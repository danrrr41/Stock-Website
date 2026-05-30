from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from . import stock_service
from . import redis_service
from pydantic import BaseModel
import yfinance as yf
import pandas as pd
import numpy as np
import os
from typing import Optional

app = FastAPI()

CRON_SECRET = os.getenv("CRON_SECRET", "default_secret")
SITE_PASSWORD = "0603"

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def migrate_file_to_redis():
    # ... (existing bookmark and nasdaq100 logic) ...
    # Initialize MDD tickers if not present
    if not redis_service.get_tickers("mdd"):
        redis_service.save_tickers("mdd", ["QQQ", "SPY", "NVDA", "TSLA", "AAPL", "MSFT"])
    
    bookmark_path = os.path.join(os.path.dirname(__file__), "../settings/Ticker_Bookmark.txt")
    if os.path.exists(bookmark_path) and not redis_service.get_tickers("bookmark"):
        with open(bookmark_path, "r", encoding="utf-8") as f:
            content = f.read()
            tickers = [t.strip() for t in content.replace("\n", ",").split(",") if t.strip()]
            if tickers:
                redis_service.save_tickers("bookmark", tickers)
    nasdaq_path = os.path.join(os.path.dirname(__file__), "../settings/Ticker_NASDAQ100.txt")
    if os.path.exists(nasdaq_path) and not redis_service.get_tickers("nasdaq100"):
        with open(nasdaq_path, "r", encoding="utf-8") as f:
            content = f.read()
            tickers = [t.strip() for t in content.replace("\n", ",").split(",") if t.strip()]
            if tickers:
                redis_service.save_tickers("nasdaq100", tickers)

@app.get("/api/stocks")
async def get_stocks(list_type: Optional[str] = "bookmark"):
    return stock_service.get_stock_data(list_type)

@app.get("/api/cron/update")
async def cron_update(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    token = authorization.split(" ")[1]
    if token != CRON_SECRET:
        raise HTTPException(status_code=401, detail="Invalid token")
    res = stock_service.update_all_stocks()
    return res

@app.get("/api/settings/tickers")
async def get_tickers(list_type: str = "bookmark"):
    tickers = redis_service.get_tickers(list_type)
    return {"tickers": ", ".join(tickers)}

class TickerUpdate(BaseModel):
    tickers: str
    list_type: Optional[str] = "bookmark"

@app.post("/api/settings/tickers")
async def save_tickers(data: TickerUpdate):
    tickers = [t.strip().upper() for t in data.tickers.replace("\n", ",").split(",") if t.strip()]
    redis_service.save_tickers(data.list_type, tickers)
    return {"status": "success"}

@app.get("/api/calculate")
async def calculate(code: str = "QQQ", start: str = "2004-01-01", end: str = "2026-01-30", threshold: float = 80.0):
    try:
        df = yf.download(code, start=start, end=end, progress=False)
        if df.empty:
            return JSONResponse(status_code=400, content={"message": "데이터 없음"})
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        price_col = "Adj Close" if "Adj Close" in df.columns else "Close"
        df = df[[price_col]].copy()
        df.columns = ["Price"]
        df["Peak"] = df["Price"].cummax()
        df["Drawdown"] = (df["Price"] - df["Peak"]) / df["Peak"] * 100
        max_mdd_val = df["Drawdown"].min()
        max_mdd_date = df["Drawdown"].idxmin()
        current_peak = df["Peak"].iloc[-1]
        threshold_val_pct = np.percentile(df["Drawdown"], 100 - threshold)
        price_at_threshold = current_peak * (1 + threshold_val_pct / 100)
        chart_data = [{"x": int(ts.timestamp() * 1000), "y": round(val, 2)} for ts, val in df["Drawdown"].items()]
        total_days = len(df)
        table_rows = []
        for ts in range(0, -105, -5):
            r_rate = len(df[df["Drawdown"] >= ts]) / total_days * 100
            w_days = len(df[df["Drawdown"] == 0]) if ts == 0 else len(df[(df["Drawdown"] >= ts) & (df["Drawdown"] < ts + 5)])
            weight = w_days / total_days * 100
            table_rows.append({"mdd": f"{ts}%", "recovery": round(r_rate, 1), "weight": round(weight, 1)})
        return {"chart_data": chart_data, "table_data": table_rows, "threshold_line": round(threshold_val_pct, 2), "stats": {"max_mdd": round(max_mdd_val, 2), "max_mdd_date": max_mdd_date.strftime("%Y-%m-%d"), "last_price": round(df["Price"].iloc[-1], 2), "last_val": round(df["Drawdown"].iloc[-1], 2), "peak_price": round(current_peak, 2), "price_at_threshold": round(price_at_threshold, 2), "last_date": df.index[-1].strftime("%Y-%m-%d")}}
    except Exception as e:
        return JSONResponse(status_code=500, content={"message": str(e)})

gateway_path = os.path.join(os.path.dirname(__file__), "../../gateway")
frontend_path = os.path.join(os.path.dirname(__file__), "../frontend")
mdd_frontend_path = os.path.join(os.path.dirname(__file__), "../../mdd_calculator/api")
app.mount("/static", StaticFiles(directory=frontend_path), name="static")

@app.get("/")
async def read_gateway():
    return FileResponse(os.path.join(gateway_path, "index.html"))

@app.get("/stock")
async def read_stock():
    return FileResponse(os.path.join(frontend_path, "index.html"))

@app.get("/mdd")
async def read_mdd():
    return FileResponse(os.path.join(mdd_frontend_path, "index.html"))

@app.get("/settings")
async def read_settings():
    return FileResponse(os.path.join(frontend_path, "settings.html"))

@app.get("/api/health")
async def health():
    return {"status": "ok"}
