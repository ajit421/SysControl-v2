"""
Auto-update via Google Sheets.
The "Updates" sheet holds: version, download_url, file_name, date, notes.
Upload .exe to GitHub Releases (or any direct-download host) and put the URL
in the sheet. Google Drive is NOT recommended — it blocks .exe downloads.
Backend checks on demand; downloads + swaps .exe silently. No laptop restart.
"""
import os
import sys
import subprocess
import platform
import threading
import requests

_NO_WINDOW = 0x08000000 if platform.system() == "Windows" else 0

_status = {"state": "idle", "percent": 0, "downloaded": 0, "error": "", "version": ""}
_status_lock = threading.Lock()


def _set_status(state, percent=0, downloaded=0, error="", version=""):
    with _status_lock:
        _status["state"] = state
        _status["percent"] = percent
        _status["downloaded"] = downloaded
        _status["error"] = error
        if version:
            _status["version"] = version


def get_status():
    with _status_lock:
        return dict(_status)


def _is_frozen():
    return getattr(sys, "frozen", False)


def check_update(current_version):
    from registry import GAS_URL
    if not GAS_URL:
        return None
    try:
        r = requests.get(GAS_URL, params={"action": "check_update"}, timeout=15)
        data = r.json()
        if not data.get("ok") or not data.get("available"):
            return None
        latest = data.get("version", "")
        if latest and latest != current_version:
            return {
                "version": latest,
                "download_url": data.get("download_url", ""),
                "file_name": data.get("file_name", ""),
                "date": data.get("date", ""),
                "notes": data.get("notes", ""),
            }
    except Exception:
        pass
    return None


def _gdrive_file_id(url):
    if "drive.google.com" in url and "/d/" in url:
        return url.split("/d/")[1].split("/")[0]
    if "drive.google.com" in url and "id=" in url:
        from urllib.parse import urlparse, parse_qs
        return parse_qs(urlparse(url).query).get("id", [None])[0]
    return None


def _download_file(url, dest, version=""):
    import re
    session = requests.Session()
    session.headers["User-Agent"] = "SysControl-Updater/2.0"

    file_id = _gdrive_file_id(url)
    if file_id:
        url = "https://drive.google.com/uc?export=download&confirm=t&id=" + file_id

    r = session.get(url, stream=True, timeout=300, allow_redirects=True)
    if r.status_code != 200:
        return 0, "Download failed (" + str(r.status_code) + ")"

    ct = r.headers.get("content-type", "")
    if "text/html" in ct and file_id:
        html = r.text
        token = None
        m = re.search(r'confirm=([0-9A-Za-z_-]+)', html)
        if m:
            token = m.group(1)
        m2 = re.search(r'uuid=([0-9A-Za-z_-]+)', html)
        uuid_val = m2.group(1) if m2 else None

        retry_url = "https://drive.google.com/uc?export=download&id=" + file_id
        if token:
            retry_url += "&confirm=" + token
        if uuid_val:
            retry_url += "&uuid=" + uuid_val
        r = session.get(retry_url, stream=True, timeout=300, allow_redirects=True)
        if r.status_code != 200 or "text/html" in r.headers.get("content-type", ""):
            return 0, "Google Drive blocked the download — use GitHub Releases instead"
    elif "text/html" in ct:
        return 0, "Got HTML instead of binary — check the download URL"

    total_size = int(r.headers.get("content-length", 0))
    downloaded = 0
    with open(dest, "wb") as f:
        for chunk in r.iter_content(65536):
            if chunk:
                f.write(chunk)
                downloaded += len(chunk)
                pct = int(downloaded * 100 / total_size) if total_size > 0 else 0
                _set_status("downloading", percent=min(pct, 99), downloaded=downloaded, version=version)

    return downloaded, ""


def apply_update(update_info):
    if not _is_frozen():
        _set_status("error", error="Only works with the built .exe")
        return {"ok": False, "error": "Only works with the built .exe"}

    url = update_info.get("download_url", "")
    if not url:
        _set_status("error", error="No download URL")
        return {"ok": False, "error": "No download URL"}

    version = update_info.get("version", "")
    _set_status("downloading", percent=0, version=version)

    try:
        current_exe = sys.executable
        new_exe = current_exe + ".new"

        downloaded, err = _download_file(url, new_exe, version)
        if err:
            if os.path.exists(new_exe):
                os.remove(new_exe)
            _set_status("error", error=err)
            return {"ok": False, "error": err}

        if downloaded < 1000000:
            os.remove(new_exe)
            _set_status("error", error="Download too small — check the URL")
            return {"ok": False, "error": "Download too small"}

        _set_status("installing", percent=100, downloaded=downloaded, version=version)

        exe_name = os.path.basename(current_exe)
        bat = current_exe + ".update.bat"
        with open(bat, "w") as f:
            f.write('@echo off\n')
            f.write(f'taskkill /F /IM "{exe_name}" >nul 2>&1\n')
            f.write('taskkill /F /IM "cloudflared.exe" >nul 2>&1\n')
            f.write('timeout /t 3 /nobreak >nul\n')
            f.write(f'del /F "{current_exe}"\n')
            f.write(f'if exist "{current_exe}" (\n')
            f.write(f'  taskkill /F /IM "{exe_name}" >nul 2>&1\n')
            f.write('  timeout /t 3 /nobreak >nul\n')
            f.write(f'  del /F "{current_exe}"\n')
            f.write(')\n')
            f.write(f'move /Y "{new_exe}" "{current_exe}"\n')
            f.write(f'start "" "{current_exe}"\n')
            f.write(f'del "%~f0"\n')

        import config
        config.set_version(version)

        subprocess.Popen(["cmd", "/c", bat], creationflags=_NO_WINDOW)
        os._exit(0)

    except Exception as e:
        _set_status("error", error=str(e))
        return {"ok": False, "error": str(e)}


def auto_update_loop():
    pass
