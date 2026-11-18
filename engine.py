#!/usr/bin/env python3
"""
Burç Roast Motoru — "Akıllı Çay Bardağı" astroloji edisyonu.

Akış (ADIM 3):
  1) Seçilen özelliklerin burç ağırlıkları toplanır  -> burç skor tablosu
  2) Skorlar sıralanır, eşitlik olursa 4 kademeli tie-breaker + deterministik kura
  3) Kazanan burç için seçilen özelliklerin TAG'leri, o burca katkılarıyla
     ağırlıklandırılır ve 10 varyasyondan en iyi eşleşen roast seçilir
  4) Roast; kanıt cümlesi, yan burç / beraberlik satırı, çay reçetesi ve
     kapanışla birleştirilir (modüler metin = herkese farklı sonuç)

Kullanım:
  python engine.py f_001 f_002 f_041 f_046 f_025       # sonuç üret
  python engine.py f_001 f_002 f_041 --json            # API çıktısı (JSON)
  python engine.py f_001 ... --history akrep:1,akrep:4 # tekrar oynayana farklı varyasyon
  python engine.py --validate                          # veri seti tutarlılık kontrolü
  python engine.py --simulate 20000                    # denge ve kapsama simülasyonu
  python engine.py --export                            # tek parça data/results.json üret
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data"
SIGN_ORDER = ["koc", "boga", "ikizler", "yengec", "aslan", "basak",
              "terazi", "akrep", "yay", "oglak", "kova", "balik"]

# --- Ayar düğmeleri -------------------------------------------------------
HYBRID_ABS_GAP = 2        # 1. ile 2. arasındaki fark <= 2 puan ise "beraberlik" satırı
HYBRID_REL_GAP = 0.05     # ...ya da kazananın puanının %5'i kadar
SECONDARY_MIN_PCT = 20    # 2. burç ilk-3 içinde >= %20 ise "yan burç" satırı
HISTORY_PENALTY = 0.6     # daha önce gösterilen varyasyonun skoru bu katsayıyla çarpılır
LIFT_ALPHA = 0.8          # 0 = ham tag toplamı, 1 = tam "nadirlik" normalizasyonu
TIE_LEVELS = ["toplam puan", "kanıt genişliği", "en güçlü sinyal",
              "en az zıt sinyal", "deterministik kura"]


# =========================================================================
# Veri yükleme
# =========================================================================
def load_data(data_dir: Path = DATA_DIR) -> dict:
    feats = json.loads((data_dir / "features.json").read_text(encoding="utf-8"))
    templates = json.loads((data_dir / "templates.json").read_text(encoding="utf-8"))
    results = {}
    for sign in SIGN_ORDER:
        doc = json.loads((data_dir / "results" / f"{sign}.json").read_text(encoding="utf-8"))
        results[sign] = doc["variations"]
    return {
        "meta": feats["meta"],
        "tags": feats["tags"],
        "features": {f["id"]: f for f in feats["features"]},
        "templates": templates,
        "results": results,
    }


def stable_hash(*parts: str) -> int:
    """Aynı girdi -> aynı sayı. random() yerine bunu kullanıyoruz ki
    aynı seçimleri yapan kişi her yenilemede AYNI sonucu görsün (güven),
    farklı seçim yapan ise farklı sonuç görsün (kişiselleştirme)."""
    digest = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
    return int(digest[:12], 16)


def selection_key(ids) -> str:
    return ",".join(sorted(ids))


# =========================================================================
# 1) Burç skorlama
# =========================================================================
def score_signs(selected: list[dict]) -> dict:
    stats = {s: {"score": 0, "support": 0, "max_w": 0, "neg": 0} for s in SIGN_ORDER}
    for f in selected:
        for sign, w in f["weights"].items():
            st = stats[sign]
            st["score"] += w
            if w > 0:
                st["support"] += 1                 # kaç özellik bu burcu destekledi
                st["max_w"] = max(st["max_w"], w)  # en güçlü tekil sinyal
            else:
                st["neg"] += w                     # zıt sinyallerin toplamı (<= 0)
    return stats


# =========================================================================
# 2) Sıralama + tie-breaker
# =========================================================================
def rank_signs(stats: dict, sel_key: str):
    """Sıralama anahtarı (küçük olan önde):
       1. toplam puan            (yüksek iyi)
       2. kanıt genişliği        (daha çok özellik destekliyorsa iyi)
       3. en güçlü sinyal        (tek bir 10'luk, dağınık 4'lerden değerli)
       4. en az zıt sinyal       (negatif toplamı küçük olan iyi)
       5. deterministik kura     (seçim kümesinin hash'i — rastgele ama tekrarlanabilir)
    """
    def key(s):
        st = stats[s]
        return (-st["score"], -st["support"], -st["max_w"], -st["neg"],
                stable_hash(sel_key, s))

    ranked = sorted(SIGN_ORDER, key=key)
    k1, k2 = key(ranked[0]), key(ranked[1])
    decided_by = next(i for i in range(len(k1)) if k1[i] != k2[i])
    return ranked, TIE_LEVELS[decided_by]


def top_percentages(stats: dict, top: list[str]) -> dict:
    """İlk 3 burcun pozitif skorlarını %100'e normalize eder (largest remainder)."""
    pos = {s: max(stats[s]["score"], 0) for s in top}
    total = sum(pos.values())
    if total == 0:
        return {s: 0 for s in top}
    raw = {s: 100 * v / total for s, v in pos.items()}
    floored = {s: int(v) for s, v in raw.items()}
    rest = 100 - sum(floored.values())
    for s in sorted(top, key=lambda s: raw[s] - floored[s], reverse=True)[:rest]:
        floored[s] += 1
    return floored


# =========================================================================
# 3) Varyasyon (alt-arketip) seçimi
# =========================================================================
def relevance(w: int) -> float:
    """Bir özelliğin, kazanan burç için ne kadar 'karakteristik' olduğu.
    +10 -> 3.0 | +5 -> 2.0 | 0 veya negatif -> 0.5"""
    return 1 + w / 5 if w > 0 else 0.5


def tag_profile(selected: list[dict], sign: str) -> dict:
    """Her tag'e, onu taşıyan özelliğin KAZANAN BURCA katkısı kadar ağırlık verir.
    Böylece 'Akrep'i Akrep yapan' davranışlar metni belirler."""
    tw = defaultdict(float)
    for f in selected:
        r = relevance(f["weights"].get(sign, 0))
        for t in f["tags"]:
            tw[t] += r
    return tw


_PRIOR_CACHE: dict = {}


def tag_prior(data: dict, sign: str) -> dict:
    """Bir tag'in o burç için 'ne kadar sıradan' olduğu: o burca pozitif olan
    TÜM özelliklerdeki toplam relevance'ı. Akrep'te 'stalker' çok yaygın (3 özellik),
    'manipulatif' nadir. Nadir bir tag seçildiğinde daha çok şey söyler (TF-IDF mantığı)."""
    key = (id(data), sign)
    if key not in _PRIOR_CACHE:
        prior = defaultdict(float)
        for f in data["features"].values():
            w = f["weights"].get(sign, 0)
            if w > 0:
                for t in f["tags"]:
                    prior[t] += relevance(w)
        _PRIOR_CACHE[key] = prior
    return _PRIOR_CACHE[key]


def pick_variation(sign: str, selected: list[dict], data: dict,
                   sel_key: str, history=None):
    tw = tag_profile(selected, sign)
    prior = tag_prior(data, sign)
    seen = set(history or [])
    scored = []
    for v in data["results"][sign]:
        tags = v["trigger_tags"]
        matched = [t for t in tags if tw[t] > 0]
        # lift = seçimdeki ağırlık / burç içindeki yaygınlık^ALPHA  (nadir tag = daha ayırt edici)
        # sqrt(len) normalizasyonu: 3 tag'li varyasyon sırf çok tag'i var diye kazanmasın
        score = sum(tw[t] / max(prior[t], 1.0) ** LIFT_ALPHA for t in tags) / math.sqrt(len(tags))
        coverage = len(matched) / len(tags)
        if f"{sign}:{v['variation_id']}" in seen:
            score *= HISTORY_PENALTY
        # JS ile birebir aynı yuvarlama (Python round() banker's rounding yapar, JS yapmaz)
        scored.append({"v": v, "score": math.floor(score * 10000 + 0.5) / 10000, "coverage": coverage,
                       "matched": matched})

    scored.sort(key=lambda x: (-x["score"], -x["coverage"],
                               stable_hash(sel_key, sign, str(x["v"]["variation_id"]))))
    best = scored[0]
    if best["score"] == 0:  # hiç tag eşleşmedi -> deterministik ama görülmemiş bir varyasyon
        pool = [x for x in scored if f"{sign}:{x['v']['variation_id']}" not in seen] or scored
        best = pool[stable_hash(sel_key, sign, "fallback") % len(pool)]
    debug = [{"id": x["v"]["variation_id"], "archetype": x["v"]["archetype"],
              "score": x["score"], "coverage": round(x["coverage"], 2)} for x in scored[:3]]
    return best["v"], best["matched"], debug


# =========================================================================
# 4) Kompozisyon
# =========================================================================
def confidence_label(pct: int, labels: list[dict]) -> str:
    for item in labels:
        if pct >= item["min"]:
            return item["label"]
    return labels[-1]["label"]


def generate_result(selected_ids, data: dict | None = None, history=None) -> dict:
    data = data or load_data()
    T = data["templates"]
    meta = data["meta"]["selection"]

    ids = list(dict.fromkeys(selected_ids))  # tekrarları at, sırayı koru
    unknown = [i for i in ids if i not in data["features"]]
    if unknown:
        return {"status": "error", "message": f"Bilinmeyen özellik id: {', '.join(unknown)}"}
    if len(ids) < meta["min"]:
        return {"status": "too_few",
                "message": T["too_few_message"].format(min=meta["min"],
                                                       recommended=meta["recommended"])}
    ids = sorted(ids[: meta["max"]])  # sıralı: tıklama sırası sonucu (float toplamlarını) değiştirmesin
    selected = [data["features"][i] for i in ids]
    sel_key = selection_key(ids)

    def pick(options: list, slot: str):
        """Şablon seçimi: hash tabanlı, JS ile birebir aynı (random.Random JS'te yok)."""
        return options[stable_hash(sel_key, "tpl", slot) % len(options)]

    stats = score_signs(selected)
    ranked, decided_by = rank_signs(stats, sel_key)
    winner, runner = ranked[0], ranked[1]
    signs = T["signs"]

    if stats[winner]["score"] <= 0:
        nr = T["no_sign_result"]
        return {"status": "ok", "sign": None, "sign_name": "Burçsuz",
                "archetype": nr["archetype"], "headline": f"🌌 Burçsuz — '{nr['archetype']}'",
                "body": nr["text"], "lines": [], "debug": {"scores": {s: stats[s]["score"] for s in SIGN_ORDER}}}

    pcts = top_percentages(stats, ranked[:3])
    s1, s2 = stats[winner]["score"], stats[runner]["score"]
    is_hybrid = s2 > 0 and (s1 - s2) <= max(HYBRID_ABS_GAP, HYBRID_REL_GAP * s1)

    variation, matched_tags, var_debug = pick_variation(winner, selected, data, sel_key, history)

    # Kanıt satırları: kullanıcının KENDİ cümleleri. Önce seçilen roast'un tag'leriyle
    # örtüşen özellikler (metin ile kanıt aynı hikâyeyi anlatsın), sonra en yüksek ağırlık.
    vtags = set(variation["trigger_tags"])
    evidence_feats = sorted((f for f in selected if f["weights"].get(winner, 0) > 0),
                            key=lambda f: (-bool(vtags & set(f["tags"])),
                                           -f["weights"][winner], f["id"]))
    lines = []
    if evidence_feats:
        lines.append(pick(T["evidence_templates"], "ev1").format(feature=evidence_feats[0]["text"]))
    if len(evidence_feats) > 1 and evidence_feats[1]["weights"][winner] >= 5:
        lines.append(pick(T["evidence_second_templates"], "ev2").format(feature=evidence_feats[1]["text"]))

    if is_hybrid:
        lines.append(pick(T["hybrid_templates"], "hyb").format(
            winner=signs[winner]["name"], runner=signs[runner]["name"],
            p1=pcts[winner], p2=pcts[runner]))
    elif pcts.get(runner, 0) >= SECONDARY_MIN_PCT:
        lines.append(pick(T["secondary_templates"], "sec").format(
            pct=pcts[runner], secondary=signs[runner]["name"], flavor=signs[runner]["flavor"]))

    return {
        "status": "ok",
        "sign": winner,
        "sign_name": signs[winner]["name"],
        "emoji": signs[winner]["emoji"],
        "archetype": variation["archetype"],
        "variation_id": variation["variation_id"],
        "variation_uid": f"{winner}:{variation['variation_id']}",
        "headline": f"{signs[winner]['emoji']} {signs[winner]['name']} — '{variation['archetype']}'",
        "body": variation["text"],
        "lines": lines,
        "tea": f"☕ Çay reçeten: {signs[winner]['tea']}",
        "confidence": f"{confidence_label(pcts[winner], T['confidence_labels'])} (%{pcts[winner]})",
        "mix": [{"sign": s, "name": signs[s]["name"], "pct": pcts[s]} for s in ranked[:3]],
        "closer": pick(T["closers"], "close"),
        "debug": {
            "scores": {s: stats[s]["score"] for s in ranked},
            "decided_by": decided_by,
            "hybrid": is_hybrid,
            "matched_tags": matched_tags,
            "variation_ranking": var_debug,
        },
    }


def render_text(res: dict) -> str:
    if res["status"] != "ok":
        return res["message"]
    out = [res["headline"], "", res["body"], ""]
    out += res["lines"]
    if res.get("tea"):
        mix = " · ".join(f"{m['name']} %{m['pct']}" for m in res["mix"])
        out += ["", res["tea"], f"{res['confidence']}  |  Karışım: {mix}", "", res["closer"]]
    return "\n".join(out)


# =========================================================================
# Doğrulama & simülasyon
# =========================================================================
def validate(data: dict) -> list[str]:
    issues = []
    vocab = set(data["tags"])
    for f in data["features"].values():
        for t in f["tags"]:
            if t not in vocab:
                issues.append(f"{f['id']}: tanımsız tag '{t}'")
        for s in f["weights"]:
            if s not in SIGN_ORDER:
                issues.append(f"{f['id']}: tanımsız burç '{s}'")
        if max(f["weights"].values()) < 8:
            issues.append(f"{f['id']}: belirgin bir ana burcu yok (max < 8)")
    for sign, vars_ in data["results"].items():
        if len(vars_) < 10:
            issues.append(f"{sign}: {len(vars_)} varyasyon var (min 10)")
        ids = [v["variation_id"] for v in vars_]
        if len(ids) != len(set(ids)):
            issues.append(f"{sign}: tekrar eden variation_id")
        for v in vars_:
            for t in v["trigger_tags"]:
                if t not in vocab:
                    issues.append(f"{sign}#{v['variation_id']}: tanımsız tag '{t}'")
            reachable = any(t in f["tags"] and f["weights"].get(sign, 0) > 0
                            for t in v["trigger_tags"] for f in data["features"].values())
            if not reachable:
                issues.append(f"{sign}#{v['variation_id']}: hiçbir pozitif özellik bu tag'lere ulaşmıyor")
    return issues


def primary_balance(data: dict) -> Counter:
    c = Counter()
    for f in data["features"].values():
        c[max(f["weights"], key=f["weights"].get)] += 1
    return c


def simulate(data: dict, n: int, seed: int = 42) -> None:
    rng = random.Random(seed)
    feats = list(data["features"].values())
    names = {s: data["templates"]["signs"][s]["name"] for s in SIGN_ORDER}

    # A) Tamamen rastgele tıklayan kullanıcı -> burç dağılımı dengeli mi?
    winners, levels, hybrid = Counter(), Counter(), 0
    for _ in range(n):
        pick = rng.sample(feats, rng.choice([5, 6]))
        r = generate_result([f["id"] for f in pick], data)
        winners[r["sign"]] += 1
        levels[r["debug"]["decided_by"]] += 1
        hybrid += r["debug"].get("hybrid", False)
    print(f"\n[A] Rastgele {n} kullanıcı (5-6 seçim) — kazanan burç dağılımı (ideal ≈ %{100/12:.1f}):")
    for s in SIGN_ORDER:
        print(f"   {names[s]:<8} %{100*winners[s]/n:5.1f}  " + "█" * round(200 * winners[s] / n / 4))
    print("   Kararı veren kademe: " + ", ".join(f"{k}: %{100*v/n:.1f}" for k, v in levels.most_common()))
    print(f"   Beraberlik satırı gösterilen: %{100*hybrid/n:.1f}")

    # B) Persona simülasyonu: kullanıcı bir burca benziyor ama gürültülü seçiyor
    print(f"\n[B] Persona simülasyonu — her burç için {n//12} kişi (benzer özellikleri seçme olasılığı yüksek):")
    total_vars, hit_vars = 0, 0
    for s in SIGN_ORDER:
        weights = [max(f["weights"].get(s, 0), 0) ** 2 + 2 for f in feats]
        hits, var_hits = 0, Counter()
        for _ in range(n // 12):
            pick = set()
            while len(pick) < rng.choice([5, 6]):
                pick.add(rng.choices(feats, weights)[0]["id"])
            r = generate_result(list(pick), data)
            if r["sign"] == s:
                hits += 1
                var_hits[r["variation_id"]] += 1
        n_vars = len(data["results"][s])
        total_vars += n_vars
        hit_vars += len(var_hits)
        missing = [v["variation_id"] for v in data["results"][s] if v["variation_id"] not in var_hits]
        spread = " ".join(f"{vid}:{var_hits[vid]}" for vid in sorted(var_hits))
        print(f"   {names[s]:<8} doğru tahmin %{100*hits/(n//12):5.1f} | "
              f"tetiklenen varyasyon {len(var_hits)}/{n_vars}"
              + (f" | hiç çıkmayan: {missing}" if missing else "") + f"\n            dağılım → {spread}")
    print(f"\n   Toplam varyasyon kapsaması: {hit_vars}/{total_vars}")


def export(data: dict) -> Path:
    out = DATA_DIR / "results.json"
    out.write_text(json.dumps({"results": data["results"]}, ensure_ascii=False, indent=2),
                   encoding="utf-8")
    return out


# =========================================================================
def main(argv=None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="Burç Roast Motoru")
    ap.add_argument("ids", nargs="*", help="seçilen özellik id'leri (f_001 ...)")
    ap.add_argument("--json", action="store_true", help="sonucu JSON olarak yaz")
    ap.add_argument("--history", default="", help="daha önce gösterilen varyasyonlar: akrep:1,akrep:4")
    ap.add_argument("--validate", action="store_true")
    ap.add_argument("--simulate", type=int, metavar="N")
    ap.add_argument("--export", action="store_true")
    args = ap.parse_args(argv)

    data = load_data()
    if args.validate:
        issues = validate(data)
        bal = primary_balance(data)
        print(f"{len(data['features'])} özellik, {sum(len(v) for v in data['results'].values())} varyasyon, "
              f"{len(data['tags'])} tag")
        print("Ana burç dağılımı: " + ", ".join(f"{s}:{bal[s]}" for s in SIGN_ORDER))
        print("Sorun yok ✔" if not issues else "\n".join(issues))
        return 1 if issues else 0
    if args.simulate:
        simulate(data, args.simulate)
        return 0
    if args.export:
        print(f"Yazıldı: {export(data)}")
        return 0
    if not args.ids:
        ap.print_help()
        return 0
    history = [h for h in args.history.split(",") if h]
    res = generate_result(args.ids, data, history)
    print(json.dumps(res, ensure_ascii=False, indent=2) if args.json else render_text(res))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
