/* FETS v4 — injects an embedded Google Map for each centre next to
   the existing "Open in maps" links. Idempotent; retries until the
   React app has rendered the links. No API key needed (output=embed). */
(function () {
  var CENTRES = [
    {
      match: "Kadooli",
      q: "Kadooli Tower, West Nadakkavu, Vandipetta Junction, Kozhikode, Kerala 673011",
      title: "FETS Calicut centre map"
    },
    {
      match: "Manjooran",
      q: "Manjooran Estate, Bypass Junction, Edappally, Kochi, Kerala 682024",
      title: "FETS Kochi centre map"
    }
  ];

  function inject() {
    var done = 0;
    CENTRES.forEach(function (c) {
      var a = document.querySelector('a[href*="' + c.match + '"]');
      if (!a || a.dataset.fetsMap === "1") {
        if (a) done++;
        return;
      }
      var f = document.createElement("iframe");
      f.className = "fets-map-embed";
      f.src = "https://maps.google.com/maps?q=" + encodeURIComponent(c.q) + "&output=embed";
      f.loading = "lazy";
      f.title = c.title;
      f.setAttribute("referrerpolicy", "no-referrer-when-downgrade");
      f.setAttribute("allowfullscreen", "true");
      a.parentNode.insertBefore(f, a.nextSibling);
      a.dataset.fetsMap = "1";
      done++;
    });
    return done === CENTRES.length;
  }

  var tries = 0;
  var timer = setInterval(function () {
    if (inject() || ++tries > 40) clearInterval(timer);
  }, 500);
})();
