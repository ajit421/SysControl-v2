/* SysControl v2 — Frontend (JWT auth, multi-device, Google Apps Script registry) */

var GAS_URL = "https://script.google.com/macros/s/AKfycbwVtNbpmiTUMGfTVIMkhdqV0qaKsbpPuMkdaEveKvpvNDERfpWghcatvSXh2IWSqC1l/exec";
var conn = { url: "", token: "", device: "", version: "" };
var devices = [];
var healthInterval = null;
var authUser = "";

function $(id) { return document.getElementById(id); }
function show(id) { $(id).classList.remove("hidden"); }
function hide(id) { $(id).classList.add("hidden"); }
function esc(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
function now() { return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }

/* ===== AUTH ===== */

function checkAuth() {
  try {
    authUser = localStorage.getItem("sc_user") || "";
  } catch(e) { authUser = ""; }
  if (authUser) {
    hide("authScreen");
    show("homeScreen");
    loadDevices();
  } else {
    show("authScreen");
    hide("homeScreen");
    setTimeout(function() { $("authUser").focus(); }, 100);
  }
}

function doAuth() {
  var username = ($("authUser").value || "").trim();
  var password = $("authPass").value || "";
  if (!username || !password) { $("authError").textContent = "Enter username and password"; return; }

  $("authBtn").disabled = true;
  $("authBtn").textContent = "Authenticating...";
  $("authError").textContent = "";

  fetch(GAS_URL + "?action=login&username=" + encodeURIComponent(username) + "&password=" + encodeURIComponent(password))
    .then(function(r) { return r.json(); })
    .then(function(d) {
      $("authBtn").disabled = false;
      $("authBtn").textContent = "Authenticate";
      if (d.ok) {
        authUser = d.username || username;
        try { localStorage.setItem("sc_user", authUser); } catch(e) {}
        hide("authScreen");
        show("homeScreen");
        loadDevices();
      } else {
        $("authError").textContent = d.error || "Login failed";
      }
    })
    .catch(function(e) {
      $("authBtn").disabled = false;
      $("authBtn").textContent = "Authenticate";
      $("authError").textContent = "Cannot reach server: " + e.message;
    });
}

function doLogout() {
  authUser = "";
  try { localStorage.removeItem("sc_user"); } catch(e) {}
  hide("homeScreen");
  hide("panelScreen");
  show("authScreen");
  $("authUser").value = "";
  $("authPass").value = "";
  $("authError").textContent = "";
  conn.token = "";
  stopHealth();
}

/* ===== DEVICE DISCOVERY via Google Apps Script ===== */

function loadDevices() {
  if (!GAS_URL) {
    $("deviceList").innerHTML = '<div class="empty-state">Registry not configured.<br>Set GAS_URL in main.js</div>';
    return;
  }
  refreshDevices();
}

function discoverDevices() {
  var list = $("deviceList");
  list.innerHTML = '<div class="empty-state">Scanning devices...</div>';
  fetch(GAS_URL + "?action=devices")
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.ok || !data.devices) {
        list.innerHTML = '<div class="empty-state">Cannot read device registry.</div>';
        return;
      }
      devices = [];
      if (!data.devices.length) {
        list.innerHTML = '<div class="empty-state">No devices registered yet.<br>Run the backend on a laptop first.</div>';
        return;
      }
      data.devices.forEach(function(d) {
        if (!d.password) return;
        devices.push({
          deviceId: d.device_id,
          label: d.name || d.device_id,
          _url: d.url || "",
          _name: d.name || d.device_id,
          _version: d.version || "?",
          _online: false,
          _lastSeen: d.last_seen || "",
          _os: d.os || "",
          _password: d.password
        });
      });
      renderDevices();
    })
    .catch(function() {
      list.innerHTML = '<div class="empty-state">Cannot reach registry. Check your connection.</div>';
    });
}

function refreshDevices() {
  var btn = $("refreshBtn");
  btn.disabled = true;
  btn.textContent = "Checking...";
  var list = $("deviceList");
  list.innerHTML = '<div class="empty-state">Fetching devices...</div>';

  fetch(GAS_URL + "?action=devices")
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.ok || !data.devices) {
        list.innerHTML = '<div class="empty-state">Cannot read device registry.</div>';
        btn.disabled = false; btn.textContent = "Refresh";
        return;
      }
      devices = [];
      data.devices.forEach(function(d) {
        if (!d.password) return;
        devices.push({
          deviceId: d.device_id,
          label: d.name || d.device_id,
          _url: d.url || "",
          _name: d.name || d.device_id,
          _version: d.version || "?",
          _online: false,
          _checking: true,
          _lastSeen: d.last_seen || "",
          _os: d.os || "",
          _password: d.password
        });
      });
      if (!devices.length) {
        list.innerHTML = '<div class="empty-state">No devices found.</div>';
        btn.disabled = false; btn.textContent = "Refresh";
        return;
      }
      renderDevices();
      pingAllDevices(function() {
        btn.disabled = false;
        btn.textContent = "Refresh";
      });
    })
    .catch(function() {
      list.innerHTML = '<div class="empty-state">Cannot reach registry.</div>';
      btn.disabled = false; btn.textContent = "Refresh";
    });
}

