"""stock_record 시스템 백엔드 로직.

- 보유 포지션 기록(매수만, 미니멀) CRUD + Follow Up 계산
- 매매 원장(매수/매도) CRUD + 통계

stock_overview의 데이터 로직(normalize_ticker, calculate_indicators,
snapshot_indicators, currency_symbol)을 재사용한다.
"""
import uuid
from datetime import datetime, timedelta, timezone

import yfinance as yf
import pandas as pd
import numpy as np

from . import redis_service
from . import stock_service


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# 미국 거래일(yfinance) ↔ 한국시간(KST) 표시 변환.
# 미국 정규장은 KST 기준 그날 밤~다음날 새벽 → KST 표시일 = 미국 거래일 + 1일.
def _us_to_kst(dt):
    return dt + timedelta(days=1)


def _kst_to_us(date_str: str):
    return datetime.strptime(date_str, "%Y-%m-%d") - timedelta(days=1)


# ===========================================================================
# 1) 보유 포지션 기록 (record:{uid}) — 매수만
# ===========================================================================
def list_records(uid: str) -> list:
    return redis_service.get_records(uid)


def add_record(uid: str, ticker: str, buy_date: str, buy_price, quantity, fee=0, memo: str = "") -> dict:
    records = redis_service.get_records(uid)
    rec = {
        "id": _new_id(),
        "ticker": str(ticker).strip().upper(),
        "buy_date": buy_date,
        "buy_price": float(buy_price),
        "quantity": float(quantity),
        "fee": float(fee or 0),
        "memo": memo or "",
        "created_at": _now(),
    }
    records.append(rec)
    redis_service.save_records(uid, records)
    return rec


def update_record(uid: str, rec_id: str, fields: dict):
    records = redis_service.get_records(uid)
    for r in records:
        if r["id"] == rec_id:
            for k in ("ticker", "buy_date", "buy_price", "quantity", "fee", "memo"):
                if k in fields and fields[k] is not None:
                    if k in ("buy_price", "quantity", "fee"):
                        r[k] = float(fields[k])
                    elif k == "ticker":
                        r[k] = str(fields[k]).strip().upper()
                    else:
                        r[k] = fields[k]
            redis_service.save_records(uid, records)
            return r
    return None


def delete_record(uid: str, rec_id: str) -> dict:
    records = redis_service.get_records(uid)
    target = next((r for r in records if r["id"] == rec_id), None)
    new_records = [r for r in records if r["id"] != rec_id]
    redis_service.save_records(uid, new_records)
    if target:
        _maybe_cleanup_history(target.get("ticker", ""))
    return {"deleted": len(records) - len(new_records)}


# ===========================================================================
# 2) Follow Up 계산 — 매수 이후 차트 + 현재 지표 + 수익률/실제 수익
# ===========================================================================
def _clean_series(series):
    return series.ffill().bfill().fillna(0).round(2).tolist()


# --- Follow Up 히스토리 캐시 (다운로드 최소화) -------------------------------
_STD_COLS = ["Open", "High", "Low", "Close", "Volume"]


def _df_from_data(data: dict):
    if not data:
        return None
    df = pd.DataFrame.from_dict(data, orient="index")
    if df.empty:
        return None
    df.index = pd.to_datetime(df.index)
    return df.sort_index()


def _store_df(df) -> dict:
    d = df.copy()
    d.index = d.index.strftime("%Y-%m-%d")
    return d.to_dict(orient="index")


def _download_clean(norm: str, start=None, end=None):
    """yfinance에서 받아 표준 OHLCV(대문자) DataFrame으로 정리."""
    df = yf.download(norm, start=start, end=end, progress=False, auto_adjust=True)
    if df is None or df.empty:
        return None
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.droplevel(1)
    keep = [c for c in _STD_COLS if c in df.columns]
    if "Close" not in keep:
        return None
    df = df[keep].dropna(subset=["Close"])
    df.index = pd.to_datetime(df.index)
    return df if not df.empty else None


