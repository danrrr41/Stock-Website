import redis
import json
import os

# Vercel이 주는 KV_URL을 먼저 찾고, 없으면 REDIS_URL을 찾도록 유연하게 변경
REDIS_URL = os.getenv("KV_URL") or os.getenv("REDIS_URL")

if not REDIS_URL:
    raise EnvironmentError("REDIS_URL(또는 KV_URL) 환경변수가 설정되지 않았습니다.")

client = redis.from_url(REDIS_URL, decode_responses=True)

# Redis Key Helpers
def key_ohlcv(ticker: str) -> str: return f"ohlcv:{ticker}"
def key_stock_data(ticker: str) -> str: return f"stock_data:{ticker}"
def key_tickers(list_type: str) -> str: return f"tickers:{list_type}"
def key_name(ticker: str) -> str: return f"name:{ticker}"

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

def get_tickers(list_type: str) -> list:
    data = client.get(key_tickers(list_type))
    return json.loads(data) if data else []

def save_tickers(list_type: str, tickers: list):
    client.set(key_tickers(list_type), json.dumps(tickers))

def get_name(ticker: str) -> str:
    return client.get(key_name(ticker))

def save_name(ticker: str, name: str):
    client.set(key_name(ticker), name)
