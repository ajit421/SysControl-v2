"""
Cloudflare Quick Tunnel — auto-start, fully hidden, no terminal window.
"""
import re
import subprocess
import platform

_proc = None
_url = None

OS = platform.system()
_NO_WINDOW = 0x08000000 if OS == "Windows" else 0
_si = None
if OS == "Windows":
    _si = subprocess.STARTUPINFO()
    _si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    _si.wShowWindow = 0


def start(port):
    global _proc, _url
    if _proc and _proc.poll() is None:
        return _url

    try:
        _proc = subprocess.Popen(
            ["cloudflared", "tunnel", "--url", f"http://localhost:{port}"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            creationflags=_NO_WINDOW, startupinfo=_si,
        )
        for raw_line in _proc.stdout:
            line = raw_line.decode(errors="ignore").strip()
            if "trycloudflare.com" in line:
                m = re.search(r"(https://[a-zA-Z0-9\-]+\.trycloudflare\.com)", line)
                if m:
                    _url = m.group(1)
                    return _url
    except FileNotFoundError:
        return None
    return None


def stop():
    global _proc, _url
    if _proc and _proc.poll() is None:
        _proc.terminate()
    _proc = None
    _url = None


def get_url():
    return _url


def is_running():
    return _proc is not None and _proc.poll() is None
