import yfinance as yf
import pandas as pd
import pandas_ta as ta
import numpy as np
import concurrent.futures
from typing import Optional
from . import redis_service

def normalize_ticker(ticker):
    t = ticker.strip().upper()
    if t.startswith('KRX:'): t = t.replace('KRX:', '').strip()
    if t.isdigit() and len(t) == 6: return f"{t}.KS"
    return t

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
    
    df['ma20'] = df.ta.sma(length=20)
    df['ma60'] = df.ta.sma(length=60)
    
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

    adx_col = next((c for c in t_df.columns if c.startswith('ADX_')), None)
    dmp_col = next((c for c in t_df.columns if c.startswith('DMP_')), None)
    dmn_col = next((c for c in t_df.columns if c.startswith('DMN_')), None)
    pb_col = next((c for c in t_df.columns if c.startswith('BBP_')), None)
    bbu_col = next((c for c in t_df.columns if c.startswith('BBU_')), None)
    bbl_col = next((c for c in t_df.columns if c.startswith('BBL_')), None)
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
        "currency_symbol": "₩" if (norm_ticker.endswith(".KS") or norm_ticker.endswith(".KQ")) else "$",
        "rsi_val": float(t_df['rsi_final'].iloc[-1]) if not np.isnan(t_df['rsi_final'].iloc[-1]) else 0,
        "mfi_val": float(t_df['mfi_final'].iloc[-1]) if not np.isnan(t_df['mfi_final'].iloc[-1]) else 0,
        "adx_val": float(t_df[adx_col].iloc[-1]) if adx_col and not np.isnan(t_df[adx_col].iloc[-1]) else 0,
        "di_plus_val": float(t_df[dmp_col].iloc[-1]) if dmp_col and not np.isnan(t_df[dmp_col].iloc[-1]) else 0,
        "di_minus_val": float(t_df[dmn_col].iloc[-1]) if dmn_col and not np.isnan(t_df[dmn_col].iloc[-1]) else 0,
        "pb_val": float(t_df[pb_col].iloc[-1]) if pb_col and not np.isnan(t_df[pb_col].iloc[-1]) else 0,
        "ohlc": ohlc,
        "ma20": clean_list(t_df['ma20']),
        "ma60": clean_list(t_df['ma60']),
        "bb_upper": clean_list(t_df[bbu_col]) if bbu_col else [0]*60,
        "bb_lower": clean_list(t_df[bbl_col]) if bbl_col else [0]*60,
        "macd": clean_list(t_df[m_col]) if m_col in t_df else [0]*60,
        "macd_signal": clean_list(t_df[ms_col]) if ms_col in t_df else [0]*60,
        "macd_hist": clean_list(t_df[mh_col]) if mh_col in t_df else [0]*60,
        "volume": t_df['volume'].tolist(),
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

def update_all_stocks(list_type: Optional[str] = None):
    """Cron 작업용 전체 데이터 업데이트. list_type이 None이면 모든 등록된 티커 업데이트"""
    if list_type:
        orig_tickers = redis_service.get_tickers(list_type)
    else:
        # 모든 리스트의 티커를 합쳐서 업데이트
        bookmark = redis_service.get_tickers("bookmark")
        nasdaq = redis_service.get_tickers("nasdaq100")
        orig_tickers = list(set(bookmark + nasdaq))

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

def get_stock_data(list_type="bookmark"):
    """사용자 요청용 API 로직"""
    orig_tickers = redis_service.get_tickers(list_type)
    if not orig_tickers: return []

    # 1. Redis에서 완성형 JSON들 가져오기
    cached_results = []
    for orig in orig_tickers:
        data = redis_service.get_stock_data(orig)
        if data: cached_results.append(data)

    if not cached_results: return []

    # 2. 실시간 현재가 업데이트 (fast_info 사용)
    # 캐시 오염 방지를 위해 간단한 딕셔너리 복사 사용
    results = [dict(r) for r in cached_results]

    def fetch_realtime(res):
        try:
            norm = normalize_ticker(res['ticker'])
            t_obj = yf.Ticker(norm)
            
            # fast_info는 딕셔너리 방식으로 접근 (getattr 작동 안 함)
            current_price = float(t_obj.fast_info['lastPrice'])
            prev_close = float(t_obj.fast_info['regularMarketPreviousClose'])
            
            if current_price and prev_close and not np.isnan(current_price) and not np.isnan(prev_close):
                res['current_price'] = current_price
                res['change_pct'] = ((current_price - prev_close) / prev_close) * 100
            # else: fallback - 캐시된 기존 데이터 유지
        except Exception as e:
            print(f"Realtime fetch error for {res['ticker']}: {e}")
            # fallback: 네트워크 오류 시 None으로 덮어쓰지 않고 캐시 데이터 유지

    # 병렬 처리를 통해 속도 향상
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
        executor.map(fetch_realtime, results)

    return results