function pingAllDevices(done) {
  var pending = devices.length;
  if (!pending) { done(); return; }
  devices.forEach(function(dev, i) {
    if (!dev._url) {
      dev._online = false;
      dev._checking = false;
      pending--;
      if (!pending) { renderDevices(); done(); }
      return;
    }
    fetch(dev._url + "/api/status", { signal: AbortSignal.timeout(5000) })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        dev._online = true;
        dev._checking = false;
        if (d.version) dev._version = d.version;
        if (d.os) dev._os = d.os;
      })
      .catch(function() {
        dev._online = false;
        dev._checking = false;
      })
      .finally(function() {
        pending--;
        renderDevices();
        if (!pending) done();
      });
  });
}

function timeAgo(iso) {
  if (!iso) return "";
  var diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}

function renderDevices() {
  var list = $("deviceList");
  if (!devices.length) {
    list.innerHTML = '<div class="empty-state">No devices found.<br>Run the backend on a laptop first.</div>';
    return;
  }
  list.innerHTML = "";
  devices.forEach(function(dev, i) {
    var card = document.createElement("div");
    card.className = "device-card";
    var statusText = dev._checking
      ? "Checking..."
      : dev._online
        ? "Online · " + (dev._os || "") + " · v" + (dev._version || "?")
        : "Offline" + (dev._lastSeen ? " · last seen " + timeAgo(dev._lastSeen) : "");
    card.innerHTML =
      '<div class="dc-icon">' + esc((dev.label || "?").charAt(0).toUpperCase()) + '</div>' +
      '<div class="dc-info">' +
        '<div class="dc-name">' + esc(dev.label || dev.deviceId) + '</div>' +
        '<div class="dc-status ' + (dev._checking ? "checking" : dev._online ? "online" : "offline") + '">' + statusText + '</div>' +
      '</div>';
    card.onclick = function() { connectDevice(i); };
    list.appendChild(card);
  });
}

/* ===== CONNECT ===== */

function connectDevice(i) {
  var dev = devices[i];
  if (!dev._url || !dev._online) {
    var ago = dev._lastSeen ? " Last seen " + timeAgo(dev._lastSeen) + "." : "";
    alert("Device is offline." + ago + " Start the backend on that laptop first.");
    return;
  }
  conn.url = dev._url;
  conn._idx = i;
  autoLogin(dev);
}

function autoLogin(dev) {
  var card = document.querySelectorAll(".device-card")[conn._idx];
  if (card) {
    var status = card.querySelector(".dc-status");
    if (status) status.textContent = "Connecting...";
  }

  fetch(conn.url + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: dev._password }),
    signal: AbortSignal.timeout(8000),
  })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.ok) {
        conn.token = d.token;
        conn.device = d.device;
        conn.version = d.version;
        showPanel();
      } else {
        renderDevices();
        alert("Connection failed: " + (d.error || "wrong password in registry. Restart the backend to reset."));
      }
    })
    .catch(function(e) {
      renderDevices();
      alert("Cannot reach device. It may have restarted — click Refresh to get the new address.");
    });
}

function showLoginModal(dev) {
  $("loginTitle").textContent = dev._name || dev.label || "Device";
  $("loginIcon").textContent = (dev.label || "?").charAt(0).toUpperCase();
  $("loginStatus").textContent = dev._url;
  $("loginError").textContent = "";
  $("loginPassword").value = "";
  show("loginModal");
  setTimeout(function() { $("loginPassword").focus(); }, 100);
}

function hideLogin() { hide("loginModal"); }

function doLogin() {
  var pw = $("loginPassword").value;
  if (!pw) return;
  $("loginBtn").disabled = true;
  $("loginBtn").textContent = "Connecting...";
  $("loginError").textContent = "";

  fetch(conn.url + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: pw }),
  })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      $("loginBtn").disabled = false;
      $("loginBtn").textContent = "Connect";
      if (d.ok) {
        conn.token = d.token;
        conn.device = d.device;
        conn.version = d.version;
        hideLogin();
        showPanel();
      } else {
        $("loginError").textContent = d.error || "Login failed";
      }
    })
    .catch(function(e) {
      $("loginBtn").disabled = false;
      $("loginBtn").textContent = "Connect";
      $("loginError").textContent = "Cannot reach device: " + e.message;
    });
}

/* ===== PANEL ===== */

function showPanel() {
  hide("homeScreen");
  show("panelScreen");
  $("panelName").textContent = conn.device;
  $("panelVersion").textContent = "v" + conn.version;
  $("chatArea").innerHTML = "";
  addMsg("bot", "> connected: " + conn.device + " [v" + conn.version + "]\n> use controls below or type a command");
  startHealth();
}

function disconnect() {
  hide("panelScreen");
  show("homeScreen");
  $("chatArea").innerHTML = "";
  conn.token = "";
  stopHealth();
  closeLive(); closeLiveCam(); closeMic(); closeKeylog(); closeShell(); closeExplorer(); closeEditor();
  discoverDevices();
}

/* ===== AUTH FETCH ===== */

function api(path, opts) {
  opts = opts || {};
  opts.headers = opts.headers || {};
  if (conn.token) opts.headers["Authorization"] = "Bearer " + conn.token;
  return fetch(conn.url + path, opts).then(function(r) { return r.json(); });
}

function apiRaw(path) {
  return fetch(conn.url + path, {
    headers: { "Authorization": "Bearer " + conn.token },
  });
}

