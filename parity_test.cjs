// Python motoru ile tarayıcı motorunun AYNI sonucu verdiğini doğrular.
// Kullanım: node parity_test.cjs  (önce: python build_site.py)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const vm = require("vm");

const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "site", "data.js"), "utf8"), ctx);
const Engine = require("./site/engine.js");
const engine = Engine.createEngine(ctx.window.DEMLI_DATA);

// 1) SHA-256 doğruluğu
for (const s of ["", "abc", "f_001,f_002|tpl|ev1", "Türkçe ğüşiöç ♏ ☕".repeat(9)]) {
  const ref = crypto.createHash("sha256").update(s, "utf8").digest("hex");
  if (Engine.sha256Hex(s) !== ref) { console.error("SHA-256 HATALI:", s); process.exit(1); }
}
console.log("SHA-256 ✔");

// 2) Rastgele seçim kümeleri üret (bazılarına history ekle)
const N = Number(process.argv[2] || 3000);
const ids = engine.features.map((f) => f.id);
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const cases = [];
for (let i = 0; i < N; i++) {
  const k = 3 + Math.floor(rnd() * 8);
  const pick = [...ids].sort(() => rnd() - 0.5).slice(0, k);
  const history = rnd() < 0.3 ? Engine.SIGN_ORDER.slice(0, 4).map((s, j) => `${s}:${1 + ((i + j) % 10)}`) : [];
  cases.push({ ids: pick, history });
}
const tmp = path.join(require("os").tmpdir(), `parity_${process.pid}.json`);
fs.writeFileSync(tmp, JSON.stringify(cases));

const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(__dirname)})
from engine import load_data, generate_result
d = load_data()
out = []
for c in json.load(open(${JSON.stringify(tmp)}, encoding="utf-8")):
    r = generate_result(c["ids"], d, c["history"])
    out.append({k: r.get(k) for k in ("sign", "variation_uid", "body", "lines", "closer", "confidence")})
sys.stdout.reconfigure(encoding="utf-8")
print(json.dumps(out, ensure_ascii=False))
`;
const pyOut = JSON.parse(execFileSync("python", ["-I", "-c", py], { encoding: "utf8", maxBuffer: 1 << 28 }));
fs.unlinkSync(tmp);

let bad = 0;
cases.forEach((c, i) => {
  const j = engine.generate(c.ids, { history: c.history });
  const p = pyOut[i];
  const jsConf = j.confidence_label ? `${j.confidence_label} (%${j.confidence_pct})` : undefined;
  const same = (j.sign ?? null) === (p.sign ?? null) && (j.variation_uid ?? null) === (p.variation_uid ?? null) &&
    j.body === p.body && JSON.stringify(j.lines) === JSON.stringify(p.lines) &&
    (j.closer ?? null) === (p.closer ?? null) && (jsConf ?? null) === (p.confidence ?? null);
  if (!same && bad++ < 5) console.error("FARK:", c.ids.join(","), { js: j.variation_uid, py: p.variation_uid });
});
console.log(bad ? `❌ ${bad}/${N} vakada fark var` : `Python ↔ JS: ${N}/${N} vaka birebir aynı ✔`);
process.exit(bad ? 1 : 0);