def _ensure_history(orig: str, norm: str, need_start: str):
    """매수일(need_start)부터 현재까지의 OHLCV를 확보. 불필요한 재다운로드 방지.

    - 캐시가 있으면 재사용. 과거가 부족하면 그 부분만 백필.
    - 최신 보강은 하루 1회(updated != 오늘)만.
    - 캐시가 비었고 전역 ohlcv(즐겨찾기/나스닥)가 매수일을 커버하면 그것을 시드로 재사용.
    """
    today = datetime.now().strftime("%Y-%m-%d")
    cache = redis_service.get_rec_ohlcv(orig)
    data = cache.get("data") if cache else None
    updated = cache.get("updated") if cache else None

    # 캐시가 없으면: 전역 ohlcv가 충분히 과거를 커버하면 시드로 재사용
    if not data:
        global_oh = redis_service.get_ohlcv(orig)
        if global_oh and min(global_oh.keys()) <= need_start:
            data = dict(global_oh)

    df = _df_from_data(data)
    changed = False

    if df is None or df.empty:
        # 최초 다운로드: 매수일부터 현재까지
        df = _download_clean(norm, start=need_start)
        if df is None:
            return None
        changed = True
    else:
        cmin = df.index.min().strftime("%Y-%m-%d")
        cmax = df.index.max().strftime("%Y-%m-%d")
        # 과거 백필 (더 오래된 매수일이 들어온 경우)
        if need_start < cmin:
            older = _download_clean(norm, start=need_start, end=cmin)
            if older is not None:
                df = pd.concat([older, df])
                changed = True
        # 최신 보강 (하루 1회)
        if updated != today:
            newer = _download_clean(norm, start=cmax)
            if newer is not None and not newer.empty:
                # [분할/배당 재조정 감지] 겹치는 cmax 종가가 1% 넘게 달라지면
                # 전체 시계열 재조정 → need_start부터 전체 재다운로드로 seam 방지.
                readj = False
                cmax_ts = pd.Timestamp(cmax)
                if cmax_ts in newer.index and cmax_ts in df.index:
                    try:
                        od = float(df.loc[cmax_ts, "Close"])
                        nd = float(newer.loc[cmax_ts, "Close"])
                        if od and abs(nd - od) / od > 0.01:
                            readj = True
                    except Exception:
                        pass
                if readj:
                    full = _download_clean(norm, start=need_start)
                    df = full if (full is not None and not full.empty) else pd.concat([df, newer])
                else:
                    df = pd.concat([df, newer])
            changed = True  # 오늘 갱신 시도 완료로 표시 → 같은 날 재다운로드 방지

    df = df[~df.index.duplicated(keep="last")].sort_index()
    if changed:
        redis_service.save_rec_ohlcv(orig, {"updated": today, "data": _store_df(df)})
    return df


def _maybe_cleanup_history(ticker: str):
    """해당 종목을 아무 사용자도 더 이상 거래내역에 갖고 있지 않으면 followup 캐시 삭제."""
    t = ticker.strip().upper()
    for u in stock_service.get_valid_users():
        for e in redis_service.get_ledger(u):
            if e.get("ticker", "").strip().upper() == t:
                return  # 아직 사용 중
        for r in redis_service.get_records(u):  # 이전 호환
            if r.get("ticker", "").strip().upper() == t:
                return
    redis_service.delete_rec_ohlcv(t)


