from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from . import stock_service
from . import redis_service
from . import record_service
from pydantic import BaseModel
import yfinance as yf
import pandas as pd
import numpy as np
import os
from typing import Optional

app = FastAPI()

CRON_SECRET = os.getenv("CRON_SECRET", "default_secret")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _check_uid(uid: Optional[str]) -> str:
    """uid가 유효한 사용자인지 검증."""
    if not uid or uid not in stock_service.get_valid_users():
        raise HTTPException(status_code=401, detail="유효하지 않은 사용자입니다.")
    return uid


@app.on_event("startup")
async def startup_seed():
    # 1) NASDAQ100 목록 → 전역 시드 (최초 1회)
    nasdaq_path = os.path.join(os.path.dirname(__file__), "../settings/Ticker_NASDAQ100.txt")
    if os.path.exists(nasdaq_path) and not redis_service.get_tickers("nasdaq100"):
        with open(nasdaq_path, "r", encoding="utf-8") as f:
            tickers = [t.strip() for t in f.read().replace("\n", ",").split(",") if t.strip()]
            if tickers:
                redis_service.save_tickers("nasdaq100", tickers)

    # 2) 사용자(uid)별 즐겨찾기 시드 (없으면 AAPL). MDD는 이 bookmark를 공유.
    for uid in stock_service.get_valid_users():
        if not redis_service.get_tickers("bookmark", uid):
            redis_service.save_tickers("bookmark", ["AAPL"], uid)

    # 3) 기존 포지션 기록(record) → 거래내역(ledger) 이전 (멱등)
    for uid in stock_service.get_valid_users():
        record_service.migrate_records_to_ledger(uid)


# ===========================================================================
# 인증
# ===========================================================================
class LoginRequest(BaseModel):
    password: str


@app.post("/api/auth/login")
async def login(data: LoginRequest):
    if data.password in stock_service.get_valid_users():
        return {"ok": True, "uid": data.password}
    raise HTTPException(status_code=401, detail="비밀번호가 올바르지 않습니다.")


# ===========================================================================
# Stock Overview
# ===========================================================================
@app.get("/api/stocks")
async def get_stocks(list_type: Optional[str] = "bookmark", uid: Optional[str] = None):
    _check_uid(uid)
    # 즐겨찾기는 로드 시 즉석 재계산(오늘 봉 반영). 나스닥100은 무거우니 크론 캐시 사용.
    if list_type == "bookmark":
        stock_service.update_all_stocks(list_type="bookmark", uid=uid)
        return stock_service.get_stock_data(list_type, uid, realtime=False)
    return stock_service.get_stock_data(list_type, uid)


@app.get("/api/stocks/refresh")
async def refresh_stock(ticker: str, uid: Optional[str] = None):
    _check_uid(uid)
    data = stock_service.get_one_fresh(ticker.strip().upper())
    if not data:
        raise HTTPException(status_code=404, detail="데이터를 가져올 수 없습니다.")
    return data


@app.get("/api/cron/update")
async def cron_update(authorization: Optional[str] = Header(None)):
    # 크론 보안: Vercel은 CRON_SECRET 설정 시 자동으로 Bearer 헤더를 전송함
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    token = authorization.split(" ")[1]
    if token != CRON_SECRET:
        raise HTTPException(status_code=401, detail="Invalid token")
    return stock_service.update_all_stocks()


@app.get("/api/settings/tickers")
async def get_tickers(list_type: str = "bookmark", uid: Optional[str] = None):
    _check_uid(uid)
    tickers = redis_service.get_tickers(list_type, uid)
    return {"tickers": ", ".join(tickers)}


class TickerUpdate(BaseModel):
    tickers: str
    list_type: Optional[str] = "bookmark"
    uid: Optional[str] = None


@app.post("/api/settings/tickers")
async def save_tickers(data: TickerUpdate):
    _check_uid(data.uid)
    tickers = [t.strip().upper() for t in data.tickers.replace("\n", ",").split(",") if t.strip()]
    redis_service.save_tickers(data.list_type, tickers, data.uid)
    return {"status": "success"}


# ===========================================================================
# 보유 종목 (거래내역에서 자동 산출)
# ===========================================================================
@app.get("/api/positions")
async def positions_list(uid: Optional[str] = None):
    _check_uid(uid)
    return record_service.get_positions(uid)


@app.get("/api/positions/followup")
async def positions_followup(uid: Optional[str] = None, ticker: Optional[str] = None):
    _check_uid(uid)
    res = record_service.followup_for_ticker(uid, ticker)
    if res is None:
        raise HTTPException(status_code=404, detail="보유 종목을 찾을 수 없습니다.")
    return res