/* ===== MESSAGES ===== */

function addMsg(who, content, type) {
  var area = $("chatArea");
  var row = document.createElement("div");
  row.className = "msg " + who;
  var bubble = document.createElement("div");
  bubble.className = "bubble";
  if (type === "photo") {
    var img = document.createElement("img");
    img.src = content; img.loading = "lazy";
    img.onclick = function(e) { e.stopPropagation(); openLightbox(content); };
    bubble.appendChild(img);
  } else {
    var t = document.createElement("span");
    t.textContent = content;
    bubble.appendChild(t);
  }
  var ts = document.createElement("span");
  ts.className = "ts"; ts.textContent = now();
  bubble.appendChild(ts);
  row.appendChild(bubble);
  area.appendChild(row);
  area.scrollTop = area.scrollHeight;
}

function addTyping() {
  var area = $("chatArea");
  var row = document.createElement("div");
  row.className = "msg bot"; row.id = "typingMsg";
  row.innerHTML = '<div class="bubble"><div class="typing"><span></span><span></span><span></span></div></div>';
  area.appendChild(row);
  area.scrollTop = area.scrollHeight;
}

function removeTyping() { var t = $("typingMsg"); if (t) t.remove(); }

/* ===== COMMANDS ===== */

function execCmd(cmd) {
  addMsg("user", cmd);
  addTyping();
  api("/api/cmd", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + conn.token },
    body: JSON.stringify({ cmd: cmd }),
  })
    .then(function(d) {
      removeTyping();
      if (d.type === "photo") {
        addMsg("bot", d.data, "photo");
        if (d.text) addMsg("bot", d.text);
      } else if (d.type === "shell") {
        addMsg("bot", (d.stdout || "") + (d.stderr || "") || "[No output]");
      } else {
        addMsg("bot", d.text || d.error || "No response.");
      }
    })
    .catch(function(e) { removeTyping(); addMsg("bot", "Error: " + e.message); });
}

function sendInput() {
  var inp = $("msgInput"); var text = inp.value.trim();
  if (!text) return; inp.value = "";
  execCmd(text);
}

function confirmShutdown() { if (confirm("Shut down the PC?")) execCmd("/shutdown"); }
function promptSpeech() {
  var text = prompt("Enter text to speak:");
  if (text && text.trim()) execCmd("/speech " + text.trim());
}

/* ===== SHELL ===== */

var shHistory = [], shIdx = -1, shCwd = "", shRunning = false;

function enterShell() {
  show("shellOverlay");
  if (!$("shOutput").innerHTML) {
    shAppend("SysControl Terminal\n", "sh-info");
  }
  api("/api/cmd", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + conn.token },
    body: JSON.stringify({ cmd: "/shellcmd" }),
  }).then(function(d) {
    if (d.type === "shell") { shCwd = d.cwd || ""; shPrompt(); }
  });
  setTimeout(function() { $("shInput").focus(); }, 100);
}

function closeShell() { hide("shellOverlay"); }
function clearShell() { $("shOutput").innerHTML = ""; shAppend("Cleared.\n", "sh-info"); }

function shPrompt() {
  $("shCwd").textContent = shCwd || "~";
  var short = shCwd.length > 40 ? "..." + shCwd.slice(-37) : shCwd;
  $("shPs1").textContent = short + ">";
}

function shAppend(text, cls) {
  if (!text) return;
  var el = document.createElement("div");
  el.className = "sh-line " + (cls || ""); el.textContent = text;
  $("shOutput").appendChild(el);
  $("shOutput").scrollTop = $("shOutput").scrollHeight;
}

function shAppendPrompt(cwd, cmd) {
  var el = document.createElement("div"); el.className = "sh-line";
  el.innerHTML = '<span class="sh-p">' + esc(cwd) + '&gt; </span><span class="sh-c">' + esc(cmd) + '</span>';
  $("shOutput").appendChild(el);
  $("shOutput").scrollTop = $("shOutput").scrollHeight;
}

function runShell() {
  var inp = $("shInput"); var cmd = inp.value; if (!cmd.trim() || shRunning) return;
  inp.value = "";
  shHistory.push(cmd); if (shHistory.length > 100) shHistory.shift();
  shIdx = shHistory.length;
  shAppendPrompt(shCwd, cmd);
  shRunning = true; inp.placeholder = "Running...";

  api("/api/cmd", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + conn.token },
    body: JSON.stringify({ cmd: "/shellcmd " + cmd }),
  })
    .then(function(d) {
      shRunning = false; inp.placeholder = "Type command...";
      if (d.type === "shell") {
        if (d.stdout) shAppend(d.stdout, "sh-out");
        if (d.stderr) shAppend(d.stderr, "sh-err");
        shCwd = d.cwd || shCwd; shPrompt();
      } else { shAppend(d.text || d.error || "Error", "sh-err"); }
      inp.focus();
    })
    .catch(function(e) {
      shRunning = false; inp.placeholder = "Type command...";
      shAppend("Error: " + e.message, "sh-err"); inp.focus();
    });
}

