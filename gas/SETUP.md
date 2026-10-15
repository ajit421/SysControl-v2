# Google Apps Script — Device Registry Setup

## Step 1: Create the Google Sheet

1. Go to [Google Sheets](https://sheets.google.com) and create a new spreadsheet
2. Name it **SysControl** (or any name you like)

## Step 2: Add the Apps Script

1. In the spreadsheet, go to **Extensions → Apps Script**
2. Delete any default code in the editor
3. Copy-paste the entire contents of `Code.gs` into the editor
4. Click **Save** (Ctrl+S)

## Step 3: Deploy as Web App

1. Click **Deploy → New deployment**
2. Click the gear icon next to "Select type" → choose **Web app**
3. Set:
   - **Description**: SysControl Device Registry
   - **Execute as**: Me
   - **Who has access**: Anyone
4. Click **Deploy**
5. **Authorize** when prompted (click "Advanced" → "Go to SysControl" if Google warns)
6. **Copy the Web App URL** — it looks like:
   ```
   https://script.google.com/macros/s/AKfycb.../exec
   ```

## Step 4: Paste the URL

### Backend
Open `backend/registry.py` and set:
```python
GAS_URL = "https://script.google.com/macros/s/YOUR_ID_HERE/exec"
```

### Frontend
Open `frontend/main.js` and set:
```javascript
var GAS_URL = "https://script.google.com/macros/s/YOUR_ID_HERE/exec";
```

Both use the **same URL**.

## Step 5: Done!

- **Backend**: Just run `python server.py` (or the .exe). No input needed — it auto-configures using the PC hostname, auto-generates password, auto-shares to registry.
- **Frontend**: Just open the website. All registered devices appear automatically.

## Updating the Script

If you modify `Code.gs`:
1. Go to Apps Script editor
2. Paste the updated code
3. Click **Deploy → Manage deployments**
4. Edit the existing deployment → set **Version** to "New version"
5. Click **Deploy**

The URL stays the same — no need to update backend/frontend.

## Data in Google Sheets

The "Devices" sheet auto-creates with columns:
| device_id | name | url | version | online | last_seen | os | ip |

You can view/edit device data directly in the spreadsheet.
