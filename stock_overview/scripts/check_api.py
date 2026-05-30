import requests
import json

try:
    response = requests.get("http://127.0.0.1:8000/api/stocks?list_type=bookmark")
    if response.status_code == 200:
        stocks = response.json()
        if stocks:
            sample = stocks[0]
            print(f"Ticker: {sample['ticker']}")
            print(f"Has adx_list: {'adx_list' in sample}")
            print(f"Has di_plus_list: {'di_plus_list' in sample}")
            print(f"Has di_minus_list: {'di_minus_list' in sample}")
            if 'di_plus_list' in sample:
                print(f"di_plus_list (first 5): {sample['di_plus_list'][:5]}")
        else:
            print("No stocks returned.")
    else:
        print(f"Error: {response.status_code}")
except Exception as e:
    print(f"Connection failed: {e}")
