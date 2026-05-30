import yfinance as yf
import json

ticker = yf.Ticker("AAPL")
print("Fast Info keys:")
print(list(ticker.fast_info.keys()))
print(f"lastPrice: {ticker.fast_info.get('lastPrice')}")
print(f"previousClose: {ticker.fast_info.get('previousClose')}")
print(f"regularMarketPreviousClose: {ticker.fast_info.get('regularMarketPreviousClose')}")
