import requests

url = "http://127.0.0.1:8000/api/cron/update"
headers = {"Authorization": "Bearer default_secret"}

try:
    print("Triggering update...")
    response = requests.get(url, headers=headers)
    print(f"Status Code: {response.status_code}")
    print(f"Response: {response.json()}")
except Exception as e:
    print(f"Failed: {e}")
