# GLYDE

**GoLive Logistics, Yard & Dispatch Engine**: Satıştan gelen siparişin depoda hazırlanmasından müşteriye teslimine kadar olan süreci tek ekrandan yöneten, rol bazlı sipariş ve sevkiyat takip sistemi.

## Özellikler

- **Sipariş akışı:** Alındı → Hazırlanıyor → Depoda Bekliyor → Yüklendi → Sevkiyatta → Teslim Edildi; yükleme öncesinde gerekçeli iptal.
- **Rol bazlı yetkiler:** Kurallar hem arayüzde hem API'de uygulanır. Pasife alınan ya da rolü değişen kullanıcının oturumu anında kapanır.
- **Görev sahipliği:** Her sipariş sıradaki işi yapacak rolün ekranında "Sizde" olarak görünür. Araç atanmamış bir sipariş Lojistik'in işidir.
- **Bildirimler:** Yeni görev ataması, süre uyarısı (limitin %80'i), gecikme ve varış bildirimleri sesli uyarıyla gelir; her rol yalnızca kendi işini görür.
- **Canlı takip:** OpenStreetMap üzerinde gerçek karayolu rotaları ve simülasyonla ilerleyen araçlar gösterilir.
- **Filo ve şoför:** Araçlar şirkete, şoförler personele aittir. Lojistik siparişe araç ve şoför atar; şoför boş bırakılırsa müsait olan otomatik atanır. Bir araç ya da şoför aynı anda tek sevkiyatta olabilir.
- **Şoför ekranı:** Şoför kendi görevini tam ekran haritada görür, yola çıkışı işaretler ve teslimde teslim alan kişiyi kaydeder.
- **GLYDE Asistan:** Kullanıcının yetkileriyle sorgu yapar ve işlem yürütür: sipariş açma, araç ve şoför atama, aşama ilerletme, bekleyen işleri toplu tamamlama, iptal; yönetici için personel, araç ve müşteri yönetimi. Eksik bilgi olduğunda seçenekleri listeleyip sorar, verilen cevabı önceki mesajla birleştirir. `ANTHROPIC_API_KEY` tanımlıysa yapay zekâ ile serbest sohbet eder, tanımlı değilse Türkçe komutları kendisi yorumlar.
- **Yönetim paneli:** Personel, araç–şoför eşleşmesi ve müşteri yönetimi; geçmişte kullanılan kayıtlar silinmez, pasife alınır.
- **Tema:** Başlıktaki butonla açık/koyu arasında geçilir; ilk açılışta işletim sisteminin tercihi kullanılır.
- **Dışa aktarma:** Sipariş listesi, uygulanan filtrelerle birlikte CSV olarak indirilebilir.

## Roller

| Rol | Ekranlar | İşlemler |
|---|---|---|
| Yönetici | Tümü | Tüm işlemler, yönetim paneli |
| Satış | Dashboard, Siparişler, Canlı Takip | Sipariş oluşturma ve iptal |
| Depo | Dashboard, Siparişler | Hazırlık ve yükleme |
| Lojistik | Dashboard, Siparişler, Canlı Takip | Araç ve şoför atama, sevkiyat, teslim |
| Şoför | Görevlerim | Yola çıkış ve teslim (yalnızca kendi aracı) |

## Süre kuralları

- **Aşama limitleri:** Alındı 30 dk, Hazırlanıyor 2 sa, Depoda Bekliyor 1 sa, Yüklendi 1 sa.
- **Yol süresi:** OSRM süresi × 1,3 (kamyon katsayısı). Sevkiyat limiti, yol süresi + 30 dk teslim toleransıdır.
- **Simülasyon:** Araç, yolu `SIMULATION_SPEED` kat hızlı tamamlar. Ekranda görünen süreler gerçek yol süresi ölçeğindedir; örneğin 30x hızda 51 dakikalık yol yaklaşık 1 dakika 40 saniyede biter.

## Teknolojiler

| Katman | Teknoloji |
|---|---|
| Arayüz | React, Vite, Tailwind CSS, React Router, Leaflet |
| Sunucu | Node.js, Express 5, JWT, bcrypt |
| Veritabanı | PostgreSQL 16 (Docker) |
| Rota ve harita | OSRM, OpenStreetMap |

## Kurulum

```bash
docker compose up --build -d
```

Uygulama: http://localhost:8080

## Ortam değişkenleri (`docker-compose.yml`)

| Değişken | Açıklama |
|---|---|
| `DATABASE_URL` | PostgreSQL bağlantı adresi |
| `JWT_SECRET` | Oturum imzalama anahtarı |
| `SIMULATION_SPEED` | Yeni sevkiyatların hız çarpanı. `30` ile 30 dakikalık yol 1 dakikada biter, `1` gerçek süredir |
| `ANTHROPIC_API_KEY` | İsteğe bağlı. Tanımlanırsa asistan yapay zekâ modunda çalışır (proje kökündeki `.env` dosyasına yazılır) |
| `RESET_DATA_ON_START` | `true` ise örnek veriler her açılışta güncel saatle yeniden yüklenir |
| `OSRM_URL` | Rota servisi adresi |

## Hesaplar (şifre: `123456`)

| Rol | E-posta |
|---|---|
| Yönetici | admin@glyde.app |
| Satış | satis@glyde.app |
| Depo | depo@glyde.app |
| Lojistik | lojistik@glyde.app |
| Şoför | sofor1@glyde.app … sofor8@glyde.app |

## Test

Uygulama yeni açıldıktan hemen sonra çalıştırılır:

```bash
node tests/smoke.mjs
```

Yönetim panelinden eklenen personelin e-postası rolüne göre otomatik verilir (ör. `depo2@glyde.app`); şifre alanı boş bırakılırsa varsayılan şifre `123456` olur.

## Mimari notları

- **İş kuralları:** Aşama sırası, süre limitleri ve rol yetkileri `server/src/config/statuses.js` dosyasında tanımlıdır.
- **Tek iş katmanı:** Tüm sipariş işlemleri `server/src/services/orders.js` içindedir. API ve asistan aynı kuralları kullanır.
- **Durum değişiklikleri:** Transaction ve satır kilidi (`FOR UPDATE`) ile yapılır. Her değişiklik `order_events` tablosuna yazılır.
- **Araç konumu:** Yola çıkış zamanı ve planlanan yol süresinden hesaplanır. Gerçek GPS entegrasyonu için tek değişmesi gereken nokta konum kaynağıdır.

> Tüm veriler örnek amaçlıdır; gerçek müşteri, araç veya kişi bilgisi içermez.
