"""
Google Apps Script — device registry.
Each device registers its tunnel URL so the frontend can auto-discover it.
"""
import time
import platform
import threading
import requests


GAS_URL = "https://script.google.com/macros/s/AKfycbwVtNbpmiTUMGfTVIMkhdqV0qaKsbpPuMkdaEveKvpvNDERfpWghcatvSXh2IWSqC1l/exec"


def register_url(device_id, device_name, tunnel_url, password="", version="1.0.0"):
    if not GAS_URL:
        return False
    try:
        params = {
            "action": "register",
            "device_id": device_id,
            "name": device_name,
            "url": tunnel_url,
            "version": version,
            "os": platform.system() + " " + platform.release(),
            "password": password,
        }
        r = requests.get(GAS_URL, params=params, timeout=15)
        return r.status_code == 200
    except Exception:
        return False


def set_offline(device_id):
    if not GAS_URL:
        return
    try:
        requests.get(
            GAS_URL,
            params={"action": "offline", "device_id": device_id},
            timeout=10,
        )
    except Exception:
        pass


def heartbeat_loop(device_id, device_name, get_url, password="", version="1.0.0"):
    """Send heartbeat every 3 minutes so frontend always has the latest tunnel URL."""
    def _loop():
        while True:
            time.sleep(180)
            url = get_url()
            if url:
                try:
                    params = {
                        "action": "heartbeat",
                        "device_id": device_id,
                        "name": device_name,
                        "url": url,
                        "version": version,
                        "os": platform.system() + " " + platform.release(),
                        "password": password,
                    }
                    requests.get(GAS_URL, params=params, timeout=15)
                except Exception:
                    pass
    t = threading.Thread(target=_loop, daemon=True)
    t.start()
