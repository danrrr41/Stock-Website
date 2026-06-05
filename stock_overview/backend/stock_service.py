import yfinance as yf
import pandas as pd
import pandas_ta as ta
import numpy as np
import concurrent.futures
import os
from typing import Optional
from . import redis_service


def get_valid_users():
    """유효 비밀번호(=uid) 목록. 환경변수 SITE_PASSWORDS(쉼표구분), 기본값 제공."""
    raw = os.getenv("SITE_PASSWORDS", "1016,1114")
    return [u.strip() for u in raw.split(",") if u.strip()]


def normalize_ticker(ticker):
    t = ticker.strip().upper()
    if t.startswith('KRX:'): t = t.replace('KRX:', '').strip()
    if t.isdigit() and len(t) == 6: return f"{t}.KS"
    return t


def currency_symbol(norm_ticker):
    return "₩" if (norm_ticker.endswith(".KS") or norm_ticker.endswith(".KQ")) else "$"


def _find_indicator_cols(df):
    """pandas-ta가 만든 지표 컬럼을 접두사로 탐색 (버전별 접미사 차이 대응)."""
    return {
        'adx': next((c for c in df.columns if c.startswith('ADX_')), None),
        'dmp': next((c for c in df.columns if c.startswith('DMP_')), None),
        'dmn': next((c for c in df.columns if c.startswith('DMN_')), None),
        'pb': next((c for c in df.columns if c.startswith('BBP_')), None),
        'bbu': next((c for c in df.columns if c.startswith('BBU_')), None),
        'bbl': next((c for c in df.columns if c.startswith('BBL_')), None),
    }


def _last_val(df, col):
    if not col or col not in df.columns:
        return 0
    v = df[col].iloc[-1]
    return float(v) if not pd.isna(v) else 0


def snapshot_indicators(t_df):
    """최신 시점 지표 스냅샷 (overview/record 공통 재사용)."""
    cols = _find_indicator_cols(t_df)
    return {
        "rsi_val": _last_val(t_df, 'rsi_final'),
        "mfi_val": _last_val(t_df, 'mfi_final'),
        "adx_val": _last_val(t_df, cols['adx']),
        "di_plus_val": _last_val(t_df, cols['dmp']),
        "di_minus_val": _last_val(t_df, cols['dmn']),
        "pb_val": _last_val(t_df, cols['pb']),
    }

def calculate_indicators(df):
    """지표 계산 공통 함수"""
    if df is None or df.empty: return None
    
    # MultiIndex 처리 및 컬럼 정리
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.droplevel(1)
    df = df.dropna(subset=['Close'])
    df.columns = [c.lower() for c in df.columns]

    # pandas-ta 지표 계산
    adx = df.ta.adx(length=14)
    if adx is not None: df = pd.concat([df, adx], axis=1)
    
    df['rsi_final'] = df.ta.rsi(length=14)
    df['mfi_final'] = df.ta.mfi(length=14)
    
    macd = df.ta.macd(fast=12, slow=26, signal=9)
    if macd is not None: df = pd.concat([df, macd], axis=1)
    
    bb = df.ta.bbands(length=20, std=2)
    if bb is not None: df = pd.concat([df, bb], axis=1)
    
    df['ma5'] = df['close'].rolling(window=5).mean()
    df['ma20'] = df.ta.sma(length=20)
    df['ma60'] = df.ta.sma(length=60)
    df['ma120'] = df['close'].rolling(window=120).mean()

    df['vol_ma5'] = df['volume'].rolling(window=5).mean()
    df['vol_ma20'] = df['volume'].rolling(window=20).mean()
    
    return df