def followup_for_record(rec: dict) -> dict:
    """단일 포지션 기록의 Follow Up 데이터 계산."""
    orig = rec["ticker"]
    norm = stock_service.normalize_ticker(orig)
    buy_date = rec["buy_date"]
    buy_price = float(rec["buy_price"])
    qty = float(rec["quantity"])
    fee = float(rec.get("fee", 0) or 0)

    base = {
        "id": rec["id"],
        "ticker": orig,
        "buy_date": buy_date,
        "buy_price": buy_price,
        "quantity": qty,
        "fee": fee,
        "memo": rec.get("memo", ""),
        "name": redis_service.get_name(orig) or orig,
        "currency_symbol": stock_service.currency_symbol(norm),
    }

    # 입력 매수일(KST) → 미국 거래일로 변환, 지표 시드 위해 120일 더 과거까지
    try:
        us_buy = _kst_to_us(buy_date)
        need_start = (us_buy - timedelta(days=120)).strftime("%Y-%m-%d")
    except Exception:
        return {**base, "error": "잘못된 매수일 형식"}

    # 캐시 우선 확보 (불필요한 재다운로드 방지)
    try:
        hist = _ensure_history(orig, norm, need_start)
    except Exception as e:
        return {**base, "error": f"다운로드 실패: {e}"}

    if hist is None or hist.empty:
        return {**base, "error": "데이터 없음"}

    # 지표 계산은 필요한 구간(매수일 시드부터)만 → 속도 최적화
    hist = hist[hist.index >= pd.to_datetime(need_start)]
    df = stock_service.calculate_indicators(hist.copy())  # 컬럼 소문자화 + 지표 계산
    if df is None or df.empty:
        return {**base, "error": "지표 계산 실패"}

    df.index = pd.to_datetime(df.index)

    # 현재가: 실시간(fast_info) 우선, 실패 시 마지막 종가
    current_price = float(df["close"].iloc[-1])
    try:
        lp = float(yf.Ticker(norm).fast_info["lastPrice"])
        if lp and not np.isnan(lp):
            current_price = lp
    except Exception:
        pass

    # 매수일(미국 거래일) 이후 구간만 차트로
    chart_df = df[df.index >= us_buy]
    if chart_df.empty:
        chart_df = df.tail(1)

    cols = stock_service._find_indicator_cols(df)
    ohlc = [{
        "x": _us_to_kst(dt).strftime("%Y-%m-%d"),  # KST 표시일
        "o": round(float(row["open"]), 2),
        "h": round(float(row["high"]), 2),
        "l": round(float(row["low"]), 2),
        "c": round(float(row["close"]), 2),
    } for dt, row in chart_df.iterrows()]

    return_pct = ((current_price - buy_price) / buy_price * 100) if buy_price else 0
    profit = (current_price - buy_price) * qty - fee  # 수수료 차감한 실제 수익
    try:
        kst_today = (datetime.now(timezone.utc) + timedelta(hours=9)).date()  # KST 기준 오늘
        days_held = (kst_today - datetime.strptime(buy_date, "%Y-%m-%d").date()).days
    except Exception:
        days_held = 0

    payload = {
        **base,
        "current_price": round(current_price, 2),
        "return_pct": round(return_pct, 2),
        "profit": round(profit, 2),
        "days_held": days_held,
        "dates": (chart_df.index + pd.Timedelta(days=1)).strftime("%Y-%m-%d").tolist(),  # KST 표시일
        "ohlc": ohlc,
        "ma5": _clean_series(chart_df["ma5"]) if "ma5" in chart_df else [],
        "ma20": _clean_series(chart_df["ma20"]) if "ma20" in chart_df else [],
        "ma60": _clean_series(chart_df["ma60"]) if "ma60" in chart_df else [],
        "ma120": _clean_series(chart_df["ma120"]) if "ma120" in chart_df else [],
        "bb_upper": _clean_series(chart_df[cols["bbu"]]) if cols["bbu"] in chart_df else [],
        "bb_lower": _clean_series(chart_df[cols["bbl"]]) if cols["bbl"] in chart_df else [],
        # 지표 미니차트용 시계열 (차트와 동일 기간)
        "rsi_list": _clean_series(chart_df["rsi_final"]) if "rsi_final" in chart_df else [],
        "mfi_list": _clean_series(chart_df["mfi_final"]) if "mfi_final" in chart_df else [],
        "adx_list": _clean_series(chart_df[cols["adx"]]) if cols["adx"] in chart_df else [],
        "di_plus_list": _clean_series(chart_df[cols["dmp"]]) if cols["dmp"] in chart_df else [],
        "di_minus_list": _clean_series(chart_df[cols["dmn"]]) if cols["dmn"] in chart_df else [],
        "pb_list": _clean_series(chart_df[cols["pb"]]) if cols["pb"] in chart_df else [],
    }
    payload.update(stock_service.snapshot_indicators(df))  # 최신 시점 지표 스냅샷
    return payload


def compute_followup(uid: str, rec_id: str):
    rec = next((r for r in redis_service.get_records(uid) if r["id"] == rec_id), None)
    if not rec:
        return None
    return followup_for_record(rec)


# ===========================================================================
# 3) 매매 원장 (ledger:{uid}) — 매수/매도 전체 + 통계
# ===========================================================================
def list_ledger(uid: str) -> list:
    return redis_service.get_ledger(uid)