function shellKey(e) {
  if (e.key === "Enter") { runShell(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); if (shIdx > 0) { shIdx--; $("shInput").value = shHistory[shIdx]; } }
  else if (e.key === "ArrowDown") { e.preventDefault(); if (shIdx < shHistory.length - 1) { shIdx++; $("shInput").value = shHistory[shIdx]; } else { shIdx = shHistory.length; $("shInput").value = ""; } }
}

/* ===== FILE EXPLORER ===== */

var exPath = "", exParent = "", exItems = [], drivesLoaded = false;

var EDITABLE = "txt,md,log,ini,cfg,conf,csv,json,xml,yml,yaml,toml,env,html,htm,css,js,ts,py,pyw,rb,php,go,rs,java,c,cpp,h,cs,sh,bat,cmd,vbs,ps1,sql,lua".split(",");

function isEditable(n) { var e = (n.split(".").pop() || "").toLowerCase(); return EDITABLE.indexOf(e) !== -1; }

function openExplorer(path) {
  show("explorerOverlay");
  $("exList").innerHTML = '<div class="loading">Loading...</div>';
  if (!drivesLoaded) loadDrives();
  var cmd = path ? "/browse " + path : "/browse";
  api("/api/cmd", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + conn.token },
    body: JSON.stringify({ cmd: cmd }),
  }).then(function(d) {
    if (d.type === "browse") {
      exPath = d.path || ""; exParent = d.parent || ""; exItems = d.items || [];
      $("exTitle").textContent = exPath.split(/[/\\]/).pop() || "Root";
      $("exPath").textContent = exPath;
      $("exSearch").value = "";
      renderExplorer(exItems, d.error);
    }
  });
}

function loadDrives() {
  api("/api/cmd", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + conn.token },
    body: JSON.stringify({ cmd: "/drives" }),
  }).then(function(d) {
    if (d.type !== "drives") return;
    drivesLoaded = true;
    var bar = $("exDrives"); bar.innerHTML = "";
    d.drives.forEach(function(drv) {
      var btn = document.createElement("button");
      btn.className = "drive-btn"; btn.textContent = drv.letter;
      btn.onclick = function() { openExplorer(drv.path); };
      bar.appendChild(btn);
    });
  });
}

function filterExplorer() {
  var q = ($("exSearch").value || "").trim().toLowerCase();
  if (!q) { renderExplorer(exItems); return; }
  renderExplorer(exItems.filter(function(it) { return it.name.toLowerCase().indexOf(q) !== -1; }), "", true);
}

function renderExplorer(items, error, filtering) {
  var list = $("exList"); list.innerHTML = "";
  if (!filtering && exParent && exParent !== exPath) {
    var up = document.createElement("div"); up.className = "ex-item";
    up.innerHTML = '<span class="ex-i">..</span><div class="ex-inf"><div class="ex-n">..</div></div>';
    up.onclick = function() { openExplorer(exParent); };
    list.appendChild(up);
  }
  if (error) { list.innerHTML += '<div class="ex-empty">' + esc(error) + '</div>'; }
  if (!items.length && !error) { list.innerHTML += '<div class="ex-empty">' + (filtering ? "No match" : "Empty") + '</div>'; return; }
  items.forEach(function(item) {
    var row = document.createElement("div"); row.className = "ex-item";
    var fp = exPath + "\\" + item.name;
    row.innerHTML =
      '<span class="ex-i">' + (item.is_dir ? "/" : ".") + '</span>' +
      '<div class="ex-inf"><div class="ex-n">' + esc(item.name) + '</div><div class="ex-m">' + (item.is_dir ? "Folder" : fmtSize(item.size)) + '</div></div>' +
      (!item.is_dir ? '<button class="ex-a" onclick="event.stopPropagation();dlFile(\'' + esc(fp.replace(/'/g, "\\'")) + '\',\'' + esc(item.name.replace(/'/g, "\\'")) + '\')">dl</button>' : '') +
      '<button class="ex-a" onclick="event.stopPropagation();renItem(\'' + esc(fp.replace(/'/g, "\\'")) + '\',\'' + esc(item.name.replace(/'/g, "\\'")) + '\')">rn</button>' +
      '<button class="ex-a del" onclick="event.stopPropagation();delItem(\'' + esc(fp.replace(/'/g, "\\'")) + '\',\'' + esc(item.name.replace(/'/g, "\\'")) + '\',' + item.is_dir + ')">rm</button>';
    if (item.is_dir) { row.style.cursor = "pointer"; (function(p) { row.onclick = function() { openExplorer(p); }; })(fp); }
    else if (isEditable(item.name) && item.size <= 1048576) { row.style.cursor = "pointer"; (function(p) { row.onclick = function() { openEditor(p); }; })(fp); }
    list.appendChild(row);
  });
}

function explorerBack() { if (exParent && exParent !== exPath) openExplorer(exParent); }
function closeExplorer() { hide("explorerOverlay"); }

function dlFile(fp, fn) {
  api("/api/cmd", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + conn.token },
    body: JSON.stringify({ cmd: "/download " + fp }),
  }).then(function(d) {
    if (d.type === "file" && d.data) {
      var bc = atob(d.data), bn = new Array(bc.length);
      for (var i = 0; i < bc.length; i++) bn[i] = bc.charCodeAt(i);
      var blob = new Blob([new Uint8Array(bn)]);
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a"); a.href = url; a.download = d.name || fn;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    }
  });
}

function delItem(fp, name, isDir) {
  if (!confirm("Delete " + name + "?")) return;
  api("/api/cmd", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + conn.token },
    body: JSON.stringify({ cmd: "/delete " + fp }),
  }).then(function() { openExplorer(exPath); });
}

function renItem(fp, old) {
  var n = prompt("Rename to:", old);
  if (!n || n.trim() === old) return;
  api("/api/cmd", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + conn.token },
    body: JSON.stringify({ cmd: "/rename " + fp + "|" + n.trim() }),
  }).then(function() { openExplorer(exPath); });
}

function createFolder() {
  var n = prompt("Folder name:"); if (!n) return;
  api("/api/cmd", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + conn.token },
    body: JSON.stringify({ cmd: "/mkdir " + exPath + "\\" + n.trim() }),
  }).then(function() { openExplorer(exPath); });
}

