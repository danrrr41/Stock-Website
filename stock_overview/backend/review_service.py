"""stock_review (복기) 백엔드 로직.

- 임의 종목/날짜의 차트(진입 직전 ~ 현재까지) 생성 + 진입 시점 마커
- 수량/매매금액으로 수익률·평가손익 산출 (소수점 주식 지원)
- 복기 메모(왜 들어갔는지) CRUD

stock_overview/record 데이터 로직(normalize_ticker, calculate_indicators,
generate_stock_json, _download_clean, _bulk_realtime, _kst_to_us)을 재사용한다.
"""
import uuid
from datetime import datetime, timedelta, timezone

import pandas as pd

from . import redis_service
from . import stock_service
from . import record_service


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# ===========================================================================
# 1) 복기 차트 — 진입 직전 ~ 현재까지, 진입 시점 마커 + (옵션) 수익률
# ===========================================================================
def review_chart(ticker: str, date: str, quantity=None, amount=None, fee=None):
    """ticker의 진입일(date, KST) 직전부터 현재까지의 차트 JSON.

    - generate_stock_json과 동일 스키마로 반환 → 프론트 차트 렌더러 재사용.
    - entry_us: 매수 시점 수직선용(차트 dates와 같은 미국 날짜 문자열).
    - quantity/amount(총액)/fee가 있으면 평균매수가 = (amount - fee)/quantity 로 산출.
      평가손익·수익률의 원가 기준은 실제 지출액 = amount(수수료 포함).
    """
    orig = (ticker or "").strip().upper()
    if not orig or not date:
        return None
    norm = stock_service.normalize_ticker(orig)
    try:
        # 기록 날짜를 미국 거래일로 직접 사용(±1 변환 없음).
        # stock_record가 "미국 장 기준"으로 입력받는 것과 통일 → 차트도 미국 날짜로 표시.
        target = datetime.strptime(date, "%Y-%m-%d")
    except Exception:
        return None

    # 진입 전 리드업 + 120MA 워밍업 위해 진입일 기준 넉넉히 과거부터, 현재까지(end=None).
    start = (target - timedelta(days=365)).strftime("%Y-%m-%d")
    try:
        df = record_service._download_clean(norm, start=start)
    except Exception:
        return None
    if df is None or df.empty:
        return None
    df = stock_service.calculate_indicators(df)
    if df is None or df.empty:
        return None
    df.index = pd.to_datetime(df.index)

    # 진입 봉 = 기록 날짜(미국 거래일) 당일 또는 그 이후 첫 거래일.
    # (주말/휴일이면 다음 거래일로 — 입력일보다 앞 봉에 찍히는 문제 방지)
    on_after = df.index[df.index >= pd.Timestamp(target)]
    entry_bar = on_after[0] if len(on_after) else df.index[-1]
    entry_pos = df.index.get_loc(entry_bar)
    LEAD = 60  # 진입 전 표시할 영업일 수(맥락)
    start_pos = max(0, entry_pos - LEAD)
    count = len(df) - start_pos

    name = redis_service.get_name(orig) or orig
    data = stock_service.generate_stock_json(orig, norm, df, name=name, count=count)
    if not data:
        return None

    # 매수 시점 수직선용(차트 dates와 동일한 미국 날짜 문자열)
    data["entry_us"] = entry_bar.strftime("%Y-%m-%d")

    # 현재가: 실시간 우선, 실패 시 마지막 종가(generate_stock_json의 current_price 유지)
    try:
        rt = stock_service._bulk_realtime([norm])
        if norm in rt:
            cur = rt[norm][0]
            if cur and cur == cur:  # NaN 아님
                data["current_price"] = round(float(cur), 2)
    except Exception:
        pass

    # 수량 + 매매 총액 + 수수료 → 수익률.
    # 평균매수가(순단가) = (총액 - 수수료) / 수량. 원가 기준 = 총액(수수료 포함).
    q = _num_or_none(quantity)
    amt = _num_or_none(amount)
    fe = _num_or_none(fee) or 0.0
    if q and q > 0 and amt is not None:
        cur = float(data["current_price"])
        market_value = cur * q
        profit = market_value - amt
        data["quantity"] = q
        data["amount"] = round(amt, 2)
        data["fee"] = round(fe, 2)
        data["buy_price"] = round((amt - fe) / q, 4)
        data["market_value"] = round(market_value, 2)
        data["profit"] = round(profit, 2)
        data["return_pct"] = round((profit / amt * 100) if amt else 0, 2)
        try:
            kst_today = (datetime.now(timezone.utc) + timedelta(hours=9)).date()
            data["days_held"] = (kst_today - datetime.strptime(date, "%Y-%m-%d").date()).days
        except Exception:
            data["days_held"] = 0

    return data


# ===========================================================================
# 2) 복기 메모 (review:{uid}) — 왜 들어갔는지 한두 줄
# ===========================================================================
def list_reviews(uid: str) -> list:
    return sorted(
        redis_service.get_reviews(uid),
        key=lambda r: (r.get("date", ""), r.get("created_at", "")),
        reverse=True,
    )


def _num_or_none(v):
    try:
        return float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def add_review(uid: str, ticker: str, date: str, quantity=None, amount=None, fee=None, memo: str = "") -> dict:
    reviews = redis_service.get_reviews(uid)
    r = {
        "id": _new_id(),
        "ticker": str(ticker).strip().upper(),
        "date": date,
        "quantity": _num_or_none(quantity),
        "amount": _num_or_none(amount),
        "fee": _num_or_none(fee),
        "memo": memo or "",
        "created_at": _now(),
    }
    reviews.append(r)
    redis_service.save_reviews(uid, reviews)
    return r


def update_review(uid: str, rid: str, fields: dict):
    reviews = redis_service.get_reviews(uid)
    for r in reviews:
        if r["id"] == rid:
            for k in ("ticker", "date", "quantity", "amount", "fee", "memo"):
                if k in fields and fields[k] is not None:
                    if k == "ticker":
                        r[k] = str(fields[k]).strip().upper()
                    elif k in ("quantity", "amount", "fee"):
                        r[k] = _num_or_none(fields[k])
                    else:
                        r[k] = fields[k]
            redis_service.save_reviews(uid, reviews)
            return r
    return None


def delete_review(uid: str, rid: str) -> dict:
    reviews = redis_service.get_reviews(uid)
    new = [r for r in reviews if r["id"] != rid]
    redis_service.save_reviews(uid, new)
    return {"deleted": len(reviews) - len(new)}
