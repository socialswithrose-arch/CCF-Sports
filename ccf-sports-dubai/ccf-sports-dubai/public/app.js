/* CCF Sports Ministry: shared helpers, router and the player screens. */
(function () {
  "use strict";
  var L = window.Logic;

  /* ---------------- helpers ---------------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function sload(k) { try { var v = sessionStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function ssave(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  var toastT;
  function toast(msg) {
    var el = $(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.textContent = msg; el.classList.remove("hidden");
    clearTimeout(toastT); toastT = setTimeout(function () { el.classList.add("hidden"); }, 3000);
  }

  /* POST to the API. Network problems reject with {offline:true}. */
  function api(path, body, timeoutMs) {
    var ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, timeoutMs || 15000);
    return fetch("/api/" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined })
      .then(function (r) {
        clearTimeout(t);
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) { var e = new Error(j.error || "Something went wrong. Please try again."); e.status = r.status; throw e; }
          return j;
        });
      }, function () { clearTimeout(t); var e = new Error("No internet connection right now."); e.offline = true; throw e; });
  }

  function icon(d, size, color, sw) {
    return '<svg width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" stroke="' + (color || "currentColor") + '" stroke-width="' + (sw || 2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + "</svg>";
  }
  var ICONS = {
    back: '<path d="M15 18l-6-6 6-6"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    scan: '<path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2"/><path d="M7 12h10"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    todo: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h11"/>',
    people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.6.8 2.7 2.6 3 5.2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
    wifiOff: '<path d="M2 8.5a15 15 0 0 1 4-2.7M10.7 5.1A15 15 0 0 1 22 8.5M5 12a10 10 0 0 1 3.4-2.1M15.6 9.9A10 10 0 0 1 19 12M8.5 15.5a5 5 0 0 1 7 0"/><path d="M3 3l18 18"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'
  };
  /* The CCF Sports Dubai logo (teal on transparent). size = height in px. */
  function ball(size) {
    return '<img src="/brand/logo.png" alt="CCF Sports Dubai" style="height:' + size + 'px;width:auto" />';
  }

  /* Draw a QR code into an element. Falls back to the text if the library didn't load. */
  function qrInto(el, text, size) {
    el.innerHTML = "";
    if (window.QRCode) {
      try { new window.QRCode(el, { text: text, width: size || 220, height: size || 220, correctLevel: window.QRCode.CorrectLevel.M, colorDark: "#000000", colorLight: "#ffffff" }); return; } catch (e) {}
    }
    el.innerHTML = '<div class="empty">QR not available yet. Use the code below.</div>';
  }

  function modal(html, opts) {
    opts = opts || {};
    $("#modalRoot").innerHTML = '<div class="overlay"><div class="modal" role="dialog" aria-modal="true" style="' + (opts.narrow ? "max-width:380px" : "") + '">' + html + "</div></div>";
    var ov = $("#modalRoot .overlay");
    ov.addEventListener("mousedown", function (e) { if (e.target === ov) closeModal(); });
    $$("#modalRoot [data-close]").forEach(function (b) { b.onclick = closeModal; });
    var f = $("#modalRoot input, #modalRoot button"); if (f && !opts.noFocus) f.focus();
  }
  function closeModal() { $("#modalRoot").innerHTML = ""; }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });

  /* Fill a set of .choice buttons; returns a getter for the picked value. */
  function choices(box, opts, initial) {
    box.innerHTML = opts.map(function (o) { return '<button type="button" class="choice" aria-pressed="' + (o === initial) + '" data-v="' + esc(o) + '">' + esc(o) + "</button>"; }).join("");
    box.addEventListener("click", function (e) {
      var b = e.target.closest(".choice"); if (!b) return;
      var was = b.getAttribute("aria-pressed") === "true";
      $$(".choice", box).forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
      b.setAttribute("aria-pressed", was ? "false" : "true");
    });
    return function () { var b = $('.choice[aria-pressed="true"]', box); return b ? b.dataset.v : ""; };
  }

  /* ---------------- camera scanner ---------------- */
  var activeScanner = null;
  function stopScanner() { if (activeScanner) { activeScanner.stop(); activeScanner = null; } }
  /* Opens the camera inside box (.cam) and calls onCode(text) for each new QR it reads. */
  function startScanner(box, onCode) {
    stopScanner();
    var stopped = false, stream = null, lastText = "", lastAt = 0, detector = null, canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
    var video = document.createElement("video");
    video.setAttribute("playsinline", ""); video.muted = true;
    box.querySelector(".start") && box.querySelector(".start").remove();
    box.insertBefore(video, box.firstChild);
    if ("BarcodeDetector" in window) { try { detector = new window.BarcodeDetector({ formats: ["qr_code"] }); } catch (e) { detector = null; } }
    function hit(text) {
      var now = Date.now();
      if (text === lastText && now - lastAt < 4000) return;
      lastText = text; lastAt = now;
      if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) {} }
      onCode(text);
    }
    function tick() {
      if (stopped) return;
      if (video.readyState >= 2) {
        if (detector) {
          detector.detect(video).then(function (codes) { if (codes && codes[0]) hit(codes[0].rawValue); }).catch(function () {}).then(function () { setTimeout(tick, 200); });
          return;
        }
        if (window.jsQR) {
          var w = 480, h = Math.round(w * (video.videoHeight / video.videoWidth || 0.75));
          canvas.width = w; canvas.height = h;
          ctx.drawImage(video, 0, 0, w, h);
          var img = ctx.getImageData(0, 0, w, h);
          var r = window.jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
          if (r && r.data) hit(r.data);
        }
      }
      setTimeout(tick, 220);
    }
    var api = { stop: function () { stopped = true; if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); video.remove(); } };
    activeScanner = api;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      box.querySelector(".hint").textContent = "This browser can't use the camera. Use Find name instead.";
      return api;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }).then(function (s) {
      if (stopped) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
      stream = s; video.srcObject = s; video.play().catch(function () {}); tick();
    }).catch(function () {
      box.querySelector(".hint").textContent = "Camera blocked. Allow camera access in your browser settings, or use Find name.";
    });
    return api;
  }
  function camHTML(hint) {
    return '<div class="cam"><div class="frame" aria-hidden="true"><i></i><i></i><i></i><i></i></div><div class="start"><button type="button" class="btn primary" data-startcam>' + icon(ICONS.scan, 20, "currentColor") + ' Start camera</button></div><div class="hint">' + esc(hint) + "</div></div>";
  }

  /* ---------------- router ---------------- */
  var routes = {};
  function parseHash() {
    var h = (location.hash || "#/").slice(1);
    var q = h.indexOf("?"), path = q >= 0 ? h.slice(0, q) : h, params = {};
    if (q >= 0) h.slice(q + 1).split("&").forEach(function (kv) { var p = kv.split("="); if (p[0]) params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ""); });
    return { path: path.replace(/\/+$/, "") || "/", params: params };
  }
  function go(h) { if (location.hash === h) render(); else location.hash = h; }
  function render() {
    stopScanner(); closeModal();
    var r = parseHash();
    var fn = routes[r.path] || routes["/"];
    document.body.classList.toggle("leader", r.path.indexOf("/leader") === 0);
    window.scrollTo(0, 0);
    fn(r.params, r.path);
  }
  window.addEventListener("hashchange", render);

  function shell(opts, body) {
    var top = '<header class="topbar"><div class="topbar-in">' +
      (opts.back ? '<button class="back" aria-label="Back" data-back>' + icon(ICONS.back, 22, "#fff") + "</button>" : '<a class="brand" href="#/">' + ball(28) + "</a>") +
      '<div class="brand" style="flex:1;min-width:0">' + '<span>' + esc(opts.title || "CCF Sports Ministry") + (opts.sub ? "<small>" + esc(opts.sub) + "</small>" : "") + "</span></div>" +
      (opts.right || "") + "</div></header>";
    $("#app").innerHTML = top + '<main class="' + (opts.wide ? "" : "narrow") + '">' + body + "</main>" + (opts.after || "");
    var b = $("[data-back]"); if (b) b.onclick = function () { if (history.length > 1) history.back(); else go(opts.backTo || "#/"); };
  }

  /* ---------------- player data ---------------- */
  function me() { return load("ccf.player", null); }
  function setMe(p, token) { save("ccf.player", { id: p.id, token: token, code: p.code, firstName: p.firstName, lastName: p.lastName }); }
  function pendingSession() {
    var s = sload("ccf.session");
    return s && s.date === L.today() ? s : null;
  }

  /* Self check-ins made without internet wait here and upload later. */
  function flushPlayerQueue() {
    var q = load("ccf.pqueue", []), p = me();
    if (!q.length || !p) return Promise.resolve();
    var item = q[0];
    return api("player", { action: "checkin", id: p.id, token: p.token, session: item.session, date: item.date, satellite: item.satellite || "" }).then(function () {
      save("ccf.pqueue", load("ccf.pqueue", []).slice(1)); refreshMe(); return flushPlayerQueue();
    }, function (e) {
      if (!e.offline) { save("ccf.pqueue", load("ccf.pqueue", []).slice(1)); return flushPlayerQueue(); }
    });
  }
  function refreshMe() {
    var p = me(); if (!p) return Promise.resolve(null);
    return api("player", { action: "me", id: p.id, token: p.token }).then(function (r) {
      save("ccf.me", { visits: r.visits, dgroup: r.dgroup, nextGame: r.nextGame || null, tonight: r.tonight || null, at: Date.now() });
      setMe(r.player, p.token);
      return r;
    }, function (e) { if (e.status === 401) { save("ccf.player", null); save("ccf.me", null); } return null; });
  }
  window.addEventListener("online", function () { flushPlayerQueue(); });

  /* ---------------- player screens ---------------- */
  routes["/"] = function () {
    if (me()) return go("#/me");
    $("#app").innerHTML = '<main class="narrow">' +
      '<div class="hero"><div class="photo" role="img" aria-label="CCF Sports Dubai players on the court"></div><div class="body"><img class="logo" src="/brand/logo.png" alt="CCF Sports Dubai"><div class="tag">Play with a purpose</div><h1>Welcome to the court</h1><p>Sign up once. After that, checking in takes one scan.</p></div></div>' +
      '<div class="stackv"><a class="btn primary big" href="#/signup">First time here? Sign up</a><a class="btn big" href="#/find">I\'ve been here before</a>' +
      '<div class="card" style="display:flex;gap:12px;align-items:flex-start;padding:14px 16px">' + icon(ICONS.phone, 22, "var(--accent)") +
      '<div><b>Add it to your home screen</b><div class="sub" style="margin:2px 0 0">iPhone: tap Share, then Add to Home Screen. Android: tap the menu, then Install app. It opens like an app and works without internet.</div></div></div></div>' +
      '<p style="text-align:center;margin-top:28px;font-size:14px"><a href="#/leader">Leaders sign in</a></p></main>';
    api("player", { action: "info" }, 6000).then(function (i) { var el = $(".hero .tag"); if (el && i.tagline) el.textContent = i.tagline.replace(/\.$/, ""); }, function () {});
  };

  routes["/signup"] = function () {
    shell({ title: "Sign up", sub: "Once only, about 30 seconds", back: true },
      '<form id="su" class="stackv" novalidate>' +
      '<div><span class="f">I\'m signing up as</span><div class="choices" id="su-role"></div></div>' +
      '<div class="grid2"><div><label class="f" for="su-first">First name</label><input class="input" id="su-first" autocomplete="given-name" required></div>' +
      '<div><label class="f" for="su-last">Last name</label><input class="input" id="su-last" autocomplete="family-name" required></div></div>' +
      '<div><label class="f" for="su-phone">Mobile number</label><input class="input" id="su-phone" type="tel" inputmode="tel" autocomplete="tel" required></div>' +
      '<div><label class="f" for="su-email">Email address</label><input class="input" id="su-email" type="email" autocomplete="email" required></div>' +
      '<div><label class="f" for="su-loc">Where do you live? (area)</label><input class="input" id="su-loc" placeholder="e.g. Al Nahda, Dubai" required></div>' +
      '<div><span class="f">Life stage</span><div class="choices" id="su-life"></div></div>' +
      '<div><span class="f">Which satellite invited you?</span><div class="choices" id="su-sat"></div></div>' +
      '<div id="su-att" class="stackv"><div><span class="f">Your church connection</span><div class="choices" id="su-church"></div></div>' +
      '<div><span class="f">Would you like to join a small group (D-group) with other players?</span><div class="choices" id="su-want"></div></div></div>' +
      '<div><label class="f" for="su-inv">Who invited you? (optional)</label><input class="input" id="su-inv"></div>' +
      '<label class="toggle"><input type="checkbox" id="su-ok" checked> It\'s OK for a leader to text or call me</label>' +
      '<div class="err" id="su-err" role="alert"></div>' +
      '<button class="btn primary big" type="submit">Sign up and get my QR</button></form>');
    var life = choices($("#su-life"), L.LIFE_STAGES, ""), want = choices($("#su-want"), L.WANTS, "");
    var role = choices($("#su-role"), L.ROLES, ""), church = choices($("#su-church"), L.CHURCH, "");
    var sp = pendingSession(), sat = choices($("#su-sat"), L.SATELLITES.map(L.satLabel), sp && sp.sat ? L.satLabel(sp.sat) : "");
    $("#su-role").addEventListener("click", function () { setTimeout(function () { $("#su-att").classList.toggle("hidden", role() === "Volunteer"); }, 0); });
    $("#su").addEventListener("submit", function (e) {
      e.preventDefault();
      var err = $("#su-err"); err.textContent = "";
      var body = {
        action: "signup", firstName: $("#su-first").value, lastName: $("#su-last").value, phone: $("#su-phone").value, email: $("#su-email").value,
        location: $("#su-loc").value, lifeStage: life(), invitedBy: $("#su-inv").value, wantsConnect: role() === "Volunteer" ? "" : want(), contactOk: $("#su-ok").checked,
        role: role(), churchStatus: role() === "Volunteer" ? "" : church(), satellite: L.satFromLabel(sat())
      };
      if (!body.satellite) return (err.textContent = "Please choose your satellite.");
      if (!body.role) return (err.textContent = "Please choose Attendee or Volunteer.");
      if (!body.firstName.trim() || !body.lastName.trim()) return (err.textContent = "Please enter your first and last name.");
      if (body.phone.replace(/\D/g, "").length < 7) return (err.textContent = "Please enter your mobile number.");
      if (!/.+@.+\..+/.test(body.email)) return (err.textContent = "Please enter a valid email address.");
      if (!body.location.trim()) return (err.textContent = "Please tell us where you live.");
      if (!body.lifeStage) return (err.textContent = "Please choose your life stage.");
      if (body.role === "Attendee" && !body.churchStatus) return (err.textContent = "Please choose your church connection.");
      var s = pendingSession(); if (s) { body.session = s.code; body.sessionSatellite = s.sat || ""; }
      var btn = $("#su button[type=submit]"); btn.disabled = true; btn.textContent = "Signing you up…";
      api("player", body).then(function (r) {
        setMe(r.player, r.token); ssave("ccf.session", null);
        if (r.checkin) showDone(r.player.firstName, "new", 1, false, r.checkin.spot);
        else { toast("You're signed up! Save your QR code."); go("#/me"); }
      }, function (e2) {
        btn.disabled = false; btn.textContent = "Sign up and get my QR";
        err.textContent = e2.offline ? "No internet right now. Ask a leader at the table to sign you up, it takes a minute." : e2.message;
      });
    });
  };

  routes["/find"] = function () {
    shell({ title: "Find my record", back: true },
      '<p class="sub" style="font-size:15px">Your 5-digit player code is under your QR (CCF-12345). No code? Ask a leader at the table, they can find you by name.</p>' +
      '<form id="fd" class="stackv" novalidate><div><label class="f" for="fd-code">Player code</label><input class="input" id="fd-code" inputmode="numeric" placeholder="12345" autocomplete="off"></div>' +
      '<div><label class="f" for="fd-ph">Last 4 digits of your mobile</label><input class="input" id="fd-ph" inputmode="numeric" maxlength="4" autocomplete="off"></div>' +
      '<div class="err" id="fd-err" role="alert"></div><button class="btn primary big" type="submit">Find me</button></form>' +
      '<p style="text-align:center;margin-top:20px"><a href="#/signup">Never signed up? Sign up</a></p>');
    $("#fd").addEventListener("submit", function (e) {
      e.preventDefault();
      var err = $("#fd-err"); err.textContent = "";
      var code = $("#fd-code").value.replace(/\D/g, ""), ph = $("#fd-ph").value.replace(/\D/g, "");
      if (code.length !== 5) return (err.textContent = "Enter the 5 digits of your player code.");
      if (ph.length !== 4) return (err.textContent = "Enter the last 4 digits of your mobile number.");
      api("player", { action: "claim", code: code, phoneLast4: ph }).then(function (r) {
        setMe(r.player, r.token);
        var s = pendingSession();
        if (s) return selfCheckin(s.code, s.date, s.sat);
        go("#/me");
      }, function (e2) { err.textContent = e2.message; });
    });
  };

  routes["/me"] = function () {
    var p = me(); if (!p) return go("#/");
    var cache = load("ccf.me", { visits: [], dgroup: null });
    var queued = load("ccf.pqueue", []).length;
    shell({ title: "My check-in", sub: "CCF Sports Ministry", right: '<a class="btn small ghost" style="color:#fff" href="#/leader">Leaders</a>' },
      '<div class="stackv">' +
      '<div class="qrcard"><div class="who" style="font-size:15px">Hi ' + esc(p.firstName) + ', show this at the table</div><div class="qr" id="myqr"></div>' +
      '<div class="code">' + esc(L.codeLabel(p)) + "</div>" + '<span class="pill good">' + icon(ICONS.check, 14, "currentColor", 3) + "Works without internet</span></div>" +
      (queued ? '<div class="banner warn">' + icon(ICONS.wifiOff, 20, "currentColor") + "<span>" + queued + " check-in waiting to upload. It will go through when you're online.</span></div>" : "") +
      '<div id="nextGame"></div>' +
      '<a class="btn primary big" href="#/scan">' + icon(ICONS.scan, 22, "currentColor") + "Scan " + L.dayName() + "'s check-in QR</a>" +
      '<div class="tiles"><div class="tile"><div class="l">Visits</div><div class="v" id="me-visits">' + (cache.visits || []).length + '</div><div class="sub" style="margin:0" id="me-last">' + ((cache.visits || []).length ? "Last: " + fmt(cache.visits[cache.visits.length - 1]) : "Welcome!") + "</div></div>" +
      '<div class="tile"><div class="l">My D-group</div><div id="me-dg" style="font-weight:700;margin-top:4px">' + (cache.dgroup ? esc(cache.dgroup.name) : "Not yet") + '</div><div class="sub" style="margin:0" id="me-dgl">' + (cache.dgroup && cache.dgroup.leader ? "Leader: " + esc(cache.dgroup.leader) : "Ask a leader") + "</div></div></div>" +
      '<p style="text-align:center;font-size:13px;color:var(--muted)">Tip: take a screenshot of your QR as a backup.<br><button class="btn ghost small" id="me-out">Not you? Remove from this phone</button></p></div>');
    qrInto($("#myqr"), L.codeLabel(p), 220);
    paintNextGame(cache.nextGame, cache.tonight);
    $("#me-out").onclick = function () {
      modal('<div class="mhead"><h3>Remove from this phone?</h3></div><p>Your record stays safe. You can find it again with your player code ' + esc(L.codeLabel(p)) + '.</p><div class="mfoot"><span class="sp"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="rm-yes">Remove</button></div>', { narrow: true });
      $("#rm-yes").onclick = function () { save("ccf.player", null); save("ccf.me", null); save("ccf.pqueue", null); closeModal(); go("#/"); };
    };
    flushPlayerQueue().then(refreshMe).then(function (r) {
      if (!r || parseHash().path !== "/me") return;
      $("#me-visits").textContent = r.visits.length;
      $("#me-last").textContent = r.visits.length ? "Last: " + fmt(r.visits[r.visits.length - 1]) : "Welcome!";
      $("#me-dg").textContent = r.dgroup ? r.dgroup.name : "Not yet";
      $("#me-dgl").textContent = r.dgroup && r.dgroup.leader ? "Leader: " + r.dgroup.leader : "Ask a leader";
      paintNextGame(r.nextGame, r.tonight);
    });
  };

  /* "I'll play" card for the next game. Saying yes doesn't check you in: you still scan at the court. */
  /* "Game 1 · Team A" style text for a player's spot in today's line-up. */
  function spotHTML(spot) {
    if (!spot) return "";
    if (spot.sitOut) return '<div class="spot"><div class="kicker2">' + L.dayName() + '\'s line-up</div><b>You\'re sitting out</b><span>Ask a leader if you want to play.</span></div>';
    var now = spot.game === 1;
    return '<div class="spot' + (now ? " now" : "") + '"><div class="kicker2">Your spot in ' + L.dayName() + '\'s line-up' + (spot.satellite ? " · " + esc(spot.satellite) : "") + '</div><b>Game ' + spot.game + " · Team " + esc(spot.team) + "</b><span>" +
      (now ? "You're in the first game. Get ready!" : "#" + spot.n + " in line. " + (spot.game === 2 ? "You're up next after Game 1." : "Games " + 1 + "–" + (spot.game - 1) + " go before you.")) +
      '</span><button class="btn small ghost" data-refresh-spot>Refresh</button></div>';
  }
  function paintNextGame(ng, spot) {
    var box = $("#nextGame"); if (!box) return;
    if (spot && ng && ng.date === L.today()) {
      box.innerHTML = spotHTML(spot);
      var rb = $("[data-refresh-spot]", box);
      if (rb) rb.onclick = function () { rb.textContent = "…"; refreshMe().then(function (r) { if (r) paintNextGame(r.nextGame, r.tonight); else rb.textContent = "Refresh"; }); };
      return;
    }
    if (!ng) { box.innerHTML = ""; return; }
    var isToday = ng.date === L.today();
    var vt = (ng.venues || [])[0], tm = (ng.venues || []).length === 1 && vt && vt.time ? vt.time : ng.time;
    var when = (isToday ? "Today" : fmt(ng.date)) + (tm ? ", " + L.fmtTime(tm) : "");
    var status = ng.checkedIn ? '<span class="pill good">' + icon(ICONS.check, 14, "currentColor", 3) + "You're checked in</span>" :
      ng.going === true ? '<span class="pill good">You said you\'ll play</span>' : ng.going === false ? '<span class="pill">You can\'t make it</span>' : "";
    var venues = (ng.venues || []).map(function (v) {
      return '<div class="venue"><div><b>' + esc(L.satLabel(v.satellite)) + "</b>" + (v.gym ? " · " + esc(v.gym) : " · gym to be announced") + (v.time ? " · " + esc(L.fmtTime(v.time)) : "") +
        (v.changed ? ' <span class="pill warn">Gym changed this week</span>' : "") + "</div>" + (v.map ? '<a class="btn small" href="' + esc(v.map) + '" target="_blank" rel="noopener">Directions</a>' : "") + "</div>";
    }).join("");
    if ((ng.venues || []).length > 1) venues = '<div class="sub" style="margin:8px 0 4px">Go to your satellite\'s gym:</div>' + venues;
    box.innerHTML = '<div class="card" style="padding:14px 16px"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><div><div class="kicker2">Next game</div><div style="font-weight:700;font-size:17px">' + esc(when) + "</div></div>" +
      '<span style="margin-left:auto">' + status + "</span></div>" + venues +
      (ng.checkedIn ? "" : '<div class="grid2" style="margin-top:12px"><button class="btn ' + (ng.going === true ? "primary" : "") + '" data-rsvp="1" aria-pressed="' + (ng.going === true) + '">I\'ll play</button><button class="btn" data-rsvp="0" aria-pressed="' + (ng.going === false) + '">Can\'t make it</button></div>' +
        '<div class="sub" style="margin:8px 0 0">' + (isToday ? "At the court, scan today's check-in QR or show your code to check in." : "We'll save you a spot. You still check in at the court.") + "</div>") + "</div>";
    $$("[data-rsvp]", box).forEach(function (b) {
      b.onclick = function () {
        var p = me(), going = b.dataset.rsvp === "1";
        api("player", { action: "rsvp", id: p.id, token: p.token, date: ng.date, going: going }).then(function () {
          ng.going = going; var c = load("ccf.me", {}); c.nextGame = ng; save("ccf.me", c); paintNextGame(ng);
          toast(going ? "See you on the court!" : "Thanks for letting us know.");
        }, function (e) { toast(e.offline ? "You need internet to answer. Try again in a moment." : e.message); });
      };
    });
  }

  /* Player scans the game day's check-in QR with the in-app camera. */
  routes["/scan"] = function () {
    if (!me()) return go("#/");
    shell({ title: "Scan to check in", back: true, backTo: "#/me" },
      '<div class="stackv">' + camHTML("Point at the check-in QR on the leader's screen or the court poster") +
      '<p class="sub" style="text-align:center">No internet? It still works: your check-in is saved and uploads later.</p></div>');
    $("[data-startcam]").onclick = function () {
      startScanner($(".cam"), function (text) {
        var s = sessionFromText(text);
        if (s) { stopScanner(); selfCheckin(s.code, L.today(), s.sat); }
        else toast("That's not today's check-in QR.");
      });
    };
  };

  /* Opened by scanning the game day's QR with the phone camera: #/here?s=CODE */
  routes["/here"] = function (params) {
    var code = (params.s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    var sat = L.SATELLITES.indexOf(params.v) >= 0 ? params.v : "";
    if (code) ssave("ccf.session", { code: code, date: L.today(), sat: sat });
    var s = pendingSession();
    if (!s) return go(me() ? "#/me" : "#/");
    if (me()) return selfCheckin(s.code, s.date, s.sat);
    shell({ title: "Check in", sub: L.dayName() + "'s game" },
      '<div class="stackv"><div class="hero"><div class="photo" role="img" aria-label="CCF Sports Dubai players on the court"></div><div class="body"><img class="logo" src="/brand/logo.png" alt="CCF Sports Dubai"><div class="tag">Play with a purpose</div><h1>Welcome!</h1><p>Have you signed up before?</p></div></div>' +
      '<a class="btn primary big" href="#/signup">No, first time: sign up</a><a class="btn big" href="#/find">Yes, find my record</a></div>');
  };

  function sessionFromText(text) {
    var m = /[#&?]s=([A-Za-z0-9]{6})/.exec(text || "");
    var v = /[#&?]v=([A-Za-z]+)/.exec(text || ""); if (v && L.SATELLITES.indexOf(v[1]) < 0) v = null;
    if (m) return { code: m[1].toUpperCase(), sat: v ? v[1] : "" };
    if (/^[A-Z0-9]{6}$/.test((text || "").trim())) return { code: text.trim(), sat: "" };
    return null;
  }

  function selfCheckin(code, date, sat) {
    var p = me();
    api("player", { action: "checkin", id: p.id, token: p.token, session: code, date: date, satellite: sat || "" }).then(function (r) {
      ssave("ccf.session", null);
      refreshMe();
      showDone(p.firstName, r.already ? "already" : (r.firstTime ? "new" : "back"), r.visitNumber, false, r.spot);
    }, function (e) {
      if (e.offline) {
        var q = load("ccf.pqueue", []);
        if (!q.some(function (x) { return x.date === date; })) q.push({ session: code, date: date, satellite: sat || "" });
        save("ccf.pqueue", q); ssave("ccf.session", null);
        var cache = load("ccf.me", { visits: [] });
        showDone(p.firstName, "back", (cache.visits || []).length + 1, true);
      } else if (e.status === 401) { save("ccf.player", null); toast(e.message); go("#/find"); }
      else { ssave("ccf.session", null); toast(e.message); go("#/me"); }
    });
  }

  function showDone(first, kind, n, offline, spot) {
    var titles = { back: "You're in, " + first + "!", "new": "Welcome, " + first + "!", already: "You're all set, " + first };
    var subs = { back: "Have a great game.", "new": "So glad you came. Enjoy the game!", already: "You already checked in today." };
    shell({ title: "Checked in" },
      '<div class="done"><div class="tick">' + icon(ICONS.check, 56, "#fff", 3) + "</div><h1>" + esc(titles[kind]) + "</h1><p>" + esc(subs[kind]) + "</p>" +
      '<p style="margin-top:12px"><span class="pill new" style="font-size:14px;padding:6px 14px">' + (kind === "new" ? "First visit" : "Visit #" + n) + "</span></p>" +
      (spot ? '<div style="margin-top:18px;text-align:left">' + spotHTML(spot).replace(/<button[^>]*data-refresh-spot[^>]*>[^<]*<\/button>/, "") + "</div>" : "") +
      (offline ? '<div class="banner warn" style="margin-top:22px;text-align:left">' + icon(ICONS.wifiOff, 22, "currentColor") + "<span><b>No internet right now.</b> Your check-in is saved on this phone and uploads by itself.</span></div>" : "") +
      '<a class="btn big" style="margin-top:22px" href="#/me">Done</a></div>');
  }

  function fmt(d) {
    if (!d) return "—";
    var dt = L.parse(d);
    return dt.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  }

  /* ---------------- boot ---------------- */
  window.App = {
    $: $, $$: $$, esc: esc, load: load, save: save, toast: toast, api: api, icon: icon, ICONS: ICONS, ball: ball, qrInto: qrInto,
    modal: modal, closeModal: closeModal, choices: choices, startScanner: startScanner, stopScanner: stopScanner, camHTML: camHTML,
    routes: routes, go: go, render: render, shell: shell, parseHash: parseHash, fmt: fmt
  };
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", function () { navigator.serviceWorker.register("/sw.js").catch(function () {}); });
  }
  document.addEventListener("DOMContentLoaded", function () { flushPlayerQueue(); render(); });
})();