function createFile() {
  var n = prompt("File name (e.g. notes.txt):"); if (!n) return;
  api("/api/cmd", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + conn.token },
    body: JSON.stringify({ cmd: "/mkfile " + exPath + "\\" + n.trim() }),
  }).then(function() { openExplorer(exPath); });
}

function uploadToExplorer() { $("exFileInput").value = ""; $("exFileInput").click(); }

function handleUpload(input) {
  if (!input.files || !input.files.length) return;
  var files = Array.prototype.slice.call(input.files), idx = 0;
  function next() {
    if (idx >= files.length) { openExplorer(exPath); return; }
    var file = files[idx++];
    if (file.size > 15728640) { alert(file.name + " too large (max 15MB)"); next(); return; }
    var reader = new FileReader();
    reader.onload = function() {
      var b64 = reader.result.split(",")[1];
      fetch(conn.url + "/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + conn.token },
        body: JSON.stringify({ name: file.name, path: exPath, data: b64 }),
      }).then(function() { next(); }).catch(function() { next(); });
    };
    reader.readAsDataURL(file);
  }
  next();
}

function fmtSize(b) {
  if (b === 0) return "0 B";
  var k = 1024, s = ["B", "KB", "MB", "GB"], i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(1)) + " " + s[i];
}

/* ===== FILE EDITOR ===== */

var edState = { path: "", enc: "utf-8", orig: "", dirty: false };

function openEditor(path) {
  show("editorOverlay");
  $("edTitle").textContent = path.split(/[/\\]/).pop();
  $("edPath").textContent = path;
  $("edContent").value = ""; $("edContent").disabled = true;
  $("edStatus").textContent = "Loading...";
  $("edDirty").classList.add("hidden");
  edState.path = path; edState.dirty = false;

  fetch(conn.url + "/api/read-file", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + conn.token },
    body: JSON.stringify({ path: path }),
  }).then(function(r) { return r.json(); })
    .then(function(d) {
      if (!d.ok) { $("edStatus").textContent = d.error || "Failed"; return; }
      edState.enc = d.encoding || "utf-8"; edState.orig = d.content || "";
      $("edContent").value = edState.orig; $("edContent").disabled = false;
      $("edStatus").textContent = d.encoding + " · " + fmtSize(d.size || 0);
    });
}

function edChanged() {
  var dirty = $("edContent").value !== edState.orig;
  if (dirty !== edState.dirty) { edState.dirty = dirty; $("edDirty").classList.toggle("hidden", !dirty); }
}

function edKey(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); saveEditor(); }
  if (e.key === "Tab") { e.preventDefault(); var el = e.target, s = el.selectionStart, en = el.selectionEnd; el.value = el.value.substring(0, s) + "  " + el.value.substring(en); el.selectionStart = el.selectionEnd = s + 2; edChanged(); }
}

function saveEditor() {
  if (!edState.path) return;
  $("edStatus").textContent = "Saving...";
  fetch(conn.url + "/api/save-file", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + conn.token },
    body: JSON.stringify({ path: edState.path, content: $("edContent").value, encoding: edState.enc }),
  }).then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.ok) { edState.orig = $("edContent").value; edState.dirty = false; $("edDirty").classList.add("hidden"); $("edStatus").textContent = "Saved"; }
      else { $("edStatus").textContent = d.error || "Save failed"; }
    });
}

function closeEditor() {
  if (edState.dirty && !confirm("Discard unsaved changes?")) return;
  hide("editorOverlay"); edState.path = ""; edState.dirty = false;
}

/* ===== LIVE SCREEN ===== */

var live = { on: false, q: "med", delay: 50, frames: 0, t0: 0, busy: false };
var LIVE_DELAY = { low: 150, med: 50, high: 10 };

