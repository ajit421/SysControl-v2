/**
 * SysControl v2 — Google Apps Script Device Registry
 *
 * Deploy as Web App:
 *   1. Create a Google Sheet named "SysControl"
 *   2. Extensions → Apps Script → paste this code
 *   3. Deploy → New Deployment → Web App
 *      - Execute as: Me
 *      - Who has access: Anyone
 *   4. Copy the Web App URL → paste into backend/registry.py and frontend/main.js
 */

var SHEET_NAME = "Devices";
var HEADERS = ["device_id", "name", "url", "version", "online", "last_seen", "os", "ip", "password"];
var COLS = HEADERS.length;

var USERS_SHEET = "Users";
var USER_HEADERS = ["username", "password"];

var UPDATES_SHEET = "Updates";
var UPDATE_HEADERS = ["version", "download_url", "file_name", "date", "notes"];

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, COLS).setFontWeight("bold");
    sheet.setFrozenRows(1);
  } else {
    var firstRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (firstRow.length < COLS || firstRow[8] !== "password") {
      sheet.getRange(1, 9).setValue("password");
      sheet.getRange(1, 9).setFontWeight("bold");
    }
  }
  return sheet;
}

function findDeviceRow(sheet, deviceId) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === deviceId) return i + 1;
  }
  return -1;
}

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  var action = (e.parameter && e.parameter.action) || "";
  var result;

  try {
    if (action === "register") {
      result = registerDevice(e);
    } else if (action === "heartbeat") {
      result = heartbeat(e);
    } else if (action === "offline") {
      result = setOffline(e);
    } else if (action === "devices") {
      result = getDevices();
    } else if (action === "cleanup") {
      result = cleanupOld();
    } else if (action === "login") {
      result = loginUser(e);
    } else if (action === "check_update") {
      result = checkUpdate();
    } else {
      result = { ok: false, error: "Unknown action: " + action };
    }
  } catch (err) {
    result = { ok: false, error: err.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/* Register or update a device */
function registerDevice(e) {
  var p = e.parameter;
  var deviceId = p.device_id;
  if (!deviceId) return { ok: false, error: "device_id required" };

  var sheet = getSheet();
  var row = findDeviceRow(sheet, deviceId);
  var now = new Date().toISOString();

  var rowData = [
    deviceId,
    p.name || "",
    p.url || "",
    p.version || "1.0.0",
    "true",
    now,
    p.os || "",
    p.ip || "",
    p.password || ""
  ];

  if (row > 0) {
    sheet.getRange(row, 1, 1, COLS).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
  }

  return { ok: true, device_id: deviceId };
}

/* Heartbeat — update URL + timestamp + online status */
function heartbeat(e) {
  var p = e.parameter;
  var deviceId = p.device_id;
  if (!deviceId) return { ok: false, error: "device_id required" };

  var sheet = getSheet();
  var row = findDeviceRow(sheet, deviceId);
  if (row < 0) return registerDevice(e);

  var now = new Date().toISOString();
  if (p.url) sheet.getRange(row, 3).setValue(p.url);
  if (p.name) sheet.getRange(row, 2).setValue(p.name);
  if (p.version) sheet.getRange(row, 4).setValue(p.version);
  sheet.getRange(row, 5).setValue("true");
  sheet.getRange(row, 6).setValue(now);
  if (p.os) sheet.getRange(row, 7).setValue(p.os);
  if (p.ip) sheet.getRange(row, 8).setValue(p.ip);
  if (p.password) sheet.getRange(row, 9).setValue(p.password);

  return { ok: true };
}

/* Mark device offline */
function setOffline(e) {
  var deviceId = e.parameter.device_id;
  if (!deviceId) return { ok: false, error: "device_id required" };

  var sheet = getSheet();
  var row = findDeviceRow(sheet, deviceId);
  if (row < 0) return { ok: false, error: "device not found" };

  sheet.getRange(row, 5).setValue("false");
  sheet.getRange(row, 6).setValue(new Date().toISOString());

  return { ok: true };
}

/* Get all devices — called by frontend */
function getDevices() {
  var sheet = getSheet();
  var data = sheet.getDataRange().getValues();
  var devices = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue;
    devices.push({
      device_id: row[0],
      name: row[1],
      url: row[2],
      version: row[3],
      online: row[4] === true || row[4] === "true",
      last_seen: row[5],
      os: row[6] || "",
      ip: row[7] || "",
      password: row[8] || ""
    });
  }

  return { ok: true, devices: devices };
}

/* ===== USER AUTH ===== */

function getUsersSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(USERS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(USERS_SHEET);
    sheet.appendRow(USER_HEADERS);
    sheet.getRange(1, 1, 1, 2).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function loginUser(e) {
  var p = e.parameter;
  var username = (p.username || "").trim().toLowerCase();
  var password = p.password || "";

  if (!username || !password) return { ok: false, error: "Username and password required" };

  var sheet = getUsersSheet();
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    var u = (data[i][0] || "").toString().trim().toLowerCase();
    var pw = (data[i][1] || "").toString();
    if (u === username && pw === password) {
      return { ok: true, username: u };
    }
  }

  return { ok: false, error: "Invalid username or password" };
}

/* ===== UPDATES ===== */

function getUpdatesSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(UPDATES_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(UPDATES_SHEET);
    sheet.appendRow(UPDATE_HEADERS);
    sheet.getRange(1, 1, 1, UPDATE_HEADERS.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function checkUpdate() {
  var sheet = getUpdatesSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true, available: false };

  var row = sheet.getRange(lastRow, 1, 1, UPDATE_HEADERS.length).getValues()[0];
  return {
    ok: true,
    available: true,
    version: (row[0] || "").toString(),
    download_url: (row[1] || "").toString(),
    file_name: (row[2] || "").toString(),
    date: (row[3] || "").toString(),
    notes: (row[4] || "").toString()
  };
}

/* Remove devices offline for more than 7 days */
function cleanupOld() {
  var sheet = getSheet();
  var data = sheet.getDataRange().getValues();
  var now = new Date().getTime();
  var week = 7 * 24 * 60 * 60 * 1000;
  var removed = 0;

  for (var i = data.length - 1; i >= 1; i--) {
    var online = data[i][4] === true || data[i][4] === "true";
    var lastSeen = data[i][5] ? new Date(data[i][5]).getTime() : 0;
    if (!online && (now - lastSeen) > week) {
      sheet.deleteRow(i + 1);
      removed++;
    }
  }

  return { ok: true, removed: removed };
}
