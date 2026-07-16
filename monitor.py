import time
import requests

URL = "https://sabbir520.unaux.com"

while True:
    try:
        r = requests.get(URL, timeout=10)
        print(f"Status: {r.status_code}")
    except Exception as e:
        print("Error:", e)