def add_ledger(uid: str, ticker: str, type_: str, date: str, price, quantity, fee=0, memo: str = "") -> dict:
    entries = redis_service.get_ledger(uid)
    entry = {
        "id": _new_id(),
        "ticker": str(ticker).strip().upper(),
        "type": type_ if type_ in ("buy", "sell") else "buy",
        "date": date,
        "price": float(price),
        "quantity": float(quantity),
        "fee": float(fee or 0),
        "memo": memo or "",
        "created_at": _now(),
    }
    entries.append(entry)
    redis_service.save_ledger(uid, entries)
    return entry


def update_ledger(uid: str, eid: str, fields: dict):
    entries = redis_service.get_ledger(uid)
    for e in entries:
        if e["id"] == eid:
            for k in ("ticker", "type", "date", "price", "quantity", "fee", "memo"):
                if k in fields and fields[k] is not None:
                    if k in ("price", "quantity", "fee"):
                        e[k] = float(fields[k])
                    elif k == "ticker":
                        e[k] = str(fields[k]).strip().upper()
                    elif k == "type":
                        e[k] = fields[k] if fields[k] in ("buy", "sell") else e[k]
                    else:
                        e[k] = fields[k]
            redis_service.save_ledger(uid, entries)
            return e
    return None


def delete_ledger(uid: str, eid: str) -> dict:
    entries = redis_service.get_ledger(uid)
    target = next((e for e in entries if e["id"] == eid), None)
    new_entries = [e for e in entries if e["id"] != eid]
    redis_service.save_ledger(uid, new_entries)
    if target:
        _maybe_cleanup_history(target.get("ticker", ""))
    return {"deleted": len(entries) - len(new_entries)}


def ledger_stats(uid: str) -> dict:
    """평균단가법 실현손익 통계."""
    entries = sorted(
        redis_service.get_ledger(uid),
        key=lambda e: (e["ticker"], e.get("date", ""), e.get("created_at", "")),
    )
    by_ticker = {}
    for e in entries:
        t = e["ticker"]
        st = by_ticker.setdefault(t, {
            "qty": 0.0, "cost": 0.0, "realized": 0.0,
            "buys": 0, "sells": 0, "wins": 0,
        })
        q = float(e["quantity"])
        p = float(e["price"])
        fee = float(e.get("fee", 0) or 0)
        if e["type"] == "buy":
            st["cost"] += q * p + fee  # 매수 수수료는 원가에 가산
            st["qty"] += q
            st["buys"] += 1
        else:  # sell
            if st["qty"] > 0:
                avg = st["cost"] / st["qty"]
                sold = min(q, st["qty"])               # 보유 초과분은 무시(음수 수량 방지)
                realized = (p - avg) * sold - fee       # 매도 수수료 차감
                st["realized"] += realized
                st["cost"] -= avg * sold
                st["qty"] -= sold
                st["sells"] += 1
                if realized > 0:
                    st["wins"] += 1
            else:
                # 보유 없는 매도(데이터 오류 등): 0원가 가짜 수익 방지, 수수료만 반영
                st["realized"] -= fee
                st["sells"] += 1

    per_ticker = []
    total_realized = 0.0
    total_sells = 0
    total_wins = 0
    for t, st in by_ticker.items():
        avg_cost = (st["cost"] / st["qty"]) if st["qty"] > 0 else 0
        per_ticker.append({
            "ticker": t,
            "net_qty": round(st["qty"], 4),
            "avg_cost": round(avg_cost, 4),
            "realized": round(st["realized"], 2),
            "trades": st["buys"] + st["sells"],
        })
        total_realized += st["realized"]
        total_sells += st["sells"]
        total_wins += st["wins"]

    win_rate = (total_wins / total_sells * 100) if total_sells else 0
    per_ticker.sort(key=lambda x: x["ticker"])

    # 평가손익(미실현): 현재 보유분 × 현재가 기준
    unrealized = 0.0
    positions = get_positions(uid)
    if positions:
        norm_map = {stock_service.normalize_ticker(p["ticker"]): p for p in positions}
        try:
            rt = stock_service._bulk_realtime(list(norm_map.keys()))
        except Exception:
            rt = {}
        for norm, p in norm_map.items():
            if norm in rt:
                cur = rt[norm][0]
                if cur and cur == cur:  # NaN 아님
                    unrealized += (cur - p["avg_price"]) * p["quantity"]

    return {
        "per_ticker": per_ticker,
        "total_realized": round(total_realized, 2),
        "unrealized": round(unrealized, 2),
        "total_pnl": round(total_realized + unrealized, 2),
        "total_sell_trades": total_sells,
        "win_rate": round(win_rate, 1),
    }


