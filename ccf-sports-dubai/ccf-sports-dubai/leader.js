/* CCF Sports Ministry: the leaders' app (scan, follow-up, dashboard, players, settings).
   Works offline: data is kept on the phone and changes wait in an outbox until there is internet. */
(function () {
  "use strict";
  var A = window.App, L = window.Logic, $ = A.$, $$ = A.$$, esc = A.esc, icon = A.icon, I = A.ICONS;

  /* ---------------- local data + outbox ---------------- */
  var EMPTY = { players: [], checkins: [], dgroups: [], settings: {}, rsvps: [], sessionCodes: {}, sheet: false, fetchedAt: 0, role: "leader" };
  var D = A.load("ccf.data", null) || JSON.parse(JSON.stringify(EMPTY));
  var outbox = A.load("ccf.outbox", []);
  var status = { syncing: false, lastError: "", online: navigator.onLine };
  var lastScan = null;

  function auth() { return A.load("ccf.leader", null); }
  function isVol() { var a = auth(); return !!a && a.role === "volunteer"; }
  function rbp() { return L.rsvpsByPlayer(D.rsvps || []); }
  /* The satellite this phone is checking in for (North / South), remembered on the phone. */
  var curSat = A.load("ccf.sat", "");
  function setSat(v) { curSat = v; A.save("ccf.sat", v); }
  function satOfCheckin(c) { if (c.satellite) return c.satellite; var p = D.players.find(function (x) { return x.id === c.playerId; }); return p ? (p.satellite || "") : ""; }
  function satSeg(id, current, withAll) {
    var opts = (withAll ? [["", "All satellites"]] : []).concat(L.SATELLITES.map(function (x) { return [x, x]; }));
    return '<div class="seg" id="' + id + '">' + opts.map(function (o) { return '<button type="button" data-sat="' + o[0] + '" aria-pressed="' + (current === o[0]) + '">' + o[1] + "</button>"; }).join("") + "</div>";
  }
  /* Report filter: "" = all satellites. */
  var satFilter = "";
  /* Next step for a player, taking "I'll play" answers into account. */
  function act(p, visits, rmap) { return L.nextAction(p, visits, D.dgroups, L.today(), (rmap || rbp()).get(p.id) || []); }
  function persist() { A.save("ccf.data", D); A.save("ccf.outbox", outbox); }
  function playersMap() { var m = new Map(); D.players.forEach(function (p) { m.set(p.id, p); }); return m; }
  function rid() { var a = new Uint8Array(9); crypto.getRandomValues(a); return btoa(String.fromCharCode.apply(null, a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  /* Next member number in order (CCF-00001...). Pending sign-ups on this phone count too; the server confirms it when syncing. */
  function newCode() { var max = D.players.reduce(function (m, p) { return Math.max(m, parseInt(p.code, 10) || 0); }, 0); return String(max + 1).padStart(5, "0"); }
  function dgName(id) { var g = D.dgroups.find(function (x) { return x.id === id; }); return g ? g.name : ""; }
  function fac(p) { return L.facilitatorOf(p, D.dgroups); }
  function initials(p) { return (((p.firstName || "?")[0] || "") + ((p.lastName || "")[0] || "")).toUpperCase(); }
  /* D-group name with its D-group leader (separate from the small group lead in sports). */
  function dgCell(p) { var n = dgName(p.dgroupId), l = L.dgroupLeaderOf(p, D.dgroups); return n ? esc(n) + (l ? '<div class="sub" style="margin:0">D-group leader: ' + esc(l) + "</div>" : "") : "—"; }
  /* The satellite an "I'll play" answer is for: the one saved with it, else the player's home satellite. */
  function rsvpSat(r) { if (r.satellite) return r.satellite; var p = D.players.find(function (x) { return x.id === r.playerId; }); return p ? (p.satellite || "") : ""; }
  /* Line-up settings a satellite lead chose for one game day. */
  function cfgFor(d, sat) { return L.gameConfig(D.settings, d, sat); }
  function saveCfg(d, sat, patch) {
    var gd = Object.assign({}, D.settings.gameDays || {}), k = L.gameKey(d, sat), cur = Object.assign({}, gd[k] || {}, patch);
    Object.keys(cur).forEach(function (x) { if (cur[x] == null) delete cur[x]; });
    gd[k] = cur; queue({ type: "settings", data: { gameDays: gd } });
  }
  /* Hand the viewer a file: through Claude's download prompt inside claude.ai, a normal browser download elsewhere. */
  function saveFile(filename, blob) {
    var viaClaude = window.claude && typeof window.claude.use === "function" ? window.claude.use("downloads").catch(function () { return null; }) : Promise.resolve(null);
    return viaClaude.then(function (dl) {
      if (dl) return dl.save({ filename: filename, data: blob }).then(function () { A.toast("Saved " + filename); }, function (e) { if (e && e.code !== "declined") A.toast("Couldn't save the file here"); });
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    });
  }
  var libs = {};
  function loadScript(src) { return libs[src] || (libs[src] = new Promise(function (ok, no) { var sc = document.createElement("script"); sc.src = src; sc.onload = ok; sc.onerror = function () { delete libs[src]; no(new Error("load")); }; document.head.appendChild(sc); })); }
  var LIGHT = { "--bg": "#f4f2ee", "--surface": "#fcfcfb", "--surface-2": "#efece6", "--line": "#e2ded6", "--text": "#14130f", "--text-2": "#52514e", "--muted": "#6b6963", "--accent-soft": "#d4f1f4", "--accent-soft-ink": "#05505a", "--link": "#047785", "--navy": "#0b0d0e",
    "--s1": "#2a78d6", "--s2": "#eb6834", "--f1": "#86b6ef", "--f2": "#6da7ec", "--f3": "#5598e7", "--f4": "#3987e5", "--f5": "#2a78d6", "--f6": "#1c5cab", "--f7": "#104281", "--good": "#1a7f37", "--good-soft": "#dcf3e2", "--good-ink": "#14532d", "--warn": "#9a6700", "--warn-soft": "#fff3cd", "--warn-ink": "#5c3b00", "--shadow": "none" };
  /* The dashboard as an A4 PDF: a picture of each section, page breaks between sections, always in light colours. */
  function dashboardPdf(btn) {
    var main = $("main"); if (!main) return;
    var old = btn.textContent; btn.disabled = true; btn.textContent = "Making PDF…";
    var root = document.documentElement, opened = $$("details", main).filter(function (d) { return !d.open; });
    var done = function () {
      document.body.classList.remove("pdfmode"); Object.keys(LIGHT).forEach(function (k) { root.style.removeProperty(k); }); root.style.removeProperty("color-scheme");
      opened.forEach(function (d) { d.open = false; }); btn.disabled = false; btn.textContent = old;
    };
    Promise.all([loadScript("https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/dist/html-to-image.js"), loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js")]).then(function () {
      document.body.classList.add("pdfmode"); Object.keys(LIGHT).forEach(function (k) { root.style.setProperty(k, LIGHT[k]); }); root.style.setProperty("color-scheme", "light");
      opened.forEach(function (d) { d.open = true; });
      var top = main.getBoundingClientRect().top;
      var breaks = Array.prototype.slice.call(main.children).map(function (el) { return el.getBoundingClientRect().bottom - top; });
      var opts = { backgroundColor: LIGHT["--bg"], pixelRatio: 2, cacheBust: false, width: main.scrollWidth, height: main.scrollHeight, style: { margin: "0", transform: "none" } };
      return window.htmlToImage.toCanvas(main, opts).catch(function () { return window.htmlToImage.toCanvas(main, Object.assign({ skipFonts: true }, opts)); }).then(function (cv) { return { cv: cv, breaks: breaks, w: main.offsetWidth }; });
    }).then(function (r) {
      var PDF = window.PDFLib, ratio = r.cv.width / r.w, pageW = 595.28, pageH = 841.89, mar = 28, head = 22;
      var scale = (pageW - mar * 2) / r.cv.width, maxH = Math.floor((pageH - mar * 2 - head) / scale);
      var cuts = [0], y = 0, bs = r.breaks.map(function (b) { return Math.round(b * ratio); }).concat([r.cv.height]);
      while (y < r.cv.height) {
        var lim = y + maxH, fit = bs.filter(function (b) { return b > y + 40 && b <= lim; });
        y = lim >= r.cv.height ? r.cv.height : fit.length ? fit[fit.length - 1] : lim;
        cuts.push(y);
      }
      return PDF.PDFDocument.create().then(function (doc) {
        return doc.embedFont(PDF.StandardFonts.Helvetica).then(function (font) {
          var m = metrics(), title = (D.settings.name || "CCF Sports Ministry") + " - Dashboard - " + periodLabel(m) + (satFilter && satFilter !== "__none" ? " - " + satFilter : " - all satellites");
          var chain = Promise.resolve(), n = cuts.length - 1;
          cuts.slice(0, -1).forEach(function (c0, i) {
            chain = chain.then(function () {
              var h = cuts[i + 1] - c0, part = document.createElement("canvas"); part.width = r.cv.width; part.height = h;
              part.getContext("2d").drawImage(r.cv, 0, c0, r.cv.width, h, 0, 0, r.cv.width, h);
              return doc.embedPng(part.toDataURL("image/png")).then(function (img) {
                var pg = doc.addPage([pageW, pageH]);
                pg.drawText(title.replace(/[^\x20-\x7E]/g, "-"), { x: mar, y: pageH - mar - 10, size: 9, font: font });
                pg.drawText("Page " + (i + 1) + " of " + n + "  |  made " + L.today(), { x: pageW - mar - 120, y: pageH - mar - 10, size: 8, font: font });
                pg.drawImage(img, { x: mar, y: pageH - mar - head - h * scale, width: r.cv.width * scale, height: h * scale });
              });
            });
          });
          return chain.then(function () { return doc.save(); });
        });
      });
    }).then(function (bytes) {
      done();
      return saveFile("ccf-dashboard-" + (period === "game" ? periodRange()[0] : L.today()) + (satFilter && satFilter !== "__none" ? "-" + satFilter.toLowerCase() : "") + ".pdf", new Blob([bytes], { type: "application/pdf" }));
    }, function (e) { done(); console.error(e); A.toast("Couldn't make the PDF. Check the internet connection and try again."); });
  }

  /* Cover for a game day: { date: { playerId: "Name" } }. The player's usual small group lead stays the same. */
  function coverMap(d) { return ((D.settings.cover || {})[d]) || {}; }
  function leadOn(p, d) { return coverMap(d)[p.id] || p.facilitator || ""; }
  function nameIs(n, me) { n = String(n || "").trim().toLowerCase(); return !!me && !!n && (n === me || n.indexOf(me + " ") === 0); }
  function isMyPlayer(p, me, d) { if (!me || p.volunteer) return false; return nameIs(p.facilitator, me) || nameIs(coverMap(d)[p.id], me); }
  /* Who can cover: ministry leaders, volunteers, and anyone signed up who is already in a D-group. People here today come first. */
  function coverOptions(d) {
    var here = new Set(D.checkins.filter(function (c) { return c.date === d; }).map(function (c) { return c.playerId; })), seen = {}, out = [];
    var add = function (n, k, h) { if (!n || seen[n.toLowerCase()]) return; seen[n.toLowerCase()] = 1; out.push({ n: n, k: k, here: h }); };
    D.players.forEach(function (p) { if (p.volunteer) add(L.fullName(p), "volunteer", here.has(p.id)); });
    (D.settings.leaders || []).forEach(function (n) { add(n, "leader", false); });
    D.players.forEach(function (p) { if (!p.volunteer && (p.dgroupId || p.churchStatus === L.CHURCH[0] || p.dgOutreach === "attending")) add(L.fullName(p), "in a D-group", here.has(p.id)); });
    var rank = { volunteer: 0, leader: 1, "in a D-group": 2 };
    return out.sort(function (a, b) { return (b.here - a.here) || rank[a.k] - rank[b.k] || a.n.localeCompare(b.n); });
  }
  function coverSelect(attrs, d, current, blankLabel) {
    return "<select " + attrs + ">" + '<option value="">' + esc(blankLabel) + "</option>" + coverOptions(d).map(function (o) { return '<option value="' + esc(o.n) + '"' + (o.n === current ? " selected" : "") + ">" + esc(o.n) + " · " + o.k + (o.here ? " · here" : "") + "</option>"; }).join("") + "</select>";
  }
  function coverCard(d) {
    var leads = {};
    D.players.forEach(function (p) { if (!p.volunteer && p.facilitator) (leads[p.facilitator] = leads[p.facilitator] || []).push(p); });
    var here = new Set(D.checkins.filter(function (c) { return c.date === d; }).map(function (c) { return c.playerId; }));
    var names = Object.keys(leads).sort(function (a, b) { return a.localeCompare(b); });
    if (!names.length) return "";
    var cm = coverMap(d);
    return '<div class="card" style="margin-top:12px"><h3>Small group leads today</h3><div class="sub">If a lead can\'t make it, hand their players to a volunteer, a leader, or a player who\'s already in a D-group. It\'s just for that day unless you make it permanent.</div><div class="table-wrap"><table class="t"><thead><tr><th>Lead</th><th class="num">Players</th><th class="num">Here today</th><th>Today</th><th></th></tr></thead><tbody>' +
      names.map(function (n) {
        var ps = leads[n], cov = ps.filter(function (p) { return cm[p.id]; }), who = Array.from(new Set(cov.map(function (p) { return cm[p.id]; })));
        return "<tr><td><b>" + esc(n) + '</b></td><td class="num">' + ps.length + '</td><td class="num">' + ps.filter(function (p) { return here.has(p.id); }).length + "</td><td>" + (cov.length ? '<span class="pill warn">' + cov.length + " covered by " + esc(who.join(", ")) + "</span>" : '<span class="sub" style="margin:0">Leading</span>') + '</td><td><button class="btn small" data-cover="' + esc(n) + '">' + (cov.length ? "Change" : "Away? Hand over") + "</button></td></tr>";
      }).join("") + "</tbody></table></div></div>";
  }
  function bindCover(root, d) { $$("[data-cover]", root).forEach(function (b) { b.onclick = function () { openCover(b.dataset.cover, d); }; }); }
  function openCover(lead, d0) {
    if (isVol()) return A.toast("Only leaders can change who leads players");
    var ng = L.nextGame(D.settings, L.today(), curSat || ""), d = d0 || (ng ? ng.date : L.today());
    var ps = D.players.filter(function (p) { return !p.volunteer && p.facilitator === lead; }).sort(function (a, b) { return L.fullName(a).localeCompare(L.fullName(b)); });
    var here = new Set(D.checkins.filter(function (c) { return c.date === d; }).map(function (c) { return c.playerId; }));
    var draw = function () {
      var cm = coverMap(d);
      A.modal('<div class="mhead"><h3>Hand over ' + esc(lead) + '\'s players</h3><button class="btn small ghost x" data-close aria-label="Close">✕</button></div>' +
        '<div class="grid2 stack"><div><label class="f" for="cvDate">For the game on</label><input type="date" class="input" id="cvDate" value="' + esc(d) + '"></div>' +
        '<div><label class="f" for="cvAll">Give all ' + ps.length + " to</label>" + coverSelect('class="input" id="cvAll"', d, "", "Pick someone…") + "</div></div>" +
        '<div class="sub" style="margin:8px 0">Or split them between people:</div><div class="stackv" style="gap:6px">' + ps.map(function (p) {
          return '<div class="lu" style="background:var(--surface-2)"><span class="lu-nm">' + esc(L.fullName(p)) + (here.has(p.id) ? ' <span class="pill good">here</span>' : "") + "</span>" + coverSelect('class="input" data-cv="' + esc(p.id) + '" style="width:auto;max-width:230px;min-height:36px;font-size:13px"', d, cm[p.id] || "", "Keep with " + lead) + "</div>";
        }).join("") + "</div>" +
        '<label class="toggle" style="margin-top:10px"><input type="checkbox" id="cvPerm"> Make it permanent (change their small group lead)</label>' +
        '<div class="sub" style="margin:4px 0 0">Whoever covers sees these players under <b>My players</b> when they sign in with the volunteer password using that name.</div>' +
        '<div class="mfoot"><button class="btn small ghost" id="cvClear">Clear cover</button><span class="sp"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="cvSave">Save</button></div>', { noFocus: true });
      $$("#modalRoot option").forEach(function (o) { if (o.value && o.value.toLowerCase() === lead.toLowerCase()) o.remove(); });
      $("#cvDate").onchange = function () { if (this.value) { d = this.value; draw(); } };
      $("#cvAll").onchange = function () { var v = this.value; if (v) $$("[data-cv]").forEach(function (s2) { s2.value = v; }); };
      var save = function (clear) {
        var all = Object.assign({}, D.settings.cover || {}), cm2 = Object.assign({}, all[d] || {}), perm = !clear && $("#cvPerm").checked;
        $$("[data-cv]").forEach(function (s2) {
          var pid = s2.dataset.cv, v = clear ? "" : s2.value;
          if (perm && v) { queue({ type: "player", id: pid, patch: { facilitator: v } }); delete cm2[pid]; }
          else if (v) cm2[pid] = v; else delete cm2[pid];
        });
        all[d] = cm2; if (!Object.keys(cm2).length) delete all[d];
        queue({ type: "settings", data: { cover: all } });
        A.closeModal(); A.toast(clear ? "Cover cleared" : perm ? "Small group lead changed" : "Cover saved for " + A.fmt(d)); refreshView();
      };
      $("#cvSave").onclick = function () { save(false); };
      $("#cvClear").onclick = function () { save(true); };
    };
    draw();
  }
  function luFor(d, sat) { return L.lineup(D.checkins.filter(function (c) { return c.date === d && satOfCheckin(c) === sat; }), playersMap(), cfgFor(d, sat)); }

  function applyLocal(op) {
    if (op.type === "player") {
      var p = D.players.find(function (x) { return x.id === op.id; });
      if (p) Object.assign(p, op.patch);
      else D.players.push(Object.assign({ id: op.id }, op.patch));
    } else if (op.type === "checkin") {
      var cid = op.rec.date + "_" + op.rec.playerId;
      if (!D.checkins.some(function (c) { return c.id === cid; })) {
        var prior = D.checkins.some(function (c) { return c.playerId === op.rec.playerId; });
        D.checkins.push(Object.assign({ id: cid, firstTime: !prior, role: "player" }, op.rec));
        var pl = D.players.find(function (x) { return x.id === op.rec.playerId; });
        if (pl && (!pl.firstVisit || pl.firstVisit > op.rec.date)) pl.firstVisit = op.rec.date;
      }
    } else if (op.type === "dgroup") {
      D.dgroups = D.dgroups.filter(function (g) { return g.id !== op.id; });
      if (!op.delete) D.dgroups.push(Object.assign({ id: op.id }, op.data));
      D.dgroups.sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
    } else if (op.type === "settings") {
      D.settings = Object.assign({}, D.settings, op.data);
    } else if (op.type === "deletePlayer") {
      D.players = D.players.filter(function (x) { return x.id !== op.id; });
      D.checkins = D.checkins.filter(function (c) { return c.playerId !== op.id; });
    } else if (op.type === "checkinPatch") {
      var ck = D.checkins.find(function (c) { return c.id === op.id; });
      if (ck) Object.assign(ck, op.patch);
    } else if (op.type === "deleteCheckin") {
      D.checkins = D.checkins.filter(function (c) { return c.id !== op.id; });
    }
  }
  function queue(op) {
    op.qid = rid();
    outbox.push(op); applyLocal(op); persist(); scheduleSync(300); paintStatus();
  }

  var syncT;
  function scheduleSync(ms) { clearTimeout(syncT); syncT = setTimeout(sync, ms || 0); }
  function sync() {
    var a = auth();
    if (!a || status.syncing) return Promise.resolve();
    status.syncing = true; paintStatus();
    var sending = outbox.slice(0, 200);
    var push = sending.length ? A.api("leader", { action: "push", auth: a.auth, ops: sending }, 30000) : Promise.resolve({ results: [] });
    return push.then(function (r) {
      var sentIds = new Set(sending.map(function (o) { return o.qid; }));
      outbox = outbox.filter(function (o) { return !sentIds.has(o.qid); });
      (r.results || []).forEach(function (res, i) {
        if (res && res.codeChanged) A.toast("Member number confirmed as CCF-" + res.codeChanged + " (another phone signed someone up first). Their QR on their phone updates when they open the app.");
        if (res && res.ok === false) console.warn("Change not saved:", sending[i], res.error);
      });
      persist();
      return A.api("leader", { action: "all", auth: a.auth }, 30000);
    }).then(function (all) {
      D = { players: all.players, checkins: all.checkins, dgroups: (all.dgroups || []).sort(function (x, y) { return (x.name || "").localeCompare(y.name || ""); }), settings: all.settings || {}, rsvps: all.rsvps || [], sessionCodes: all.sessionCodes || {}, sheet: !!all.sheet, fetchedAt: Date.now(), role: all.role || "leader" };
      var a2 = auth(); if (a2 && all.role && a2.role !== all.role) { a2.role = all.role; A.save("ccf.leader", a2); }
      outbox.forEach(applyLocal); // keep anything added while we were syncing
      persist(); status.online = true; status.lastError = "";
    }, function (e) {
      if (e.status === 401) { A.save("ccf.leader", null); A.toast("Please sign in again."); A.go("#/leader/login"); }
      status.online = !e.offline; status.lastError = e.offline ? "" : e.message;
    }).then(function () {
      status.syncing = false; paintStatus(); refreshView();
      if (outbox.length && status.online) scheduleSync(2000);
    });
  }
  window.addEventListener("online", function () { status.online = true; scheduleSync(500); });
  window.addEventListener("offline", function () { status.online = false; paintStatus(); });
  setInterval(function () { if (auth() && document.visibilityState === "visible") sync(); }, 60000);
  setInterval(function () { var pth = A.parseHash().path; if (auth() && document.visibilityState === "visible" && /\/(dashboard|lineup)$/.test(pth) && !status.syncing) sync(); }, 20000);
  // the preview's view switcher (and coming back to the app) asks for fresh data
  window.addEventListener("ccf:resync", function () { D.fetchedAt = 0; if (auth()) scheduleSync(50); });

  function statusHTML() {
    var n = outbox.length;
    if (status.syncing) return '<span class="pill" style="background:#2a3a58;color:#fff">Syncing…</span>';
    if (!status.online || !navigator.onLine) return '<span class="pill warn">' + icon(I.wifiOff, 14, "currentColor") + "Offline" + (n ? " · " + n + " waiting" : "") + "</span>";
    if (n) return '<span class="pill warn">' + n + " waiting to upload</span>";
    if (status.lastError) return '<span class="pill warn" title="' + esc(status.lastError) + '">Not synced</span>';
    return '<span class="pill" style="background:#2a3a58;color:#fff">' + icon(I.check, 14, "currentColor", 3) + "Up to date</span>";
  }
  function paintStatus() { var el = $("[data-status]"); if (el) el.innerHTML = statusHTML(); var w = $("[data-waiting]"); if (w) w.textContent = outbox.length; }

  var currentRefresh = null;
  function refreshView() { if (currentRefresh && !$("#modalRoot .overlay")) currentRefresh(); }

  /* ---------------- shell ---------------- */
  var NAVALL = [["scan", "Scan", I.scan], ["lineup", "Line-up", I.list], ["followup", "Follow-up", I.todo], ["dashboard", "Dashboard", I.chart], ["players", "Players", I.people], ["settings", "Settings", I.gear]];
  var NAVVOL = [["mine", "My players", I.people], ["scan", "Scan", I.scan], ["lineup", "Line-up", I.list]];
  /* Volunteers start on their own players; leaders start on Scan. */
  function homeHash() { return isVol() ? "#/leader/mine" : "#/leader/scan"; }
  function lshell(active, body, opts) {
    opts = opts || {};
    var a = auth();
    var NAV = isVol() ? NAVVOL : NAVALL;
    var tabs = NAV.map(function (n) { return '<a href="#/leader/' + n[0] + '" aria-current="' + (n[0] === active ? "page" : "false") + '">' + n[1] + "</a>"; }).join("");
    var bottom = NAV.map(function (n) { return '<a href="#/leader/' + n[0] + '" aria-current="' + (n[0] === active ? "page" : "false") + '">' + icon(n[2], 22, "currentColor") + "<span>" + n[1] + "</span></a>"; }).join("");
    $("#app").innerHTML = '<header class="topbar"><div class="topbar-in"><a class="brand" href="' + homeHash() + '">' + A.ball(28) + "<span>" + esc(D.settings.name || "CCF Sports Ministry") + "<small>" + (isVol() ? "Volunteer" : "Leaders") + " · " + esc(a ? a.name : "") + "</small></span></a>" +
      '<nav class="ltabs" aria-label="Leader sections">' + tabs + '</nav><div class="right" data-status>' + statusHTML() + "</div></div></header>" +
      '<main class="' + (opts.narrow ? "narrow" : "") + '">' + body + "</main>" + '<nav class="bottom" aria-label="Leader sections">' + bottom + "</nav>";
  }
  function needAuth(leadersOnly) {
    if (!auth()) { A.go("#/leader/login"); return true; }
    if (leadersOnly && isVol()) { A.go("#/leader/mine"); return true; }
    if (!status.syncing && (!D.fetchedAt || Date.now() - D.fetchedAt > 5 * 60000)) scheduleSync(200);
    return false;
  }

  /* ---------------- login ---------------- */
  A.routes["/leader"] = function () { A.go(auth() ? homeHash() : "#/leader/login"); };
  A.routes["/leader/login"] = function () {
    currentRefresh = null;
    var last = A.load("ccf.leaderName", "");
    A.shell({ title: "Leaders sign in", back: true, backTo: "#/" },
      '<form id="lg" class="stackv" novalidate><p class="sub" style="font-size:15px;margin:0">For leaders and volunteers helping at the table. Use the password the ministry lead gave you.</p>' +
      '<div><label class="f" for="lg-name">Your name (as players know you)</label><input class="input" id="lg-name" autocomplete="name" value="' + esc(last) + '"></div>' +
      '<div><label class="f" for="lg-pw">Password</label><input class="input" id="lg-pw" type="password" autocomplete="current-password"></div>' +
      '<div class="err" id="lg-err" role="alert"></div><button class="btn primary big" type="submit">Sign in</button>' +
      '<p style="text-align:center;margin:4px 0 0"><a href="#/" style="color:#03a3b4">← Back to home</a></p></form>');
    $("#lg").addEventListener("submit", function (e) {
      e.preventDefault();
      var name = $("#lg-name").value.trim(), pw = $("#lg-pw").value, err = $("#lg-err");
      err.textContent = "";
      if (!name) return (err.textContent = "Enter your name.");
      if (!pw) return (err.textContent = "Enter the password.");
      A.api("leader", { action: "login", name: name, password: pw }).then(function (r) {
        A.save("ccf.leader", { auth: r.auth, name: r.name, role: r.role || "leader" }); A.save("ccf.leaderName", r.name);
        A.toast(r.setup ? "Welcome, " + r.name + ". First step: add the leaders' names in Settings." : "Welcome, " + r.name + ". Downloading players for offline use…");
        sync(); A.go(r.setup ? "#/leader/settings" : homeHash());
      }, function (e2) { err.textContent = e2.offline ? "You need internet to sign in the first time." : e2.message; });
    });
  };

  /* ---------------- scan / check-in ---------------- */
  var scanTab = "scan", scanRole = "player";
  function tonightStats() {
    var t = L.today(), tn = D.checkins.filter(function (c) { return c.date === t && (!curSat || satOfCheckin(c) === curSat); });
    var pl = tn.filter(function (c) { return c.role !== "volunteer"; });
    var here = new Set(tn.map(function (c) { return c.playerId; }));
    var yes = (D.rsvps || []).filter(function (r) { return r.date === t && r.going && (!curSat || rsvpSat(r) === curSat); });
    return { players: pl.length, firsts: pl.filter(function (c) { return c.firstTime; }).length, vols: tn.length - pl.length, yes: yes.length, yesHere: yes.filter(function (r) { return here.has(r.playerId); }).length };
  }
  function statsHTML() {
    var s = tonightStats();
    return '<div class="stats4"><div><b>' + s.players + '</b><span>Players here</span></div><div class="hl"><b>' + s.firsts + '</b><span>First-timers</span></div><div><b>' + s.vols + '</b><span>Volunteers</span></div><div><b>' + s.yesHere + "/" + s.yes + '</b><span>Said yes, here</span></div></div>';
  }
  A.routes["/leader/scan"] = function () {
    if (needAuth()) return;
    var t = L.today();
    lshell("scan",
      '<div class="stackv" style="max-width:560px;margin:0 auto">' +
      (isVol() && curSat ? '<div class="satbar"><span>Checking in for</span><b style="color:var(--text)">' + esc(curSat) + '</b><button type="button" class="btn small ghost" id="satChange">Change</button></div>'
        : '<div><div class="kicker2" style="margin-bottom:6px">Check players in at</div><div class="gympick" id="satSeg">' + L.SATELLITES.map(function (k) { var v = L.venueFor(D.settings, k, t); return '<button type="button" data-sat="' + k + '" aria-pressed="' + (curSat === k) + '"><b>' + esc(k) + "</b><span>" + esc(v.gym || "Gym not set") + (v.time ? " · " + esc(L.fmtTime(v.time)) : "") + "</span></button>"; }).join("") + "</div></div>") +
      (curSat ? '<div class="sub" style="margin:0">Everyone checked in on this phone is recorded as playing at <b>' + esc(curSat) + "</b> today, even if their home satellite is different.</div>" : '<div class="banner warn">Choose which satellite you\'re checking in for. This phone remembers it.</div>') +
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><div><div class="kicker2">' + (L.isGameDay(D.settings, t) ? "Game day" : "Check-in") + (curSat ? " · " + esc(curSat) : "") + '</div><h2 style="font-size:28px;font-weight:800;text-transform:uppercase">' + esc(A.fmt(t)) + '</h2><div id="vline">' + venueLine(t) + '</div></div>' +
      '<a class="btn small" style="margin-left:auto" href="#/leader/tonight">' + icon(I.scan, 16, "currentColor") + " Show " + L.dayName(t) + "'s QR</a></div>" +
      '<div class="seg" role="tablist" aria-label="Check-in method" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr))">' +
      ["scan:Scan QR", "find:Find name", "new:New player"].map(function (x) { var k = x.split(":"); return '<button type="button" role="tab" data-tab="' + k[0] + '" aria-selected="' + (scanTab === k[0]) + '">' + k[1] + "</button>"; }).join("") + "</div>" +
      (scanTab !== "new" ? '<div class="rolebar"><span>Checking in as</span><div class="seg" id="roleSeg"><button type="button" data-r="player" aria-pressed="' + (scanRole === "player") + '">Player</button><button type="button" data-r="volunteer" aria-pressed="' + (scanRole === "volunteer") + '">Volunteer</button></div></div>' : "") +
      '<div id="tabBody"></div>' +
      '<div id="lastScan"></div>' +
      '<div id="tonightStats">' + statsHTML() + "</div>" +
      '<a class="btn" href="#/leader/lineup">' + icon(I.list, 18, "currentColor") + " See " + L.dayName(t) + "'s line-up</a>" +
      (D.fetchedAt ? "" : '<div class="banner warn">The player list hasn\'t downloaded yet. Connect to the internet once before the game.</div>') +
      "</div>");
    $$("[data-tab]").forEach(function (b) { b.onclick = function () { scanTab = b.dataset.tab; A.routes["/leader/scan"](); }; });
    $$("#satSeg button").forEach(function (b) { b.onclick = function () { setSat(b.dataset.sat); A.routes["/leader/scan"](); }; });
    var sc = $("#satChange"); if (sc) sc.onclick = function () { if (window.confirm("Check-ins on this phone are recorded at the satellite you pick. Change it?")) { setSat(""); A.routes["/leader/scan"](); } };
    $$("#roleSeg button").forEach(function (b) { b.onclick = function () { scanRole = b.dataset.r; $$("#roleSeg button").forEach(function (x) { x.setAttribute("aria-pressed", x === b); }); }; });
    paintLastScan();
    var body = $("#tabBody");
    if (scanTab === "scan") {
      body.innerHTML = A.camHTML("Point the camera at the player's QR code");
      $("[data-startcam]").onclick = function () { A.startScanner($(".cam"), onScan); };
    } else if (scanTab === "find") {
      body.innerHTML = '<label class="f" for="fn-q">Name, phone or player code</label><input class="input" id="fn-q" autocomplete="off" placeholder="Type at least 2 letters"><div class="results" id="fn-res"></div>';
      var q = $("#fn-q"); q.focus();
      q.oninput = function () { paintSearch(q.value); };
      q.onkeydown = function (e) { if (e.key === "Enter") { var r = search(q.value); if (r.length === 1) checkIn(r[0].id); } };
    } else newPlayerForm(body);
    currentRefresh = function () {
      if (!A.parseHash().path.endsWith("/scan")) return;
      paintStatus();
      var ts = $("#tonightStats"); if (ts) ts.innerHTML = statsHTML();
      var vl = $("#vline"); if (vl) vl.innerHTML = venueLine(L.today());
      $$("#satSeg button[data-sat]").forEach(function (b) { var sp = b.querySelector("span"), v = L.venueFor(D.settings, b.dataset.sat, L.today()); if (sp) sp.textContent = (v.gym || "Gym not set") + (v.time ? " · " + L.fmtTime(v.time) : ""); });
    };
  };

  function venueLine(d) {
    if (!curSat) return "";
    var v = L.venueFor(D.settings, curSat, d);
    return '<div class="sub" style="margin:2px 0 0">' + (v.gym ? esc(v.gym) : "Gym not set yet (Settings)") + (v.time ? " · " + esc(L.fmtTime(v.time)) : "") + (v.changed ? ' <span class="pill warn">Changed this week</span>' : "") + "</div>";
  }
  function onScan(text) {
    var m = /CCF[-\s]?(\d{5})/i.exec(text) || /^\s*(\d{5})\s*$/.exec(text);
    if (!m) { A.toast(/s=/.test(text) ? "That's today's check-in QR. Scan the player's own QR." : "Not a CCF player QR."); return; }
    var p = D.players.find(function (x) { return String(x.code) === m[1]; });
    if (!p) { A.toast("Code CCF-" + m[1] + " isn't on this phone yet. Try Find name, or sync when online."); return; }
    checkIn(p.id);
  }
  function search(qs) {
    qs = qs.trim().toLowerCase(); if (qs.length < 2) return [];
    var qd = qs.replace(/\D/g, "");
    return D.players.filter(function (p) {
      var nm = L.fullName(p).toLowerCase(), ph = String(p.phone || "").replace(/\D/g, "");
      return nm.indexOf(qs) >= 0 || (qd.length >= 3 && (ph.indexOf(qd) >= 0 || String(p.code).indexOf(qd) >= 0));
    }).sort(function (a, b) { return L.fullName(a).localeCompare(L.fullName(b)); }).slice(0, 12);
  }
  function paintSearch(qs) {
    var res = search(qs), t = L.today(), el = $("#fn-res");
    if (qs.trim().length < 2) { el.innerHTML = ""; return; }
    if (!res.length) { el.innerHTML = '<div class="empty">No match. Try another spelling, or add them as a new player.</div>'; return; }
    el.innerHTML = res.map(function (p) {
      var inToday = D.checkins.some(function (c) { return c.playerId === p.id && c.date === t; });
      return '<button class="result" data-id="' + esc(p.id) + '"><span class="avatar">' + esc(initials(p)) + '</span><span><div class="nm">' + esc(L.fullName(p)) + '</div><div class="meta">' + esc(L.codeLabel(p)) + " · ••" + esc(String(p.phone || "").replace(/\D/g, "").slice(-4)) + '</div></span><span class="go">' + (inToday ? "✓ In today" : "Check in") + "</span></button>";
    }).join("");
    $$("#fn-res .result").forEach(function (b) { b.onclick = function () { checkIn(b.dataset.id); }; });
  }
  function checkIn(id, forceRole) {
    var p = playersMap().get(id); if (!p) return;
    var t = L.today();
    var existing = D.checkins.find(function (c) { return c.playerId === id && c.date === t; });
    var role = forceRole || (p.volunteer ? "volunteer" : scanRole);
    var sat = curSat || p.satellite || "";
    if (!existing) queue({ type: "checkin", rec: { playerId: id, date: t, ts: Date.now(), role: role, satellite: sat, venue: sat ? L.venueFor(D.settings, sat, t).gym : "" } });
    var visits = (L.visitsByPlayer(D.checkins).get(id) || []);
    var ck = D.checkins.find(function (c) { return c.playerId === id && c.date === t; });
    lastScan = { id: id, already: !!existing, n: visits.length, att: L.attendanceOf(visits), first: !!(ck && ck.firstTime), role: ck ? ck.role : role };
    if (A.parseHash().path === "/leader/scan") {
      if (scanTab !== "scan") A.routes["/leader/scan"]();
      else { paintLastScan(); var ts = $("#tonightStats"); if (ts) ts.innerHTML = statsHTML(); }
    }
  }
  function spotText(playerId) {
    var t = L.today(), mine = D.checkins.find(function (c) { return c.date === t && c.playerId === playerId; });
    var sat = mine ? satOfCheckin(mine) : "";
    var lu = luFor(t, sat);
    var me = lu.find(function (x) { return x.checkin.playerId === playerId; });
    if (!me) return "Sitting out today";
    return me.game === 1 ? "Plays in Game 1 · Team " + me.team : "Game " + me.game + " · Team " + me.team + " (#" + me.n + " in line)";
  }
  function paintLastScan() {
    var el = $("#lastScan"); if (!el) return;
    if (!lastScan) { el.innerHTML = ""; return; }
    var p = playersMap().get(lastScan.id); if (!p) { el.innerHTML = ""; return; }
    var action = isVol() ? "" : act(p, L.visitsByPlayer(D.checkins).get(p.id) || []);
    var badge = lastScan.first ? '<span class="pill new">First time</span>' : lastScan.role === "volunteer" ? '<span class="pill">Volunteer</span>' : "";
    el.innerHTML = (lastScan.first ? '<div class="firstbanner">' + icon(I.star, 22, "currentColor") + "<span><b>First time here!</b> Welcome " + esc(p.firstName) + ' and introduce them to a leader. They play first.</span></div>' : "") +
      '<div class="lastscan"><div class="ok">' + icon(I.check, 22, "#fff", 3) + '</div><div style="flex:1;min-width:0"><div style="font-weight:700;display:flex;gap:6px;align-items:center;flex-wrap:wrap">' + esc(L.fullName(p)) + (lastScan.already ? " was already in" : " checked in") + " " + badge + '</div><div class="sub" style="margin:0">' +
      esc(spotText(p.id)) + (lastScan.first ? "" : " · Visit #" + lastScan.n) + (action ? " · ⚑ " + esc(action) : "") + "</div></div>" + (isVol() ? "" : '<button class="btn small" data-open="' + esc(p.id) + '">Open</button>') + "</div>";
    var ck = D.checkins.find(function (c) { return c.playerId === p.id && c.date === L.today(); });
    if (ck && !isVol()) {
      var at = satOfCheckin(ck);
      el.insertAdjacentHTML("beforeend", '<div class="lastsat">Checked in at <b style="color:var(--text)">' + esc(at || "no satellite") + (ck.venue ? " (" + esc(ck.venue) + ")" : "") + "</b>" +
        L.SATELLITES.filter(function (k) { return k !== at; }).map(function (k) { return '<button class="btn small" data-movesat="' + k + '">Change to ' + esc(k) + "</button>"; }).join("") + "</div>");
      $$("[data-movesat]", el).forEach(function (b) { b.onclick = function () {
        var k = b.dataset.movesat;
        queue({ type: "checkinPatch", id: ck.id, patch: { satellite: k, venue: L.venueFor(D.settings, k, ck.date).gym } });
        A.toast(L.fullName(p) + " now counts at " + k + " today"); paintLastScan();
        var ts = $("#tonightStats"); if (ts) ts.innerHTML = statsHTML();
      }; });
    }
    var o = $("[data-open]", el); if (o) o.onclick = function () { openPlayer(p.id); };
  }

  /* ---------------- the game day's line-up ---------------- */
  A.routes["/leader/lineup"] = function () {
    if (needAuth()) return;
    lshell("lineup", '<div style="max-width:760px;margin:0 auto"><div class="dash-head"><div><div class="kicker2">' + esc(A.fmt(L.today())) + (curSat ? " · " + esc(curSat) : "") + '</div><h2>' + esc(L.dayName()) + '\'s line-up</h2><div id="vline">' + venueLine(L.today()) + '</div></div><div class="right">' + satSeg("luSat", curSat, false) + "</div></div>" +
      '<div class="prio"><b>Who plays first</b><ol>' + ["First-timers", "Attendees", "CCF churchgoers with no D-group", "D-group attendees", "Volunteers, once everyone has played"].map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ol>Arrival time breaks ties." + (isVol() ? "" : " Leaders can change the order, the players per game and the number of games.") + '</div><div id="luCfg"></div><div id="luBody"></div></div>');
    $$("#luSat button").forEach(function (b) { b.onclick = function () { setSat(b.dataset.sat); A.routes["/leader/lineup"](); }; });
    paintLineup();
    currentRefresh = paintLineup;
  };
  function paintLineup() {
    var box = $("#luBody"); if (!box) return;
    var vl = $("#vline"); if (vl) vl.innerHTML = venueLine(L.today());
    var t = L.today(), pm = playersMap(), canEdit = !isVol(), cb = $("#luCfg");
    if (!curSat) { box.innerHTML = '<div class="empty">Choose a satellite above to see its line-up.</div>'; if (cb) cb.innerHTML = ""; return; }
    var tn = D.checkins.filter(function (c) { return c.date === t && satOfCheckin(c) === curSat; });
    var cfg = cfgFor(t, curSat), per = parseInt(cfg.perGame, 10) || 10, lu = L.lineup(tn, pm, cfg);
    var size = lu.length ? lu[0].size : per, games = lu.length ? lu[lu.length - 1].game : 0, manual = !!(cfg.order && cfg.order.length);
    var summary = lu.length + " playing · " + games + (games === 1 ? " game" : " games") + " of " + (cfg.games > 0 ? "about " : "") + size + " (" + Math.floor(size / 2) + " v " + Math.ceil(size / 2) + ")";
    if (cb) cb.innerHTML = canEdit ? '<div class="card lucfg"><label>Players per game<select class="input" id="cfgPer">' + [6, 8, 10, 12, 14, 16].map(function (n) { return "<option" + (n === per ? " selected" : "") + ">" + n + "</option>"; }).join("") + "</select></label>" +
      '<label>Number of games<select class="input" id="cfgGames"><option value="0">Auto (' + Math.max(1, Math.ceil(lu.length / per)) + ")</option>" + [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) { return '<option value="' + n + '"' + (+cfg.games === n ? " selected" : "") + ">" + n + "</option>"; }).join("") + "</select></label>" +
      '<div class="sub" style="margin:0">' + esc(summary) + (manual ? ' · <b>order changed by hand</b> <button class="btn small ghost" id="cfgReset">Back to automatic order</button>' : "") + "</div></div>"
      : '<p class="sub" style="font-size:14px">' + esc(summary) + "</p>";
    var ids = lu.map(function (x) { return x.checkin.id; });
    var row = function (x) {
      var p = pm.get(x.checkin.playerId) || {}, c = x.checkin, i = x.n - 1;
      var tag = x.priority === 0 ? '<span class="pill new">First time</span>' : x.priority === 4 ? '<span class="pill">Volunteer</span>' : '<span class="pill" style="font-weight:500">' + esc(L.PRIORITY[x.priority]) + "</span>";
      var ctl = canEdit ? '<span class="lu-ctl"><button class="btn small ghost" data-up="' + i + '" aria-label="Move up"' + (i === 0 ? " disabled" : "") + '>↑</button><button class="btn small ghost" data-down="' + i + '" aria-label="Move down"' + (i === ids.length - 1 ? " disabled" : "") + ">↓</button>" +
        '<select class="input" data-mv="' + i + '" aria-label="Move to game">' + Array.from({ length: games + 1 }, function (_, g) { return '<option value="' + (g + 1) + '"' + (g + 1 === x.game ? " selected" : "") + ">Game " + (g + 1) + "</option>"; }).join("") + "</select>" +
        '<button class="btn small ghost" data-sit="' + esc(c.id) + '">Sit out</button></span>' : "";
      return '<li class="lu"><span class="lu-n">' + x.n + '</span><span class="lu-nm">' + esc(L.fullName(p)) + " " + tag + "</span>" + ctl + "</li>";
    };
    var html = "";
    if (!lu.length) html = '<div class="empty">No one checked in yet today.</div>';
    var byGame = {};
    lu.forEach(function (x) { (byGame[x.game] = byGame[x.game] || []).push(x); });
    Object.keys(byGame).forEach(function (g) {
      var list = byGame[g], full = list.length >= size;
      html += '<div class="card" style="margin-bottom:12px"><h3>Game ' + g + (g === "1" ? " · first on court" : "") + (full ? "" : ' <span class="pill warn">' + list.length + " of " + size + "</span>") + '</h3><div class="teams">' +
        ["A", "B"].map(function (tm) { return '<div><div class="kicker2" style="margin:8px 0 6px">Team ' + tm + '</div><ol class="lulist">' + list.filter(function (x) { return x.team === tm; }).map(row).join("") + "</ol></div>"; }).join("") + "</div></div>";
    });
    var out = tn.filter(function (c) { return c.sitOut; });
    if (out.length) html += '<div class="card" style="margin-bottom:12px"><h3>Sitting out</h3><ol class="lulist">' + out.map(function (c) { var p = pm.get(c.playerId) || {}; return '<li class="lu"><span class="lu-nm">' + esc(L.fullName(p)) + "</span>" + (canEdit ? '<button class="btn small" data-back="' + esc(c.id) + '">Back in</button>' : "") + "</li>"; }).join("") + "</ol></div>";
    var here = new Set(tn.map(function (c) { return c.playerId; }));
    var allHere = new Set(D.checkins.filter(function (c) { return c.date === t; }).map(function (c) { return c.playerId; }));
    var waiting = (D.rsvps || []).filter(function (r) { return r.date === t && r.going && !allHere.has(r.playerId) && rsvpSat(r) === curSat; });
    if (waiting.length) html += '<div class="card"><h3>Said "I\'ll play", not here yet</h3><div class="sub">' + waiting.length + ' players</div><div class="choices">' + waiting.map(function (r) { var p = pm.get(r.playerId); return p ? '<span class="pill">' + esc(L.fullName(p)) + "</span>" : ""; }).join("") + "</div></div>";
    if (canEdit) html += coverCard(t);
    box.innerHTML = html;
    if (canEdit) bindCover(box, t);
    var setOrder = function (next) { saveCfg(t, curSat, { order: next }); paintLineup(); };
    $$("[data-up]", box).forEach(function (b) { b.onclick = function () { var i = +b.dataset.up, n = ids.slice(); n.splice(i - 1, 2, n[i], n[i - 1]); setOrder(n); }; });
    $$("[data-down]", box).forEach(function (b) { b.onclick = function () { var i = +b.dataset.down, n = ids.slice(); n.splice(i, 2, n[i + 1], n[i]); setOrder(n); }; });
    $$("[data-mv]", box).forEach(function (sel) { sel.onchange = function () { var i = +sel.dataset.mv, g = +sel.value, n = ids.slice(), id = n.splice(i, 1)[0]; n.splice(Math.min(g * size - 1, n.length), 0, id); setOrder(n); }; });
    $$("[data-sit]", box).forEach(function (b) { b.onclick = function () { queue({ type: "checkinPatch", id: b.dataset.sit, patch: { sitOut: true } }); paintLineup(); }; });
    $$("[data-back]", box).forEach(function (b) { b.onclick = function () { queue({ type: "checkinPatch", id: b.dataset.back, patch: { sitOut: false } }); paintLineup(); }; });
    var cp = $("#cfgPer"); if (cp) cp.onchange = function () { saveCfg(t, curSat, { perGame: +cp.value }); paintLineup(); };
    var cg = $("#cfgGames"); if (cg) cg.onchange = function () { saveCfg(t, curSat, { games: +cg.value || null }); paintLineup(); };
    var cr = $("#cfgReset"); if (cr) cr.onclick = function () { saveCfg(t, curSat, { order: null }); paintLineup(); };
  }

  function newPlayerForm(box) {
    box.innerHTML = '<form id="np" class="stackv" novalidate>' +
      '<div><span class="f">Signing up as</span><div class="choices" id="np-role"></div></div>' +
      '<div class="grid2"><div><label class="f" for="np-first">First name</label><input class="input" id="np-first"></div><div><label class="f" for="np-last">Last name</label><input class="input" id="np-last"></div></div>' +
      '<div><label class="f" for="np-phone">Mobile number</label><input class="input" id="np-phone" type="tel" inputmode="tel"></div>' +
      '<div><label class="f" for="np-email">Email address</label><input class="input" id="np-email" type="email"></div>' +
      '<div><label class="f" for="np-loc">Where do they live? (area)</label><input class="input" id="np-loc"></div>' +
      '<div><span class="f">Life stage</span><div class="choices" id="np-life"></div></div>' +
      '<div><span class="f">Satellite</span><div class="choices" id="np-sat"></div></div>' +
      '<div id="np-att" class="stackv"><div><span class="f">Church connection</span><div class="choices" id="np-church"></div></div>' +
      '<div><span class="f">Interested in a D-group?</span><div class="choices" id="np-want"></div></div></div>' +
      '<div><label class="f" for="np-inv">Who invited them? (optional)</label><input class="input" id="np-inv"></div>' +
      '<label class="toggle"><input type="checkbox" id="np-ok" checked> OK for a leader to text or call</label>' +
      '<div class="err" id="np-err" role="alert"></div><button class="btn primary big" type="submit">Sign up and check in</button></form>';
    var life = A.choices($("#np-life"), L.LIFE_STAGES, ""), want = A.choices($("#np-want"), L.WANTS, "");
    var role = A.choices($("#np-role"), L.ROLES, "Attendee"), church = A.choices($("#np-church"), L.CHURCH, "");
    var npSat = A.choices($("#np-sat"), L.SATELLITES.map(L.satLabel), curSat ? L.satLabel(curSat) : "");
    $("#np-role").addEventListener("click", function () { setTimeout(function () { $("#np-att").classList.toggle("hidden", role() === "Volunteer"); }, 0); });
    $("#np").addEventListener("submit", function (e) {
      e.preventDefault();
      var err = $("#np-err"), f = $("#np-first").value.trim(), l = $("#np-last").value.trim(), ph = $("#np-phone").value.trim();
      err.textContent = "";
      if (!f || !l) return (err.textContent = "Enter their first and last name.");
      if (ph.replace(/\D/g, "").length < 7) return (err.textContent = "Enter their mobile number.");
      if (!life()) return (err.textContent = "Choose their life stage.");
      if (!npSat() && !curSat) return (err.textContent = "Choose their satellite.");
      if (!role()) return (err.textContent = "Choose Attendee or Volunteer.");
      if (role() === "Attendee" && !church()) return (err.textContent = "Choose their church connection.");
      var dupe = D.players.find(function (p) { return String(p.phone || "").replace(/\D/g, "").slice(-8) === ph.replace(/\D/g, "").slice(-8); });
      if (dupe) return (err.innerHTML = "This number belongs to <b>" + esc(L.fullName(dupe)) + '</b>. <button type="button" class="btn small" id="np-dupe">Check them in instead</button>'), ($("#np-dupe").onclick = function () { checkIn(dupe.id); scanTab = "scan"; A.routes["/leader/scan"](); });
      var id = rid(), t = L.today();
      var patch = { firstName: f, lastName: l, phone: ph, email: $("#np-email").value.trim(), location: $("#np-loc").value.trim(), lifeStage: life(), invitedBy: $("#np-inv").value.trim(),
        wantsConnect: role() === "Volunteer" ? "" : want(), contactOk: $("#np-ok").checked, volunteer: role() === "Volunteer", churchStatus: role() === "Volunteer" ? "" : church(), satellite: L.satFromLabel(npSat()) || curSat, code: newCode(), firstVisit: t, stage: "new", stageDates: { "new": t }, dgroupId: "", dgroupDate: "", followedUp: false, notes: "", createdAt: Date.now(), source: "leader" };
      queue({ type: "player", id: id, patch: patch });
      var nsat = curSat || L.satFromLabel(npSat());
      queue({ type: "checkin", rec: { playerId: id, date: t, ts: Date.now(), role: role() === "Volunteer" ? "volunteer" : "player", satellite: nsat, venue: nsat ? L.venueFor(D.settings, nsat, t).gym : "" } });
      var p = playersMap().get(id);
      A.modal('<div class="mhead"><h3>Welcome, ' + esc(f) + '!</h3><button class="btn small ghost x" data-close aria-label="Close">✕</button></div>' +
        '<p style="margin-top:0">Checked in. Ask them to <b>take a photo of this QR</b>. Next time they just show it.</p>' +
        '<div class="bigqr"><div class="qr" id="npqr"></div><div class="display" style="font-size:30px;font-weight:800;letter-spacing:.08em">' + esc(L.codeLabel(p)) + '</div><div style="font-size:14px;color:#555">' + esc(L.fullName(p)) + "</div></div>" +
        '<p class="sub" style="margin-top:12px">They can also open this website on their phone, tap “I\'ve been here before”, and enter ' + esc(p.code) + " plus the last 4 digits of their mobile.</p>" +
        '<div class="mfoot"><span class="sp"></span><button class="btn primary" data-close>Next player</button></div>', { noFocus: true });
      A.qrInto($("#npqr"), L.codeLabel(p), 260);
      $$("#modalRoot [data-close]").forEach(function (b) { b.addEventListener("click", function () { scanTab = "scan"; A.routes["/leader/scan"](); }); });
    });
  }

  A.routes["/leader/tonight"] = function () {
    if (needAuth()) return;
    currentRefresh = null;
    var t = L.today(), code = (D.sessionCodes || {})[t];
    if (!curSat) { A.toast("Choose your satellite first"); return A.go("#/leader/scan"); }
    A.shell({ title: L.dayName(t) + "'s check-in · " + curSat, sub: A.fmt(t), back: true, backTo: "#/leader/scan" },
      code ? '<div class="stackv" style="align-items:center;text-align:center"><p style="font-size:17px;margin:0">Players with the app: <b>scan this to check in.</b></p>' +
        '<div class="bigqr"><div class="qr" id="tqr"></div><div class="display" style="font-size:26px;font-weight:800;letter-spacing:.12em">' + esc(code) + '</div></div>' +
        '<p class="sub">Only works today. New players can scan it too: it takes them to sign-up.</p></div>'
        : '<div class="empty">Today\'s code hasn\'t downloaded yet. Connect to the internet once, then come back.</div>');
    if (code) A.qrInto($("#tqr"), location.origin + "/#/here?s=" + code + "&v=" + encodeURIComponent(curSat), 300);
  };

  /* ---------------- dashboard ---------------- */
  var period = "month", pFrom = "", pTo = "", pGame = "";
  function gameDates() {
    var set = new Set(D.checkins.filter(function (c) { return !satFilter || satOfCheckin(c) === satFilter; }).map(function (c) { return c.date; }));
    return Array.from(set).sort().reverse();
  }
  /* [from, to] for the chosen period. */
  function periodRange() {
    var t = L.today();
    if (period === "custom") { var a = pFrom || periodStart("all"), b = pTo || t; return a <= b ? [a, b] : [b, a]; }
    if (period === "game") { var g = pGame || gameDates()[0] || t; return [g, g]; }
    return [periodStart(period), t];
  }
  function periodLabel(m) {
    if (period === "custom") return A.fmt(m.a) + " to " + A.fmt(m.b);
    if (period === "game") return "Game on " + A.fmt(m.a);
    return { month: "This month", "3m": "In the last 3 months", year: "This year", all: "So far" }[period];
  }
  function periodStart(p) {
    var t = L.today(), y = +t.slice(0, 4), m = +t.slice(5, 7);
    function first(yy, mm) { while (mm < 1) { mm += 12; yy--; } return yy + "-" + String(mm).padStart(2, "0") + "-01"; }
    if (p === "month") return first(y, m);
    if (p === "3m") return first(y, m - 2);
    if (p === "year") return y + "-01-01";
    var all = D.checkins.map(function (c) { return c.date; }).concat(D.players.map(function (x) { return x.firstVisit; }).filter(Boolean)).sort();
    return all[0] || first(y, m);
  }
  function inRange(d, a, b) { return !!d && d >= a && d <= b; }
  var pct = function (n, d) { return d ? Math.round(100 * n / d) : 0; };
  function metrics() {
    var rg = periodRange(), a = rg[0], b = rg[1], vbp = L.visitsByPlayer(D.checkins), pm = playersMap();
    var inSat = function (c) { return !satFilter || satOfCheckin(c) === satFilter; };
    var allIn = D.checkins.filter(function (c) { return inRange(c.date, a, b) && inSat(c); });
    // with a satellite chosen, the report is about the people who checked in THERE in this period
    var attIds = new Set(allIn.map(function (c) { return c.playerId; }));
    var PL = satFilter ? D.players.filter(function (p) { return attIds.has(p.id); }) : D.players;
    var cin = allIn.filter(function (c) { return c.role !== "volunteer"; });
    var vols = new Set(allIn.filter(function (c) { return c.role === "volunteer"; }).map(function (c) { return c.playerId; }));
    var uniq = new Set(cin.map(function (c) { return c.playerId; }));
    var firsts = satFilter ? PL.filter(function (p) { return allIn.some(function (c) { return c.playerId === p.id && c.firstTime; }); }) : PL.filter(function (p) { return inRange(p.firstVisit, a, b); });
    var returning = new Set(cin.filter(function (c) { var p = pm.get(c.playerId); return p && c.date !== p.firstVisit; }).map(function (c) { return c.playerId; }));
    var cameBack = firsts.filter(function (p) { return (vbp.get(p.id) || []).length >= 2; });
    return {
      a: a, b: b, vbp: vbp, pm: pm, PL: PL, inSat: inSat, cin: cin, vols: vols, rbp: rbp(), uniq: uniq, firsts: firsts, returning: returning, cameBack: cameBack,
      sent: PL.filter(function (p) { return p.dgroupId && inRange(p.dgroupDate, a, b); }),
      decisions: PL.filter(function (p) { return inRange((p.stageDates || {}).received, a, b); }),
      baptisms: PL.filter(function (p) { return inRange((p.stageDates || {}).baptized, a, b); }),
      active: Array.from(uniq).map(function (id) { return pm.get(id); }).filter(function (p) { return p && !p.volunteer; })
    };
  }

  A.routes["/leader/dashboard"] = function () {
    if (needAuth(true)) return;
    lshell("dashboard",
      '<div class="dash-head"><div><div class="kicker2">Leaders\' report</div><h2>Ministry dashboard</h2></div><div class="right noprint"><button class="btn small primary" id="pdfBtn">Download PDF</button><div class="seg" id="periodSeg">' +
      [["month", "This month"], ["3m", "Last 3 months"], ["year", "This year"], ["all", "All time"], ["custom", "Pick dates"], ["game", "One game"]].map(function (x) { return '<button data-p="' + x[0] + '" aria-pressed="' + (period === x[0]) + '">' + x[1] + "</button>"; }).join("") +
      "</div></div></div>" +
      (period === "custom" ? '<div class="periodpick filters noprint"><label>From <input type="date" class="input" id="pFrom" value="' + esc(pFrom || periodRange()[0]) + '"></label><label>To <input type="date" class="input" id="pTo" value="' + esc(pTo || L.today()) + '"></label></div>' : "") +
      (period === "game" ? '<div class="periodpick filters noprint"><label>Game date <select class="input" id="pGame">' + gameDates().slice(0, 60).map(function (d) { return '<option value="' + d + '"' + (d === periodRange()[0] ? " selected" : "") + ">" + esc(A.fmt(d)) + (L.parse(d).getUTCFullYear() !== L.parse(L.today()).getUTCFullYear() ? " " + d.slice(0, 4) : "") + "</option>"; }).join("") + "</select></label></div>" : "") +
      '<div class="filters noprint">' + satSeg("dashSat", satFilter, true) + "</div>" +
      '<div class="card" id="nextGames" style="margin-bottom:16px"></div><div class="card" id="gameDay" style="margin-bottom:16px"></div><div class="headline" id="headline"></div><div class="kpis" id="kpis"></div>' +
      '<div class="row"><div class="card"><h3>Attendance</h3><div class="sub" id="attSub"></div><div class="legend"><span><i style="background:var(--s2)"></i>First-timers</span><span><i style="background:var(--s1)"></i>Returning</span></div><div class="chart" id="attChart"></div></div>' +
      '<div class="card"><h3>Faith journey</h3><div class="sub" id="funnelSub"></div><div class="funnel" id="funnel"></div></div></div>' +
      '<div class="row even"><div class="card"><h3>Where everyone is now</h3><div class="sub">Current faith step of players who came in this period</div><div class="funnel" id="stageNow"></div></div>' +
      '<div class="card"><h3>D-group outreach</h3><div class="sub">Players who came in this period: have we reached out?</div><div class="funnel" id="outBars"></div></div></div>' +
      '<div class="row even"><div class="card"><h3>Small group leads (sports)</h3><div class="sub">Who cares for each player during game play. Tap a name to see their players. D-group leaders are under D-groups.</div><div class="table-wrap" id="facTable"></div></div>' +
      '<div class="card"><h3>Life stage</h3><div class="sub">Players who came in this period</div><div class="table-wrap" id="lifeTable"></div><h3 style="margin-top:18px">Church connection</h3><div class="sub">What attendees said when they signed up</div><div class="table-wrap" id="churchTable"></div></div></div>' +
      '<div class="row even"><div class="card"><h3>D-groups</h3><div class="sub">Who has been forwarded where</div><div class="table-wrap" id="dgTable"></div></div>' +
      '<div class="card"><h3>Said "I\'ll play" vs came</h3><div class="sub">The next game and recent games. Updates as players answer.</div><div class="table-wrap" id="rsvpTable"></div></div></div>' +
      '<div class="card"><h3>By satellite</h3><div class="sub">This period, counted by where people checked in. A player who plays at both counts at each.</div><div class="table-wrap" id="satTable"></div></div>');
    $$("#periodSeg button").forEach(function (b) { b.onclick = function () { period = b.dataset.p; A.routes["/leader/dashboard"](); }; });
    $("#pdfBtn").onclick = function () { dashboardPdf(this); };
    var pf = $("#pFrom"), pt = $("#pTo"), pg = $("#pGame");
    if (pf) pf.onchange = function () { pFrom = pf.value; paintDashboard(); };
    if (pt) pt.onchange = function () { pTo = pt.value; paintDashboard(); };
    if (pg) pg.onchange = function () { pGame = pg.value; paintDashboard(); };
    $$("#dashSat button").forEach(function (b) { b.onclick = function () { satFilter = b.dataset.sat; A.routes["/leader/dashboard"](); }; });
    paintDashboard();
    currentRefresh = paintDashboard;
  };

  function paintDashboard() {
    if (!$("#kpis")) return;
    var m = metrics();
    var need = m.active.filter(function (p) { return act(p, m.vbp.get(p.id) || [], m.rbp); }).length;
    var lbl = periodLabel(m);
    $("#headline").innerHTML = !m.PL.length ? "No players yet" + (satFilter ? " in " + esc(satFilter) : "") + ". Check-ins and sign-ups will show up here." :
      (satFilter ? esc(satFilter) + " · " : "") + esc(lbl) + ": <b>" + m.firsts.length + "</b> new " + (m.firsts.length === 1 ? "player" : "players") + " came to the court and <b>" + pct(m.cameBack.length, m.firsts.length) + "%</b> of them have come back. <b>" + m.sent.length + "</b> forwarded to a D-group, <b>" + m.decisions.length + "</b> received Christ" + (m.baptisms.length ? ", and <b>" + m.baptisms.length + "</b> baptized" : "") + ". <b>" + need + "</b> need follow-up.";
    var k = [["Check-ins", m.cin.length, m.uniq.size + " different players"], ["First-timers", m.firsts.length, "first visit in this period"], ["Returning players", m.returning.size, "came back after a first visit"],
      ["Return rate", pct(m.cameBack.length, m.firsts.length) + "%", m.cameBack.length + " of " + m.firsts.length + " first-timers came again"], ["Sent to D-groups", m.sent.length, "forwarded in this period"],
      ["Received Christ", m.decisions.length, "decisions in this period"], ["Baptized", m.baptisms.length, "in this period"], ["Volunteers served", m.vols.size, "different volunteers"]];
    $("#kpis").innerHTML = k.map(function (x) { return '<div class="kpi"><div class="lbl">' + x[0] + '</div><div class="val">' + x[1] + '</div><div class="hint">' + esc(x[2]) + "</div></div>"; }).join("");
    paintAttendance(m);
    var c = m.firsts, n = c.length, at = function (key) { return c.filter(function (p) { return L.stageIdx(p.stage) >= L.stageIdx(key); }).length; };
    $("#funnelSub").textContent = n ? "Of the " + n + " players who first came in this period, how many reached each step" : "No first-timers in this period yet";
    funnel($("#funnel"), [["First visit", n], ["Came back", m.cameBack.length], ["Open to faith talks", at("open")], ["Heard the Gospel", at("gospel")], ["Received Christ", at("received")],
      ["Sent to a D-group", c.filter(function (p) { return p.dgroupId; }).length], ["Baptized", at("baptized")]].map(function (r, i) { return { label: r[0], v: r[1], color: "--f" + Math.min(i + 1, 7) }; }), n);
    if (m.active.length) {
      funnel($("#stageNow"), L.STAGES.map(function (s, i) { return { label: s.label, v: m.active.filter(function (p) { return L.stageIdx(p.stage) === i; }).length, color: "--s1" }; }), m.active.length);
      var cols = ["--s2", "--s1", "--good", "--muted"];
      funnel($("#outBars"), L.OUTREACH.map(function (o, i) { return { label: o.label, v: m.active.filter(function (p) { return L.outreachOf(p) === o.k; }).length, color: cols[i] }; }), m.active.length);
    } else { $("#stageNow").innerHTML = $("#outBars").innerHTML = '<div class="empty">No check-ins in this period.</div>'; }
    paintFacilitators(m); paintLife(m); paintDgTable(m); paintRsvp(m); paintSat(); paintNextGames(); paintGameDay();
  }

  function funnel(el, rows, total) {
    el.innerHTML = rows.map(function (r) {
      return '<div class="frow"><div class="fl">' + esc(r.label) + '</div><div class="track"><div class="bar" style="width:' + (total ? Math.max(r.v ? 1 : 0, 100 * r.v / total) : 0) + "%;background:var(" + r.color + ')"></div></div><div class="fv"><b>' + r.v + "</b> <span>" + (total ? pct(r.v, total) + "%" : "") + "</span></div></div>";
    }).join("");
  }

  function paintAttendance(m) {
    var span = L.daysBetween(m.a, m.b), monthly = span > 130, buckets = [];
    $("#attSub").textContent = "Check-ins per " + (monthly ? "month" : "week") + ", first-timers vs. returning players";
    function weekStart(s) { var d = L.parse(s); var dow = (d.getUTCDay() + 6) % 7; return L.addDays(s, -dow); }
    if (monthly) {
      var y = +m.a.slice(0, 4), mo = +m.a.slice(5, 7), endKey = m.b.slice(0, 7);
      for (;;) { var key = y + "-" + String(mo).padStart(2, "0"); buckets.push({ key: key, label: L.parse(key + "-01").toLocaleDateString(undefined, { month: "short", timeZone: "UTC" }) + (mo === 1 || !buckets.length ? " '" + String(y).slice(2) : ""), n: 0, r: 0 }); if (key >= endKey) break; mo++; if (mo > 12) { mo = 1; y++; } }
    } else { for (var w = weekStart(m.a); w <= m.b; w = L.addDays(w, 7)) buckets.push({ key: w, label: A.fmt(w).replace(/^\w+,?\s*/, ""), n: 0, r: 0 }); }
    var idx = new Map(buckets.map(function (b, i) { return [b.key, i]; }));
    m.cin.forEach(function (c) { var i = idx.get(monthly ? c.date.slice(0, 7) : weekStart(c.date)); if (i === undefined) return; if (c.firstTime) buckets[i].n++; else buckets[i].r++; });
    var W = 640, H = 240, Lp = 34, R = 8, T = 10, B = 28;
    var max = Math.max.apply(null, [4].concat(buckets.map(function (b) { return b.n + b.r; })));
    var nice = Math.ceil(max / 4) * 4, step = nice / 4;
    var bw = (W - Lp - R) / buckets.length, barW = Math.max(4, Math.min(38, bw * 0.62));
    var yv = function (v) { return T + (H - T - B) * (1 - v / nice); };
    var g = "";
    for (var i = 0; i <= 4; i++) { var v = step * i; g += '<line class="gridline" x1="' + Lp + '" x2="' + (W - R) + '" y1="' + yv(v) + '" y2="' + yv(v) + '"/><text class="axis" x="' + (Lp - 6) + '" y="' + (yv(v) + 4) + '" text-anchor="end">' + v + "</text>"; }
    var every = Math.ceil(buckets.length / 8), bars = "";
    buckets.forEach(function (b, i) {
      var cx = Lp + bw * i + bw / 2, x = cx - barW / 2, yR1 = yv(b.r), yN1 = yv(b.r + b.n);
      if (b.r) bars += rect(x, yR1, barW, yv(0) - yR1, b.n ? 0 : 4, "var(--s1)");
      if (b.n) bars += rect(x, yN1, barW, Math.max(0, yR1 - yN1 - (b.r ? 2 : 0)), 4, "var(--s2)");
      bars += '<rect class="hit" data-i="' + i + '" x="' + (Lp + bw * i) + '" y="' + T + '" width="' + bw + '" height="' + (H - T - B) + '" fill="transparent"/>';
      if (i % every === 0) bars += '<text class="axis" x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(b.label) + "</text>";
    });
    var el = $("#attChart");
    el.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Attendance chart">' + g + bars + '</svg><div class="tip hidden"></div>';
    var tip = $(".tip", el);
    $$(".hit", el).forEach(function (h) {
      var show = function () {
        var b = buckets[+h.dataset.i];
        tip.innerHTML = "<b>" + (monthly ? "" : "Week of ") + esc(b.label) + "</b><br>First-timers: " + b.n + "<br>Returning: " + b.r + "<br>Total: " + (b.n + b.r);
        var r = el.getBoundingClientRect(), hr = h.getBoundingClientRect();
        tip.style.left = (hr.left - r.left + hr.width / 2) + "px"; tip.style.top = (yv(b.n + b.r) / H * r.height) + "px";
        tip.classList.remove("hidden"); h.setAttribute("fill", "rgba(127,127,127,.08)");
      };
      h.addEventListener("mouseenter", show); h.addEventListener("click", show);
      h.addEventListener("mouseleave", function () { tip.classList.add("hidden"); h.setAttribute("fill", "transparent"); });
    });
  }
  function rect(x, y, w, h, r, fill) {
    if (h <= 0) return "";
    r = Math.min(r, h, w / 2);
    if (!r) return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '"/>';
    return '<path d="M' + x + "," + (y + h) + " V" + (y + r) + " Q" + x + "," + y + " " + (x + r) + "," + y + " H" + (x + w - r) + " Q" + (x + w) + "," + y + " " + (x + w) + "," + (y + r) + " V" + (y + h) + ' Z" fill="' + fill + '"/>';
  }
  function volunteers() { return D.players.filter(function (p) { return p.volunteer && ((p.firstName || "") + (p.lastName || "")).trim(); }); }
  /* Names offered for "D-group leader": anyone already leading a D-group, plus ministry leaders. Any other name can be typed. */
  function dgLeaderOptions() {
    var s = new Set((D.settings.leaders || []).filter(Boolean));
    D.dgroups.forEach(function (g) { if (g.leader) s.add(g.leader); });
    D.players.forEach(function (p) { if (p.dgroupLeader) s.add(p.dgroupLeader); });
    return Array.from(s).sort(function (a, b) { return a.localeCompare(b); });
  }
  /* Names offered for "Small group lead (sports)": ministry leaders, existing leads and volunteers. */
  function leadOptions() {
    var s = new Set(leaderNames());
    D.players.forEach(function (p) { if (p.volunteer) s.add(L.fullName(p)); });
    return Array.from(s).sort(function (a, b) { return a.localeCompare(b); });
  }
  function leaderNames() {
    var s = new Set((D.settings.leaders || []).filter(Boolean));
    volunteers().forEach(function (p) { s.add(L.fullName(p).trim()); });
    D.dgroups.forEach(function (g) { if (g.leader) s.add(g.leader); });
    D.players.forEach(function (p) { if (p.facilitator) s.add(p.facilitator); });
    return Array.from(s).sort(function (a, b) { return a.localeCompare(b); });
  }
  // Picker for "Leader caring for them": volunteers from the same satellite first, then other volunteers, then other leaders.
  function facOptions(sat) {
    var seen = new Set(), out = [];
    var vols = volunteers().slice().sort(function (a, b) { return ((a.satellite === sat) ? 0 : 1) - ((b.satellite === sat) ? 0 : 1) || L.fullName(a).localeCompare(L.fullName(b)); });
    vols.forEach(function (v) { var n = L.fullName(v).trim(); if (seen.has(n)) return; seen.add(n); out.push('<option value="' + esc(n) + '" label="Volunteer' + (v.satellite ? " · " + esc(v.satellite) : "") + '">'); });
    leaderNames().forEach(function (n) { if (seen.has(n)) return; seen.add(n); out.push('<option value="' + esc(n) + '" label="Leader">'); });
    return out.join("");
  }
  function isMine(p) { var me = ((auth() || {}).name || "").trim().toLowerCase(), f = (fac(p) || "").trim().toLowerCase(); return !!me && !!f && (f === me || f.indexOf(me + " ") === 0); }
  function paintFacilitators(m) {
    var map = new Map(leaderNames().map(function (n) { return [n, []]; })); map.set("", []);
    m.PL.forEach(function (p) { if (p.volunteer) return; var f = fac(p); if (!map.has(f)) map.set(f, []); map.get(f).push(p); });
    var rows = Array.from(map.entries()).filter(function (e) { return e[1].length || e[0]; }).map(function (e) {
      var ps = e[1];
      return { n: e[0], total: ps.length, active: ps.filter(function (p) { return m.uniq.has(p.id); }).length, regular: ps.filter(function (p) { return L.attendanceOf(m.vbp.get(p.id) || []) === "regular"; }).length,
        reached: ps.filter(function (p) { return L.outreachOf(p) !== "not_yet"; }).length, dg: ps.filter(function (p) { return L.outreachOf(p) === "attending"; }).length,
        saved: ps.filter(function (p) { return L.stageIdx(p.stage) >= L.stageIdx("received"); }).length, act: ps.filter(function (p) { return act(p, m.vbp.get(p.id) || [], m.rbp); }).length };
    }).sort(function (a, b) { return (a.n === "") - (b.n === "") || b.total - a.total; });
    if (!D.players.length) { $("#facTable").innerHTML = '<div class="empty">Volunteers appear here once they sign up. Then open each attendee and pick their small group lead.</div>'; return; }
    $("#facTable").innerHTML = '<table class="t"><thead><tr><th>Small group lead</th><th class="num">Players</th><th class="num">Came</th><th class="num">Regulars</th><th class="num">Reached out</th><th class="num">In D-group</th><th class="num">Received Christ</th><th class="num">Need action</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr class="click" data-f="' + esc(r.n || "__none") + '"><td><b>' + (r.n ? esc(r.n) : '<span style="color:var(--warn)">No small group lead yet</span>') + '</b></td><td class="num">' + r.total + '</td><td class="num">' + r.active + '</td><td class="num">' + r.regular + '</td><td class="num">' + r.reached + '</td><td class="num">' + r.dg + '</td><td class="num">' + r.saved + '</td><td class="num">' + (r.act ? '<b style="color:var(--warn)">' + r.act + "</b>" : "0") + "</td></tr>"; }).join("") + "</tbody></table>";
    $$("#facTable tr[data-f]").forEach(function (tr) { tr.onclick = function () { fuFilter.who = tr.dataset.f; fuFilter.action = false; A.go("#/leader/followup"); }; });
  }
  function paintSat() {
    var keep = satFilter; satFilter = "";
    var rows = L.SATELLITES.concat([""]).map(function (sat) {
      satFilter = sat === "" ? "__none" : sat;
      var m = metrics();
      if (sat === "") { m.PL = []; }
      var visitors = sat ? new Set(m.cin.filter(function (c) { var p = D.players.find(function (x) { return x.id === c.playerId; }); return p && p.satellite && p.satellite !== sat; }).map(function (c) { return c.playerId; })).size : 0;
      return { sat: sat, players: m.uniq.size, visitors: visitors, checkins: m.cin.length, firsts: m.firsts.length, back: m.cameBack.length, dg: m.sent.length, saved: m.decisions.length };
    });
    satFilter = keep;
    var unsure = D.players.filter(function (p) { return !p.satellite && !p.volunteer; }).length;
    $("#satTable").innerHTML = '<table class="t"><thead><tr><th>Satellite</th><th class="num">Played here</th><th class="num">From the other satellite</th><th class="num">Check-ins</th><th class="num">First-timers</th><th class="num">Came back</th><th class="num">Sent to D-group</th><th class="num">Received Christ</th></tr></thead><tbody>' +
      rows.filter(function (r) { return r.sat; }).map(function (r) {
        return '<tr class="click" data-sat="' + r.sat + '"><td><b>' + esc(r.sat) + '</b></td><td class="num">' + r.players + '</td><td class="num">' + r.visitors + '</td><td class="num">' + r.checkins + '</td><td class="num">' + r.firsts + '</td><td class="num">' + r.back + '</td><td class="num">' + r.dg + '</td><td class="num">' + r.saved + "</td></tr>";
      }).join("") + "</tbody></table>" + (unsure ? '<div class="sub" style="margin:10px 0 0">' + unsure + " player" + (unsure === 1 ? "" : "s") + " have no satellite set. Open them in Players to set it.</div>" : "");
    $$("#satTable tr[data-sat]").forEach(function (tr) { tr.onclick = function () { satFilter = tr.dataset.sat; A.routes["/leader/dashboard"](); }; });
  }
  /* Game day report: the people who actually attended and checked in, by the satellite they checked in at. */
  var gdDate = "";
  function paintGameDay() {
    var el = $("#gameDay"); if (!el) return;
    var dates = Array.from(new Set(D.checkins.map(function (c) { return c.date; }))).sort().reverse();
    if (!dates.length) { el.innerHTML = '<h3>Game day report</h3><div class="empty">No check-ins yet.</div>'; return; }
    var d = period === "game" ? periodRange()[0] : (gdDate && dates.indexOf(gdDate) >= 0 ? gdDate : dates[0]);
    var pm = playersMap(), sats = satFilter && satFilter !== "__none" ? [satFilter] : L.SATELLITES;
    var tot = { pl: 0, first: 0, ret: 0, vol: 0, vis: 0, yes: 0, yesCame: 0, walkIn: 0 };
    var rows = sats.map(function (sat) {
      var ck = D.checkins.filter(function (c) { return c.date === d && satOfCheckin(c) === sat; });
      var pl = ck.filter(function (c) { return c.role !== "volunteer"; }), ids = new Set(pl.map(function (c) { return c.playerId; }));
      var vis = pl.filter(function (c) { var p = pm.get(c.playerId); return p && p.satellite && p.satellite !== sat; });
      var yes = (D.rsvps || []).filter(function (r) { return r.date === d && r.going && rsvpSat(r) === sat; });
      var yesIds = new Set(yes.map(function (r) { return r.playerId; }));
      var r = { sat: sat, gym: (ck.find(function (c) { return c.venue; }) || {}).venue || L.venueFor(D.settings, sat, d).gym, pl: pl.length, first: pl.filter(function (c) { return c.firstTime; }).length, vol: ck.length - pl.length, vis: vis.length,
        yes: yes.length, yesCame: yes.filter(function (x) { return ids.has(x.playerId); }).length, walkIn: pl.filter(function (c) { return !yesIds.has(c.playerId); }).length, list: ck };
      r.ret = r.pl - r.first;
      Object.keys(tot).forEach(function (k) { tot[k] += r[k]; });
      return r;
    });
    var cell = function (r, bold) { var b = function (x) { return bold ? "<b>" + x + "</b>" : x; };
      return '<td class="num">' + b(r.pl) + '</td><td class="num">' + r.first + '</td><td class="num">' + r.ret + '</td><td class="num">' + r.vis + '</td><td class="num">' + r.vol + '</td><td class="num">' + r.yesCame + " of " + r.yes + '</td><td class="num">' + r.walkIn + "</td>"; };
    var who = rows.map(function (r) {
      if (!r.list.length) return "";
      return '<details><summary>' + esc(r.sat) + ": see who checked in (" + r.list.length + ")</summary><div class=\"choices\" style=\"margin-top:6px;gap:4px\">" + r.list.slice().sort(function (x, y) { return (x.ts || 0) - (y.ts || 0); }).map(function (c) {
        var p = pm.get(c.playerId) || {}, note = c.role === "volunteer" ? " · volunteer" : c.firstTime ? " · first time" : p.satellite && p.satellite !== r.sat ? " · from " + p.satellite : "";
        return '<span class="pill' + (c.firstTime && c.role !== "volunteer" ? " new" : "") + '">' + esc(L.fullName(p)) + esc(note) + "</span>";
      }).join("") + "</div></details>";
    }).join("");
    el.innerHTML = '<div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap"><div><h3>Game day report</h3><div class="sub" style="margin:0">Who attended and checked in, counted at the satellite where they checked in.</div></div>' +
      (period === "game" ? "" : '<label class="periodpick noprint" style="margin-left:auto">Game date <select class="input" id="gdPick">' + dates.slice(0, 60).map(function (x) { return '<option value="' + x + '"' + (x === d ? " selected" : "") + ">" + esc(A.fmt(x)) + "</option>"; }).join("") + "</select></label>") + "</div>" +
      '<div class="table-wrap" style="margin-top:10px"><table class="t"><thead><tr><th>' + esc(A.fmt(d)) + '</th><th class="num">Checked in</th><th class="num">New</th><th class="num">Returning</th><th class="num">From other sat.</th><th class="num">Volunteers</th><th class="num" title="Said I\'ll play and came">Said yes, came</th><th class="num" title="Came without saying I\'ll play">Walk-ins</th></tr></thead><tbody>' +
      rows.map(function (r) { return "<tr><td><b>" + esc(r.sat) + "</b>" + (r.gym ? '<div class="sub" style="margin:0">' + esc(r.gym) + "</div>" : "") + "</td>" + cell(r) + "</tr>"; }).join("") +
      (rows.length > 1 ? "<tr><td><b>Total</b></td>" + cell(tot, true) + "</tr>" : "") + "</tbody></table></div>" + who;
    var gp = $("#gdPick"); if (gp) gp.onchange = function () { gdDate = gp.value; paintGameDay(); };
  }
  /* Next game per satellite: how many said "I'll play", so leads know how many to expect. */
  function paintNextGames() {
    var el = $("#nextGames"); if (!el) return;
    var t = L.today(), pm = playersMap(), vbp = L.visitsByPlayer(D.checkins), sats = satFilter && satFilter !== "__none" ? [satFilter] : L.SATELLITES;
    el.innerHTML = '<h3>Next game: who\'s coming</h3><div class="sub">Counted from players tapping “I\'ll play” on their app. Updates by itself as they answer.</div><div class="ngrid">' + sats.map(function (sat) {
      var ng = L.nextGame(D.settings, t, sat);
      if (!ng) return '<div class="ngcell"><div class="kicker2">' + esc(sat) + '</div><div class="sub" style="margin:6px 0 0">No game scheduled. Set game days in Settings.</div></div>';
      var v = L.venueFor(D.settings, sat, ng.date), ans = (D.rsvps || []).filter(function (r) { return r.date === ng.date && rsvpSat(r) === sat; });
      var yes = ans.filter(function (r) { return r.going; }), no = ans.length - yes.length;
      var per = parseInt(cfgFor(ng.date, sat).perGame, 10) || 10;
      var newOnes = yes.filter(function (r) { return !(vbp.get(r.playerId) || []).some(function (d) { return d < ng.date; }); }).length;
      var past = Array.from(new Set(D.checkins.filter(function (c) { return c.date < t && satOfCheckin(c) === sat; }).map(function (c) { return c.date; }))).sort().slice(-4);
      var avg = past.length ? Math.round(past.reduce(function (n, d) { return n + new Set(D.checkins.filter(function (c) { return c.date === d && c.role !== "volunteer" && satOfCheckin(c) === sat; }).map(function (c) { return c.playerId; })).size; }, 0) / past.length) : 0;
      var here = ng.date === t ? yes.filter(function (r) { return D.checkins.some(function (c) { return c.date === t && c.playerId === r.playerId; }); }).length : -1;
      var names = yes.map(function (r) { var p = pm.get(r.playerId); return p ? '<span class="pill' + ((vbp.get(p.id) || []).some(function (d) { return d < ng.date; }) ? "" : " new") + '">' + esc(L.fullName(p)) + "</span>" : ""; }).join("");
      return '<div class="ngcell"><div class="kicker2">' + esc(sat) + " · " + (ng.date === t ? "Today" : esc(A.fmt(ng.date))) + (v.time ? " · " + esc(L.fmtTime(v.time)) : "") + (v.gym ? " · " + esc(v.gym) : "") + "</div>" +
        '<div style="display:flex;align-items:baseline;gap:8px;margin-top:6px"><span class="ngbig">' + yes.length + '</span><span style="font-weight:600">said they\'ll play</span></div>' +
        '<div class="sub" style="margin:4px 0 0">' + (newOnes ? newOnes + " new · " : "") + no + " can\'t make it · about " + Math.max(1, Math.ceil(yes.length / per)) + (Math.ceil(yes.length / per) > 1 ? " games" : " game") + " of " + per + (avg ? " · usually " + avg + " come" : "") + (here >= 0 ? " · " + here + " of them here now" : "") + "</div>" +
        (yes.length ? "<details><summary>See who</summary><div class=\"choices\">" + names + "</div></details>" : "") + "</div>";
    }).join("") + "</div>";
  }
  function paintRsvp(m) {
    var t = L.today(), dates = new Set(), ng = L.nextGame(D.settings, t, satFilter || ""), upto = ng ? ng.date : t;
    if (ng) dates.add(ng.date);
    (D.rsvps || []).forEach(function (r) { if (r.date <= upto && (!satFilter || rsvpSat(r) === satFilter)) dates.add(r.date); });
    var list = Array.from(dates).sort().reverse().slice(0, 8);
    if (!list.length) { $("#rsvpTable").innerHTML = '<div class="empty">No "I\'ll play" answers yet. Players see the button on their app for the next game.</div>'; return; }
    $("#rsvpTable").innerHTML = '<table class="t"><thead><tr><th>Game</th><th class="num">Said yes</th><th class="num">Came</th><th class="num">Didn\'t come</th><th class="num">All players</th></tr></thead><tbody>' +
      list.map(function (d) {
        var here = new Set(D.checkins.filter(function (c) { return c.date === d && c.role !== "volunteer" && m.inSat(c); }).map(function (c) { return c.playerId; }));
        var yes = (D.rsvps || []).filter(function (r) { return r.date === d && r.going && (!satFilter || rsvpSat(r) === satFilter); }), came = yes.filter(function (r) { return here.has(r.playerId); }).length;
        var fut = d > t;
        return "<tr><td>" + esc(A.fmt(d)) + (d === t ? ' <span class="pill new">Today</span>' : fut ? ' <span class="pill">Next game</span>' : "") + '</td><td class="num"><b>' + yes.length + '</b></td><td class="num">' + (fut ? "—" : came) + '</td><td class="num">' + (d >= t ? "—" : yes.length - came) + '</td><td class="num">' + (fut ? "—" : here.size) + "</td></tr>";
      }).join("") + "</tbody></table>";
  }
  function paintChurch(m) {
    var el = $("#churchTable"); if (!el) return;
    if (!m.active.length) { el.innerHTML = '<div class="empty">No check-ins in this period.</div>'; return; }
    var cats = L.CHURCH.concat(m.active.some(function (p) { return L.CHURCH.indexOf(p.churchStatus) < 0; }) ? ["Not asked yet"] : []);
    el.innerHTML = '<table class="t"><thead><tr><th>Connection</th><th class="num">Players</th><th class="num">New</th><th class="num">Invited / in D-group</th><th class="num">Received Christ</th></tr></thead><tbody>' +
      cats.map(function (c) {
        var g = m.active.filter(function (p) { return c === "Not asked yet" ? L.CHURCH.indexOf(p.churchStatus) < 0 : p.churchStatus === c; });
        return "<tr><td><b>" + esc(c) + '</b></td><td class="num">' + g.length + '</td><td class="num">' + g.filter(function (p) { return inRange(p.firstVisit, m.a, m.b); }).length + '</td><td class="num">' + g.filter(function (p) { return L.outreachOf(p) === "attending" || L.outreachOf(p) === "invited"; }).length + '</td><td class="num">' + g.filter(function (p) { return L.stageIdx(p.stage) >= L.stageIdx("received"); }).length + "</td></tr>";
      }).join("") + "</tbody></table>";
  }
  function paintLife(m) {
    paintChurch(m);
    if (!m.active.length) { $("#lifeTable").innerHTML = '<div class="empty">No check-ins in this period.</div>'; return; }
    var cats = L.LIFE_STAGES.concat(m.active.some(function (p) { return L.LIFE_STAGES.indexOf(p.lifeStage) < 0; }) ? ["Not given"] : []);
    $("#lifeTable").innerHTML = '<table class="t"><thead><tr><th>Life stage</th><th class="num">Players</th><th class="num">New</th><th class="num">In D-group</th><th class="num">Received Christ</th></tr></thead><tbody>' +
      cats.map(function (c) {
        var g = m.active.filter(function (p) { return c === "Not given" ? L.LIFE_STAGES.indexOf(p.lifeStage) < 0 : p.lifeStage === c; });
        return "<tr><td><b>" + esc(c) + '</b></td><td class="num">' + g.length + '</td><td class="num">' + g.filter(function (p) { return inRange(p.firstVisit, m.a, m.b); }).length + '</td><td class="num">' + g.filter(function (p) { return p.dgroupId; }).length + '</td><td class="num">' + g.filter(function (p) { return L.stageIdx(p.stage) >= L.stageIdx("received"); }).length + "</td></tr>";
      }).join("") + "</tbody></table>";
  }
  function paintDgTable(m) {
    if (!D.dgroups.length) { $("#dgTable").innerHTML = '<div class="empty">No D-groups yet. Add them in Settings.</div>'; return; }
    $("#dgTable").innerHTML = '<table class="t"><thead><tr><th>D-group</th><th>Leader</th><th class="num">Members</th><th class="num">New this period</th><th class="num">Received Christ</th></tr></thead><tbody>' +
      D.dgroups.map(function (g) {
        var mem = m.PL.filter(function (p) { return p.dgroupId === g.id; });
        return '<tr class="click" data-g="' + esc(g.id) + '"><td><b>' + esc(g.name) + '</b><div class="sub" style="margin:0">' + esc(g.meets || "") + "</div></td><td>" + esc(g.leader || "—") + (function () { var o = Array.from(new Set(mem.map(function (p) { return p.dgroupLeader; }).filter(Boolean))); return o.length ? '<div class="sub" style="margin:0">also ' + esc(o.join(", ")) + "</div>" : ""; })() + '</td><td class="num">' + mem.length + '</td><td class="num">' + mem.filter(function (p) { return inRange(p.dgroupDate, m.a, m.b); }).length + '</td><td class="num">' + mem.filter(function (p) { return L.stageIdx(p.stage) >= L.stageIdx("received"); }).length + "</td></tr>";
      }).join("") + "</tbody></table>";
    $$("#dgTable tr[data-g]").forEach(function (tr) { tr.onclick = function () { plFilter.group = tr.dataset.g; A.go("#/leader/players"); }; });
  }

  /* ---------------- follow-up ---------------- */
  var fuFilter = { who: "__mine", action: true, att: "" };
  A.routes["/leader/followup"] = function () {
    if (needAuth(true)) return;
    lshell("followup",
      '<div class="dash-head"><div><div class="kicker2">Player report</div><h2>Follow-up</h2></div></div>' +
      '<div class="filters"><div class="seg" id="fuWho"></div>' +
      '<select class="input" id="fuAtt" aria-label="Attendance"><option value="">All attendance</option>' + Object.keys(L.ATT).map(function (k) { return '<option value="' + k + '">' + esc(L.ATT[k].label) + "</option>"; }).join("") + "</select>" +
      '<select class="input" id="fuSat" aria-label="Satellite"><option value="">All satellites</option>' + L.SATELLITES.map(function (x) { return "<option>" + x + "</option>"; }).join("") + '</select>' +
      '<label class="toggle"><input type="checkbox" id="fuAct"> Only players who need action</label></div><div id="fuBody"></div>');
    $("#fuAtt").value = fuFilter.att; $("#fuAct").checked = fuFilter.action;
    $("#fuAtt").onchange = function () { fuFilter.att = this.value; paintFollowup(); };
    $("#fuSat").value = fuFilter.sat || ""; $("#fuSat").onchange = function () { fuFilter.sat = this.value; paintFollowup(); };
    $("#fuAct").onchange = function () { fuFilter.action = this.checked; paintFollowup(); };
    paintFollowup();
    currentRefresh = paintFollowup;
  };
  function paintFollowup() {
    var who = $("#fuWho"); if (!who) return;
    var me = (auth() || {}).name || "";
    var opts = [["__mine", "My players"], ["__none", "Unassigned"], ["", "Everyone"]];
    if (fuFilter.who && !opts.some(function (o) { return o[0] === fuFilter.who; })) opts.push([fuFilter.who, fuFilter.who]);
    who.innerHTML = opts.map(function (o) { return '<button data-w="' + esc(o[0]) + '" aria-pressed="' + (fuFilter.who === o[0]) + '">' + esc(o[1]) + "</button>"; }).join("");
    $$("button", who).forEach(function (b) { b.onclick = function () { fuFilter.who = b.dataset.w; paintFollowup(); }; });
    var vbp = L.visitsByPlayer(D.checkins), t = L.today(), rm = rbp();
    var rows = D.players.filter(function (p) { return !p.volunteer; }).map(function (p) { var v = vbp.get(p.id) || []; return { p: p, v: v, att: L.attendanceOf(v, t), out: L.outreachOf(p), f: fac(p), act: act(p, v, rm) }; })
      .filter(function (r) {
        if (fuFilter.who === "__mine" && r.f.toLowerCase() !== me.toLowerCase()) return false;
        if (fuFilter.who === "__none" && r.f) return false;
        if (fuFilter.who && fuFilter.who.indexOf("__") !== 0 && r.f !== fuFilter.who) return false;
        if (fuFilter.att && r.att !== fuFilter.att) return false;
        if (fuFilter.sat === "__none" && r.p.satellite) return false;
        if (fuFilter.sat && fuFilter.sat !== "__none" && r.p.satellite !== fuFilter.sat) return false;
        if (fuFilter.action && !r.act) return false;
        if (!fuFilter.action && !fuFilter.att && r.att === "noreturn" && fuFilter.who === "") return false;
        return true;
      })
      .sort(function (a, b) { return (b.act ? 1 : 0) - (a.act ? 1 : 0) || (b.v[b.v.length - 1] || "").localeCompare(a.v[a.v.length - 1] || ""); });
    var body = $("#fuBody");
    if (!rows.length) {
      body.innerHTML = '<div class="empty">' + (fuFilter.who === "__mine" ? "No players assigned to you" + (fuFilter.action ? " need action right now." : " yet. Open a player and set yourself as their small group lead.") : "Nothing here right now.") + "</div>";
      return;
    }
    var attPill = function (k) { return '<span class="pill" title="' + esc(L.ATT[k].hint) + '"><span class="dot" style="background:' + L.ATT[k].color + '"></span>' + esc(L.ATT[k].label) + "</span>"; };
    var outPill = function (k) { return '<span class="pill ' + (k === "attending" ? "good" : k === "not_yet" ? "new" : "") + '">' + esc(L.outreachLabel(k)) + "</span>"; };
    var wide = window.matchMedia("(min-width: 900px)").matches;
    if (wide) {
      body.innerHTML = '<div class="card" style="padding:8px 12px"><div class="table-wrap"><table class="t"><thead><tr><th>Player</th><th>Attendance</th><th class="num">Visits</th><th>Last seen</th><th>D-group outreach</th><th>D-group</th><th>Small group lead</th><th>Faith step</th><th>Next step</th></tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr class="click" data-id="' + esc(r.p.id) + '"><td><b>' + esc(L.fullName(r.p)) + '</b><div class="sub" style="margin:0">' + esc(r.p.lifeStage || "") + "</div></td><td>" + attPill(r.att) + '</td><td class="num">' + r.v.length + "</td><td>" + A.fmt(r.v[r.v.length - 1]) + "</td><td>" + outPill(r.out) + "</td><td>" + dgCell(r.p) + "</td><td>" + (r.f ? esc(r.f) : '<span style="color:var(--warn);font-weight:600">Unassigned</span>') + '</td><td><span class="pill">' + esc(L.stageLabel(r.p.stage)) + '</span></td><td style="font-weight:600">' + (r.act ? "⚑ " + esc(r.act) : '<span style="color:var(--muted);font-weight:400">On track</span>') + "</td></tr>";
        }).join("") + '</tbody></table></div><div class="sub" style="margin:10px 0 0">' + rows.length + " players</div></div>";
    } else {
      body.innerHTML = '<div class="stackv" style="gap:10px">' + rows.map(function (r) {
        return '<div class="fu-card"><div style="flex:1;min-width:0"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>' + esc(L.fullName(r.p)) + "</b>" + attPill(r.att) + '</div><div class="sub" style="margin:2px 0 0">' + r.v.length + (r.v.length === 1 ? " visit" : " visits") + " · last " + A.fmt(r.v[r.v.length - 1]) + " · " + esc(L.stageLabel(r.p.stage)) + "</div>" + (r.act ? '<div class="why">⚑ ' + esc(r.act) + "</div>" : "") + '</div><button class="btn soft" data-id="' + esc(r.p.id) + '">Open</button></div>';
      }).join("") + "</div>";
    }
    $$("[data-id]", body).forEach(function (el) { el.onclick = function () { openPlayer(el.dataset.id); }; });
  }

  /* ---------------- my players (small group lead, incl. volunteers) ---------------- */
  A.routes["/leader/mine"] = function () {
    if (needAuth()) return;
    lshell("mine", '<div style="max-width:760px;margin:0 auto"><div class="dash-head"><div><div class="kicker2">Small group lead (sports)</div><h2>My players</h2></div></div>' +
      '<p class="sub" style="font-size:14px">Players a leader assigned to you. Tap Open to see and update their details, faith step, D-group and notes. Check on them during the week and look out for them on game day.</p><div id="mineBody"></div></div>');
    paintMine(); currentRefresh = paintMine;
  };
  function paintMine() {
    var box = $("#mineBody"); if (!box) return;
    var me = ((auth() || {}).name || "").trim().toLowerCase(), t = L.today(), vbp = L.visitsByPlayer(D.checkins), rm = rbp();
    var mine = D.players.filter(function (p) { return isMyPlayer(p, me, t); })
      .map(function (p) { var v = vbp.get(p.id) || []; return { p: p, v: v, last: v[v.length - 1] || "" }; })
      .sort(function (a, b) { return b.last.localeCompare(a.last); });
    if (!mine.length) { box.innerHTML = '<div class="empty">No players have <b>' + esc((auth() || {}).name || "you") + '</b> as their Small group lead yet. A leader sets this on each player\'s record, and it has to match the name you signed in with.</div>'; return; }
    box.innerHTML = '<div class="sub" style="margin:0 0 8px">' + mine.length + (mine.length === 1 ? " player" : " players") + '</div><div class="stackv" style="gap:10px">' + mine.map(function (r) {
      var p = r.p, att = L.attendanceOf(r.v, t), here = r.v.indexOf(t) >= 0, ng = L.nextGame(D.settings, t, p.satellite || "");
      var ans = ng && (rm.get(p.id) || []).find(function (x) { return x.date === ng.date; });
      var ph = String(p.phone || "").replace(/\D/g, "");
      var rsvp = ng ? (ans ? (ans.going ? "Said they'll play " : "Can't make it ") : "No answer yet for ") + A.fmt(ng.date) : "";
      return '<div class="fu-card"><div style="flex:1;min-width:0"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>' + esc(L.fullName(p)) + '</b>' + (function () { var c = coverMap(t)[p.id]; if (!c) return ""; return nameIs(c, me) ? '<span class="pill warn">Covering for ' + esc(p.facilitator || "a lead") + " today</span>" : '<span class="pill">' + esc(c) + " covers today</span>"; })() + '<span class="pill"><span class="dot" style="background:' + L.ATT[att].color + '"></span>' + esc(L.ATT[att].label) + "</span>" + (here ? '<span class="pill good">Here today</span>' : "") + "</div>" +
        '<div class="sub" style="margin:2px 0 0">' + r.v.length + (r.v.length === 1 ? " visit" : " visits") + (r.last ? " · last " + A.fmt(r.last) : "") + (p.satellite ? " · " + esc(p.satellite) : "") + (rsvp ? " · " + esc(rsvp) : "") + "</div>" +
        (here ? '<div class="why" style="color:var(--text)">' + esc(spotText(p.id)) + "</div>" : "") +
        (!p.followedUp && r.v.length ? '<div style="margin-top:6px"><button class="btn small soft" data-fu="' + esc(p.id) + '">Mark as followed up</button></div>' : "") + "</div>" +
        '<div style="display:flex;flex-direction:column;gap:6px"><button class="btn small primary" data-mine="' + esc(p.id) + '">Open</button>' + (ph && p.contactOk !== false ? '<a class="btn small" href="https://wa.me/' + ph + '" target="_blank" rel="noopener">WhatsApp</a><a class="btn small ghost" href="tel:+' + ph + '">Call</a>' : '<span class="sub" style="margin:0">Not OK to contact</span>') + "</div></div>";
    }).join("") + "</div>";
    $$("[data-fu]", box).forEach(function (b) { b.onclick = function () { queue({ type: "player", id: b.dataset.fu, patch: { followedUp: true, followedUpDate: t } }); A.toast("Marked as followed up"); paintMine(); }; });
    $$("[data-mine]", box).forEach(function (b) { b.onclick = function () { openMine(b.dataset.mine); }; });
  }
  /* A small group lead (or whoever covers today) can update their players. */
  function openMine(id) {
    var p = playersMap().get(id), me = ((auth() || {}).name || "").trim().toLowerCase();
    if (!p || !isMyPlayer(p, me, L.today())) return A.toast("This player isn't assigned to you");
    openPlayer(id, true);
  }

  /* ---------------- players ---------------- */
  var plFilter = { q: "", stage: "", group: "", type: "", who: "" }, plSort = { key: "last", dir: -1 };
  A.routes["/leader/players"] = function () {
    if (needAuth(true)) return;
    lshell("players",
      '<div class="dash-head"><h2>Players</h2><div class="right"><button class="btn small" id="addPl">+ Add player</button></div></div>' +
      '<div class="card"><div class="filters"><input class="input search" id="pq" placeholder="Search name, phone, code, area…" aria-label="Search players">' +
      '<select class="input" id="pst" aria-label="Faith step"><option value="">All faith steps</option>' + L.STAGES.map(function (s) { return '<option value="' + s.k + '">' + esc(s.label) + "</option>"; }).join("") + "</select>" +
      '<select class="input" id="pgr" aria-label="D-group"></select>' +
      '<select class="input" id="pld" aria-label="Caring leader"></select>' +
      '<select class="input" id="psat" aria-label="Satellite"><option value="">All satellites</option>' + L.SATELLITES.map(function (x) { return "<option>" + x + "</option>"; }).join("") + '</select>' +
      '<select class="input" id="pty" aria-label="Attendance"><option value="">All attendance</option>' + Object.keys(L.ATT).map(function (k) { return '<option value="' + k + '">' + esc(L.ATT[k].label) + "</option>"; }).join("") + "</select></div>" +
      '<div class="table-wrap"><table class="t" id="pt"></table></div><div class="sub" id="pc" style="margin:10px 0 0"></div></div>');
    $("#pq").value = plFilter.q; $("#pst").value = plFilter.stage; $("#pty").value = plFilter.type;
    $("#pq").oninput = function () { plFilter.q = this.value; paintPlayers(); };
    $("#pst").onchange = function () { plFilter.stage = this.value; paintPlayers(); };
    $("#pgr").onchange = function () { plFilter.group = this.value; paintPlayers(); };
    $("#pld").onchange = function () { plFilter.who = this.value; paintPlayers(); };
    $("#pty").onchange = function () { plFilter.type = this.value; paintPlayers(); };
    $("#psat").value = plFilter.sat || ""; $("#psat").onchange = function () { plFilter.sat = this.value; paintPlayers(); };
    $("#addPl").onclick = function () { openPlayer(null); };
    paintPlayers();
    currentRefresh = paintPlayers;
  };
  function paintPlayers() {
    var sel = $("#pgr"); if (!sel) return;
    sel.innerHTML = '<option value="">All D-groups</option><option value="__none">Not in a D-group</option>' + D.dgroups.map(function (g) { return '<option value="' + esc(g.id) + '">' + esc(g.name) + "</option>"; }).join("");
    sel.value = plFilter.group;
    var me = (auth() || {}).name || "";
    $("#pld").innerHTML = '<option value="">All leaders</option>' + (me ? '<option value="__me">My people (' + esc(me) + ')</option>' : "") + '<option value="__none">No leader yet</option><option value="__vol">Volunteers only</option>' + leaderNames().map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + "</option>"; }).join("");
    $("#pld").value = plFilter.who || "";
    var vbp = L.visitsByPlayer(D.checkins), q = plFilter.q.trim().toLowerCase();
    var rows = D.players.map(function (p) { var v = vbp.get(p.id) || []; return { p: p, v: v, last: v[v.length - 1] || "", att: L.attendanceOf(v) }; }).filter(function (r) {
      var p = r.p;
      if (q && (L.fullName(p) + " " + p.phone + " " + p.email + " " + p.location + " " + L.codeLabel(p) + " " + p.invitedBy).toLowerCase().indexOf(q) < 0) return false;
      if (plFilter.stage && p.stage !== plFilter.stage) return false;
      if (plFilter.group === "__none" && p.dgroupId) return false;
      if (plFilter.group && plFilter.group !== "__none" && p.dgroupId !== plFilter.group) return false;
      if (plFilter.type && r.att !== plFilter.type) return false;
      var w = plFilter.who || "";
      if (w === "__me" && (p.volunteer || !isMine(p))) return false;
      if (w === "__none" && (p.volunteer || fac(p))) return false;
      if (w === "__vol" && !p.volunteer) return false;
      if (w && w.indexOf("__") !== 0 && (p.volunteer || fac(p) !== w)) return false;
      if (plFilter.sat === "__none" && p.satellite) return false;
      if (plFilter.sat && plFilter.sat !== "__none" && p.satellite !== plFilter.sat) return false;
      return true;
    });
    var k = plSort.key, val = function (r) { return k === "name" ? L.fullName(r.p).toLowerCase() : k === "visits" ? r.v.length : k === "stage" ? L.stageIdx(r.p.stage) : r.last; };
    rows.sort(function (a, b) { var x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * plSort.dir; });
    var th = function (key, label, cls) { return '<th class="' + (cls || "") + '"><button data-k="' + key + '">' + label + (k === key ? (plSort.dir > 0 ? " ▲" : " ▼") : "") + "</button></th>"; };
    $("#pt").innerHTML = "<thead><tr>" + th("name", "Name") + "<th>Code</th><th>Mobile</th><th>Life stage</th>" + th("visits", "Visits", "num") + "<th>Attendance</th>" + th("last", "Last seen") + th("stage", "Faith step") + "<th>D-group</th><th>Small group lead</th></tr></thead><tbody>" +
      (rows.map(function (r) {
        var p = r.p;
        return '<tr class="click" data-id="' + esc(p.id) + '"><td><b>' + esc(L.fullName(p)) + '</b><div class="sub" style="margin:0">' + esc(p.location || "") + "</div></td><td style=\"white-space:nowrap\">" + esc(L.codeLabel(p)) + "</td><td style=\"white-space:nowrap\">" + esc(p.phone) + '</td><td style="font-size:13px">' + esc(p.lifeStage || "—") + '<div class="sub" style="margin:0">' + esc(p.volunteer ? "Volunteer" : (p.churchStatus || "")) + (p.satellite ? " · " + esc(p.satellite) : "") + (playsBoth(p) ? " · plays both" : "") + '</div></td><td class="num">' + r.v.length + '</td><td><span class="pill"><span class="dot" style="background:' + L.ATT[r.att].color + '"></span>' + esc(L.ATT[r.att].label) + "</span></td><td>" + A.fmt(r.last) + '</td><td><span class="pill">' + esc(L.stageLabel(p.stage)) + "</span></td><td>" + dgCell(p) + '</td><td style="font-size:13px">' + (p.volunteer ? '<span class="pill">Volunteer</span>' : esc(fac(p) || "—")) + "</td></tr>";
      }).join("") || '<tr><td colspan="10"><div class="empty">' + (D.players.length ? "No players match these filters." : "No players yet. They appear here as they sign up.") + "</div></td></tr>") + "</tbody>";
    $$("#pt th button").forEach(function (b) { b.onclick = function () { var key = b.dataset.k; plSort = { key: key, dir: plSort.key === key ? -plSort.dir : (key === "name" ? 1 : -1) }; paintPlayers(); }; });
    $$("#pt tr[data-id]").forEach(function (tr) { tr.onclick = function () { openPlayer(tr.dataset.id); }; });
    $("#pc").textContent = rows.length + " of " + D.players.length + " players";
  }

  /* ---------------- player details ---------------- */
  function playsBoth(p) {
    var s = new Set(D.checkins.filter(function (c) { return c.playerId === p.id && c.satellite; }).map(function (c) { return c.satellite; }));
    return s.size > 1;
  }
  function playedLine(p) {
    var mine = D.checkins.filter(function (c) { return c.playerId === p.id; });
    var txt = L.playedAtText(mine, p.satellite);
    return txt ? '<p class="sub" style="margin:0 0 8px">Played at: <b>' + esc(txt) + "</b>" + (p.satellite ? " · home satellite " + esc(p.satellite) : "") + "</p>" : "";
  }
  function rsvpLine(id, visits) {
    var mine = rbp().get(id) || [], yes = mine.filter(function (r) { return r.going && r.date < L.today(); });
    if (!yes.length) return "";
    var miss = L.noShows(mine, visits);
    return '<p class="sub" style="margin:0 0 8px">Said “I\'ll play” ' + yes.length + " time" + (yes.length === 1 ? "" : "s") + (miss.length ? " · didn't come " + miss.length + " (" + miss.slice(-3).map(A.fmt).join(", ") + ")" : " · came every time") + "</p>";
  }
  function openPlayer(id, lim) {
    var isNew = !id, t = L.today();
    var p0 = isNew ? { firstName: "", lastName: "", phone: "", email: "", location: "", lifeStage: "", invitedBy: "", wantsConnect: "", contactOk: true, firstVisit: "", stage: "new", stageDates: { "new": t }, dgroupId: "", dgroupDate: "", followedUp: false, notes: "" } : playersMap().get(id);
    if (!p0) return;
    var p = JSON.parse(JSON.stringify(p0)); p.stageDates = p.stageDates || {};
    var visits = isNew ? [] : (L.visitsByPlayer(D.checkins).get(id) || []);
    var att = L.attendanceOf(visits);
    var opt = function (arr, v) { return '<option value=""></option>' + arr.map(function (a) { return "<option" + (a === v ? " selected" : "") + ">" + esc(a) + "</option>"; }).join(""); };
    var action = isNew ? "" : act(p0, visits);
    A.modal('<div class="mhead"><span class="avatar">' + esc(isNew ? "+" : initials(p)) + "</span><div><h3>" + (isNew ? "Add player" : esc(L.fullName(p))) + '</h3><div class="sub" style="margin:0">' + (isNew ? "Adds the player without checking them in" : esc(L.codeLabel(p)) + " · " + visits.length + " visit" + (visits.length === 1 ? "" : "s") + " · first came " + A.fmt(p.firstVisit)) + '</div></div><button class="btn small ghost x" data-close aria-label="Close">✕</button></div>' +
      (action ? '<div class="banner warn">⚑ Next step: <b>' + esc(action) + "</b></div>" : "") +
      '<div class="section-t">Faith journey</div><div class="stepper" id="mStep">' + L.STAGES.map(function (s) { return '<button type="button" data-k="' + s.k + '">' + esc(s.label) + "</button>"; }).join("") + "</div>" +
      '<div style="display:flex;gap:10px;align-items:center;font-size:13px;color:var(--text-2);flex-wrap:wrap"><span id="mStageInfo"></span><label style="margin-left:auto">Date of this step <input type="date" class="input" id="mStageDate" style="width:auto;min-height:36px;padding:4px 8px;display:inline-block"></label></div>' +
      '<div class="section-t">Care &amp; D-group</div>' +
      (isNew ? "" : '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;font-size:13px;color:var(--text-2)">Attendance (automatic): <span class="pill"><span class="dot" style="background:' + L.ATT[att].color + '"></span>' + esc(L.ATT[att].label) + "</span>" + esc(L.ATT[att].hint) + "</div>") +
      '<div class="grid2 stack"><div id="mFacWrap"><label class="f" for="mFac">Small group lead (sports)</label><input class="input" id="mFac" list="mFacList" value="' + esc(p.facilitator || "") + '" placeholder="Type or pick a leader or volunteer"' + (lim ? " readonly" : "") + '><datalist id="mFacList">' + facOptions(p.satellite) + "</datalist>" +
      (lim ? '<div class="sub" style="margin:4px 0 0">' + (coverMap(t)[id] ? "Covered today by " + esc(coverMap(t)[id]) + ". " : "") + "Leaders change who leads them.</div></div>" : '<button type="button" class="btn small ghost" id="mMe" style="margin-top:4px">Assign to me</button></div>') +
      '<div id="mVolNote" class="sub" style="margin:0;align-self:center"></div>' +
      '<div><label class="f" for="mOut">D-group outreach</label><div style="display:flex;gap:6px"><select class="input" id="mOut">' + L.OUTREACH.map(function (o) { return '<option value="' + o.k + '"' + (L.outreachOf(p) === o.k ? " selected" : "") + ">" + esc(o.label) + "</option>"; }).join("") + '</select><input type="date" class="input" id="mOutDate" style="width:150px" aria-label="Date reached out" value="' + esc(p.dgOutreachDate || "") + '"></div></div>' +
      '<div><label class="f" for="mDg">D-group</label><select class="input" id="mDg"><option value="">Not yet</option>' + D.dgroups.map(function (g) { return '<option value="' + esc(g.id) + '"' + (g.id === p.dgroupId ? " selected" : "") + ">" + esc(g.name) + (g.leader ? " — " + esc(g.leader) : "") + "</option>"; }).join("") + '<option value="__new">+ New D-group…</option></select><input class="input hidden" id="mDgNew" placeholder="New D-group name" style="margin-top:6px"></div>' +
      '<div><label class="f" for="mDgDate">Forwarded to D-group on</label><input type="date" class="input" id="mDgDate" value="' + esc(p.dgroupDate || "") + '"></div>' +
      '<div><label class="f" for="mDgLead">D-group leader</label><input class="input" id="mDgLead" list="mDgLeadList" value="' + esc(p.dgroupId ? L.dgroupLeaderOf(p, D.dgroups) : "") + '" placeholder="Any name, e.g. Pastor Jon"' + (p.dgroupId ? "" : " disabled") + '><datalist id="mDgLeadList">' + dgLeaderOptions().map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + "</datalist></div></div>" +
      '<div class="sub" style="margin:6px 0 0">The small group lead looks after them at game play. The <b>D-group leader</b> is who leads their D-group once they commit. It can be anyone, not only a volunteer.</div>' +
      '<div style="display:flex;gap:18px;margin-top:10px;flex-wrap:wrap"><label class="toggle"><input type="checkbox" id="mFu"' + (p.followedUp ? " checked" : "") + '> Followed up after first visit</label><label class="toggle"><input type="checkbox" id="mOk"' + (p.contactOk ? " checked" : "") + '> OK to contact</label><label class="toggle' + (lim ? " hidden" : "") + '"><input type="checkbox" id="mVol"' + (p.volunteer ? " checked" : "") + "> Volunteer (serves; not on the follow-up list)</label></div>" +
      '<div class="section-t">Notes</div><textarea class="input" id="mNotes" rows="3" placeholder="Conversations, prayer requests, next steps">' + esc(p.notes || "") + "</textarea>" +
      '<div class="section-t">Details</div><div class="grid2 stack">' +
      '<div><label class="f" for="mFirst">First name</label><input class="input" id="mFirst" value="' + esc(p.firstName) + '"></div><div><label class="f" for="mLast">Last name</label><input class="input" id="mLast" value="' + esc(p.lastName) + '"></div>' +
      '<div><label class="f" for="mPhone">Mobile</label><input class="input" id="mPhone" type="tel" value="' + esc(p.phone) + '"></div><div><label class="f" for="mEmail">Email</label><input class="input" id="mEmail" type="email" value="' + esc(p.email) + '"></div>' +
      '<div><label class="f" for="mLoc">Location</label><input class="input" id="mLoc" value="' + esc(p.location || "") + '"></div><div><label class="f" for="mLife">Life stage</label><select class="input" id="mLife">' + opt(L.LIFE_STAGES, p.lifeStage) + "</select></div>" +
      '<div><label class="f" for="mSat">Satellite</label><select class="input" id="mSat"><option value="">Not set</option>' + L.SATELLITES.map(function (x) { return '<option value="' + x + '"' + (p.satellite === x ? " selected" : "") + ">" + esc(L.satLabel(x)) + "</option>"; }).join("") + "</select></div>" +
      '<div><label class="f" for="mChurch">Church connection</label><select class="input" id="mChurch">' + opt(L.CHURCH, p.churchStatus) + "</select></div>" +
      '<div><label class="f" for="mInv">Invited by</label><input class="input" id="mInv" value="' + esc(p.invitedBy || "") + '"></div><div><label class="f" for="mWant">Interested in a D-group?</label><select class="input" id="mWant">' + opt(L.WANTS, p.wantsConnect) + "</select></div></div>" +
      (isNew ? "" : '<div class="section-t">Check-in QR</div><div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap"><div class="qrcard" style="padding:12px"><div class="qr qr-sm" id="mQr"></div><div class="code" style="font-size:22px">' + esc(L.codeLabel(p)) + '</div></div><div class="sub" style="max-width:300px;margin:0">Show this to the player to photograph, or copy a message to send them.<div style="margin-top:8px"><button class="btn small" id="mCopy">Copy message</button></div></div></div>' +
        '<div class="section-t">Visits</div>' + playedLine(p) + rsvpLine(p.id, visits) + '<div class="visits">' + (D.checkins.filter(function (c) { return c.playerId === id; }).sort(function (a, b) { return b.date.localeCompare(a.date); }).map(function (c) { return "<span>" + A.fmt(c.date) + (c.satellite ? " · " + esc(c.satellite) + (c.venue ? " (" + esc(c.venue) + ")" : "") : "") + (c.role === "volunteer" ? " · served" : "") + "</span>"; }).join("") || "<span>None yet</span>") + '</div><div style="margin-top:10px"><div id="mTodayBox"></div></div>') +
      '<div class="mfoot">' + (isNew || lim ? "" : '<button class="btn small ghost danger" id="mDel">Delete player</button>') + '<span class="sp"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="mSave">' + (isNew ? "Add player" : "Save") + "</button></div>", { noFocus: true });

    var stage = p.stage || "new";
    var drawStep = function () {
      var ci = L.stageIdx(stage);
      $$("#mStep button").forEach(function (b, i) { b.className = i < ci ? "past" : i === ci ? "cur" : ""; b.setAttribute("aria-pressed", i === ci); });
      $("#mStageDate").value = p.stageDates[stage] || t;
      var hist = L.STAGES.filter(function (s) { return p.stageDates[s.k] && s.k !== "new"; }).map(function (s) { return s.short + " " + A.fmt(p.stageDates[s.k]); });
      $("#mStageInfo").textContent = hist.length ? hist.join(" · ") : "Tap the step this player has reached.";
    };
    $$("#mStep button").forEach(function (b) { b.onclick = function () { stage = b.dataset.k; L.STAGES.forEach(function (s, i) { if (i > L.stageIdx(stage)) delete p.stageDates[s.k]; }); if (!p.stageDates[stage]) p.stageDates[stage] = t; drawStep(); }; });
    $("#mStageDate").onchange = function () { if (this.value) { p.stageDates[stage] = this.value; drawStep(); } };
    var groupLeader = function (gid) { var g = D.dgroups.find(function (x) { return x.id === gid; }); return g ? g.leader || "" : ""; };
    $("#mDg").addEventListener("change", function () {
      var v = this.value, lead = $("#mDgLead");
      $("#mDgNew").classList.toggle("hidden", v !== "__new"); if (v === "__new") $("#mDgNew").focus();
      lead.disabled = !v; if (!v) lead.value = ""; else if (v !== "__new") lead.value = groupLeader(v) || lead.value;
    });
    $("#mDg").onchange = function () { if (this.value) { if (!$("#mDgDate").value) $("#mDgDate").value = t; $("#mOut").value = "attending"; if (!$("#mOutDate").value) $("#mOutDate").value = t; } else { $("#mDgDate").value = ""; if ($("#mOut").value === "attending") $("#mOut").value = "invited"; } };
    $("#mOut").onchange = function () { if (this.value !== "not_yet" && !$("#mOutDate").value) $("#mOutDate").value = t; if (this.value === "not_yet") $("#mOutDate").value = ""; };
    if ($("#mMe")) $("#mMe").onclick = function () { $("#mFac").value = (auth() || {}).name || ""; };
    var volNote = function () {
      var vol = $("#mVol").checked, nm = (($("#mFirst").value || "") + " " + ($("#mLast").value || "")).trim().toLowerCase();
      $("#mFacWrap").style.display = vol ? "none" : "";
      var mine = vol && nm ? D.players.filter(function (x) { return !x.volunteer && (fac(x) || "").trim().toLowerCase() === nm; }).length : 0;
      $("#mVolNote").innerHTML = vol ? "<b>Volunteer</b>: they look after attendees, so they aren't assigned a leader themselves. Caring for <b>" + mine + "</b> attendee" + (mine === 1 ? "" : "s") + "." : "";
    };
    $("#mVol").addEventListener("change", volNote); volNote();
    $("#mSat").addEventListener("change", function () { $("#mFacList").innerHTML = facOptions(this.value); });
    drawStep();
    if (!isNew) {
      A.qrInto($("#mQr"), L.codeLabel(p), 150);
      $("#mCopy").onclick = function () {
        var msg = "Hi " + p.firstName + "! Thanks for playing with " + (D.settings.name || "CCF Sports Ministry") + ". Your check-in code is " + L.codeLabel(p) + ". Open " + location.origin + ", tap “I've been here before” and enter " + p.code + " with the last 4 digits of your mobile to get your QR on your phone. See you on the court!";
        (navigator.clipboard ? navigator.clipboard.writeText(msg) : Promise.reject()).then(function () { A.toast("Message copied"); }, function () { A.toast("Couldn't copy. The code is " + L.codeLabel(p)); });
      };
      var drawToday = function () {
        var box = $("#mTodayBox"); if (!box) return;
        var ck = D.checkins.find(function (c) { return c.playerId === id && c.date === t; }), at = ck ? satOfCheckin(ck) : "";
        box.innerHTML = '<div class="lastsat" style="margin:0">' + (ck ? "✓ Checked in today at <b style=\"color:var(--text)\">" + esc(at || "no satellite") + "</b>" + L.SATELLITES.filter(function (k) { return k !== at; }).map(function (k) { return '<button class="btn small" data-tsat="' + k + '">Change to ' + esc(k) + "</button>"; }).join("")
          : "Check in for today at" + L.SATELLITES.map(function (k) { return '<button class="btn small' + (k === (curSat || p0.satellite) ? " primary" : "") + '" data-tsat="' + k + '">' + esc(k) + "</button>"; }).join("")) + "</div>";
        $$("[data-tsat]", box).forEach(function (b) { b.onclick = function () {
          var k = b.dataset.tsat, venue = L.venueFor(D.settings, k, t).gym;
          if (ck) queue({ type: "checkinPatch", id: ck.id, patch: { satellite: k, venue: venue } });
          else queue({ type: "checkin", rec: { playerId: id, date: t, ts: Date.now(), role: p0.volunteer ? "volunteer" : "player", satellite: k, venue: venue } });
          A.toast((ck ? "Now counts at " : "Checked in at ") + k); drawToday();
        }; });
      };
      if (!lim) drawToday(); else { var tb = $("#mTodayBox"); if (tb) tb.innerHTML = ""; }
      if ($("#mDel")) $("#mDel").onclick = function () {
        var del = this;
        del.outerHTML = '<span style="font-size:13px">Delete ' + esc(p.firstName) + ' and all their visits? <button class="btn small danger" id="mDelYes">Yes, delete</button></span>';
        $("#mDelYes").onclick = function () { queue({ type: "deletePlayer", id: id }); A.closeModal(); A.toast("Player deleted"); refreshView(); };
      };
    }
    $("#mSave").onclick = function () {
      var out = $("#mOut").value;
      var upd = {
        firstName: $("#mFirst").value.trim(), lastName: $("#mLast").value.trim(), phone: $("#mPhone").value.trim(), email: $("#mEmail").value.trim(),
        location: $("#mLoc").value.trim(), lifeStage: $("#mLife").value, churchStatus: $("#mChurch").value, satellite: $("#mSat").value, invitedBy: $("#mInv").value.trim(), wantsConnect: $("#mWant").value,
        contactOk: $("#mOk").checked, followedUp: $("#mFu").checked, volunteer: $("#mVol").checked, facilitator: $("#mVol").checked ? "" : $("#mFac").value.trim(),
        dgOutreach: out, dgOutreachDate: out === "not_yet" ? "" : ($("#mOutDate").value || p.dgOutreachDate || t),
        stage: stage, stageDates: p.stageDates, dgroupId: $("#mDg").value, dgroupDate: $("#mDg").value ? ($("#mDgDate").value || t) : "", notes: $("#mNotes").value
      };
      if (upd.followedUp && !p0.followedUp) upd.followedUpDate = t;
      if (lim) { upd.volunteer = !!p0.volunteer; upd.facilitator = p0.facilitator || ""; }
      if (!upd.firstName) { A.toast("First name is required"); return; }
      var dgLead = $("#mDgLead").value.trim();
      if (upd.dgroupId === "__new") {
        var gname = $("#mDgNew").value.trim();
        if (!gname) { A.toast("Type the new D-group's name"); return; }
        var gid = rid(); queue({ type: "dgroup", id: gid, data: { name: gname, leader: dgLead, meets: "" } }); upd.dgroupId = gid;
      }
      // keep the player's own D-group leader only when it differs from the group's usual leader
      upd.dgroupLeader = upd.dgroupId && dgLead && dgLead !== groupLeader(upd.dgroupId) ? dgLead : "";
      if (upd.dgroupId && dgLead && !groupLeader(upd.dgroupId)) { var gg = D.dgroups.find(function (x) { return x.id === upd.dgroupId; }); if (gg) queue({ type: "dgroup", id: gg.id, data: { name: gg.name, leader: dgLead, meets: gg.meets || "" } }); upd.dgroupLeader = ""; }
      if (isNew) { upd.code = newCode(); upd.createdAt = Date.now(); upd.firstVisit = ""; upd.source = "leader"; }
      queue({ type: "player", id: isNew ? rid() : id, patch: upd });
      A.closeModal(); A.toast(isNew ? "Player added" : "Saved"); refreshView();
    };
  }

  /* ---------------- settings ---------------- */
  A.routes["/leader/settings"] = function () {
    if (needAuth(true)) return;
    var a = auth();
    lshell("settings",
      '<div class="dash-head"><h2>Settings</h2></div>' +
      '<div class="row even"><div class="card"><h3>Ministry</h3><div class="sub">Shown to players</div>' +
      '<label class="f" for="sName">Ministry name</label><input class="input" id="sName" value="' + esc(D.settings.name || "CCF Sports Ministry") + '">' +
      '<label class="f" for="sTag" style="margin-top:12px">Welcome line</label><input class="input" id="sTag" value="' + esc(D.settings.tagline || "Play with a purpose.") + '">' +
      '<label class="f" for="sLeaders" style="margin-top:12px">Leaders who can sign in (one full name per line, e.g. John Sola). Only these names can sign in with the leader password, and each one sees their own people under Follow-up. Include your own name.</label><textarea class="input" id="sLeaders" rows="5">' + esc((D.settings.leaders || []).join("\n")) + "</textarea>" +

      '<div style="margin-top:12px"><button class="btn primary" id="sSave">Save</button></div></div>' +
      '<div class="card"><h3>D-groups</h3><div class="sub">The discipleship groups players can join</div><div id="dgEdit"></div><button class="btn small" id="dgAdd">+ Add D-group</button></div></div>' +
      '<div class="card" style="margin-bottom:16px"><h3>Game plays by satellite</h3><div class="sub">Each satellite\'s lead sets that satellite\'s game days, start times and usual gym. Players see their own satellite\'s next game with an “I\'ll play” button. To move or call off one game, use “Change for one date” below.</div><div id="satEdit"></div>' +
      '<div class="section-t">Change for one date</div><div class="vcadd"><input type="date" class="input" id="vcDate" aria-label="Date"><select class="input" id="vcSat" aria-label="Satellite">' + L.SATELLITES.map(function (x) { return "<option>" + x + "</option>"; }).join("") + '</select><input class="input" id="vcGym" placeholder="Gym name" aria-label="Gym name"><input class="input" id="vcMap" placeholder="Google Maps link (optional)" aria-label="Map link"><input type="time" class="input" id="vcTime" aria-label="Start time (optional)"><label class="toggle" style="white-space:nowrap"><input type="checkbox" id="vcOff"> No game</label><button class="btn" id="vcAdd">Add change</button></div><div id="vcList"></div></div>' +
      '<div class="row even"><div class="card"><h3>Google Sheet</h3><div class="sub">' + (D.sheet ? "Connected. New sign-ups and check-ins are added straight away, and the full report refreshes every night." : "Not connected yet. See the setup steps in the project README.") + "</div>" +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="sSheet"' + (D.sheet ? "" : " disabled") + '>Update the Sheet now</button><button class="btn" id="sCsv">Download CSV</button></div></div>' +
      '<div class="card"><h3>Volunteers at the table</h3><div class="sub" style="margin:0">Volunteers sign in on the same page with the <b>volunteer password</b> (set as VOLUNTEER_PASSWORD in Vercel). They can scan, find, sign up new players, see the line-up, and open the players assigned to them as small group lead under <b>My players</b> (and update their details, faith step, D-group and notes). They cannot see other players’ records or the reports. To mark someone as a volunteer, open their record and tick Volunteer.</div></div></div><div class="row even">' +
      '<div class="card"><h3>This phone</h3><div class="sub">Signed in as <b>' + esc(a.name) + "</b>. " + D.players.length + " players saved here for offline use" + (D.fetchedAt ? ", last updated " + new Date(D.fetchedAt).toLocaleString() : "") + ". " + outbox.length + " change(s) waiting to upload.</div>" +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="sSync">Sync now</button><button class="btn danger" id="sOut">Sign out</button></div></div></div>');
    paintDg(); paintSatEdit();
    $("#sSave").onclick = function () {
      queue({ type: "settings", data: { name: $("#sName").value.trim() || "CCF Sports Ministry", tagline: $("#sTag").value.trim(), leaders: (function () {
        var ls = $("#sLeaders").value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean), me = ((auth() || {}).name || "").trim();
        if (ls.length && me && (auth() || {}).role === "leader" && !ls.some(function (n) { return n.toLowerCase() === me.toLowerCase(); })) { ls.unshift(me); $("#sLeaders").value = ls.join("\n"); A.toast("Added your name too, so you don't lock yourself out."); }
        return ls; })() } }); A.toast("Saved");
    };
    $("#dgAdd").onclick = function () { queue({ type: "dgroup", id: rid(), data: { name: "New D-group", leader: "", meets: "" } }); paintDg(); };
    $("#sSync").onclick = function () { sync().then(function () { A.toast(status.online ? "Up to date" : "Still offline"); }); };
    $("#sOut").onclick = function () {
      if (outbox.length && !confirmOut()) return;
      A.save("ccf.leader", null); A.save("ccf.data", null); A.save("ccf.outbox", null); D = JSON.parse(JSON.stringify(EMPTY)); outbox = []; A.go("#/");
    };
    $("#sSheet").onclick = function () {
      var b = this; b.disabled = true; b.textContent = "Updating…";
      A.api("leader", { action: "sheetSync", auth: a.auth }, 60000).then(function (r) { A.toast("Sheet updated: " + r.players + " players, " + r.checkins + " check-ins"); }, function (e) { A.toast(e.message); })
        .then(function () { b.disabled = false; b.textContent = "Update the Sheet now"; });
    };
    $("#sCsv").onclick = downloadCsv;
    currentRefresh = null;
  };
  function paintSatEdit() {
    var box = $("#satEdit"); if (!box) return;
    var sats = D.settings.satellites || {};
    box.innerHTML = L.SATELLITES.map(function (k) {
      var v = sats[k] || {}, sch = L.satSchedule(D.settings, k);
      return '<div class="satblock" data-k="' + k + '"><div class="satrow"><b title="' + esc(L.satLabel(k)) + '">' + k + '</b><input class="input" data-f="gym" placeholder="Usual gym" aria-label="' + k + ' gym" value="' + esc(v.gym || "") + '"><input class="input" data-f="map" placeholder="Google Maps link" aria-label="' + k + ' map link" value="' + esc(v.map || "") + '"></div>' +
        '<div class="sub" style="margin:4px 0 6px">Game days and start time</div><div class="satdays">' + [0, 1, 2, 3, 4, 5, 6].map(function (d) {
          var g = sch.find(function (x) { return x.dow === d; });
          return '<div class="daychip"><label><input type="checkbox" data-dow="' + d + '"' + (g ? " checked" : "") + "> " + L.DAYS[d].slice(0, 3) + '</label><input type="time" class="input" data-dtime="' + d + '" value="' + esc(g ? g.time : (v.time || "08:00")) + '" aria-label="' + k + " " + L.DAYS[d] + ' start time"></div>';
        }).join("") + "</div></div>";
    }).join("") + '<div style="margin-top:8px"><button class="btn primary" id="satSave">Save game plays</button></div>';
    $("#satSave").onclick = function () {
      var out = {};
      $$(".satblock", box).forEach(function (blk) {
        var o = Object.assign({}, sats[blk.dataset.k] || {}); $$("[data-f]", blk).forEach(function (i) { o[i.dataset.f] = i.value.trim(); });
        o.schedule = $$("[data-dow]", blk).filter(function (c) { return c.checked; }).map(function (c) { var d = +c.dataset.dow; return { dow: d, time: $('[data-dtime="' + d + '"]', blk).value || "08:00" }; });
        o.time = o.schedule.length ? o.schedule[0].time : (o.time || "");
        out[blk.dataset.k] = o;
      });
      if (Object.keys(out).some(function (k) { return out[k].map && !/^https?:\/\//.test(out[k].map); })) return A.toast("Map links should start with https://");
      queue({ type: "settings", data: { satellites: out } }); A.toast("Game plays saved");
    };
    var list = (D.settings.venueChanges || []).filter(function (v) { return v.date >= L.today(); }).sort(function (a, b) { return a.date.localeCompare(b.date); });
    $("#vcList").innerHTML = list.length ? '<table class="t" style="margin-top:8px"><thead><tr><th>Date</th><th>Satellite</th><th>Gym</th><th></th></tr></thead><tbody>' + list.map(function (v, i) {
      return "<tr><td>" + esc(A.fmt(v.date)) + "</td><td>" + esc(v.satellite) + "</td><td>" + (v.cancelled ? "<b>No game</b>" : esc(v.gym || "Usual gym")) + (v.time && !v.cancelled ? " · " + esc(L.fmtTime(v.time)) : "") + '</td><td><button class="btn small ghost danger" data-vcdel="' + esc(v.date + "|" + v.satellite) + '">Remove</button></td></tr>';
    }).join("") + "</tbody></table>" : '<div class="sub" style="margin:8px 0 0">No gym changes coming up.</div>';
    $("#vcAdd").onclick = function () {
      var d = $("#vcDate").value, sat = $("#vcSat").value, gym = $("#vcGym").value.trim(), map = $("#vcMap").value.trim(), tm = $("#vcTime").value;
      if (!d || d < L.today()) return A.toast("Pick a date from today on");
      var off = $("#vcOff").checked;
      if (!gym && !off && !tm) return A.toast("Type the gym or time, or tick No game");
      if (map && !/^https?:\/\//.test(map)) return A.toast("Map links should start with https://");
      var vc = (D.settings.venueChanges || []).filter(function (v) { return !(v.date === d && v.satellite === sat); }).concat([{ date: d, satellite: sat, gym: off ? "" : gym, map: off ? "" : map, time: off ? "" : tm, cancelled: off }]);
      queue({ type: "settings", data: { venueChanges: vc } }); A.toast("Gym change added"); paintSatEdit();
      $("#vcGym").value = ""; $("#vcMap").value = ""; $("#vcTime").value = ""; $("#vcOff").checked = false;
    };
    $$("[data-vcdel]").forEach(function (b) { b.onclick = function () {
      var k = b.dataset.vcdel.split("|");
      queue({ type: "settings", data: { venueChanges: (D.settings.venueChanges || []).filter(function (v) { return !(v.date === k[0] && v.satellite === k[1]); }) } }); paintSatEdit();
    }; });
  }
  function confirmOut() { return window.confirm(outbox.length + " change(s) haven't uploaded yet and will be lost. Sign out anyway?"); }
  function paintDg() {
    var box = $("#dgEdit"); if (!box) return;
    box.innerHTML = D.dgroups.length ? D.dgroups.map(function (g) {
      return '<div class="dg-item" data-id="' + esc(g.id) + '"><input class="input" aria-label="Group name" placeholder="Group name" value="' + esc(g.name) + '" data-f="name"><input class="input" aria-label="D-group leader" placeholder="D-group leader" value="' + esc(g.leader || "") + '" data-f="leader"><input class="input" aria-label="When and where" placeholder="When / where" value="' + esc(g.meets || "") + '" data-f="meets"><span style="display:flex;gap:4px"><button class="btn small" data-save>Save</button><button class="btn small ghost danger" data-del aria-label="Delete group">✕</button></span></div>';
    }).join("") : '<div class="empty" style="margin-bottom:8px">No D-groups yet.</div>';
    $$(".dg-item", box).forEach(function (row) {
      var id = row.dataset.id;
      $("[data-save]", row).onclick = function () {
        var data = {}; $$("[data-f]", row).forEach(function (i) { data[i.dataset.f] = i.value.trim(); });
        if (!data.name) return A.toast("Give the group a name");
        queue({ type: "dgroup", id: id, data: data }); A.toast("D-group saved");
      };
      $("[data-del]", row).onclick = function () {
        var n = D.players.filter(function (p) { return p.dgroupId === id; }).length;
        if (n) return A.toast("Move its " + n + " member" + (n === 1 ? "" : "s") + " to another group first");
        queue({ type: "dgroup", id: id, delete: true }); paintDg();
      };
    });
  }
  function downloadCsv() {
    var vbp = L.visitsByPlayer(D.checkins);
    var head = ["Player code", "First name", "Last name", "Mobile", "Email", "Location", "Life stage", "Signed up as", "Church connection", "Home satellite", "Played at", "Invited by", "Wants D-group", "OK to contact", "First visit", "Last seen", "Total visits", "Attendance", "Small group lead (sports)", "D-group outreach", "D-group", "D-group leader", "Faith step", "Received Christ", "Baptized", "Next step", "Notes"];
    var rows = D.players.map(function (p) {
      var v = vbp.get(p.id) || [], sd = p.stageDates || {};
      return [L.codeLabel(p), p.firstName, p.lastName, p.phone, p.email, p.location, p.lifeStage, p.volunteer ? "Volunteer" : "Attendee", p.churchStatus || "", p.satellite || "", L.playedAtText(D.checkins.filter(function (c) { return c.playerId === p.id; }), p.satellite), p.invitedBy, p.wantsConnect, p.contactOk ? "Yes" : "No", p.firstVisit, v[v.length - 1] || "", v.length, L.ATT[L.attendanceOf(v)].label, fac(p), L.outreachLabel(L.outreachOf(p)), dgName(p.dgroupId), L.dgroupLeaderOf(p, D.dgroups), L.stageLabel(p.stage), sd.received || "", sd.baptized || "", act(p, v), p.notes];
    });
    var csv = [head].concat(rows).map(function (r) { return r.map(function (x) { var s = String(x == null ? "" : x); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(","); }).join("\n");
    saveFile("ccf-players-" + L.today() + ".csv", new Blob(["\ufeff" + csv], { type: "text/csv" }));
  }

  /* first sync when a signed-in leader opens the app */
  document.addEventListener("DOMContentLoaded", function () { if (auth()) scheduleSync(300); });
})();
