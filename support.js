/* FETS candidate support desk.
   - Guided answers come straight from support/kb.json (instant, no AI).
   - Typed questions go to the Ask FETS assistant at POST /ask, which reads
     the same kb.json, so both always agree.
   Vanilla JS, no dependencies; the page still reads fine if this fails. */
(function () {
  "use strict";

  var desk = document.getElementById("desk");
  var log = document.getElementById("fd-log");
  var form = document.getElementById("fd-form");
  var input = document.getElementById("fd-q");
  var send = document.getElementById("fd-send");
  if (!desk || !log || !form || !input) return;

  var ASK_URL = "/ask";
  var KB_URL = "./support/kb.json";

  var kb = null;
  var history = [];      // [{role:'user'|'assistant', content}]
  var busy = false;
  var currentExam = null;

  /* ---------- knowledge base ---------- */
  var kbReady = fetch(KB_URL, { cache: "no-cache" })
    .then(function (r) { if (!r.ok) throw new Error("kb " + r.status); return r.json(); })
    .then(function (j) { kb = j; return j; })
    .catch(function () { kb = null; return null; });

  function findExam(id) {
    if (!kb) return null;
    for (var i = 0; i < kb.exams.length; i++) if (kb.exams[i].id === id) return kb.exams[i];
    return null;
  }
  function findTopic(exam, id) {
    for (var i = 0; i < exam.topics.length; i++) if (exam.topics[i].id === id) return exam.topics[i];
    return null;
  }

  /* ---------- safe text rendering ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // Escape first, then allow a small markdown subset: **bold**, links, bullets, numbered lists.
  function inline(s) {
    return s
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+)/g, function (m, pre, url) {
        var tail = (url.match(/[.,;:!?]+$/) || [""])[0];
        var clean = tail ? url.slice(0, -tail.length) : url;
        return pre + '<a href="' + clean + '" target="_blank" rel="noopener">' + clean.replace(/^https?:\/\//, "") + "</a>" + tail;
      })
      .replace(/(^|[\s(])([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g, '$1<a href="mailto:$2">$2</a>');
  }
  function md(text) {
    var lines = esc(text).split("\n");
    var out = "", list = null;
    function close() { if (list) { out += "</" + list + ">"; list = null; } }
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var b = ln.match(/^\s*[-*•]\s+(.*)$/);
      var n = ln.match(/^\s*\d+[.)]\s+(.*)$/);
      if (b) { if (list !== "ul") { close(); out += "<ul>"; list = "ul"; } out += "<li>" + inline(b[1]) + "</li>"; continue; }
      if (n) { if (list !== "ol") { close(); out += "<ol>"; list = "ol"; } out += "<li>" + inline(n[1]) + "</li>"; continue; }
      close();
      if (ln.trim()) out += "<p>" + inline(ln.replace(/^#+\s*/, "")) + "</p>";
    }
    close();
    return out || "<p></p>";
  }

  /* ---------- thread ---------- */
  function addMsg(who, html, cls) {
    var el = document.createElement("div");
    el.className = "fd-msg " + (who === "you" ? "is-you" : "is-desk") + (cls ? " " + cls : "");
    el.innerHTML = '<span class="fd-who">' + (who === "you" ? "You" : "Desk") + '</span><div class="fd-body">' + html + "</div>";
    log.appendChild(el);
    return el;
  }
  function scrollTo(el) {
    // Bring the start of the new entry to the top of the log so the answer reads from its first line.
    log.scrollTop = Math.max(0, el.offsetTop - 4);
  }
  function revealConsole() {
    var c = document.getElementById("fd-console");
    var r = c.getBoundingClientRect();
    if (r.top < 0 || r.top > window.innerHeight * 0.55) c.scrollIntoView({ block: "start" });
  }

  function topicButtons(exam, skipId) {
    var h = "";
    for (var i = 0; i < exam.topics.length; i++) {
      var t = exam.topics[i];
      if (t.id === skipId) continue;
      h += '<button type="button" class="fd-topic" data-exam="' + esc(exam.id) + '" data-topic="' + esc(t.id) + '">' + esc(t.label) + "</button>";
    }
    return h;
  }
  function contactHtml() {
    var c = (kb && kb.contact) || { email: "edu@fets.in", whatsappLink: "https://wa.me/919605686000", calicut: "0495 491 5936", kochi: "0484 454 1957" };
    return '<div class="fd-links">' +
      '<a class="fd-link" href="' + esc(c.whatsappLink) + '" target="_blank" rel="noopener">WhatsApp the desk ↗</a>' +
      '<a class="fd-link" href="tel:' + esc(c.calicut.replace(/\s/g, "")) + '">Call Calicut</a>' +
      '<a class="fd-link" href="tel:' + esc(c.kochi.replace(/\s/g, "")) + '">Call Kochi</a>' +
      '<a class="fd-link" href="mailto:' + esc(c.email) + '">' + esc(c.email) + "</a></div>";
  }

  function markExam(id) {
    currentExam = id;
    var btns = document.querySelectorAll(".fd-exam");
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute("data-exam") === id;
      btns[i].classList.toggle("is-on", on);
      btns[i].setAttribute("aria-pressed", on ? "true" : "false");
      // On phones the exam strip scrolls sideways: keep the chosen exam in view.
      if (on) { var s = btns[i].parentNode; s.scrollLeft = Math.max(0, btns[i].offsetLeft - (s.clientWidth - btns[i].offsetWidth) / 2); }
    }
  }

  function showExam(id) {
    kbReady.then(function () {
      var exam = findExam(id);
      markExam(id);
      revealConsole();
      if (!exam) {
        scrollTo(addMsg("desk", "<p>The guided answers could not be loaded just now. Type your question below, or reach a person:</p>" + contactHtml(), "is-err"));
        return;
      }
      var html = '<p class="fd-card-h">' + esc(exam.name) + "<span>" + esc(exam.body) + " · " + esc(exam.sites) + "</span></p>" +
        "<p>What do you need to know?</p>" +
        '<div class="fd-topics">' + topicButtons(exam) + "</div>";
      scrollTo(addMsg("desk", html));
    });
  }

  function showTopic(examId, topicId) {
    kbReady.then(function () {
      var exam = findExam(examId);
      var topic = exam && findTopic(exam, topicId);
      if (!topic) { showExam(examId); return; }
      markExam(examId);
      revealConsole();
      var q = addMsg("you", "<p>" + esc(topic.q) + "</p>");
      var html = md(topic.a);
      if (topic.links && topic.links.length) {
        html += '<div class="fd-links">';
        for (var i = 0; i < topic.links.length; i++) {
          var l = topic.links[i];
          var ext = /^https?:/.test(l.url);
          html += '<a class="fd-link" href="' + esc(l.url) + '"' + (ext ? ' target="_blank" rel="noopener"' : "") + ">" + esc(l.label) + (ext ? " ↗" : "") + "</a>";
        }
        html += "</div>";
      }
      html += '<p class="fd-src">From published policy · checked ' + esc(kb.checked) + "</p>";
      var more = topicButtons(exam, topic.id);
      if (more) html += '<div class="fd-more"><p class="fd-src">More on ' + esc(exam.name) + '</p><div class="fd-topics">' + more + "</div></div>";
      var answer = addMsg("desk", html);
      scrollTo(q);
      if (topic.calendar) liveCalendar(answer, exam);
      history.push({ role: "user", content: topic.q });
      history.push({ role: "assistant", content: topic.a });
    });
  }

  /* ---------- live centre calendar (guided answers flagged "calendar": true) ---------- */
  // Shows the days that already have candidates booked for this exam at FETS (staff
  // enter them from the providers' portals) — not every day open for booking.
  // Renders nothing unless the calendar is connected AND has matching days.
  function calendarHtml(d, exam) {
    if (!d || d.state !== "ok" || !d.centres || !d.centres.length) return "";
    var h = '<p class="fd-cal-h"><span class="fd-dot dot-pulse"></span>Exam days already booked at FETS</p>';
    for (var i = 0; i < d.centres.length; i++) {
      var c = d.centres[i];
      h += '<div class="fd-cal-c"><strong>' + esc(c.centre) + "</strong>";
      if (c.months && c.months.length) {
        for (var m = 0; m < c.months.length; m++) {
          h += '<p class="fd-cal-m"><span>' + esc(c.months[m].label) + "</span>" + esc(c.months[m].days) + "</p>";
        }
      } else {
        h += '<p class="fd-cal-m">' + c.dates.slice(0, 18).map(function (x) { return esc(x.label); }).join(" · ") + "</p>";
      }
      h += "</div>";
    }
    h += '<p class="fd-cal-n">Days with ' + esc(exam.name) + " candidates already booked at this centre, next " + esc(d.days) +
      " days (ranges inclusive). More days may be open for booking, and a listed day may be full — the official site above shows every open day and seat.</p>";
    return h;
  }
  var calCache = {};   // one request per exam per visit: the endpoint shares the assistant's rate limit
  function liveCalendar(el, exam) {
    var req = calCache[exam.id] || (calCache[exam.id] = fetch(ASK_URL + "/calendar?exam=" + encodeURIComponent(exam.id))
      .then(function (r) { return r.ok ? r.json() : null; }));
    req
      .then(function (d) {
        var h = calendarHtml(d, exam);
        if (!h) return;
        var box = document.createElement("div");
        box.className = "fd-cal";
        box.innerHTML = h;
        var body = el.querySelector(".fd-body");
        var src = body.querySelector(".fd-src");
        body.insertBefore(box, src || null);
      })
      .catch(function () {});
  }

  function ask(text) {
    text = (text || "").trim();
    if (busy || !text) return;
    busy = true; send.disabled = true;
    input.value = ""; fit();
    revealConsole();
    var q = addMsg("you", "<p>" + esc(text) + "</p>");
    var wait = addMsg("desk", '<p class="fd-wait">Checking the records</p>');
    scrollTo(q);
    var body = wait.querySelector(".fd-body");

    function fail(msg) {
      wait.classList.add("is-err");
      body.innerHTML = "<p>" + esc(msg) + "</p>" + contactHtml();
    }

    fetch(ASK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: text, history: history.slice(-8), exam: currentExam })
    })
      .then(function (r) {
        if (r.status === 429) { fail("Too many questions in a short time. Give it a minute and try again — or reach a person:"); return null; }
        if (!r.ok) { fail("The desk could not answer just now. Please try again, or reach a person:"); return null; }
        return r.json();
      })
      .then(function (d) {
        if (!d) return;
        var answer = (d.answer || "").trim();
        if (!answer) { fail("The desk had no answer for that. Reach a person:"); return; }
        body.innerHTML = md(answer);
        history.push({ role: "user", content: text });
        history.push({ role: "assistant", content: answer });
      })
      .catch(function () { fail("Could not reach the desk — check your connection and try again, or reach a person:"); })
      .then(function () {
        busy = false; send.disabled = false;
        scrollTo(q);
      });
  }

  /* ---------- input ---------- */
  function fit() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  }
  if (window.matchMedia && window.matchMedia("(max-width: 639px)").matches) input.placeholder = "Ask about your exam…";
  input.addEventListener("input", fit);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(input.value); }
  });
  form.addEventListener("submit", function (e) { e.preventDefault(); ask(input.value); });

  // The app below listens for ArrowUp/ArrowDown on window to jump between sections.
  // Keep those keys local while the candidate is typing or scrolling the thread.
  desk.addEventListener("keydown", function (e) {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") e.stopPropagation();
  });

  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest(".fd-topic");
    if (t) { showTopic(t.getAttribute("data-exam"), t.getAttribute("data-topic")); return; }
    var x = e.target.closest && e.target.closest(".fd-exam");
    if (x) { showExam(x.getAttribute("data-exam")); return; }
    var f = e.target.closest && e.target.closest("[data-desk-focus]");
    if (f) { closeIndex(); toDesk(true); return; }
    var top = e.target.closest && e.target.closest("[data-desk-top]");
    if (top) { e.preventDefault(); closeIndex(); toDesk(false); return; }
    if (e.target.closest && e.target.closest(".fd-index a")) closeIndex();
  });

  function toDesk(focus) {
    window.scrollTo({ top: 0, behavior: "auto" });
    if (focus) setTimeout(function () { input.focus({ preventScroll: true }); }, 60);
  }

  /* ---------- index overlay ---------- */
  var bar = document.getElementById("fd-bar");
  var index = document.getElementById("fd-index");
  var menuBtn = document.getElementById("fd-menu-btn");
  function openIndex() {
    index.hidden = false;
    menuBtn.setAttribute("aria-expanded", "true");
    menuBtn.textContent = "Close";
    bar.classList.remove("is-away");
    document.documentElement.style.overflow = "hidden";
    var first = index.querySelector("a"); if (first) first.focus();
  }
  function closeIndex() {
    if (index.hidden) return;
    index.hidden = true;
    menuBtn.setAttribute("aria-expanded", "false");
    menuBtn.textContent = "Index";
    document.documentElement.style.overflow = "";
  }
  menuBtn.addEventListener("click", function () { if (index.hidden) openIndex(); else { closeIndex(); menuBtn.focus(); } });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !index.hidden) { closeIndex(); menuBtn.focus(); }
  });

  /* ---------- bar: visible at the desk, steps aside on the way down, returns on the way up ---------- */
  var lastY = window.scrollY;
  var launch = document.getElementById("fd-launch");
  function onScroll() {
    var y = window.scrollY;
    var offDesk = y > desk.offsetHeight - 120;
    if (!index.hidden || !offDesk) bar.classList.remove("is-away");
    else if (y > lastY + 6) bar.classList.add("is-away");
    else if (y < lastY - 6) bar.classList.remove("is-away");
    bar.classList.toggle("is-off-desk", offDesk);
    if (launch) launch.hidden = !offDesk;
    lastY = y;
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  onScroll();

  /* ---------- clock (IST, matching the rest of the site) ---------- */
  var clock = document.getElementById("fd-clock");
  if (clock) {
    var fmt;
    try { fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }); } catch (e) { fmt = null; }
    var tick = function () { clock.textContent = (fmt ? fmt.format(new Date()) : new Date().toTimeString().slice(0, 8)) + " IST"; };
    tick(); setInterval(tick, 1000);
  }
})();
