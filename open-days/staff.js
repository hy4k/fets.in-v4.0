/* FETS staff — open days.
   Staff sign in with their fets.live login (same Supabase project) and record,
   per centre and exam, which days are open for booking. Saving goes through
   staff_save_open_days(), which only accepts active staff; fets.in then shows
   the saved days to candidates. Vanilla JS, no dependencies. */
(function () {
  "use strict";

  var MONTHS_SHOWN = 4;
  var STALE_DAYS = 7;
  var KEY = "fetsOpenDaysSession";
  var CENTRES = { calicut: "Calicut", cochin: "Kochi" };
  var MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  var $ = function (id) { return document.getElementById(id); };
  var boot = $("od-boot"), login = $("od-login"), editor = $("od-editor");

  var cfg = null;          // { url, key, exams }
  var session = null;      // { access_token, refresh_token, expires_at, email }
  var centre = "calicut", exam = null;
  var open = {};           // iso -> true (what is ticked now)
  var saved = {};          // iso -> true (what the database has)
  var reviewedAt = null;
  var busy = false;

  /* ---------- dates (the centre works in IST) ---------- */
  function todayIso() {
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()); }
    catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function iso(y, m, d) { return y + "-" + pad(m + 1) + "-" + pad(d); }
  function shownMonths() {
    var t = todayIso(), y = +t.slice(0, 4), m = +t.slice(5, 7) - 1, out = [];
    for (var i = 0; i < MONTHS_SHOWN; i++) { out.push({ y: y + Math.floor((m + i) / 12), m: (m + i) % 12 }); }
    return out;
  }
  function daysIn(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }
  function rangeEnd() { var l = shownMonths().pop(); return iso(l.y, l.m, daysIn(l.y, l.m)); }

  /* ---------- Supabase over fetch ---------- */
  function call(path, body, token) {
    return fetch(cfg.url + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.key, Authorization: "Bearer " + (token || cfg.key) },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
        if (!r.ok) {
          var err = new Error((j && (j.message || j.error_description || j.msg || j.error)) || ("HTTP " + r.status));
          err.status = r.status; err.code = j && (j.code || j.error_code);
          throw err;
        }
        return j;
      });
    });
  }
  function keep(tok) {
    session = {
      access_token: tok.access_token, refresh_token: tok.refresh_token,
      expires_at: Date.now() + (tok.expires_in || 3600) * 1000,
      email: (tok.user && tok.user.email) || (session && session.email) || ""
    };
    try { sessionStorage.setItem(KEY, JSON.stringify(session)); } catch (e) {}
  }
  function drop() { session = null; try { sessionStorage.removeItem(KEY); } catch (e) {} }
  function fresh() {
    if (!session) return Promise.reject(new Error("signed out"));
    if (session.expires_at - Date.now() > 60000) return Promise.resolve(session.access_token);
    return call("/auth/v1/token?grant_type=refresh_token", { refresh_token: session.refresh_token })
      .then(function (tok) { keep(tok); return session.access_token; });
  }
  function rpc(name, args) {
    return fresh().then(function (token) { return call("/rest/v1/rpc/" + name, args, token); });
  }
  function explain(e) {
    if (e.code === "42501" || /not an active FETS staff/i.test(e.message)) return "This login is not an active FETS staff profile.";
    if (e.code === "PGRST202" || /could not find the function/i.test(e.message)) return "Open days are not set up in the database yet. Ask the administrator to run exam_open_days.sql.";
    if (e.status === 401 || /jwt|signed out/i.test(e.message)) return "Your session ended. Please sign in again.";
    if (/invalid login|invalid_credentials|invalid_grant/i.test(e.message + " " + e.code)) return "Email or password is not right.";
    if (/Failed to fetch|NetworkError/i.test(e.message)) return "Could not reach the server. Check your connection and try again.";
    return "Something went wrong: " + e.message;
  }

  /* ---------- views ---------- */
  function show(which) {
    boot.hidden = true;
    login.hidden = which !== "login";
    editor.hidden = which !== "editor";
    $("od-user").hidden = which !== "editor";
    if (which === "editor") $("od-email").textContent = session.email;
  }
  function say(el, text, ok) { el.textContent = text || ""; el.classList.toggle("is-ok", !!ok); }

  /* ---------- editor ---------- */
  function countOpen() { var n = 0; for (var k in open) if (open[k]) n++; return n; }
  function dirty() {
    var k;
    for (k in open) if (open[k] && !saved[k]) return true;
    for (k in saved) if (saved[k] && !open[k]) return true;
    return false;
  }
  function renderStatus() {
    var el = $("od-status"), name = cfg.exams[exam] + " — " + CENTRES[centre];
    if (!reviewedAt) {
      el.className = "od-status is-warn";
      el.innerHTML = "<strong>" + name + ":</strong> never checked. Nothing is shown on fets.in for this exam and centre until you save.";
      return;
    }
    var d = new Date(reviewedAt), ageDays = (Date.now() - d.getTime()) / 86400000;
    var when = d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
    var stale = ageDays > STALE_DAYS;
    el.className = "od-status" + (stale ? " is-warn" : "");
    el.innerHTML = "<strong>" + name + ":</strong> last checked " + when + " IST. " +
      (stale ? "That is more than " + STALE_DAYS + " days ago, so fets.in has stopped showing these days. Save to publish them again."
             : "fets.in hides this list " + STALE_DAYS + " days after the last check — save again whenever you re-check the portal, even if nothing changed.");
  }
  function renderCount() {
    var n = countOpen();
    $("od-count").innerHTML = "<b>" + n + "</b> open " + (n === 1 ? "day" : "days") + " ticked" + (dirty() ? " · <em>unsaved changes</em>" : " · saved");
    $("od-save").classList.toggle("is-dirty", dirty());
  }
  function renderMonths() {
    var t = todayIso(), box = $("od-months"), html = "";
    shownMonths().forEach(function (mm, idx) {
      var first = (new Date(Date.UTC(mm.y, mm.m, 1)).getUTCDay() + 6) % 7;   // Monday first
      html += '<div class="od-month"><div class="od-month-h"><h2>' + MONTH_NAMES[mm.m] + " " + mm.y + "</h2><div>" +
        '<button type="button" data-fill="all" data-i="' + idx + '">All</button>' +
        '<button type="button" data-fill="weekdays" data-i="' + idx + '">Mon–Fri</button>' +
        '<button type="button" data-fill="none" data-i="' + idx + '">Clear</button></div></div><div class="od-grid">';
      ["M", "T", "W", "T", "F", "S", "S"].forEach(function (d) { html += '<span class="od-dow">' + d + "</span>"; });
      for (var b = 0; b < first; b++) html += "<span></span>";
      for (var d = 1; d <= daysIn(mm.y, mm.m); d++) {
        var k = iso(mm.y, mm.m, d), past = k < t;
        html += '<button type="button" class="od-day' + (k === t ? " is-today" : "") + '" data-day="' + k + '" aria-pressed="' + (open[k] ? "true" : "false") + '"' +
          (past ? " disabled" : "") + ' aria-label="' + d + " " + MONTH_NAMES[mm.m] + '">' + d + "</button>";
      }
      html += "</div></div>";
    });
    box.innerHTML = html;
  }
  function renderPickers() {
    [].forEach.call(document.querySelectorAll("#od-centres button"), function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-centre") === centre ? "true" : "false"); });
    [].forEach.call(document.querySelectorAll("#od-exams button"), function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-exam") === exam ? "true" : "false"); });
  }
  function load() {
    busy = true; say($("od-msg"), "");
    $("od-save-btn").disabled = true;
    renderPickers();
    return rpc("staff_get_open_days", { p_centre: centre, p_exam: exam }).then(function (rows) {
      open = {}; saved = {}; reviewedAt = null;
      var t = todayIso();
      (rows || []).forEach(function (r) {
        if (r.reviewed_at) reviewedAt = r.reviewed_at;
        if (r.open_date && r.open_date >= t) { open[r.open_date] = true; saved[r.open_date] = true; }
      });
      renderStatus(); renderMonths(); renderCount();
      $("od-save-btn").disabled = false;
    }).catch(function (e) {
      if (e.status === 401) { drop(); show("login"); say($("od-login-msg"), explain(e)); return; }
      $("od-months").innerHTML = ""; say($("od-msg"), explain(e));
    }).then(function () { busy = false; });
  }
  function save() {
    if (busy) return;
    busy = true; $("od-save-btn").disabled = true; say($("od-msg"), "");
    var t = todayIso(), dates = [];
    for (var k in open) if (open[k] && k >= t) dates.push(k);
    rpc("staff_save_open_days", { p_centre: centre, p_exam: exam, p_from: t, p_to: rangeEnd(), p_dates: dates.sort() })
      .then(function (stamp) {
        reviewedAt = stamp || new Date().toISOString();
        saved = {}; dates.forEach(function (d) { saved[d] = true; });
        renderStatus(); renderCount();
        say($("od-msg"), "Saved. fets.in will show these days within a few minutes.", true);
      })
      .catch(function (e) {
        if (e.status === 401) { drop(); show("login"); say($("od-login-msg"), explain(e)); return; }
        say($("od-msg"), explain(e));
      })
      .then(function () { busy = false; $("od-save-btn").disabled = false; });
  }
  function switchTo(c, x) {
    if (busy || (c === centre && x === exam)) return;
    if (dirty() && !window.confirm("You have unsaved changes for " + cfg.exams[exam] + " — " + CENTRES[centre] + ". Discard them?")) return;
    centre = c; exam = x; load();
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("button") : null;
    if (!t) return;
    if (t.hasAttribute("data-day")) {
      var k = t.getAttribute("data-day");
      open[k] = !open[k];
      t.setAttribute("aria-pressed", open[k] ? "true" : "false");
      renderCount(); say($("od-msg"), "");
    } else if (t.hasAttribute("data-fill")) {
      var mm = shownMonths()[+t.getAttribute("data-i")], mode = t.getAttribute("data-fill"), today = todayIso();
      for (var d = 1; d <= daysIn(mm.y, mm.m); d++) {
        var key = iso(mm.y, mm.m, d);
        if (key < today) continue;
        var dow = new Date(Date.UTC(mm.y, mm.m, d)).getUTCDay();
        open[key] = mode === "all" || (mode === "weekdays" && dow >= 1 && dow <= 5);
      }
      renderMonths(); renderCount(); say($("od-msg"), "");
    } else if (t.hasAttribute("data-centre")) {
      switchTo(t.getAttribute("data-centre"), exam);
    } else if (t.hasAttribute("data-exam")) {
      switchTo(centre, t.getAttribute("data-exam"));
    }
  });
  $("od-save-btn").addEventListener("click", save);
  $("od-signout").addEventListener("click", function () {
    if (dirty() && !window.confirm("You have unsaved changes. Sign out anyway?")) return;
    drop(); show("login");
  });
  window.addEventListener("beforeunload", function (e) { if (session && dirty()) { e.preventDefault(); e.returnValue = ""; } });

  /* ---------- sign in ---------- */
  $("od-login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = $("od-in-go"); btn.disabled = true; say($("od-login-msg"), "");
    call("/auth/v1/token?grant_type=password", { email: $("od-in-email").value.trim(), password: $("od-in-pass").value })
      .then(function (tok) { keep(tok); $("od-in-pass").value = ""; start(); })
      .catch(function (err) { say($("od-login-msg"), explain(err)); })
      .then(function () { btn.disabled = false; });
  });

  function start() {
    show("editor");
    var box = $("od-exams"), html = "";
    Object.keys(cfg.exams).forEach(function (id) { html += '<button type="button" data-exam="' + id + '">' + cfg.exams[id] + "</button>"; });
    box.innerHTML = html;
    if (!exam) exam = Object.keys(cfg.exams)[0];
    load();
  }

  /* ---------- boot ---------- */
  fetch("/ask/staff-config", { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error("config " + r.status); return r.json(); })
    .then(function (c) {
      cfg = c;
      try { session = JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch (e) { session = null; }
      if (session && session.access_token) start(); else show("login");
    })
    .catch(function () { boot.textContent = "Staff sign-in is not available right now. Please try again in a few minutes."; });
})();
