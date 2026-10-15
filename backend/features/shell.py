"""Remote shell — runs commands hidden, no window flashes."""
import subprocess
import platform
from pathlib import Path

_NO_WINDOW = 0x08000000 if platform.system() == "Windows" else 0
_si = None
if platform.system() == "Windows":
    _si = subprocess.STARTUPINFO()
    _si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    _si.wShowWindow = 0

_cwd = Path.home()


def run(cmd, timeout=60):
    global _cwd
    cmd = cmd.strip()
    if not cmd:
        return {"stdout": "", "stderr": "", "code": 0, "cwd": str(_cwd)}

    parts = cmd.split(None, 1)
    if parts[0].lower() == "cd":
        target = parts[1].strip().strip('"').strip("'") if len(parts) > 1 else ""
        if not target:
            return {"stdout": str(_cwd), "stderr": "", "code": 0, "cwd": str(_cwd)}
        new = (_cwd / target).resolve()
        if new.is_dir():
            _cwd = new
            return {"stdout": "", "stderr": "", "code": 0, "cwd": str(_cwd)}
        return {"stdout": "", "stderr": f"Not a directory: {target}", "code": 1, "cwd": str(_cwd)}

    try:
        proc = subprocess.Popen(
            cmd, shell=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            cwd=str(_cwd),
            creationflags=_NO_WINDOW, startupinfo=_si,
        )
        try:
            out, err = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.communicate()
            return {"stdout": "", "stderr": f"Timed out after {timeout}s", "code": -1, "cwd": str(_cwd)}

        if proc.returncode == 0 and parts[0].lower() == "cd":
            _cwd = Path(proc.cwd) if hasattr(proc, "cwd") else _cwd

        return {
            "stdout": (out or b"").decode(errors="ignore"),
            "stderr": (err or b"").decode(errors="ignore"),
            "code": proc.returncode,
            "cwd": str(_cwd),
        }
    except Exception as e:
        return {"stdout": "", "stderr": str(e), "code": -1, "cwd": str(_cwd)}


def get_cwd():
    return str(_cwd)
