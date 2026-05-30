import yfinance as yf
import pandas as pd
import pandas_ta as ta

def debug_cross(ticker):
    print(f"--- Debugging {ticker} ---")
    df = yf.download(ticker, period="200d", progress=False)
    
    # 멀티인덱스 컬럼 처리
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    
    df.columns = [str(c).lower() for c in df.columns]
    df = df.dropna(subset=['close'])
        
    df['ma20'] = df.ta.sma(length=20)
    df['ma60'] = df.ta.sma(length=60)
    
    t_df = df.tail(80).copy()
    print(f"Total days: {len(t_df)}")
    
    crosses = []
    for i in range(1, len(t_df)):
        p20, p60 = t_df['ma20'].iloc[i-1], t_df['ma60'].iloc[i-1]
        c20, c60 = t_df['ma20'].iloc[i], t_df['ma60'].iloc[i]
        
        if pd.isna(p20) or pd.isna(p60) or pd.isna(c20) or pd.isna(c60):
            continue
            
        if p20 <= p60 and c20 > c60:
            crosses.append(f"Golden Cross at {t_df.index[i].date()} (MA20: {c20:.2f}, MA60: {c60:.2f})")
        elif p20 >= p60 and c20 < c60:
            crosses.append(f"Death Cross at {t_df.index[i].date()} (MA20: {c20:.2f}, MA60: {c60:.2f})")
            
    if not crosses:
        print("No crosses detected in the last 80 days.")
    else:
        for c in crosses:
            print(c)
    print("\n")

debug_cross("MSFT")
debug_cross("GOOGL")
debug_cross("META")
