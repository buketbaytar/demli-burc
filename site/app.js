/* Demli Burç — arayüz */
(function () {
  "use strict";

  var DATA = window.DEMLI_DATA;
  var engine = window.RoastEngine.createEngine(DATA);
  var META = DATA.meta.selection; // { min, recommended, max }
  var FEATURES = engine.features;
  var BY_ID = {};
  FEATURES.forEach(function (f) { BY_ID[f.id] = f; });

  var BREW_LINES = [
    "Yapraklar demleniyor…",
    "Yıldız haritan süzgeçten geçiyor…",
    "Seçtiklerin Excel'e dökülüyor…",
    "Akreplerden ikinci görüş alınıyor…",
    "Terazi karar veremedi, Koç'a soruluyor…",
    "Kozmik kesinlik hesaplanıyor…"
  ];
  var TEXT_VS = "︎"; // burç sembolünü emoji değil, metin glifi olarak çiz
  var MAX_TOAST = "10 tane yeter, yıldızların da bir kapasitesi var.";

  /* ---------------- durum ---------------- */
  var state = {
    selected: [],      // seçilen id'ler (tıklama sırası)
    mode: "s",         // s = kendim, a = arkadaşım
    result: null,
    exclude: [],       // "tekrar demle" ile görülen varyasyonlar (aynı seçim için)
    excludeKey: ""
  };

  /* ---------------- küçük yardımcılar ---------------- */
  function $(id) { return document.getElementById(id); }
  function store(key, val) {
    try {
      if (val === undefined) return JSON.parse(localStorage.getItem(key) || "null");
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { return null; }
  }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  var toastTimer;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }
  var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** Analitik eklemek istersen burayı doldur (ör. Plausible, GA4). */
  function track(event, props) {
    try { if (window.plausible) window.plausible(event, { props: props }); } catch (e) {}
    try { if (window.gtag) window.gtag("event", event, props); } catch (e) {}
  }

  /* ---------------- geçmiş (aynı kişiye aynı metni tekrar gösterme) ---------------- */
  function getHistory() { return store("demli_history") || []; }
  function pushHistory(uid) {
    var h = getHistory().filter(function (x) { return x !== uid; });
    h.push(uid);
    store("demli_history", h.slice(-40));
  }

  /* ---------------- görünümler ---------------- */
  function showView(name) {
    ["pick", "brew", "result"].forEach(function (v) { $("view-" + v).hidden = v !== name; });
    var showBar = name === "pick";
    $("bar").classList.toggle("hide", !showBar);
    document.body.classList.toggle("no-bar", !showBar);
    window.scrollTo(0, 0);
  }

  /* ---------------- seçim ekranı ---------------- */
  function renderChips() {
    var wrap = $("chips");
    wrap.textContent = "";
    shuffle(FEATURES).forEach(function (f) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.dataset.id = f.id;
      b.setAttribute("aria-pressed", state.selected.indexOf(f.id) !== -1 ? "true" : "false");
      var tick = document.createElement("span");
      tick.className = "tick";
      tick.setAttribute("aria-hidden", "true");
      tick.textContent = "✓";
      var txt = document.createElement("span");
      txt.textContent = f.text;
      b.appendChild(tick);
      b.appendChild(txt);
      wrap.appendChild(b);
    });
  }

  function syncChips() {
    var chips = $("chips").children;
    for (var i = 0; i < chips.length; i++) {
      chips[i].setAttribute("aria-pressed", state.selected.indexOf(chips[i].dataset.id) !== -1 ? "true" : "false");
    }
    updateBar();
  }

  function toggle(id, el) {
    var i = state.selected.indexOf(id);
    if (i !== -1) state.selected.splice(i, 1);
    else {
      if (state.selected.length >= META.max) { toast(MAX_TOAST); return; }
      state.selected.push(id);
      if (el && !reducedMotion) { el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop"); }
    }
    if (el) el.setAttribute("aria-pressed", i === -1 ? "true" : "false");
    updateBar();
  }

  function updateBar() {
    var n = state.selected.length;
    $("countNum").textContent = n;
    var hint;
    if (n === 0) hint = "en az " + META.min + " seç";
    else if (n < META.min) hint = (META.min - n) + " tane daha";
    else if (n < 5) hint = "olur ama 5-6 daha isabetli";
    else if (n <= 7) hint = "mükemmel kıvam ☕";
    else hint = "tamam, anladık";
    $("countHint").textContent = hint;
    $("brewBtn").disabled = n < META.min;

    var dots = $("dots");
    if (!dots.children.length) for (var k = 0; k < 6; k++) dots.appendChild(document.createElement("i"));
    for (var d = 0; d < dots.children.length; d++) {
      dots.children[d].className = d < n ? (n >= 5 ? "ideal" : "on") : "";
    }
  }

  function setMode(m) {
    state.mode = m === "a" ? "a" : "s";
    document.querySelectorAll(".mode-btn").forEach(function (b) {
      b.setAttribute("aria-checked", b.dataset.mode === state.mode ? "true" : "false");
    });
    $("chipsHint").innerHTML = state.mode === "a"
      ? "Arkadaşına uyan <strong>5-6 tanesini</strong> seç. Merak etme, ona söylemeyeceğiz."
      : "Sana uyan <strong>5-6 tanesini</strong> seç. Dürüst ol, kimse görmüyor.";
    $("brewBtn").textContent = state.mode === "a" ? "Arkadaşımı demle" : "Burcumu demle";
  }

  function surprise() {
    state.selected = shuffle(FEATURES).slice(0, 6).map(function (f) { return f.id; });
    syncChips();
    toast("6 rastgele özellik seçildi. Bakalım evren ne diyecek 🎲");
  }

  /* ---------------- URL (paylaşılabilir sonuç) ---------------- */
  function encodeHash(ids, uid, mode) {
    var nums = ids.map(function (id) { return parseInt(id.slice(2), 10); }).join(".");
    return "#r=" + nums + "&v=" + uid.replace(":", "-") + "&m=" + mode;
  }
  function decodeHash(hash) {
    var q = {};
    hash.replace(/^#/, "").split("&").forEach(function (kv) {
      var p = kv.split("="); if (p[0]) q[p[0]] = decodeURIComponent(p[1] || "");
    });
    if (!q.r) return null;
    var ids = q.r.split(".").map(function (n) { return "f_" + ("000" + parseInt(n, 10)).slice(-3); })
      .filter(function (id) { return BY_ID[id]; });
    if (ids.length < META.min) return null;
    return { ids: ids, uid: (q.v || "").replace("-", ":"), mode: q.m === "a" ? "a" : "s" };
  }
  function shareUrl() {
    return location.href.split("#")[0] + encodeHash(state.result.ids, state.result.variation_uid || "x:0", state.mode);
  }

  /* ---------------- demleme ---------------- */
  function brew(opts) {
    opts = opts || {};
    if (state.selected.length < META.min) return;
    var key = state.selected.slice().sort().join(",");
    if (key !== state.excludeKey) { state.excludeKey = key; state.exclude = []; }

    var res = engine.generate(state.selected, { history: getHistory(), exclude: opts.rebrew ? state.exclude : [] });
    if (res.status !== "ok") { toast(res.message); return; }
    if (opts.rebrew && res.variation_uid && state.exclude.indexOf(res.variation_uid) !== -1) {
      // bu seçimle gösterilebilecek bütün varyasyonlar görüldü
      state.exclude = [];
      toast("Bu butonlarla gösterebileceğimiz her " + res.sign_name + " halini gördün. Başa döndük.");
    }
    if (res.variation_uid) { state.exclude.push(res.variation_uid); pushHistory(res.variation_uid); }
    state.result = res;
    track("brew", { sign: res.sign || "none", variation: res.variation_uid || "", mode: state.mode, rebrew: !!opts.rebrew });

    var hash = encodeHash(res.ids, res.variation_uid || "x:0", state.mode);
    try { sessionStorage.setItem("demli_own", hash); } catch (e) {}
    history.pushState({ demli: 1 }, "", hash);

    if (opts.instant) { renderResult(res, false); return; }
    showView("brew");
    var i = 0, el = $("brewText");
    el.textContent = BREW_LINES[0];
    var lines = shuffle(BREW_LINES.slice(1));
    var tick = setInterval(function () { el.textContent = lines[i++ % lines.length]; }, 520);
    setTimeout(function () { clearInterval(tick); renderResult(res, false); }, reducedMotion ? 300 : 1900);
  }

  /* ---------------- sonuç ekranı ---------------- */
  function renderResult(res, shared) {
    state.result = res;
    var friend = state.mode === "a";
    $("sharedBanner").hidden = !shared;
    $("resultEyebrow").textContent = friend ? "Arkadaşının burcu" : "Yıldızların kararı: sen bir";
    $("resultEmoji").textContent = res.sign ? res.emoji + TEXT_VS : "🌌";
    $("resultTitle").textContent = res.sign_name;
    $("resultArchetype").textContent = "“" + res.archetype + "”";
    $("resultBody").textContent = res.body;

    var ev = $("resultEvidence");
    ev.textContent = "";
    (res.evidence || []).forEach(function (line) {
      var p = document.createElement("p"); p.textContent = line; ev.appendChild(p);
    });
    var extra = $("resultExtra");
    extra.hidden = !res.extra;
    extra.textContent = res.extra ? res.extra.text : "";

    var mix = $("resultMix");
    mix.textContent = "";
    var hasMeta = !!(res.mix && res.mix.length);
    mix.parentNode.parentNode.hidden = !hasMeta;
    $("rebrewBtn").hidden = !res.sign;
    if (hasMeta) {
      res.mix.forEach(function (m) {
        var row = document.createElement("div"); row.className = "mix-row";
        var name = document.createElement("span");
        var gl = document.createElement("span"); gl.className = "glyph"; gl.textContent = m.emoji + TEXT_VS;
        name.appendChild(gl); name.appendChild(document.createTextNode(" " + m.name));
        var track = document.createElement("div"); track.className = "mix-track";
        var fill = document.createElement("div"); fill.className = "mix-fill"; track.appendChild(fill);
        var pct = document.createElement("span"); pct.className = "mix-pct"; pct.textContent = "%" + m.pct;
        row.appendChild(name); row.appendChild(track); row.appendChild(pct); mix.appendChild(row);
        requestAnimationFrame(function () { requestAnimationFrame(function () { fill.style.width = m.pct + "%"; }); });
      });
      $("resultConfidence").textContent = res.confidence_label + " (%" + res.confidence_pct + ")";
      $("resultTea").textContent = res.tea;
    }
    $("resultCloser").textContent = res.closer || "";
    document.title = res.sign_name + " — " + res.archetype + " | Demli Burç";
    showView("result");
  }

  /* ---------------- paylaşım ---------------- */
  function shareText() {
    var r = state.result;
    var who = state.mode === "a" ? "Demli Burç arkadaşımı çözdü" : "Demli Burç beni çözdü";
    return who + ": " + (r.emoji || "") + " " + r.sign_name + " — “" + r.archetype + "” ☕ Sen de dene:";
  }

  function copyLink() {
    var url = shareUrl();
    var done = function () { toast("Link kopyalandı 🔗"); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(url).then(done, function () { fallbackCopy(url); done(); });
    else { fallbackCopy(url); done(); }
    track("share", { channel: "copy" });
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
  }
  function nativeShare() {
    var data = { title: "Demli Burç", text: shareText(), url: shareUrl() };
    if (navigator.share) {
      navigator.share(data).then(function () { track("share", { channel: "native" }); }, function () {});
    } else copyLink();
  }
  function whatsapp() {
    window.open("https://wa.me/?text=" + encodeURIComponent(shareText() + " " + shareUrl()), "_blank", "noopener");
    track("share", { channel: "whatsapp" });
  }

  /* ---------------- story görseli (1080x1920, canvas) ---------------- */
  function wrapLines(ctx, text, maxW) {
    var words = text.split(/\s+/), lines = [], line = "";
    words.forEach(function (w) {
      var test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
    });
    if (line) lines.push(line);
    return lines;
  }

  function drawStory(res) {
    var W = 1080, H = 1920, PAD = 90;
    var c = document.createElement("canvas");
    c.width = W; c.height = H;
    var ctx = c.getContext("2d");

    var g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#1c120c"); g.addColorStop(0.55, "#3b1d0e"); g.addColorStop(1, "#9a3412");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(251,146,60,0.10)";
    ctx.beginPath(); ctx.arc(W - 80, 260, 360, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(60, H - 220, 260, 0, Math.PI * 2); ctx.fill();

    var display = '"Bricolage Grotesque", system-ui, sans-serif';
    var body = 'Inter, system-ui, sans-serif';
    ctx.textBaseline = "alphabetic";

    ctx.fillStyle = "#fbbf77";
    ctx.font = "600 34px " + body;
    ctx.fillText("☕  DEMLİ BURÇ", PAD, 150);

    ctx.fillStyle = "rgba(247,235,220,0.72)";
    ctx.font = "600 32px " + body;
    ctx.fillText(state.mode === "a" ? "ARKADAŞIMIN BURCU" : "YILDIZLARIN KARARI", PAD, 300);

    // burç kutusu
    ctx.fillStyle = "#f7ebdc";
    var bx = PAD, by = 340, bs = 190;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx, by, bs, bs, 48); ctx.fill(); } else ctx.fillRect(bx, by, bs, bs);
    ctx.fillStyle = "#1c120c";
    ctx.font = "120px \"Segoe UI Symbol\", \"Apple Symbols\", \"Noto Sans Symbols\", " + body;
    ctx.textAlign = "center";
    ctx.fillText(res.sign ? res.emoji + TEXT_VS : "🌌", bx + bs / 2, by + bs / 2 + 44);
    ctx.textAlign = "left";

    ctx.fillStyle = "#f7ebdc";
    ctx.font = "800 150px " + display;
    ctx.fillText(res.sign_name, PAD, 690);

    ctx.fillStyle = "#fb923c";
    ctx.font = "700 60px " + display;
    var aLines = wrapLines(ctx, "“" + res.archetype + "”", W - PAD * 2);
    var y = 780;
    aLines.forEach(function (l) { ctx.fillText(l, PAD, y); y += 70; });

    // roast metni: sığana kadar küçült
    var top = y + 40, bottom = H - 330, size = 46, lines, lh;
    do {
      ctx.font = "500 " + size + "px " + body;
      lh = Math.round(size * 1.42);
      lines = wrapLines(ctx, res.body, W - PAD * 2);
      size -= 2;
    } while (lines.length * lh > bottom - top && size > 26);
    ctx.fillStyle = "rgba(247,235,220,0.94)";
    lines.forEach(function (l, i) { ctx.fillText(l, PAD, top + lh * (i + 1) - lh * 0.3); });

    if (res.mix && res.mix.length) {
      ctx.fillStyle = "#fbbf77";
      ctx.font = "600 36px " + body;
      ctx.fillText(res.mix.map(function (m) { return m.name + " %" + m.pct; }).join("  ·  "), PAD, H - 220);
    }
    ctx.fillStyle = "rgba(247,235,220,0.8)";
    ctx.font = "600 36px " + body;
    var host = location.host || "Demli Burç";
    ctx.fillText("Sen de dene → " + host, PAD, H - 130);
    return c;
  }

  function shareImage() {
    var res = state.result;
    var ready = document.fonts && document.fonts.load
      ? Promise.all([document.fonts.load('800 150px "Bricolage Grotesque"'), document.fonts.load('700 60px "Bricolage Grotesque"'),
                     document.fonts.load("500 46px Inter"), document.fonts.load("600 36px Inter")]).catch(function () {})
      : Promise.resolve();
    ready.then(function () {
      drawStory(res).toBlob(function (blob) {
        if (!blob) { toast("Görsel oluşturulamadı."); return; }
        var name = "demli-burc-" + (res.sign || "burcsuz") + ".png";
        var file;
        try { file = new File([blob], name, { type: "image/png" }); } catch (e) { file = null; }
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: "Demli Burç", text: shareText() + " " + shareUrl() })
            .then(function () { track("share", { channel: "image" }); }, function () {});
        } else {
          var a = document.createElement("a");
          a.href = URL.createObjectURL(blob); a.download = name;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
          toast("Görsel indirildi 📸 Story'ne ekleyebilirsin.");
          track("share", { channel: "image-download" });
        }
      }, "image/png");
    });
  }

  /* ---------------- yönlendirme ---------------- */
  function restart(mode) {
    state.selected = [];
    state.result = null;
    if (mode) setMode(mode);
    history.pushState({ demli: 0 }, "", location.pathname + location.search);
    document.title = "Demli Burç — Burcunu söyleme, biz demleyip bulalım";
    renderChips();
    updateBar();
    showView("pick");
  }

  function route() {
    var parsed = decodeHash(location.hash);
    if (!parsed) {
      document.title = "Demli Burç — Burcunu söyleme, biz demleyip bulalım";
      showView("pick");
      return;
    }
    var own = false;
    try { own = sessionStorage.getItem("demli_own") === location.hash; } catch (e) {}
    setMode(parsed.mode);
    state.selected = parsed.ids.slice();
    syncChips();
    var res = engine.generate(parsed.ids, { forceVariation: parsed.uid });
    if (res.status !== "ok") { showView("pick"); return; }
    state.excludeKey = res.ids.join(",");
    state.exclude = res.variation_uid ? [res.variation_uid] : [];
    if (!own) track("open_shared", { sign: res.sign || "none" });
    renderResult(res, !own);
  }

  /* ---------------- tema ---------------- */
  function toggleTheme() {
    var root = document.documentElement;
    var dark = root.dataset.theme ? root.dataset.theme === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("demli_theme", root.dataset.theme); } catch (e) {}
  }

  /* ---------------- olaylar ---------------- */
  $("chips").addEventListener("click", function (e) {
    var chip = e.target.closest(".chip");
    if (chip) toggle(chip.dataset.id, chip);
  });
  document.querySelectorAll(".mode-btn").forEach(function (b) {
    b.addEventListener("click", function () { setMode(b.dataset.mode); });
  });
  $("surpriseBtn").addEventListener("click", surprise);
  $("brewBtn").addEventListener("click", function () { brew(); });
  $("themeBtn").addEventListener("click", toggleTheme);
  $("brandLink").addEventListener("click", function (e) { e.preventDefault(); restart(); });
  $("view-result").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-action]");
    if (!btn) return;
    var a = btn.dataset.action;
    if (a === "share") nativeShare();
    else if (a === "whatsapp") whatsapp();
    else if (a === "copy") copyLink();
    else if (a === "share-image") shareImage();
    else if (a === "rebrew") { state.selected = state.result.ids.slice(); brew({ rebrew: true }); }
    else if (a === "friend") restart("a");
    else if (a === "restart") restart("s");
  });
  window.addEventListener("popstate", route);

  /* Yerel geliştirmede test kancası (canlı sitede çalışmaz) */
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__demli = { state: state, drawStory: drawStory };

  /* ---------------- başlat ---------------- */
  renderChips();
  setMode("s");
  updateBar();
  route();
})();