function openLiveScreen() { show("liveOverlay"); live.on = true; live.frames = 0; live.t0 = Date.now(); setLiveQ(live.q); }
function setLiveQ(q) {
  live.q = q; live.delay = LIVE_DELAY[q] || 50;
  document.querySelectorAll(".qb[data-q]").forEach(function(b) { b.classList.toggle("active", b.getAttribute("data-q") === q); });
  if (live.on && !live.busy) fetchFrame();
}
function fetchFrame() {
  if (!live.on || live.busy) return;
  live.busy = true;
  apiRaw("/api/screen-live?q=" + live.q + "&t=" + Date.now())
    .then(function(r) { return r.blob(); })
    .then(function(blob) {
      if (!live.on) return;
      var url = URL.createObjectURL(blob), img = $("liveImg"), old = img.src;
      img.onload = function() { if (old && old.indexOf("blob:") === 0) URL.revokeObjectURL(old); };
      img.src = url;
      live.frames++; var el = Date.now() - live.t0;
      if (el >= 1000) { $("liveMeta").textContent = (live.frames * 1000 / el).toFixed(1) + " fps"; live.frames = 0; live.t0 = Date.now(); }
      live.busy = false;
      if (live.on) setTimeout(fetchFrame, live.delay);
    })
    .catch(function() { live.busy = false; if (live.on) setTimeout(fetchFrame, 200); });
}
function closeLive() { live.on = false; hide("liveOverlay"); var i = $("liveImg"); if (i.src && i.src.indexOf("blob:") === 0) URL.revokeObjectURL(i.src); i.src = ""; }

/* ===== LIVE CAM ===== */

var cam = { on: false, q: "med", delay: 50, frames: 0, t0: 0, busy: false };
var CAM_DELAY = { low: 150, med: 50, high: 10 };