def generate_stock_json(orig_ticker, norm_ticker, df, name=None):
    """응답용 완성형 JSON 생성"""
    t_df = df.tail(60).copy()
    if t_df.empty: return None

    curr_c = t_df['close'].iloc[-1]
    prev_c = t_df['close'].iloc[-2] if len(t_df) > 1 else curr_c
    start_p = t_df['close'].iloc[0]

    cols = _find_indicator_cols(t_df)
    adx_col, dmp_col, dmn_col = cols['adx'], cols['dmp'], cols['dmn']
    pb_col, bbu_col, bbl_col = cols['pb'], cols['bbu'], cols['bbl']
    m_col, ms_col, mh_col = 'MACD_12_26_9', 'MACDs_12_26_9', 'MACDh_12_26_9'

    ohlc = []
    for dt, row in t_df.iterrows():
        ohlc.append({
            "x": dt.strftime('%Y-%m-%d'),
            "o": round(float(row['open']), 2),
            "h": round(float(row['high']), 2),
            "l": round(float(row['low']), 2),
            "c": round(float(row['close']), 2)
        })

    def clean_list(series, count=60):
        return series.ffill().bfill().fillna(0).tail(count).round(2).tolist()

    if name is None:
        name = orig_ticker

    return {
        "ticker": orig_ticker,
        "name": name,
        "current_price": float(curr_c),
        "change_pct": float(((curr_c - prev_c) / prev_c) * 100) if prev_c != 0 else 0,
        "total_change_pct": float(((curr_c - start_p) / start_p) * 100) if start_p != 0 else 0,
        "currency_symbol": currency_symbol(norm_ticker),
        **snapshot_indicators(t_df),
        "ohlc": ohlc,
        "ma5": clean_list(t_df['ma5']) if 'ma5' in t_df else [],
        "ma20": clean_list(t_df['ma20']),
        "ma60": clean_list(t_df['ma60']),
        "ma120": clean_list(t_df['ma120']) if 'ma120' in t_df else [],
        "bb_upper": clean_list(t_df[bbu_col]) if bbu_col else [0]*60,
        "bb_lower": clean_list(t_df[bbl_col]) if bbl_col else [0]*60,
        "macd": clean_list(t_df[m_col]) if m_col in t_df else [0]*60,
        "macd_signal": clean_list(t_df[ms_col]) if ms_col in t_df else [0]*60,
        "macd_hist": clean_list(t_df[mh_col]) if mh_col in t_df else [0]*60,
        "volume": t_df['volume'].fillna(0).tolist(),
        "vol_ma5": clean_list(t_df['vol_ma5']),
        "vol_ma20": clean_list(t_df['vol_ma20']),
        "dates": t_df.index.strftime('%Y-%m-%d').tolist(),
        "rsi_list": clean_list(t_df['rsi_final'], 60),
        "mfi_list": clean_list(t_df['mfi_final'], 60),
        "adx_list": clean_list(t_df[adx_col], 60) if adx_col else [0]*60,
        "di_plus_list": clean_list(t_df[dmp_col], 60) if dmp_col else [0]*60,
        "di_minus_list": clean_list(t_df[dmn_col], 60) if dmn_col else [0]*60,
        "pb_list": clean_list(t_df[pb_col], 60) if pb_col else [0]*60,
        "dates_60": t_df.index.strftime('%Y-%m-%d').tolist()
    }

def update_all_stocks(list_type: Optional[str] = None, uid: Optional[str] = None, tickers: Optional[list] = None):
    """데이터 업데이트(다운로드→지표계산→캐시 저장).
    tickers 지정 시 그 목록만, list_type/uid 지정 시 해당 리스트, 아니면 모든 사용자 즐겨찾기 ∪ 전역 nasdaq100."""
    if tickers is not None:
        orig_tickers = list(tickers)
    elif list_type:
        orig_tickers = redis_service.get_tickers(list_type, uid)
    else:
        # 모든 사용자(uid)의 즐겨찾기 + 전역 nasdaq100 합집합
        all_tickers = set(redis_service.get_tickers("nasdaq100"))
        for u in get_valid_users():
            all_tickers.update(redis_service.get_tickers("bookmark", u))
        orig_tickers = list(all_tickers)

    if not orig_tickers: return {"updated": 0, "status": "no tickers"}

    updated_count = 0
    initial_count = 0
    incremental_count = 0
    
    # 100개씩 배치 처리 (Vercel 타임아웃 방지 및 yfinance 매너)
    batch_size = 100
    for i in range(0, len(orig_tickers), batch_size):
        batch = orig_tickers[i:i+batch_size]
        ticker_map = {normalize_ticker(t): t for t in batch}
        norm_tickers = list(ticker_map.keys())

        # 배치 내 모든 종목이 기존 데이터 있는지 확인하여 period 결정
        all_have_data = True
        for norm in norm_tickers:
            if not redis_service.get_ohlcv(ticker_map[norm]):
                all_have_data = False
                break
        period = "5d" if all_have_data else "200d"

        try:
            downloaded = yf.download(norm_tickers, period=period, group_by='ticker', progress=False)
            
            for norm in norm_tickers:
                orig = ticker_map[norm]
                new_df = downloaded if len(norm_tickers) == 1 else (downloaded[norm] if norm in downloaded else pd.DataFrame())
                if new_df.empty: continue

                # 종목명 가져오기 (Redis 캐시 활용)
                name = redis_service.get_name(orig)
                if not name:
                    try:
                        t_info = yf.Ticker(norm).info
                        name = t_info.get('shortName') or t_info.get('longName') or orig
                        redis_service.save_name(orig, name)
                    except:
                        name = orig

                # 기존 Redis 데이터와 병합
                old_data = redis_service.get_ohlcv(orig)
                if old_data:
                    old_df = pd.DataFrame.from_dict(old_data, orient='index')
                    old_df.index = pd.to_datetime(old_df.index)

                    # [분할/배당 재조정 감지] 겹치는 최근일 종가가 1% 넘게 달라지면
                    # yfinance가 전체 시계열을 재조정한 것 → 전체(200d) 재다운로드로 seam 방지.
                    readjusted = False
                    overlap = old_df.index.intersection(new_df.index)
                    if len(overlap):
                        try:
                            od = float(old_df.loc[overlap[-1], 'Close'])
                            nd = float(new_df.loc[overlap[-1], 'Close'])
                            if od and abs(nd - od) / od > 0.01:
                                readjusted = True
                        except Exception:
                            pass

                    if readjusted:
                        try:
                            full = yf.download(norm, period='200d', progress=False)
                            if isinstance(full.columns, pd.MultiIndex):
                                full.columns = full.columns.droplevel(1)
                            combined_df = full if (full is not None and not full.empty) else new_df
                        except Exception:
                            combined_df = new_df
                    else:
                        combined_df = pd.concat([old_df, new_df])
                        combined_df = combined_df[~combined_df.index.duplicated(keep='last')].sort_index()
                    incremental_count += 1
                else:
                    combined_df = new_df
                    initial_count += 1

                combined_df = combined_df.tail(200)
                combined_df.index = combined_df.index.strftime('%Y-%m-%d')
                redis_service.save_ohlcv(orig, combined_df.to_dict(orient='index'))
                
                combined_df.index = pd.to_datetime(combined_df.index)
                df_with_indicators = calculate_indicators(combined_df)
                
                stock_json = generate_stock_json(orig, norm, df_with_indicators, name=name)
                if stock_json:
                    redis_service.save_stock_data(orig, stock_json)
                    updated_count += 1
        except Exception as e:
            print(f"Batch update error ({i}-{i+batch_size}): {e}")

    return {"updated": updated_count, "initial": initial_count, "incremental": incremental_count}

