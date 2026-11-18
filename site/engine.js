/*!
 * Demli Burç — skorlama motoru (tarayıcı + Node).
 * engine.py ile birebir aynı sonucu üretir; parity_test.mjs bunu doğrular.
 * Kaynak veri değişirse: `python build_site.py` -> site/data.js yeniden üretilir.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RoastEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var SIGN_ORDER = ["koc", "boga", "ikizler", "yengec", "aslan", "basak",
                    "terazi", "akrep", "yay", "oglak", "kova", "balik"];
  var CFG = {
    HYBRID_ABS_GAP: 2,
    HYBRID_REL_GAP: 0.05,
    SECONDARY_MIN_PCT: 20,
    HISTORY_PENALTY: 0.6,
    LIFT_ALPHA: 0.8
  };
  var TIE_LEVELS = ["toplam puan", "kanıt genişliği", "en güçlü sinyal",
                    "en az zıt sinyal", "deterministik kura"];

  /* ---------------- SHA-256 (senkron, bağımlılıksız) ---------------- */
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  function sha256Hex(message) {
    var bytes = new TextEncoder().encode(message);
    var len = bytes.length;
    var padded = (((len + 9) + 63) >> 6) << 6;
    var buf = new Uint8Array(padded);
    buf.set(bytes);
    buf[len] = 0x80;
    var dv = new DataView(buf.buffer);
    var bitLen = len * 8;
    dv.setUint32(padded - 4, bitLen >>> 0);
    dv.setUint32(padded - 8, Math.floor(bitLen / 4294967296));
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
             0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Uint32Array(64);
    for (var off = 0; off < padded; off += 64) {
      for (var i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (i = 16; i < 64; i++) {
        var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    return H.map(function (x) { return ("00000000" + x.toString(16)).slice(-8); }).join("");
  }

  /** Python: int(sha256("|".join(parts)).hexdigest()[:12], 16) — 48 bit, JS Number'a sığar. */
  function stableHash() {
    var parts = Array.prototype.slice.call(arguments);
    return parseInt(sha256Hex(parts.join("|")).slice(0, 12), 16);
  }

  /* ---------------- yardımcılar ---------------- */
  function cmpTuple(a, b) {
    for (var i = 0; i < a.length; i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return 0;
  }
  function fmt(tpl, vars) {
    return tpl.replace(/\{(\w+)\}/g, function (m, k) { return k in vars ? String(vars[k]) : m; });
  }
  function relevance(w) { return w > 0 ? 1 + w / 5 : 0.5; }
  function q4(x) { return Math.floor(x * 10000 + 0.5) / 10000; }

  /* ---------------- motor ---------------- */
  function createEngine(raw) {
    var featureList = raw.features;
    var featureMap = {};
    featureList.forEach(function (f) { featureMap[f.id] = f; });
    var T = raw.templates;
    var priorCache = {};

    function scoreSigns(selected) {
      var stats = {};
      SIGN_ORDER.forEach(function (s) { stats[s] = { score: 0, support: 0, max_w: 0, neg: 0 }; });
      selected.forEach(function (f) {
        Object.keys(f.weights).forEach(function (s) {
          var w = f.weights[s], st = stats[s];
          st.score += w;
          if (w > 0) { st.support += 1; st.max_w = Math.max(st.max_w, w); }
          else st.neg += w;
        });
      });
      return stats;
    }

    function rankSigns(stats, selKey) {
      var keys = {};
      SIGN_ORDER.forEach(function (s) {
        var st = stats[s];
        keys[s] = [-st.score, -st.support, -st.max_w, -st.neg, stableHash(selKey, s)];
      });
      var ranked = SIGN_ORDER.slice().sort(function (a, b) { return cmpTuple(keys[a], keys[b]); });
      var k1 = keys[ranked[0]], k2 = keys[ranked[1]], level = 0;
      while (level < k1.length && k1[level] === k2[level]) level++;
      return { ranked: ranked, decidedBy: TIE_LEVELS[Math.min(level, TIE_LEVELS.length - 1)] };
    }

    function topPercentages(stats, top) {
      var pos = {}, total = 0;
      top.forEach(function (s) { pos[s] = Math.max(stats[s].score, 0); total += pos[s]; });
      var out = {};
      if (total === 0) { top.forEach(function (s) { out[s] = 0; }); return out; }
      var rawP = {}, sum = 0;
      top.forEach(function (s) { rawP[s] = 100 * pos[s] / total; out[s] = Math.floor(rawP[s]); sum += out[s]; });
      var rest = 100 - sum;
      top.slice().sort(function (a, b) { return (rawP[b] - out[b]) - (rawP[a] - out[a]); })
        .slice(0, rest).forEach(function (s) { out[s] += 1; });
      return out;
    }

    function tagProfile(selected, sign) {
      var tw = {};
      selected.forEach(function (f) {
        var r = relevance(f.weights[sign] || 0);
        f.tags.forEach(function (t) { tw[t] = (tw[t] || 0) + r; });
      });
      return tw;
    }

    function tagPrior(sign) {
      if (!priorCache[sign]) {
        var prior = {};
        featureList.forEach(function (f) {
          var w = f.weights[sign] || 0;
          if (w > 0) f.tags.forEach(function (t) { prior[t] = (prior[t] || 0) + relevance(w); });
        });
        priorCache[sign] = prior;
      }
      return priorCache[sign];
    }

    function pickVariation(sign, selected, selKey, history, exclude) {
      var tw = tagProfile(selected, sign), prior = tagPrior(sign);
      var seen = {};
      (history || []).forEach(function (h) { seen[h] = true; });
      var scored = raw.results[sign].map(function (v) {
        var tags = v.trigger_tags;
        var matched = tags.filter(function (t) { return (tw[t] || 0) > 0; });
        var sum = 0;
        tags.forEach(function (t) { sum += (tw[t] || 0) / Math.pow(Math.max(prior[t] || 0, 1.0), CFG.LIFT_ALPHA); });
        var score = sum / Math.sqrt(tags.length);
        if (seen[sign + ":" + v.variation_id]) score *= CFG.HISTORY_PENALTY;
        return { v: v, score: q4(score), coverage: matched.length / tags.length, matched: matched,
                 h: stableHash(selKey, sign, String(v.variation_id)) };
      });
      // "Bu ben değilim, tekrar demle": gösterilmiş varyasyonları tamamen dışla
      if (exclude && exclude.length) {
        var left = scored.filter(function (x) { return exclude.indexOf(sign + ":" + x.v.variation_id) === -1; });
        if (left.length) scored = left;
      }
      scored.sort(function (a, b) { return cmpTuple([-a.score, -a.coverage, a.h], [-b.score, -b.coverage, b.h]); });
      var best = scored[0];
      if (best.score === 0) {
        var pool = scored.filter(function (x) { return !seen[sign + ":" + x.v.variation_id]; });
        if (!pool.length) pool = scored;
        best = pool[stableHash(selKey, sign, "fallback") % pool.length];
      }
      return { variation: best.v, matched: best.matched };
    }

    function confidenceLabel(pct) {
      var labels = T.confidence_labels;
      for (var i = 0; i < labels.length; i++) if (pct >= labels[i].min) return labels[i].label;
      return labels[labels.length - 1].label;
    }

    /**
     * @param {string[]} selectedIds
     * @param {{history?: string[], forceVariation?: string}} [opts]
     *   history: daha önce gösterilen "burc:id" listesi (tekrar oynayana farklı metin)
     *   forceVariation: paylaşılan linkte gösterilen varyasyon (link herkeste aynı açılsın)
     *   exclude: tamamen dışlanacak "burc:id" listesi ("tekrar demle" butonu)
     */
    function generate(selectedIds, opts) {
      opts = opts || {};
      var meta = raw.meta.selection;
      var ids = [];
      selectedIds.forEach(function (id) { if (ids.indexOf(id) === -1) ids.push(id); });
      var unknown = ids.filter(function (i) { return !featureMap[i]; });
      if (unknown.length) return { status: "error", message: "Bilinmeyen özellik id: " + unknown.join(", ") };
      if (ids.length < meta.min) return { status: "too_few", message: fmt(T.too_few_message, meta) };
      ids = ids.slice(0, meta.max).sort();
      var selected = ids.map(function (i) { return featureMap[i]; });
      var selKey = ids.join(",");
      function pick(options, slot) { return options[stableHash(selKey, "tpl", slot) % options.length]; }

      var stats = scoreSigns(selected);
      var rk = rankSigns(stats, selKey), ranked = rk.ranked;
      var winner = ranked[0], runner = ranked[1], signs = T.signs;

      if (stats[winner].score <= 0) {
        var nr = T.no_sign_result;
        return { status: "ok", sign: null, sign_name: "Burçsuz", emoji: "🌌", archetype: nr.archetype,
                 headline: "🌌 Burçsuz — '" + nr.archetype + "'", body: nr.text, lines: [], ids: ids };
      }

      var pcts = topPercentages(stats, ranked.slice(0, 3));
      var s1 = stats[winner].score, s2 = stats[runner].score;
      var isHybrid = s2 > 0 && (s1 - s2) <= Math.max(CFG.HYBRID_ABS_GAP, CFG.HYBRID_REL_GAP * s1);

      var pv = pickVariation(winner, selected, selKey, opts.history, opts.exclude);
      var variation = pv.variation;
      if (opts.forceVariation) {
        var parts = String(opts.forceVariation).split(":");
        if (parts[0] === winner) {
          var forced = raw.results[winner].filter(function (v) { return String(v.variation_id) === parts[1]; })[0];
          if (forced) variation = forced;
        }
      }

      var vtags = variation.trigger_tags;
      var evidence = selected.filter(function (f) { return (f.weights[winner] || 0) > 0; })
        .map(function (f) {
          var ov = f.tags.some(function (t) { return vtags.indexOf(t) !== -1; }) ? 1 : 0;
          return { f: f, key: [-ov, -f.weights[winner], f.id] };
        })
        .sort(function (a, b) { return cmpTuple(a.key, b.key); })
        .map(function (x) { return x.f; });

      var evidenceLines = [];
      if (evidence.length) evidenceLines.push(fmt(pick(T.evidence_templates, "ev1"), { feature: evidence[0].text }));
      if (evidence.length > 1 && evidence[1].weights[winner] >= 5)
        evidenceLines.push(fmt(pick(T.evidence_second_templates, "ev2"), { feature: evidence[1].text }));

      var extra = null;
      if (isHybrid) {
        extra = { kind: "hybrid", text: fmt(pick(T.hybrid_templates, "hyb"), {
          winner: signs[winner].name, runner: signs[runner].name, p1: pcts[winner], p2: pcts[runner] }) };
      } else if ((pcts[runner] || 0) >= CFG.SECONDARY_MIN_PCT) {
        extra = { kind: "secondary", text: fmt(pick(T.secondary_templates, "sec"), {
          pct: pcts[runner], secondary: signs[runner].name, flavor: signs[runner].flavor }) };
      }
      var lines = evidenceLines.concat(extra ? [extra.text] : []);

      return {
        status: "ok",
        ids: ids,
        sign: winner,
        sign_name: signs[winner].name,
        emoji: signs[winner].emoji,
        element: signs[winner].element,
        archetype: variation.archetype,
        variation_id: variation.variation_id,
        variation_uid: winner + ":" + variation.variation_id,
        headline: signs[winner].emoji + " " + signs[winner].name + " — '" + variation.archetype + "'",
        body: variation.text,
        lines: lines,
        evidence: evidenceLines,
        extra: extra,
        tea: signs[winner].tea,
        confidence_label: confidenceLabel(pcts[winner]),
        confidence_pct: pcts[winner],
        mix: ranked.slice(0, 3).map(function (s) { return { sign: s, name: signs[s].name, emoji: signs[s].emoji, pct: pcts[s] }; }),
        closer: pick(T.closers, "close"),
        debug: { scores: ranked.reduce(function (o, s) { o[s] = stats[s].score; return o; }, {}),
                 decided_by: rk.decidedBy, hybrid: isHybrid, matched_tags: pv.matched }
      };
    }

    return { generate: generate, features: featureList, meta: raw.meta, templates: T };
  }

  return { createEngine: createEngine, stableHash: stableHash, sha256Hex: sha256Hex, SIGN_ORDER: SIGN_ORDER };
});
