#!/usr/bin/env python3
"""data/ klasöründeki JSON'ları tek bir site/data.js dosyasına paketler.

Metinleri ya da ağırlıkları değiştirdiğinde:
    python engine.py --validate     # tutarlılık kontrolü
    python build_site.py            # siteyi güncelle
"""
import json
import sys
from pathlib import Path

from engine import DATA_DIR, SIGN_ORDER, validate, load_data

SITE_DIR = Path(__file__).resolve().parent / "site"


def main() -> int:
    issues = validate(load_data())
    if issues:
        print("Veri setinde sorun var, site güncellenmedi:\n" + "\n".join(issues))
        return 1
    feats = json.loads((DATA_DIR / "features.json").read_text(encoding="utf-8"))
    bundle = {
        "meta": feats["meta"],
        "features": [{"id": f["id"], "text": f["text"], "tags": f["tags"], "weights": f["weights"]}
                     for f in feats["features"]],
        "templates": json.loads((DATA_DIR / "templates.json").read_text(encoding="utf-8")),
        "results": {s: json.loads((DATA_DIR / "results" / f"{s}.json").read_text(encoding="utf-8"))["variations"]
                    for s in SIGN_ORDER},
    }
    payload = json.dumps(bundle, ensure_ascii=False, separators=(",", ":"))
    out = SITE_DIR / "data.js"
    out.write_text("/* Otomatik üretildi: python build_site.py — elle düzenleme. */\n"
                   f"window.DEMLI_DATA={payload};\n", encoding="utf-8")
    print(f"Yazıldı: {out} ({out.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