def get_stock_data(list_type="bookmark", uid=None, realtime=True):
    """사용자 요청용 API 로직 (bookmark는 uid별, nasdaq100은 전역).
    realtime=False면 캐시값 그대로 반환(즉석 재계산 직후 등 불필요한 추가 다운로드 생략)."""
    orig_tickers = redis_service.get_tickers(list_type, uid)
    if not orig_tickers: return []

    # 1. Redis에서 완성형 JSON들 가져오기
    cached_results = []
    for orig in orig_tickers:
        data = redis_service.get_stock_data(orig)
        if data: cached_results.append(data)

    if not cached_results: return []

    # 2. 실시간 현재가 업데이트 — 종목별 개별 호출(fast_info N회) 대신 벌크 다운로드 1회
    # 캐시 오염 방지를 위해 간단한 딕셔너리 복사 사용
    results = [dict(r) for r in cached_results]

    if realtime:
        # norm 티커 -> 해당 결과들 매핑 (중복 종목 대비)
        norm_map = {}
        for r in results:
            norm_map.setdefault(normalize_ticker(r['ticker']), []).append(r)

        rt = _bulk_realtime(list(norm_map.keys()))
        for norm, (cur, prev) in rt.items():
            if cur and prev and not np.isnan(cur) and not np.isnan(prev):
                for r in norm_map.get(norm, []):
                    r['current_price'] = cur
                    r['change_pct'] = ((cur - prev) / prev) * 100
            # else: fallback - 캐시된 기존 데이터 유지

    return results


def get_one_fresh(orig: str):
    """단일 종목을 즉석 재계산(오늘 봉 포함)하고 실시간가 반영해 반환."""
    update_all_stocks(tickers=[orig])
    data = redis_service.get_stock_data(orig)
    if not data:
        return None
    data = dict(data)
    norm = normalize_ticker(orig)
    rt = _bulk_realtime([norm])
    if norm in rt:
        cur, prev = rt[norm]
        if cur and prev and not np.isnan(cur) and not np.isnan(prev):
            data['current_price'] = cur
            data['change_pct'] = ((cur - prev) / prev) * 100
    return data


def _bulk_realtime(norm_tickers):
    """여러 종목의 (현재가, 전일종가)를 한 번의 yf.download로 가져온다.
    개별 fast_info 호출(N회 네트워크 왕복) 대비 대량 목록에서 크게 빠르다."""
    out = {}
    if not norm_tickers:
        return out
    try:
        # 캐시 시계열이 수정주가(auto_adjust=True 기본)이므로 실시간가도 동일 기준으로 맞춤
        data = yf.download(norm_tickers, period="2d", group_by="ticker",
                           progress=False, auto_adjust=True, threads=True)
    except Exception as e:
        print(f"Bulk realtime download error: {e}")
        return out

    has_mi = isinstance(data.columns, pd.MultiIndex)
    lvl0 = set(data.columns.get_level_values(0)) if has_mi else set()
    for norm in norm_tickers:
        try:
            if has_mi:
                # MultiIndex(티커, 필드) 구조 — 단일/복수 모두 해당 티커만 추출
                if norm not in lvl0:
                    continue
                sub = data[norm]
            else:
                # 평면 컬럼(단일 티커) — 그대로 사용
                sub = data
            closes = sub["Close"].dropna()
            if closes.empty:
                continue
            cur = float(closes.iloc[-1])
            prev = float(closes.iloc[-2]) if len(closes) >= 2 else cur
            out[norm] = (cur, prev)
        except Exception:
            continue
    return out
