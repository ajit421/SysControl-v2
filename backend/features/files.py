"""File explorer — browse, download, upload, edit, rename, delete, create."""
import os
import re
import base64
import shutil
from pathlib import Path

MAX_EDIT_BYTES = 1024 * 1024

EDITABLE_EXTS = {
    "txt", "md", "log", "ini", "cfg", "conf", "csv", "tsv",
    "json", "xml", "yml", "yaml", "toml", "env",
    "html", "htm", "css", "js", "ts", "jsx", "tsx", "vue",
    "py", "pyw", "rb", "php", "go", "rs", "java", "kt",
    "c", "cpp", "h", "hpp", "cs", "swift", "sh", "bat", "cmd",
    "vbs", "ps1", "sql", "r", "lua", "pl", "scala", "dart",
    "gitignore", "dockerfile", "makefile", "editorconfig",
}


def list_drives():
    drives = []
    if os.name == "nt":
        import ctypes
        bitmask = ctypes.windll.kernel32.GetLogicalDrives()
        for i in range(26):
            if bitmask & (1 << i):
                letter = chr(65 + i)
                path = f"{letter}:\\"
                free = total = None
                try:
                    usage = shutil.disk_usage(path)
                    free = usage.free
                    total = usage.total
                except OSError:
                    pass
                drives.append({"letter": f"{letter}:", "path": path, "free": free, "total": total})
    else:
        drives.append({"letter": "/", "path": "/", "free": None, "total": None})
    return drives


def browse(path=None):
    if not path:
        path = str(Path.home())
    p = Path(path)
    if not p.is_dir():
        return {"path": path, "parent": "", "items": [], "error": "Not a directory"}
    items = []
    error = ""
    try:
        for entry in sorted(p.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower())):
            try:
                is_dir = entry.is_dir()
                size = 0 if is_dir else entry.stat().st_size
                items.append({"name": entry.name, "is_dir": is_dir, "size": size})
            except (PermissionError, OSError):
                continue
    except PermissionError:
        error = "Permission denied"
    parent = str(p.parent) if p.parent != p else ""
    return {"path": str(p), "parent": parent, "items": items, "error": error}


def read_file(path):
    p = Path(path)
    if not p.is_file():
        return {"ok": False, "error": "File not found"}
    if p.stat().st_size > MAX_EDIT_BYTES:
        return {"ok": False, "error": "File too large (max 1 MB)"}
    ext = p.suffix.lstrip(".").lower()
    if ext not in EDITABLE_EXTS:
        return {"ok": False, "error": f"Not an editable file type: .{ext}"}
    for enc in ("utf-8", "latin-1"):
        try:
            content = p.read_text(encoding=enc)
            return {"ok": True, "content": content, "encoding": enc, "size": p.stat().st_size}
        except (UnicodeDecodeError, ValueError):
            continue
    return {"ok": False, "error": "Cannot decode file"}


def save_file(path, content, encoding="utf-8"):
    try:
        Path(path).write_text(content, encoding=encoding)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def download_file(path):
    p = Path(path)
    if not p.is_file():
        return None
    data = base64.b64encode(p.read_bytes()).decode()
    return {"name": p.name, "data": data, "size": p.stat().st_size}


def upload_file(directory, name, b64_data):
    try:
        raw = base64.b64decode(b64_data)
        dest = Path(directory) / name
        dest.write_bytes(raw)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def delete_path(path):
    p = Path(path)
    try:
        if p.is_dir():
            shutil.rmtree(p)
        elif p.is_file():
            p.unlink()
        else:
            return {"ok": False, "error": "Not found"}
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def rename_path(old_path, new_name):
    p = Path(old_path)
    try:
        new = p.parent / new_name
        p.rename(new)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def mkdir(path):
    try:
        Path(path).mkdir(parents=True, exist_ok=True)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def mkfile(path):
    try:
        Path(path).touch()
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}
