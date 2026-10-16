"""Windows startup — auto-start using Task Scheduler + Registry fallback."""
import sys
import os
import platform
import subprocess

OS = platform.system()
APP_NAME = "SysControl"
TASK_NAME = "SysControlAutoStart"
REG_PATH = r"Software\Microsoft\Windows\CurrentVersion\Run"

_NO_WINDOW = 0x08000000 if OS == "Windows" else 0
_si = None
if OS == "Windows":
    _si = subprocess.STARTUPINFO()
    _si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    _si.wShowWindow = 0


def _get_exe_path():
    if getattr(sys, "frozen", False):
        return sys.executable
    return None


def _run_silent(args, timeout=10):
    try:
        subprocess.run(
            args, capture_output=True, timeout=timeout,
            creationflags=_NO_WINDOW, startupinfo=_si,
        )
        return True
    except Exception:
        return False


def _remove_motw(path):
    """Remove 'downloaded from internet' mark so Windows doesn't block on startup."""
    try:
        ads = path + ":Zone.Identifier"
        if os.path.exists(ads):
            os.remove(ads)
    except Exception:
        pass


def is_enabled():
    if OS != "Windows":
        return False
    try:
        result = subprocess.run(
            ["schtasks", "/Query", "/TN", TASK_NAME],
            capture_output=True, text=True, timeout=5,
            creationflags=_NO_WINDOW, startupinfo=_si,
        )
        if result.returncode == 0:
            return True
    except Exception:
        pass
    try:
        import winreg
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, REG_PATH, 0, winreg.KEY_READ)
        try:
            val, _ = winreg.QueryValueEx(key, APP_NAME)
            winreg.CloseKey(key)
            return bool(val)
        except FileNotFoundError:
            winreg.CloseKey(key)
    except Exception:
        pass
    return False


def enable():
    if OS != "Windows":
        return {"ok": False, "error": "Windows only"}
    exe = _get_exe_path()
    if not exe:
        return {"ok": False, "error": "Only works with the built .exe"}

    _remove_motw(exe)

    ok = False

    # Method 1: Task Scheduler (needs admin — run exe as admin for this to work)
    try:
        _run_silent(["schtasks", "/Delete", "/TN", TASK_NAME, "/F"])
    except Exception:
        pass

    try:
        result = subprocess.run(
            [
                "schtasks", "/Create",
                "/TN", TASK_NAME,
                "/TR", f'"{exe}"',
                "/SC", "ONLOGON",
                "/RL", "HIGHEST",
                "/F",
            ],
            capture_output=True, text=True, timeout=10,
            creationflags=_NO_WINDOW, startupinfo=_si,
        )
        if result.returncode == 0:
            ok = True
    except Exception:
        pass

    # Method 2: Registry Run key (no admin needed)
    try:
        import winreg
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, REG_PATH, 0, winreg.KEY_SET_VALUE)
        winreg.SetValueEx(key, APP_NAME, 0, winreg.REG_SZ, f'"{exe}"')
        winreg.CloseKey(key)
        ok = True
    except Exception:
        pass

    return {"ok": ok, "path": exe}


def disable():
    if OS != "Windows":
        return {"ok": False, "error": "Windows only"}
    try:
        _run_silent(["schtasks", "/Delete", "/TN", TASK_NAME, "/F"])
    except Exception:
        pass
    try:
        import winreg
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, REG_PATH, 0, winreg.KEY_SET_VALUE)
        try:
            winreg.DeleteValue(key, APP_NAME)
        except FileNotFoundError:
            pass
        winreg.CloseKey(key)
    except Exception:
        pass
    return {"ok": True}


def auto_setup():
    if OS != "Windows":
        return
    if not getattr(sys, "frozen", False):
        return
    exe = _get_exe_path()
    if exe:
        _remove_motw(exe)
    if is_enabled():
        return
    enable()


def status():
    return {
        "enabled": is_enabled(),
        "exe": _get_exe_path(),
        "frozen": getattr(sys, "frozen", False),
    }
