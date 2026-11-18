# Demli Burç

Komik özellikleri seç, burcunu tahmin etsin ve seni tiye alsın. 50 özellik, 12 burç, 120 roast.

Tamamen statik bir site: sunucu, veritabanı ya da API anahtarı gerekmiyor. Tüm hesaplama ziyaretçinin tarayıcısında yapılıyor ve hiçbir veri dışarı gönderilmiyor.

## Klasör yapısı

```
burc-roast/
├── site/                  ← YAYINA ALINACAK KLASÖR (sadece bu)
│   ├── index.html
│   ├── style.css
│   ├── app.js             arayüz
│   ├── engine.js          skorlama motoru (engine.py'nin birebir kopyası)
│   ├── data.js            otomatik üretilir — elle düzenleme
│   ├── og-image.png       WhatsApp/Twitter önizleme görseli (1200x630)
│   ├── favicon.svg, icon-192.png, icon-512.png, site.webmanifest, robots.txt
├── data/                  içeriklerin kaynağı (burada düzenle)
│   ├── features.json      50 buton + ağırlıklar
│   ├── results/*.json     burç başına 10 roast
│   └── templates.json     kanıt / beraberlik / çay reçetesi metinleri
├── engine.py              Python motoru + doğrulama + simülasyon
├── build_site.py          data/ → site/data.js
└── parity_test.cjs        Python ve tarayıcı motoru aynı sonucu veriyor mu?
```

## Yayına alma (yaklaşık 10 dakika)

### 1. Domain adını yerleştir
`site/index.html` içinde `https://ALANADIN.com` geçen **3 yeri** kendi adresinle değiştir (canonical, og:url, og:image). Bunu yapmazsan WhatsApp'ta paylaşılan linklerde önizleme görseli çıkmaz.

### 2. Bir hostinge yükle (hepsinin ücretsiz planı var)

**Önerilen yol: GitHub Pages.** Repoda `.github/workflows/deploy.yml` hazır. Repo ayarlarında *Settings → Pages → Source: GitHub Actions* seçtikten sonra `main` dalına yapılan her push'ta veri doğrulanıyor, testler çalışıyor ve `site/` klasörü yayına çıkıyor. Adres `https://KULLANICIADIN.github.io/REPO-ADI/` oluyor; özel domain için Settings → Pages → Custom domain.

Alternatifler:

| Seçenek | Nasıl |
|---|---|
| **Netlify** (en kolayı) | app.netlify.com/drop → `site` klasörünü sürükle bırak. Bitti. |
| **Cloudflare Pages** | Dashboard → Workers & Pages → Create → Pages → "Upload assets" → `site` klasörü |
| **Vercel** | `site` klasöründe `npx vercel` ya da GitHub reposunu bağla, root = `site` |
| **GitHub Pages** | Repoya yükle, Settings → Pages → klasör olarak `site` (veya içeriği köke koy) |
| Klasik hosting (cPanel) | `site` içindeki dosyaları `public_html` klasörüne yükle |

### 3. Domaini bağla
Domaini herhangi bir firmadan al (Cloudflare, Namecheap, GoDaddy, yerli firmalar…). Sonra hosting panelinde **"Add custom domain"** de; sana söylediği DNS kaydını (genelde bir `CNAME` ya da `A` kaydı) domain firmasının DNS ayarlarına ekle. HTTPS sertifikası yukarıdaki platformların hepsinde otomatik geliyor.

> HTTPS önemli: "Linki kopyala" ve görsel paylaşımı tarayıcılarda yalnızca güvenli (https) sayfada tam çalışıyor.

## İçerik güncelleme

```bash
# 1) data/ altındaki JSON'ları düzenle
python engine.py --validate        # eksik tag, ulaşılamayan varyasyon var mı?
python engine.py --simulate 12000  # burç dağılımı ve 120 varyasyonun kapsaması
python build_site.py               # site/data.js'i yeniden üretir
node parity_test.cjs               # Python ve tarayıcı motoru aynı sonucu veriyor mu?
# 2) site/ klasörünü tekrar yükle
```

Yerelde denemek için:
```bash
python -m http.server 8000 --directory site
```

## Nasıl çalışıyor?

- **Paylaşılan link aynı sonucu açar:** Seçimler ve gösterilen roast URL'de duruyor (örneğin `#r=1.2.41.46.25&v=akrep-3&m=s`). Linki açan herkes birebir aynı kartı görüyor ve üstünde "Sen de dene" bandı çıkıyor.
- **Aynı seçim, aynı sonuç:** Rastgelelik yerine seçimlerin hash'i kullanılıyor, yani sayfayı yenilemek sonucu değiştirmiyor.
- **"Bu ben değilim, tekrar demle":** Aynı seçimlerle aynı burcun bir sonraki en uygun roast'u gösteriliyor ve 10'u da gezilebiliyor.
- **Geri gelen ziyaretçi:** Daha önce gördüğü roast'lar tarayıcısında (localStorage) hatırlanıyor ve bir dahaki sefere başka bir metin önceleniyor.
- **Story görseli:** 1080x1920 PNG. Telefonda doğrudan paylaşım menüsü açılıyor (Instagram'a gönderilebiliyor), masaüstünde dosya olarak iniyor.

## Analitik (isteğe bağlı)

`app.js` içindeki `track()` fonksiyonu `brew`, `share` ve `open_shared` olaylarını gönderiyor. Ziyaretçi sayısını görmek istersen `index.html`'in `<head>` bölümüne Plausible ya da Google Analytics kodunu eklemen yeterli; olaylar kendiliğinden gitmeye başlar.

> KVKK: Site şu an hiçbir veri ya da çerez toplamıyor. Google Analytics eklersen çerez onayı göstermen gerekir. Plausible gibi çerezsiz bir araç bu ihtiyacı ortadan kaldırır.

## Marka notu

Site nötr bir isimle ("Demli Burç") hazırlandı. Lipton ya da başka bir markanın adını veya logosunu kullanacaksan, yayına almadan önce marka sahibinden yazılı izin almalısın.
