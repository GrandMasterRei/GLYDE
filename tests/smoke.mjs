// GLYDE uçtan uca API testi.
// Temiz açılıştan hemen sonra çalıştırın: node tests/smoke.mjs
// (Test veri değiştirir; sonrasında "docker compose restart server" ile veriler tazelenir.)
const B = process.env.API_URL || 'http://localhost:4000/api';
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++; };
const section = (t) => console.log(`\n— ${t}`);

async function call(token, path, method = 'GET', body) {
  const r = await fetch(B + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
const login = async (e, p = '123456') => (await call(null, '/auth/login', 'POST', { email: e, password: p })).data.token;
const idOf = async (t, no) => (await call(t, `/orders?q=${no}`)).data.find((o) => o.order_no === no)?.id;
const ask = async (t, text, history = []) =>
  (await call(t, '/assistant', 'POST', { messages: [...history, { role: 'user', content: text }] })).data;

section('Giriş ve yetkiler');
const T = {
  ADMIN: await login('admin@glyde.app'), SATIS: await login('satis@glyde.app'),
  DEPO: await login('depo@glyde.app'), LOJISTIK: await login('lojistik@glyde.app'),
  SOFOR: await login('sofor1@glyde.app'),
};
ok(Object.values(T).every(Boolean), 'beş rol giriş yapabiliyor');
ok((await call(null, '/auth/login', 'POST', { email: 'admin@glyde.app', password: 'x' })).status === 401, 'yanlış şifre reddedildi');
ok((await call(null, '/orders')).status === 401, 'oturumsuz istek reddedildi');

const access = {
  '/dashboard': ['ADMIN', 'SATIS', 'DEPO', 'LOJISTIK'],
  '/tracking': ['ADMIN', 'SATIS', 'LOJISTIK'],
  '/admin/users': ['ADMIN'],
};
for (const [role, t] of Object.entries(T)) {
  for (const path of ['/auth/me', '/meta', '/orders', '/alerts', '/assistant']) {
    ok((await call(t, path)).status === 200, `${role} ${path}`);
  }
  for (const [path, roles] of Object.entries(access)) {
    const expected = roles.includes(role) ? 200 : 403;
    ok((await call(t, path)).status === expected, `${role} ${path} → ${expected}`);
  }
}

section('Veriler');
const meta = (await call(T.SATIS, '/meta')).data;
ok(meta.customers.length === 15 && meta.vehicles.length === 8 && meta.destinations.length === 10, 'meta listeleri dolu');
ok(meta.drivers.length === 8 && meta.vehicles.every((v) => !v.driver_name), 'araçlar şoförsüz, şoförler ayrı listede');
const dash = (await call(T.ADMIN, '/dashboard')).data;
ok(dash.total === 13 && dash.inTransit === 3, `dashboard: ${dash.total} sipariş, ${dash.inTransit} yolda`);
const tr = (await call(T.ADMIN, '/tracking')).data;
ok(tr.shipments.length === 5 && tr.shipments.every((s) => s.route?.length > 1), 'takipte 5 araç ve rotaları var');
const gl5 = tr.shipments.find((s) => s.order_no === 'GL-005');
ok(gl5.route_minutes === 330 && gl5.remaining_minutes > 200, `GL-005 yol süresi ${gl5.route_minutes} dk, kalan ${Math.round(gl5.remaining_minutes)} dk`);

section('Görev sahipliği');
const gl6 = (await call(T.LOJISTIK, '/orders?q=GL-006')).data[0];
ok(gl6.is_my_task === true, 'araçsız bekleyen sipariş Lojistik\'in işi');
ok((await call(T.DEPO, '/orders?q=GL-006')).data[0].is_my_task === false, 'aynı sipariş Depo\'nun işi değil');
const driverOrders = (await call(T.SOFOR, '/orders')).data;
ok(driverOrders.length === 2 && driverOrders.every((o) => o.plate === '34 GLY 101'), 'şoför yalnızca kendi siparişlerini görüyor');
ok((await call(T.SOFOR, `/orders/${gl6.id}`)).status === 404, 'şoför başkasının siparişini açamaz');

const driverAlerts = (await call(T.SOFOR, '/alerts')).data;
ok(driverAlerts.some((a) => a.level === 'task' && a.order_no === 'GL-008'), 'şoföre "yük hazır" bildirimi var');

section('Uçtan uca sevkiyat');
const c = await call(T.SATIS, '/orders', 'POST', { customer_id: 7, warehouse: 'Kocaeli Depo', note: 'Test notu' });
ok(c.status === 201 && c.data.order_no === 'GL-014', `sipariş oluştu (${c.data.order_no}), nokta müşteriden geldi`);
const u = `/orders/${c.data.id}`;
ok((await call(T.SATIS, u + '/advance', 'PATCH')).status === 403, 'satış ilerletemez');
ok((await call(T.DEPO, u + '/advance', 'PATCH')).data.status === 'HAZIRLANIYOR', 'depo: hazırlanıyor');
ok((await call(T.DEPO, u + '/advance', 'PATCH')).data.status === 'DEPODA_BEKLIYOR', 'depo: depoda bekliyor');
ok((await call(T.DEPO, u + '/advance', 'PATCH')).status === 400, 'araçsız yükleme engellendi');
ok((await call(T.LOJISTIK, u + '/vehicle', 'PATCH', { vehicle_id: 1 })).status === 409, 'meşgul araç atanamaz');
const busyDriver = (await call(T.ADMIN, '/meta')).data.drivers.find((d) => d.busy_order_no);
ok((await call(T.LOJISTIK, u + '/vehicle', 'PATCH', { vehicle_id: 8, driver_id: busyDriver.id })).status === 409, 'meşgul şoför atanamaz');
const assigned = await call(T.LOJISTIK, u + '/vehicle', 'PATCH', { vehicle_id: 8 });
ok(assigned.status === 200 && assigned.data.driver_name, `araç atandı, müsait şoför otomatik seçildi (${assigned.data.driver_name})`);
ok((await call(T.DEPO, u + '/advance', 'PATCH')).data.status === 'YUKLENDI', 'depo: yüklendi');
ok((await call(T.SOFOR, u + '/advance', 'PATCH')).status === 403, 'başka aracın şoförü işlem yapamaz');
ok((await call(T.LOJISTIK, u + '/advance', 'PATCH')).data.status === 'SEVKIYATTA', 'lojistik: sevkiyatta');
const d = (await call(T.LOJISTIK, u)).data;
ok(d.transit_minutes >= 0.5 && d.note === 'Test notu' && d.events.length === 5, `simüle süre ${d.transit_minutes} dk, yol ${d.route_minutes} dk`);
ok((await call(T.ADMIN, u + '/advance', 'PATCH')).status === 409, 'varmadan teslim engellendi');

section('Şoför');
const gl8 = await idOf(T.SOFOR, 'GL-008');
const gl3 = await idOf(T.ADMIN, 'GL-003');
ok((await call(T.SOFOR, `/orders/${gl3}/advance`, 'PATCH')).status === 403, 'şoför başka aracın siparişini ilerletemez');
ok((await call(T.SOFOR, `/orders/${gl8}/advance`, 'PATCH')).data.status === 'SEVKIYATTA', 'şoför kendi aracıyla yola çıktı');
const gl4 = await idOf(T.ADMIN, 'GL-004');
const del = await call(T.LOJISTIK, `/orders/${gl4}/advance`, 'PATCH', { note: 'Teslim alan: Ayşe Hanım' });
ok(del.data.status === 'TESLIM_EDILDI', 'varan araç teslim alındı');
const ev = (await call(T.ADMIN, `/orders/${gl4}`)).data.events.at(-1);
ok(ev.note === 'Teslim alan: Ayşe Hanım', 'teslim alan kişi kaydedildi');

section('İptal');
const gl12 = await idOf(T.ADMIN, 'GL-012');
ok((await call(T.DEPO, `/orders/${gl12}/cancel`, 'PATCH', { reason: 'x' })).status === 403, 'depo iptal edemez');
ok((await call(T.SATIS, `/orders/${gl12}/cancel`, 'PATCH', {})).status === 400, 'gerekçesiz iptal reddedildi');
ok((await call(T.SATIS, `/orders/${gl12}/cancel`, 'PATCH', { reason: 'Müşteri vazgeçti' })).data.status === 'IPTAL', 'sipariş iptal edildi');
ok((await call(T.SATIS, `/orders/${gl3}/cancel`, 'PATCH', { reason: 'x' })).status === 400, 'yüklenmiş sipariş iptal edilemez');
ok((await call(T.DEPO, `/orders/${gl12}/advance`, 'PATCH')).status === 400, 'iptal edilen ilerletilemez');
const dash2 = (await call(T.ADMIN, '/dashboard')).data;
ok(dash2.cancelled === 1 && dash2.total === 13, 'iptal dashboard sayılarından ayrıldı');

section('Bildirimler');
const lojAlerts = (await call(T.LOJISTIK, '/alerts')).data;
ok(lojAlerts.some((a) => a.level === 'task' && a.order_no === 'GL-010'), 'lojistik: araç atanacak sipariş görev olarak geldi');
const depoAlerts = (await call(T.DEPO, '/alerts')).data;
ok(depoAlerts.some((a) => a.order_no === 'GL-007' && a.level === 'danger'), 'depo: GL-007 gecikme bildirimi');
ok(!depoAlerts.some((a) => a.order_no === 'GL-006'), 'depo: araç bekleyen GL-006 bildirimi yok');
ok((await call(T.LOJISTIK, '/alerts')).data.some((a) => a.order_no === 'GL-006'), 'lojistik: GL-006 bildirimi var');

section('Asistan');
const info = (await call(T.LOJISTIK, '/assistant')).data;
ok(['basic', 'ai'].includes(info.mode), `asistan modu: ${info.mode}`);
const a1 = await ask(T.ADMIN, 'Günün özeti');
ok(/Aktif sipariş|aktif/i.test(a1.reply), 'özet yanıtı');
const a2 = await ask(T.DEPO, 'GL-006 için 34 GLY 102 ata');
ok(a2.changed === false, 'depo asistanla araç atayamaz');
// Eksik bilgi: önce sorar, sonra cevabı bağlamla birleştirir
const q1 = await ask(T.LOJISTIK, 'GL-006 için araç ata');
ok(!q1.changed && /hangi aracı/i.test(q1.reply), 'araç belirtilmeyince seçenekleri sorar');
const q2 = await ask(T.LOJISTIK, '34 GLY 102', [
  { role: 'user', content: 'GL-006 için araç ata' }, { role: 'assistant', content: q1.reply },
]);
ok(q2.changed === true && /GL-006/.test(q2.reply), 'plaka yanıtıyla atama tamamlandı');
const q3 = await ask(T.LOJISTIK, 'GL-010 için 34 GLY 104 ata');
ok(q3.changed === true && /şoför/i.test(q3.reply), 'araç atanınca şoför de bildirildi');
// Türkçe karakter olmadan ve eksik bilgiyle
const s1 = await ask(T.ADMIN, 'sofor ekle');
ok(!s1.changed && /adını yazın/i.test(s1.reply), '"sofor ekle" yazımı anlaşıldı ve ad soruldu');
const s2 = await ask(T.ADMIN, 'ahmet yildiz', [
  { role: 'user', content: 'sofor ekle' }, { role: 'assistant', content: s1.reply },
]);
ok(s2.changed && /Ahmet Yildiz/.test(s2.reply), 'verilen adla personel eklendi');
const s3 = await ask(T.DEPO, 'teslim et');
ok(!s3.changed && /(hangi siparişi|ilerletilebilecek iş yok)/i.test(s3.reply), 'eksik komutta iş uydurulmuyor');
const q4 = await ask(T.DEPO, 'bekleyen işleri tamamla');
ok(q4.changed === true && /ilerletildi/.test(q4.reply), 'depo bekleyen işlerini toplu tamamladı');
ok(/GL-\d{3} → /.test(q4.reply), 'toplu işlem sonucunda sipariş durumları listelendi');
const q5 = await ask(T.ADMIN, 'bekleyen işleri tamamla');
ok(q5.changed === true, 'yönetici tüm bekleyen işleri ilerletti');
const a4 = await ask(T.SATIS, 'Atlas Mobilya için İzmir deposundan yeni sipariş');
ok(a4.changed === true && /GL-015/.test(a4.reply), `satış asistanla sipariş açtı`);
const a5 = await ask(T.SOFOR, 'Görevlerim');
ok(/GL-008/.test(a5.reply), 'şoför görevlerini gördü');
const a6 = await ask(T.DEPO, 'GL-007 detay');
ok(/GL-007/.test(a6.reply) && a6.changed === false, 'sipariş detayı');

section('Pilot yönetim komutları');
const p1 = await ask(T.ADMIN, 'Şoför ekle: ahmet kaya');
ok(p1.changed && /sofor\d+@glyde\.app/.test(p1.reply), `şoför eklendi → ${p1.reply.split('\n')[1]}`);
const p2 = await ask(T.ADMIN, 'Araç ekle 34 XYZ 99 Ford Transit');
ok(p2.changed, 'araç şoförüyle eklendi');
const p3 = await ask(T.ADMIN, 'Müşteri ekle: Demir Lojistik, Gebze OSB');
ok(p3.changed, 'müşteri eklendi');
const p4 = await ask(T.ADMIN, "Demir Lojistik'i pasife al");
ok(p4.changed && /pasife alındı/.test(p4.reply), 'müşteri pasife alındı');
const p5 = await ask(T.ADMIN, 'Personel listesi');
ok(/Ahmet Kaya · Şoför/.test(p5.reply), 'personel listesinde yeni şoför görünüyor');
const p6 = await ask(T.DEPO, 'Şoför ekle: Deneme Kişi');
ok(!p6.changed, 'depo personel ekleyemez');
ok((await call(T.SATIS, '/admin/users/suggest-email?role=SATIS')).status === 403, 'e-posta önerisi yalnızca yönetici için');
ok((await call(T.ADMIN, '/admin/users/suggest-email?role=DEPO')).data.email === 'depo2@glyde.app', 'sıradaki depo e-postası depo2');

section('Yönetim');
const nu = await call(T.ADMIN, '/admin/users', 'POST', { name: 'Yeni Şoför', role: 'SOFOR' });
ok(nu.status === 201 && /^sofor\d+@glyde\.app$/.test(nu.data.email) && nu.data.default_password, `e-posta otomatik (${nu.data.email}), varsayılan şifre`);
const nv = await call(T.ADMIN, '/admin/vehicles', 'POST', { plate: '06 abc 1', model: 'Test Kamyon' });
ok(nv.status === 201, 'araç eklendi');
ok((await call(T.ADMIN, '/admin/vehicles', 'POST', { plate: '06 ABC 1', model: 'X' })).status === 409, 'aynı plaka reddedildi');
const tt = await login(nu.data.email);
ok((await call(T.ADMIN, `/admin/users/${nu.data.id}/active`, 'PATCH', { active: false })).status === 200, 'personel pasife alındı');
ok((await call(tt, '/orders')).status === 401, 'pasif kullanıcının oturumu kapandı');
ok((await call(T.ADMIN, '/admin/customers/7', 'DELETE')).data.archived, 'geçmişli müşteri pasife alındı');
ok((await call(T.ADMIN, '/admin/vehicles/4/active', 'PATCH', { active: false })).status === 409, 'yoldaki araç pasife alınamaz');
ok((await call(T.ADMIN, '/admin/users/1', 'DELETE')).status === 400, 'yönetici kendini silemez');
ok((await call(T.ADMIN, '/nope')).status === 404, 'bilinmeyen adres 404');

console.log(fails ? `\n${fails} HATA` : '\nTÜM TESTLER GEÇTİ');
process.exit(fails ? 1 : 0);
