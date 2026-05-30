import requests
import json

try:
    response = requests.get("http://127.0.0.1:8000/api/stocks?list_type=bookmark")
    if response.status_code == 200:
        stocks = response.json()
        if stocks:
            sample = stocks[0]
            print(f"Ticker: {sample['ticker']}")
            print(f"Name: {sample['name']}")
            print(f"Has di_plus_val: {'di_plus_val' in sample}")
            print(f"Has di_minus_val: {'di_minus_val' in sample}")
            if 'di_plus_val' in sample:
                print(f"Values: {sample['di_plus_val']} / {sample['di_minus_val']}")
        else:
            print("No stocks returned.")
    else:
        print(f"Error: {response.status_code}")
except Exception as e:
    print(f"Connection failed: {e}")