# ===========================================================================
# 매매 기록 (매수/매도 거래내역 + 통계)
# ===========================================================================
@app.get("/api/ledger/list")
async def ledger_list(uid: Optional[str] = None):
    _check_uid(uid)
    return {"entries": record_service.list_ledger(uid), "stats": record_service.ledger_stats(uid)}


class LedgerAdd(BaseModel):
    uid: str
    ticker: str
    type: str
    date: str
    price: float
    quantity: float
    fee: Optional[float] = 0
    memo: Optional[str] = ""


@app.post("/api/ledger/add")
async def ledger_add(data: LedgerAdd):
    _check_uid(data.uid)
    if data.type == "sell":
        held = record_service.held_quantity(data.uid, data.ticker)
        if held <= 0:
            raise HTTPException(status_code=400, detail=f"{data.ticker.strip().upper()} 보유 중이 아니라 매도할 수 없습니다.")
        if data.quantity > held + 1e-9:
            raise HTTPException(status_code=400, detail=f"보유 수량({held})보다 많이 매도할 수 없습니다.")
    return record_service.add_ledger(data.uid, data.ticker, data.type, data.date, data.price, data.quantity, fee=data.fee, memo=data.memo)


class LedgerUpdate(BaseModel):
    uid: str
    id: str
    ticker: Optional[str] = None
    type: Optional[str] = None
    date: Optional[str] = None
    price: Optional[float] = None
    quantity: Optional[float] = None
    fee: Optional[float] = None
    memo: Optional[str] = None


@app.post("/api/ledger/update")
async def ledger_update(data: LedgerUpdate):
    _check_uid(data.uid)
    e = record_service.update_ledger(data.uid, data.id, data.model_dump())
    if not e:
        raise HTTPException(status_code=404, detail="내역을 찾을 수 없습니다.")
    return e


class LedgerDelete(BaseModel):
    uid: str
    id: str


@app.post("/api/ledger/delete")
async def ledger_delete(data: LedgerDelete):
    _check_uid(data.uid)
    return record_service.delete_ledger(data.uid, data.id)


# ===========================================================================
# MDD Calculator
# ===========================================================================
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
        # KST 표시: 미국 거래일 + 1일
        kst = pd.Timedelta(days=1)
        chart_data = [{"x": int((ts + kst).timestamp() * 1000), "y": round(val, 2)} for ts, val in df["Drawdown"].items()]
        total_days = len(df)
        table_rows = []
        for ts in range(0, -105, -5):
            r_rate = len(df[df["Drawdown"] >= ts]) / total_days * 100
            w_days = len(df[df["Drawdown"] == 0]) if ts == 0 else len(df[(df["Drawdown"] >= ts) & (df["Drawdown"] < ts + 5)])
            weight = w_days / total_days * 100
            table_rows.append({"mdd": f"{ts}%", "recovery": round(r_rate, 1), "weight": round(weight, 1)})
        return {"chart_data": chart_data, "table_data": table_rows, "threshold_line": round(threshold_val_pct, 2), "stats": {"max_mdd": round(max_mdd_val, 2), "max_mdd_date": (max_mdd_date + kst).strftime("%Y-%m-%d"), "last_price": round(df["Price"].iloc[-1], 2), "last_val": round(df["Drawdown"].iloc[-1], 2), "peak_price": round(current_peak, 2), "price_at_threshold": round(price_at_threshold, 2), "last_date": (df.index[-1] + kst).strftime("%Y-%m-%d")}}
    except Exception as e:
        return JSONResponse(status_code=500, content={"message": str(e)})


# ===========================================================================
# 정적 파일 / 페이지 라우트
# ===========================================================================
gateway_path = os.path.join(os.path.dirname(__file__), "../../gateway")
frontend_path = os.path.join(os.path.dirname(__file__), "../frontend")
mdd_frontend_path = os.path.join(os.path.dirname(__file__), "../../mdd_calculator/api")
record_frontend_path = os.path.join(os.path.dirname(__file__), "../../stock_record/frontend")

app.mount("/static", StaticFiles(directory=frontend_path), name="static")
app.mount("/record-static", StaticFiles(directory=record_frontend_path), name="record_static")


@app.get("/")
async def read_gateway():
    return FileResponse(os.path.join(gateway_path, "index.html"))


@app.get("/stock")
async def read_stock():
    return FileResponse(os.path.join(frontend_path, "index.html"))


@app.get("/mdd")
async def read_mdd():
    return FileResponse(os.path.join(mdd_frontend_path, "index.html"))


@app.get("/record")
async def read_record():
    return FileResponse(os.path.join(record_frontend_path, "index.html"))


@app.get("/record/ledger")
async def read_record_ledger():
    return FileResponse(os.path.join(record_frontend_path, "ledger.html"))


@app.get("/settings")
async def read_settings():
    return FileResponse(os.path.join(frontend_path, "settings.html"))


@app.get("/api/health")
async def health():
    return {"status": "ok"}