function openLiveCam() {
  show("camOverlay");
  cam.on = false;
  cam.frames = 0;
  cam.t0 = Date.now();
  $("camMeta").textContent = "Starting camera...";
  setCamQ(cam.q);
  api("/api/webcam/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
    .then(function(d) {
      if (d.ok) {
        cam.on = true;
        fetchCamFrame();
      } else {
        $("camMeta").textContent = d.error || "Camera unavailable";
      }
    })
    .catch(function() { $("camMeta").textContent = "Error connecting"; });
}

function setCamQ(q) {
  cam.q = q; cam.delay = CAM_DELAY[q] || 50;
  document.querySelectorAll(".cam-qb").forEach(function(b) { b.classList.toggle("active", b.getAttribute("data-cq") === q); });
}

function fetchCamFrame() {
  if (!cam.on || cam.busy) return;
  cam.busy = true;
  apiRaw("/api/webcam-live?q=" + cam.q + "&t=" + Date.now())
    .then(function(r) {
      if (!r.ok) throw new Error("no frame");
      var ct = r.headers.get("content-type") || "";
      if (ct.indexOf("image") === -1) throw new Error("not image");
      return r.blob();
    })
    .then(function(blob) {
      if (!cam.on) return;
      var url = URL.createObjectURL(blob), img = $("camImg"), old = img.src;
      img.onload = function() { if (old && old.indexOf("blob:") === 0) URL.revokeObjectURL(old); };
      img.src = url;
      cam.frames++;
      var el = Date.now() - cam.t0;
      if (el >= 1000) { $("camMeta").textContent = (cam.frames * 1000 / el).toFixed(1) + " fps"; cam.frames = 0; cam.t0 = Date.now(); }
      cam.busy = false;
      if (cam.on) setTimeout(fetchCamFrame, cam.delay);
    })
    .catch(function() { cam.busy = false; if (cam.on) setTimeout(fetchCamFrame, 300); });
}

function closeLiveCam() {
  cam.on = false;
  hide("camOverlay");
  var i = $("camImg");
  if (i.src && i.src.indexOf("blob:") === 0) URL.revokeObjectURL(i.src);
  i.src = "";
  api("/api/webcam/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(function() {});
}

/* ===== UPDATE ===== */

var _updateInfo = null;
var _updatePoll = null;

function checkUpdate() {
  _updateInfo = null;
  show("updateModal");
  _updateSetBody('<p style="color:var(--dim);text-align:center;padding:20px 0">Checking for updates...</p>', "none", "none");

  api("/api/update/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
    .then(function(d) {
      if (d.update_available) {
        _updateInfo = d;
        var dateStr = d.date || "";
        if (dateStr && dateStr.length > 10) {
          try { dateStr = new Date(dateStr).toLocaleDateString(); } catch(e) {}
        }
        _updateSetBody(
          '<div style="text-align:center;padding:8px 0">' +
            '<div style="font-size:20px;margin-bottom:12px;color:var(--cyan)">[~]</div>' +
            '<p style="font-size:14px;margin-bottom:16px;color:var(--accent)">Update Available</p>' +
            '<div style="background:var(--bg2);border:1px solid var(--border);padding:14px;text-align:left">' +
              '<p><span style="color:var(--dim)">Current:</span> <strong>v' + esc(d.current) + '</strong></p>' +
              '<p style="margin-top:6px"><span style="color:var(--dim)">Latest:</span> <strong style="color:var(--green)">v' + esc(d.version) + '</strong></p>' +
              (dateStr ? '<p style="margin-top:6px"><span style="color:var(--dim)">Date:</span> ' + esc(dateStr) + '</p>' : '') +
              (d.file_name ? '<p style="margin-top:6px"><span style="color:var(--dim)">File:</span> ' + esc(d.file_name) + '</p>' : '') +
              (d.notes ? '<p style="margin-top:6px"><span style="color:var(--dim)">Notes:</span> ' + esc(d.notes) + '</p>' : '') +
            '</div>' +
          '</div>', "flex", "none");
      } else {
        _updateSetBody(
          '<div style="text-align:center;padding:20px 0">' +
            '<div style="font-size:20px;margin-bottom:12px;color:var(--green)">[OK]</div>' +
            '<p style="font-size:14px;color:var(--green)">System up to date</p>' +
            '<p style="color:var(--dim);margin-top:6px">Running v' + esc(d.current) + '</p>' +
          '</div>', "none", "flex");
      }
    })
    .catch(function() {
      _updateSetBody(
        '<div style="text-align:center;padding:20px 0">' +
          '<div style="font-size:20px;margin-bottom:12px;color:var(--red)">[ERR]</div>' +
          '<p style="color:var(--red)">Failed to check for updates</p>' +
        '</div>', "none", "flex");
    });
}

function _updateSetBody(html, actionsDisplay, closeDisplay) {
  $("updateBody").innerHTML = html;
  $("updateActions").style.display = actionsDisplay;
  $("updateClose").style.display = closeDisplay;
}

function _progressBar(pct) {
  var filled = Math.round(pct / 5);
  var empty = 20 - filled;
  var bar = '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
  return '<p style="color:var(--accent);font-size:13px;margin-top:16px;text-align:center;letter-spacing:1px">' + bar + '</p>' +
    '<p style="color:var(--dim);font-size:11px;margin-top:4px;text-align:center">' + pct + '%</p>';
}

function applyUpdate() {
  if (!_updateInfo) return;
  $("updateBtn").disabled = true;
  $("updateBtn").textContent = "Starting...";

  api("/api/update/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ download_url: _updateInfo.download_url, version: _updateInfo.version })
  })
    .then(function() {
      _updateSetBody(
        '<div style="text-align:center;padding:12px 0">' +
          '<div style="font-size:20px;margin-bottom:12px;color:var(--cyan)">[>>]</div>' +
          '<p style="font-size:14px;color:var(--accent)">Downloading v' + esc(_updateInfo.version) + '...</p>' +
          _progressBar(0) +
        '</div>', "none", "none");
      _startUpdatePoll();
    })
    .catch(function() {
      $("updateBtn").disabled = false;
      $("updateBtn").textContent = "Update Now";
    });
}

function _startUpdatePoll() {
  var retries = 0;
  _updatePoll = setInterval(function() {
    apiRaw("/api/update/status?t=" + Date.now())
      .then(function(r) {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(function(s) {
        retries = 0;
        if (s.state === "downloading") {
          _updateSetBody(
            '<div style="text-align:center;padding:12px 0">' +
              '<div style="font-size:20px;margin-bottom:12px;color:var(--cyan)">[>>]</div>' +
              '<p style="font-size:14px;color:var(--accent)">Downloading v' + esc(s.version) + '...</p>' +
              '<p style="color:var(--dim);font-size:12px;margin-top:4px">' + (s.downloaded / 1048576).toFixed(1) + ' MB</p>' +
              _progressBar(s.percent) +
            '</div>', "none", "none");
        } else if (s.state === "installing") {
          _updateSetBody(
            '<div style="text-align:center;padding:20px 0">' +
              '<div style="font-size:20px;margin-bottom:12px;color:var(--cyan)">[...]</div>' +
              '<p style="font-size:14px;color:var(--accent)">Installing...</p>' +
              '<p style="color:var(--dim);margin-top:6px">The app will restart in a few seconds.</p>' +
              _progressBar(100) +
            '</div>', "none", "none");
        } else if (s.state === "error") {
          _stopUpdatePoll();
          _updateSetBody(
            '<div style="text-align:center;padding:20px 0">' +
              '<div style="font-size:20px;margin-bottom:12px;color:var(--red)">[ERR]</div>' +
              '<p style="color:var(--red)">Update Failed</p>' +
              '<p style="color:var(--dim);margin-top:6px">' + esc(s.error) + '</p>' +
            '</div>', "none", "flex");
        }
      })
      .catch(function() {
        retries++;
        if (retries >= 3) {
          _stopUpdatePoll();
          _showReconnecting();
        }
      });
  }, 1000);
}

function _showReconnecting() {
  var ver = _updateInfo ? _updateInfo.version : "";
  _updateSetBody(
    '<div style="text-align:center;padding:20px 0">' +
      '<div style="font-size:20px;margin-bottom:12px;color:var(--cyan)">[..]</div>' +
      '<p style="font-size:14px;color:var(--accent)">Restarting app...</p>' +
      '<p style="color:var(--dim);margin-top:6px">Waiting for device to come back online.</p>' +
    '</div>', "none", "none");
  var attempts = 0;
  var reconnect = setInterval(function() {
    attempts++;
    apiRaw("/api/status?t=" + Date.now())
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.ok) {
          clearInterval(reconnect);
          conn.version = d.version || ver;
          var vt = document.querySelector(".version-tag");
          if (vt) vt.textContent = "v" + conn.version;
          _updateSetBody(
            '<div style="text-align:center;padding:20px 0">' +
              '<div style="font-size:20px;margin-bottom:12px;color:var(--green)">[OK]</div>' +
              '<p style="font-size:14px;color:var(--green)">Update Complete</p>' +
              '<p style="color:var(--dim);margin-top:6px">Now running v' + esc(d.version || ver) + '</p>' +
            '</div>', "none", "flex");
        }
      })
      .catch(function() {
        if (attempts > 30) {
          clearInterval(reconnect);
          _updateSetBody(
            '<div style="text-align:center;padding:20px 0">' +
              '<div style="font-size:20px;margin-bottom:12px;color:var(--yellow)">[!]</div>' +
              '<p style="color:var(--yellow)">Device not responding</p>' +
              '<p style="color:var(--dim);margin-top:6px">The update may still be installing. Try refreshing later.</p>' +
            '</div>', "none", "flex");
        }
      });
  }, 2000);
}

function _stopUpdatePoll() {
  if (_updatePoll) { clearInterval(_updatePoll); _updatePoll = null; }
}

function closeUpdate() {
  hide("updateModal");
  _stopUpdatePoll();
  _updateInfo = null;
}

/* ===== LIVE MIC ===== */

var mic = { on: false, timer: null, busy: false, ctx: null, next: 0 };

function openLiveMic() { show("micOverlay"); $("micStatus").textContent = "Press Start to listen."; show("micStartBtn"); hide("micStopBtn"); }

function startMic() {
  $("micStatus").textContent = "Starting...";
  api("/api/mic/start", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + conn.token }, body: "{}" })
    .then(function(d) {
      if (!d.ok) { $("micStatus").textContent = d.error || "Failed"; return; }
      mic.on = true;
      if (!mic.ctx) mic.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (mic.ctx.state === "suspended") mic.ctx.resume();
      mic.next = mic.ctx.currentTime + 0.1;
      hide("micStartBtn"); show("micStopBtn");
      $("micStatus").textContent = "Listening..."; $("micMeta").textContent = "LIVE";
      mic.timer = setInterval(fetchMicChunk, 400);
    });
}

