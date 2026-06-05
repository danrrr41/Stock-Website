import redis
import json
import os

# Vercel이 주는 KV_URL을 먼저 찾고, 없으면 REDIS_URL을 찾도록 유연하게 변경
REDIS_URL = os.getenv("KV_URL") or os.getenv("REDIS_URL")

if not REDIS_URL:
    raise EnvironmentError("REDIS_URL(또는 KV_URL) 환경변수가 설정되지 않았습니다.")

client = redis.from_url(REDIS_URL, decode_responses=True)

# ---------------------------------------------------------------------------
# Redis Key Helpers
# 시장 데이터(ohlcv/stock_data/name)는 모든 사용자 공유 → 전역 키 유지.
# 즐겨찾기/기록은 사용자(uid)별로 분리.
# ---------------------------------------------------------------------------
def key_ohlcv(ticker: str) -> str: return f"ohlcv:{ticker}"
def key_stock_data(ticker: str) -> str: return f"stock_data:{ticker}"
def key_name(ticker: str) -> str: return f"name:{ticker}"

# nasdaq100은 모두 동일한 지수 구성이므로 전역 공유. 그 외(bookmark/mdd)는 uid별.
def key_tickers(list_type: str, uid: str = None) -> str:
    if list_type == "nasdaq100" or not uid:
        return f"tickers:{list_type}"
    return f"tickers:{uid}:{list_type}"

def key_records(uid: str) -> str: return f"record:{uid}"
def key_ledger(uid: str) -> str: return f"ledger:{uid}"
# Follow Up 전용 장기 히스토리 캐시 (기록된 종목만, 매수일까지 커버)
def key_rec_ohlcv(ticker: str) -> str: return f"rec_ohlcv:{ticker}"


# --- 시장 데이터 (전역) -----------------------------------------------------
def get_ohlcv(ticker: str) -> dict:
    data = client.get(key_ohlcv(ticker))
    return json.loads(data) if data else {}

def save_ohlcv(ticker: str, data: dict):
    client.set(key_ohlcv(ticker), json.dumps(data))

def get_stock_data(ticker: str) -> dict:
    data = client.get(key_stock_data(ticker))
    return json.loads(data) if data else {}

def save_stock_data(ticker: str, data: dict):
    client.set(key_stock_data(ticker), json.dumps(data))

def get_name(ticker: str) -> str:
    return client.get(key_name(ticker))

def save_name(ticker: str, name: str):
    client.set(key_name(ticker), name)


# --- 즐겨찾기 (uid별, nasdaq100은 전역) -------------------------------------
def get_tickers(list_type: str, uid: str = None) -> list:
    data = client.get(key_tickers(list_type, uid))
    return json.loads(data) if data else []

def save_tickers(list_type: str, tickers: list, uid: str = None):
    client.set(key_tickers(list_type, uid), json.dumps(tickers))


# --- 매매 포지션 기록 (uid별) ----------------------------------------------
def get_records(uid: str) -> list:
    data = client.get(key_records(uid))
    return json.loads(data) if data else []

def save_records(uid: str, records: list):
    client.set(key_records(uid), json.dumps(records))


# --- 매매 원장 (uid별) -----------------------------------------------------
def get_ledger(uid: str) -> list:
    data = client.get(key_ledger(uid))
    return json.loads(data) if data else []

def save_ledger(uid: str, entries: list):
    client.set(key_ledger(uid), json.dumps(entries))


# --- Follow Up 장기 히스토리 캐시 (전역, 기록된 종목만) -----------------------
def get_rec_ohlcv(ticker: str) -> dict:
    data = client.get(key_rec_ohlcv(ticker))
    return json.loads(data) if data else {}

def save_rec_ohlcv(ticker: str, obj: dict):
    client.set(key_rec_ohlcv(ticker), json.dumps(obj))

def delete_rec_ohlcv(ticker: str):
    client.delete(key_rec_ohlcv(ticker))