# ===========================================================================
# 4) 보유 종목 (거래내역에서 자동 산출) — 매수/매도 통합 모델
# ===========================================================================
def _aggregate_positions(uid: str) -> dict:
    """거래내역(ledger)에서 종목별 보유 수량/평균단가(수수료 포함) 산출."""
    txs = sorted(
        redis_service.get_ledger(uid),
        key=lambda e: (e.get("ticker", ""), e.get("date", ""), e.get("created_at", "")),
    )
    pos = {}
    for e in txs:
        t = e["ticker"]
        st = pos.setdefault(t, {"qty": 0.0, "cost": 0.0, "first_buy": None})
        q = float(e["quantity"])
        p = float(e["price"])
        fee = float(e.get("fee", 0) or 0)
        if e.get("type") == "buy":
            st["cost"] += q * p + fee          # 수수료 원가 가산
            st["qty"] += q
            d = e.get("date")
            if d and (st["first_buy"] is None or d < st["first_buy"]):
                st["first_buy"] = d
        else:  # sell
            if st["qty"] > 0:
                avg = st["cost"] / st["qty"]
                sold = min(q, st["qty"])
                st["cost"] -= avg * sold
                st["qty"] -= sold
    return pos


def get_positions(uid: str) -> list:
    """현재 순보유(>0) 종목 목록."""
    out = []
    for t, st in _aggregate_positions(uid).items():
        if st["qty"] > 1e-9:
            out.append({
                "ticker": t,
                "name": redis_service.get_name(t) or t,
                "quantity": round(st["qty"], 6),
                "avg_price": round(st["cost"] / st["qty"], 4),  # 수수료 반영 평균단가
                "first_buy": st["first_buy"],
            })
    out.sort(key=lambda x: x["ticker"])
    return out


def held_quantity(uid: str, ticker: str) -> float:
    """현재 순보유 수량(없으면 0)."""
    t = (ticker or "").strip().upper()
    st = _aggregate_positions(uid).get(t)
    return round(st["qty"], 6) if st else 0.0


def followup_for_ticker(uid: str, ticker: str):
    """보유 종목 1개의 Follow Up (평균매수가/순수량/최초매수일 기준)."""
    ticker = (ticker or "").strip().upper()
    h = next((x for x in get_positions(uid) if x["ticker"] == ticker), None)
    if not h:
        return None
    holding = {
        "id": ticker,
        "ticker": ticker,
        "buy_date": h["first_buy"],
        "buy_price": h["avg_price"],
        "quantity": h["quantity"],
        "fee": 0,  # 수수료는 avg_price에 이미 반영
        "memo": "",
    }
    return followup_for_record(holding)


def migrate_records_to_ledger(uid: str) -> int:
    """기존 포지션(record:{uid}) 매수기록을 거래내역(ledger)으로 이전 후 비움(멱등)."""
    recs = redis_service.get_records(uid)
    if not recs:
        return 0
    entries = redis_service.get_ledger(uid)
    existing = {e.get("id") for e in entries}
    moved = 0
    for r in recs:
        mid = "mig_" + str(r.get("id", ""))
        if mid in existing:
            continue
        entries.append({
            "id": mid,
            "ticker": str(r.get("ticker", "")).strip().upper(),
            "type": "buy",
            "date": r.get("buy_date"),
            "price": float(r.get("buy_price", 0) or 0),
            "quantity": float(r.get("quantity", 0) or 0),
            "fee": float(r.get("fee", 0) or 0),
            "memo": r.get("memo", ""),
            "created_at": r.get("created_at", _now()),
        })
        moved += 1
    if moved:
        redis_service.save_ledger(uid, entries)
        redis_service.save_records(uid, [])
    return moved