function fetchMicChunk() {
  if (!mic.on || mic.busy) return; mic.busy = true;
  apiRaw("/api/mic/chunk?t=" + Date.now())
    .then(function(r) { var ct = r.headers.get("Content-Type") || ""; return ct.indexOf("audio") !== -1 ? r.arrayBuffer() : null; })
    .then(function(buf) {
      mic.busy = false;
      if (!buf || !mic.on || !mic.ctx) return;
      mic.ctx.decodeAudioData(buf, function(ab) {
        if (!mic.on) return;
        var src = mic.ctx.createBufferSource(); src.buffer = ab; src.connect(mic.ctx.destination);
        var t = Math.max(mic.next, mic.ctx.currentTime + 0.02); src.start(t); mic.next = t + ab.duration;
      }, function() {});
    })
    .catch(function() { mic.busy = false; });
}

function stopMic() {
  mic.on = false; if (mic.timer) { clearInterval(mic.timer); mic.timer = null; }
  api("/api/mic/stop", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + conn.token }, body: "{}" }).catch(function() {});
  show("micStartBtn"); hide("micStopBtn"); $("micStatus").textContent = "Stopped."; $("micMeta").textContent = "Idle";
}

function closeMic() { if (mic.on) stopMic(); hide("micOverlay"); }

/* ===== KEYLOGGER ===== */

var klPoll = null;

function openKeylog() { show("keylogOverlay"); refreshKl(); klPoll = setInterval(refreshKl, 1500); }
function closeKeylog() { hide("keylogOverlay"); if (klPoll) { clearInterval(klPoll); klPoll = null; } }

function refreshKl() {
  apiRaw("/api/keylog/data")
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (!d.ok) return;
      $("klStartBtn").classList.toggle("hidden", d.running);
      $("klStopBtn").classList.toggle("hidden", !d.running);
      $("klMeta").textContent = d.running ? "REC · " + d.count + " keys" : d.count + " keys";
      $("klOutput").textContent = d.data || "(no keystrokes)";
    }).catch(function() {});
}

function startKeylog() {
  api("/api/keylog/start", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + conn.token }, body: "{}" })
    .then(function() { refreshKl(); });
}
function stopKeylog() {
  api("/api/keylog/stop", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + conn.token }, body: "{}" })
    .then(function() { refreshKl(); });
}
function clearKeylog() {
  api("/api/keylog/clear", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + conn.token }, body: "{}" })
    .then(function() { refreshKl(); });
}
function copyKeylog() {
  try { navigator.clipboard.writeText($("klOutput").textContent); $("klMeta").textContent = "Copied!"; setTimeout(refreshKl, 1000); } catch(e) {}
}

/* ===== LIGHTBOX ===== */

function openLightbox(src) { $("lbImg").src = src; show("lightbox"); }
function closeLightbox() { hide("lightbox"); $("lbImg").src = ""; }

document.addEventListener("keydown", function(e) {
  if (e.key === "Escape") { closeLightbox(); closeShell(); closeExplorer(); closeEditor(); closeLive(); closeLiveCam(); closeMic(); closeKeylog(); closeUpdate(); }
});

/* ===== HEALTH ===== */

function startHealth() {
  stopHealth();
  healthInterval = setInterval(function() {
    fetch(conn.url + "/api/status")
      .then(function(r) { return r.json(); })
      .then(function() { $("panelStatus").textContent = "Connected"; $("panelStatus").className = "status-label"; })
      .catch(function() { $("panelStatus").textContent = "Offline"; $("panelStatus").className = "status-label offline"; });
  }, 10000);
}

function stopHealth() { if (healthInterval) { clearInterval(healthInterval); healthInterval = null; } }

/* ===== INIT ===== */

window.onload = function() { checkAuth(); };
