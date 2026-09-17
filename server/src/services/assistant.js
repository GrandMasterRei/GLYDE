// GLYDE Asistan: operasyon yardımcısı. İşlemler kullanıcının kendi yetkileriyle, servis katmanı üzerinden yapılır.
// ANTHROPIC_API_KEY tanımlıysa Claude ile sohbet eder; değilse Türkçe komutları kendisi yorumlar.
import { pool } from '../db.js';
import { HttpError } from '../lib/errors.js';
import { formatDuration } from '../lib/format.js';
import { WAREHOUSE_NAMES } from '../config/locations.js';
import { ALL_STATUSES, ROLE_LABELS, STATUS_LABELS } from '../config/statuses.js';
import * as svc from './orders.js';
import * as admin from './admin.js';

const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.ASSISTANT_MODEL || 'claude-haiku-4-5-20251001';
const ALL = ['ADMIN', 'SATIS', 'DEPO', 'LOJISTIK', 'SOFOR'];
const lc = (s) => String(s ?? '').toLocaleLowerCase('tr-TR');

const brief = (o) => ({
  no: o.order_no,
  musteri: o.customer,
  durum: o.status_label,
  depo: o.warehouse,
  teslimat: `${o.destination.name}, ${o.destination.city}`,
  arac: o.plate || null,
  sofor: o.driver_name || null,
  asamada: formatDuration(o.minutes_in_status),
  gecikme: o.is_delayed ? formatDuration(o.delay_minutes) : null,
  kalan_yol: o.remaining_minutes != null && !o.arrived ? formatDuration(o.remaining_minutes) : null,
  teslim_bekliyor: o.arrived || undefined,
  sizi_bekliyor: o.is_my_task || undefined,
  not: o.note || undefined,
});

async function findCustomerId(name) {
  const { rows } = await pool.query('SELECT id, name FROM customers WHERE active ORDER BY name');
  const q = lc(name).trim();
  const hits = rows.filter((c) => lc(c.name) === q || lc(c.name).includes(q) || q.includes(lc(c.name)));
  if (!hits.length) throw new HttpError(404, `"${name}" adlı müşteri bulunamadı`);
  if (hits.length > 1) throw new HttpError(400, `Birden fazla müşteri eşleşti: ${hits.map((h) => h.name).join(', ')}`);
  return hits[0].id;
}

const TOOLS = [
  {
    name: 'get_summary',
    roles: ['ADMIN', 'SATIS', 'DEPO', 'LOJISTIK'],
    description: 'Günün operasyon özeti: aktif, yolda, teslim bekleyen, geciken, bugün teslim edilen ve kullanıcıyı bekleyen iş sayıları.',
    input_schema: { type: 'object', properties: {} },
    run: async (user) => {
      const d = await svc.dashboardSummary(user);
      return {
        aktif: d.active, yolda: d.inTransit, teslim_bekleyen: d.awaitingDelivery,
        geciken: d.delayedCount, bugun_teslim: d.deliveredToday, sizi_bekleyen: d.myActionCount,
        asamalar: Object.fromEntries(d.byStatus.map((s) => [s.label, s.count])),
      };
    },
  },
  {
    name: 'list_orders',
    roles: ALL,
    description: 'Siparişleri listeler. Tüm filtreler isteğe bağlıdır.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ALL_STATUSES, description: 'Durum kodu' },
        only_delayed: { type: 'boolean', description: 'Yalnızca gecikenler' },
        only_my_tasks: { type: 'boolean', description: 'Yalnızca kullanıcının işlem yapması gerekenler' },
        only_arrived: { type: 'boolean', description: 'Yalnızca teslimat noktasına varmış araçlar' },
        search: { type: 'string', description: 'Sipariş no, müşteri, plaka veya teslimat noktası' },
      },
    },
    run: async (user, i = {}) => {
      let list = await svc.listOrders(user, { status: i.status, q: i.search });
      if (i.only_delayed) list = list.filter((o) => o.is_delayed);
      if (i.only_my_tasks) list = list.filter((o) => o.is_my_task);
      if (i.only_arrived) list = list.filter((o) => o.arrived);
      return { adet: list.length, siparisler: list.slice(0, 15).map(brief) };
    },
  },
  {
    name: 'get_order',
    roles: ALL,
    description: 'Tek bir siparişin detayı ve aşama geçmişi.',
    input_schema: {
      type: 'object',
      properties: { order_no: { type: 'string', description: 'Örn. GL-006' } },
      required: ['order_no'],
    },
    run: async (user, i) => {
      const o = await svc.getOrder(user, await svc.findOrderId(i.order_no));
      return {
        ...brief(o),
        sonraki_adim: o.next_status_label,
        bu_kullanici_ilerletebilir: o.can_advance && !(o.status === 'SEVKIYATTA' && !o.arrived),
        gecmis: o.events.map((e) => ({
          durum: STATUS_LABELS[e.status],
          kim: e.changed_by_name,
          saat: new Date(e.created_at).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'short', timeStyle: 'short' }),
          not: e.note || undefined,
        })),
      };
    },
  },
  {
    name: 'advance_order',
    roles: ['ADMIN', 'DEPO', 'LOJISTIK', 'SOFOR'],
    changes: true,
    description: 'Siparişi bir sonraki aşamaya geçirir (hazırlığı başlat, hazırlığı tamamla, yüklemeyi tamamla, sevkiyata çıkar, teslim al). Yalnızca kullanıcı açıkça isterse çağır.',
    input_schema: {
      type: 'object',
      properties: {
        order_no: { type: 'string' },
        note: { type: 'string', description: 'Teslimde teslim alan kişi gibi not' },
      },
      required: ['order_no'],
    },
    run: async (user, i) => svc.advanceOrder(user, await svc.findOrderId(i.order_no), { note: i.note }),
  },
  {
    name: 'assign_vehicle',
    roles: ['ADMIN', 'LOJISTIK'],
    changes: true,
    description: 'Siparişe plakasıyla araç atar. Yalnızca kullanıcı açıkça isterse çağır.',
    input_schema: {
      type: 'object',
      properties: {
        order_no: { type: 'string' },
        plate: { type: 'string', description: 'Araç plakası, ör. 34 GLY 102' },
        driver_name: { type: 'string', description: 'Şoförün adı soyadı. Boş bırakılırsa müsait şoför atanır.' },
      },
      required: ['order_no', 'plate'],
    },
    run: async (user, i) => svc.assignVehicle(
      user,
      await svc.findOrderId(i.order_no),
      await svc.findVehicleId(i.plate),
      i.driver_name ? await svc.findDriverId(i.driver_name) : null
    ),
  },
  {
    name: 'list_available_vehicles',
    roles: ['ADMIN', 'LOJISTIK'],
    description: 'Şu an boşta olan araçlar ve müsait şoförler.',
    input_schema: { type: 'object', properties: {} },
    run: async () => ({
      araclar: (await svc.availableVehicles()).map((v) => ({ plaka: v.plate, model: v.model })),
      soforler: (await svc.availableDrivers()).map((d) => d.name),
    }),
  },
  {
    name: 'create_order',
    roles: ['ADMIN', 'SATIS'],
    changes: true,
    description: 'Yeni sipariş oluşturur; teslimat noktası müşterinin kayıtlı noktasıdır. Yalnızca kullanıcı açıkça isterse çağır.',
    input_schema: {
      type: 'object',
      properties: {
        customer: { type: 'string', description: 'Müşteri adı' },
        warehouse: { type: 'string', enum: WAREHOUSE_NAMES },
        note: { type: 'string' },
      },
      required: ['customer', 'warehouse'],
    },
    run: async (user, i) => svc.createOrder(user, {
      customer_id: await findCustomerId(i.customer), warehouse: i.warehouse, note: i.note,
    }),
  },
  {
    name: 'cancel_order',
    roles: ['ADMIN', 'SATIS'],
    changes: true,
    description: 'Siparişi gerekçesiyle iptal eder (yalnızca yükleme öncesi). Yalnızca kullanıcı açıkça isterse çağır.',
    input_schema: {
      type: 'object',
      properties: { order_no: { type: 'string' }, reason: { type: 'string' } },
      required: ['order_no', 'reason'],
    },
    run: async (user, i) => svc.cancelOrder(user, await svc.findOrderId(i.order_no), i.reason),
  },
  {
    name: 'advance_pending',
    roles: ['ADMIN', 'DEPO', 'LOJISTIK', 'SOFOR'],
    changes: true,
    description: 'Kullanıcının yetkisindeki, şu an ilerletilebilecek tüm siparişleri sıradaki aşamaya geçirir. Araç bekleyen veya yolda olan siparişler atlanır. Yalnızca kullanıcı açıkça isterse çağır.',
    input_schema: { type: 'object', properties: {} },
    run: async (user) => svc.advancePending(user),
  },
  {
    name: 'list_pending',
    roles: ['ADMIN', 'DEPO', 'LOJISTIK', 'SOFOR'],
    description: 'Şu an ilerletilebilecek işleri listeler.',
    input_schema: { type: 'object', properties: {} },
    run: async (user) => ({
      isler: (await svc.pendingTasks(user)).map((o) => ({ no: o.order_no, musteri: o.customer, sonraki: o.next_status_label })),
    }),
  },
  {
    name: 'list_alerts',
    roles: ALL,
    description: 'Kullanıcının ilgilenmesi gereken gecikme, uyarı ve varış bildirimleri.',
    input_schema: { type: 'object', properties: {} },
    run: async (user) => ({
      uyarilar: (await svc.listAlerts(user)).map((a) => ({ no: a.order_no, baslik: a.title, detay: a.detail })),
    }),
  },
];

async function findDestinationId(name) {
  const { rows } = await pool.query('SELECT id, name FROM destinations');
  const q = lc(name).trim();
  const hit = rows.find((d) => lc(d.name) === q) || rows.find((d) => lc(d.name).includes(q) || q.includes(lc(d.name)));
  if (!hit) throw new HttpError(404, `"${name}" teslimat noktası bulunamadı`);
  return hit.id;
}

TOOLS.push(
  {
    name: 'list_staff',
    roles: ['ADMIN'],
    description: 'Tüm personeli rolü, e-postası, durumu ve (şoförse) aracıyla listeler.',
    input_schema: { type: 'object', properties: {} },
    run: async (user) => ({
      personel: (await admin.listUsers(user)).map((u) => ({
        ad: u.name, rol: ROLE_LABELS[u.role], eposta: u.email, aktif: u.active, gorev: u.busy_order_no || undefined,
      })),
    }),
  },
  {
    name: 'add_staff',
    roles: ['ADMIN'],
    changes: true,
    description: 'Yeni personel ekler. E-posta rolüne göre otomatik verilir (ör. sofor9@glyde.app), varsayılan şifre 123456. Yalnızca kullanıcı açıkça isterse çağır.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' }, role: { type: 'string', enum: admin.ROLES } },
      required: ['name', 'role'],
    },
    run: async (user, i) => admin.createUser(user, { name: i.name, role: i.role }),
  },
  {
    name: 'list_vehicles',
    roles: ['ADMIN'],
    description: 'Tüm araçları şoförü, durumu ve varsa aktif siparişiyle listeler.',
    input_schema: { type: 'object', properties: {} },
    run: async (user) => ({
      araclar: (await admin.listVehicles(user)).map((v) => ({
        plaka: v.plate, model: v.model, aktif: v.active, siparis: v.busy_order_no || undefined,
      })),
    }),
  },
  {
    name: 'add_vehicle',
    roles: ['ADMIN'],
    changes: true,
    description: 'Filoya yeni araç ekler. Yalnızca kullanıcı açıkça isterse çağır.',
    input_schema: {
      type: 'object',
      properties: { plate: { type: 'string' }, model: { type: 'string' } },
      required: ['plate', 'model'],
    },
    run: async (user, i) => admin.createVehicle(user, { plate: i.plate, model: i.model }),
  },
  {
    name: 'list_customers',
    roles: ['ADMIN', 'SATIS'],
    description: 'Aktif müşterileri kayıtlı teslimat noktalarıyla listeler.',
    input_schema: { type: 'object', properties: {} },
    run: async () => {
      const { rows } = await pool.query(`
        SELECT c.name, d.name AS nokta, d.city FROM customers c
        JOIN destinations d ON d.id = c.destination_id WHERE c.active ORDER BY c.name`);
      return { musteriler: rows.map((r) => ({ ad: r.name, teslimat: `${r.nokta}, ${r.city}` })) };
    },
  },
  {
    name: 'add_customer',
    roles: ['ADMIN'],
    changes: true,
    description: 'Yeni müşteri ekler. Teslimat noktası mevcut noktalardan biri olmalıdır. Yalnızca kullanıcı açıkça isterse çağır.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' }, destination: { type: 'string', description: 'Ör. Gebze OSB' } },
      required: ['name', 'destination'],
    },
    run: async (user, i) => admin.createCustomer(user, {
      name: i.name, destination_id: await findDestinationId(i.destination),
    }),
  },
  {
    name: 'set_record_active',
    roles: ['ADMIN'],
    changes: true,
    description: 'Personeli (ad soyad), aracı (plaka) veya müşteriyi (ad) aktif ya da pasif yapar. Yalnızca kullanıcı açıkça isterse çağır.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Ad soyad, plaka veya müşteri adı' }, active: { type: 'boolean' } },
      required: ['name', 'active'],
    },
    run: async (user, i) => {
      const rec = await admin.findRecord(i.name);
      await admin.setActive(user, rec.entity, rec.id, i.active);
      return { kayit: rec.label, aktif: i.active };
    },
  },
);

async function runTool(user, name, input) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, error: 'Bilinmeyen işlem' };
  if (!tool.roles.includes(user.role)) return { ok: false, error: `${ROLE_LABELS[user.role]} rolü bu işlemi yapamaz` };
  try {
    return { ok: true, changes: Boolean(tool.changes), result: await tool.run(user, input || {}) };
  } catch (err) {
    if (err instanceof HttpError) return { ok: false, error: err.message };
    throw err;
  }
}

/* ---------------- Yapay zekâ modu ---------------- */

async function askClaude(user, messages) {
  const tools = TOOLS
    .filter((t) => t.roles.includes(user.role))
    .map(({ name, description, input_schema }) => ({ name, description, input_schema }));

  const system = [
    'GLYDE sipariş ve sevkiyat takip sisteminin operasyon asistanısın.',
    `Kullanıcı: ${user.name}, rolü: ${ROLE_LABELS[user.role]}.`,
    `Şu an: ${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}.`,
    'Türkçe, kısa ve net yanıt ver. Yalnızca araçlardan gelen verilere dayan; veri uydurma.',
    'Değişiklik yapan işlemleri yalnızca kullanıcı açıkça istediğinde yap.',
    'Eksik bilgi varsa (hangi araç, hangi müşteri gibi) uydurma; seçenekleri listeleyip sor.',
    'Bir işlem yetki nedeniyle reddedilirse bunu açıkça söyle.',
    'Tablo kullanma; gerekirse kısa madde listesi kullan. Süreleri araçtan geldiği gibi yaz.',
  ].join('\n');

  const convo = messages.map((m) => ({ role: m.role, content: m.content }));
  let changed = false;

  for (let step = 0; step < 6; step++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, system, tools, messages: convo }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);

    const data = await res.json();
    convo.push({ role: 'assistant', content: data.content });
    const uses = data.content.filter((b) => b.type === 'tool_use');

    if (data.stop_reason !== 'tool_use' || !uses.length) {
      const reply = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      return { reply, changed, mode: 'ai' };
    }

    const results = [];
    for (const use of uses) {
      const r = await runTool(user, use.name, use.input);
      if (r.ok && r.changes) changed = true;
      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: JSON.stringify(r.ok ? r.result : { hata: r.error }),
        ...(r.ok ? {} : { is_error: true }),
      });
    }
    convo.push({ role: 'user', content: results });
  }
  return { reply: 'Bu istek çok fazla adım gerektirdi, daha kısa bir soru sorabilir misiniz?', changed, mode: 'ai' };
}

/* ---------------- Komut modu ---------------- */

const EXAMPLES = {
  ADMIN: ['Günün özeti', 'Bekleyen işleri tamamla', 'GL-006 için araç ata', 'Personel listesi', 'Şoför ekle: Ahmet Kaya'],
  SATIS: ['Günün özeti', 'Yoldaki siparişler', 'GL-005 nerede?', 'Müşteri listesi', 'GL-012 iptal et çünkü müşteri vazgeçti'],
  DEPO: ['Bende bekleyen işler', 'Bekleyen işleri tamamla', 'GL-007 hazırlığı tamamla', 'GL-011 detay'],
  LOJISTIK: ['Bende bekleyen işler', 'Boştaki araçlar', 'GL-006 için araç ata', 'GL-008 sevkiyata çıkar', 'Teslim bekleyenler'],
  SOFOR: ['Görevlerim', 'Yola çık', 'Teslim ettim, teslim alan Ahmet Bey'],
};

// Türkçe karakterleri sadeleştirir: "şoför" ve "sofor" aynı şekilde eşleşir
const norm = (v) => lc(v)
  .replace(/[şŞ]/g, 's').replace(/[çÇ]/g, 'c').replace(/[ğĞ]/g, 'g')
  .replace(/[ıİ]/g, 'i').replace(/[öÖ]/g, 'o').replace(/[üÜ]/g, 'u').replace(/[âÂ]/g, 'a');

const parseOrderNo = (v) => {
  const m = norm(v).match(/\bgl[-\s]?0*(\d{1,4})\b/);
  return m ? `GL-${m[1].padStart(3, '0')}` : null;
};
const parsePlate = (v) => {
  const m = v.match(/\b(\d{2})\s*([A-Za-zÇĞİÖŞÜçğıöşü]{1,3})\s*(\d{2,4})\b/);
  return m ? `${m[1]} ${m[2].toLocaleUpperCase('tr-TR')} ${m[3]}` : null;
};

const ROLE_WORDS = [[/sofor/, 'SOFOR'], [/depo/, 'DEPO'], [/lojistik/, 'LOJISTIK'], [/satis/, 'SATIS'], [/(yonetici|admin)/, 'ADMIN']];

// Komutta geçen fiile göre hedeflenen aşama
const ACTION_TARGETS = [
  [/(teslim et|teslim al|teslim ettim|teslimat yap)/, 'TESLIM_EDILDI'],
  [/(yola|sevkiyata|sevk et|cikar|yola cik)/, 'SEVKIYATTA'],
  [/(yukle|yuklemeyi)/, 'YUKLENDI'],
  [/(hazirl)/, null],
];

const line = (o) => `• ${o.no} · ${o.musteri} · ${o.durum}`
  + (o.gecikme ? ` · +${o.gecikme} gecikme` : '')
  + (o.kalan_yol ? ` · ${o.kalan_yol} kaldı` : '')
  + (o.teslim_bekliyor ? ' · teslim bekliyor' : '');

const listText = (title, r, empty) => (r.adet
  ? `${title} (${r.adet}):\n${r.siparisler.map(line).join('\n')}${r.adet > 15 ? '\n…' : ''}`
  : empty);

async function tool(user, name, input) {
  const r = await runTool(user, name, input);
  return r.ok ? { result: r.result, changes: r.changes } : { error: r.error };
}

async function commandMode(user, messages) {
  const text = messages.at(-1).content.trim();
  const t = norm(text);
  const history = messages.slice(0, -1);
  const lastAssistant = norm([...history].reverse().find((m) => m.role === 'assistant')?.content || '');
  const lastUser = norm([...history].reverse().find((m) => m.role === 'user')?.content || '');
  const contextOrder = parseOrderNo(lastAssistant) || parseOrderNo(lastUser);

  const done = (reply, changed = false) => ({ reply, changed, mode: 'basic' });
  const fail = (r) => done(r.error);
  const examples = () => EXAMPLES[user.role].map((e) => `• ${e}`).join('\n');

  const assign = async (orderNo, vehicle, driver) => {
    const r = await tool(user, 'assign_vehicle', { order_no: orderNo, plate: vehicle, driver_name: driver });
    if (r.error) return fail(r);
    return done(`${r.result.plate} ve şoför ${r.result.driver_name}, ${orderNo} siparişine atandı.`, true);
  };

  const advance = async (orderNo, note) => {
    const r = await tool(user, 'advance_order', { order_no: orderNo, note });
    return r.error ? fail(r) : done(`${orderNo} → ${r.result.status_label}`, true);
  };

  const pickOrder = async (question, filter) => {
    const r = await tool(user, 'list_pending');
    if (r.error) return { reply: fail(r) };
    const list = r.result.isler.filter((x) => !filter || x.sonraki === filter);
    if (list.length === 1) return { order: list[0].no };
    if (!list.length) return { reply: done('Şu an ilerletilebilecek iş yok.') };
    return { reply: done(`${question}\n${list.map((x) => `• ${x.no} · ${x.musteri} · ${x.sonraki}`).join('\n')}`) };
  };

  /* --- Önceki soruya verilen yanıtlar --- */
  if (contextOrder && /hangi araci/.test(lastAssistant)) {
    return assign(contextOrder, parsePlate(text) || text, null);
  }
  if (contextOrder && /iptal gerekcesi/.test(lastAssistant)) {
    const r = await tool(user, 'cancel_order', { order_no: contextOrder, reason: text });
    return r.error ? fail(r) : done(`${contextOrder} iptal edildi.`, true);
  }
  if (/adini yaz/.test(lastAssistant) && /ekle/.test(lastUser)) {
    const role = ROLE_WORDS.find(([re]) => re.test(lastUser))?.[1];
    if (role) {
      const name = text.split(/\s+/).map((w) => w.charAt(0).toLocaleUpperCase('tr-TR') + w.slice(1)).join(' ');
      const r = await tool(user, 'add_staff', { name, role });
      return r.error ? fail(r)
        : done(`${name} eklendi (${ROLE_LABELS[role]}).\nGiriş: ${r.result.email}${r.result.default_password ? ' · şifre 123456' : ''}`, true);
    }
  }
  if (/hangi siparisi/.test(lastAssistant) && parseOrderNo(t)) {
    return advance(parseOrderNo(t));
  }

  /* --- Sohbet --- */
  if (/^(selam|merhaba|gunaydin|iyi gunler|iyi aksamlar|slm|hey)\b/.test(t)) {
    return done(`Merhaba ${user.name.split(' ')[0]}. Ne yapmak istersiniz?\n${examples()}`);
  }
  if (/(tesekkur|sag ?ol|eyvallah|tamamdir|super|harika)/.test(t) && t.length < 30) return done('Rica ederim.');
  if (/(yardim|neler yap|ne yapabilir|komut|nasil kullan)/.test(t)) {
    return done(`Şunları yapabilirim:\n${examples()}`);
  }

  const orderNo = parseOrderNo(t);
  const plate = parsePlate(text);

  /* --- Sipariş işlemleri --- */
  if (/iptal/.test(t) && (orderNo || contextOrder)) {
    const target = orderNo || contextOrder;
    const reason = text.split(/çünkü|cunku|sebep|gerekçe|gerekce/i)[1]?.trim();
    if (!reason) return done(`${target} için iptal gerekçesi nedir?`);
    const r = await tool(user, 'cancel_order', { order_no: target, reason });
    return r.error ? fail(r) : done(`${target} iptal edildi.`, true);
  }

  const isQuestion = /\b(mi|mı|mu|mü)\s*\??$/.test(t.trim());
  const assignIntent = !isQuestion && /(\bata\w*\b|\bver\b|\bversene\b)/.test(t) && (plate || /(arac|sofor)/.test(t));
  if (assignIntent) {
    const target = orderNo || contextOrder;
    if (!target) {
      const r = await tool(user, 'list_orders', { only_my_tasks: true });
      if (r.error) return fail(r);
      const waiting = r.result.siparisler.filter((o) => !o.arac);
      if (!waiting.length) return done('Araç bekleyen sipariş yok.');
      return done(`Hangi siparişe araç atayalım?\n${waiting.map(line).join('\n')}`);
    }
    const driver = /sofor/.test(t) && !plate ? text.replace(/.*(sofor|şoför)\s*/i, '').replace(/\s*(ata|ver)\w*\s*$/i, '').trim() : null;
    if (!plate && !driver) {
      const r = await tool(user, 'list_available_vehicles');
      if (r.error) return fail(r);
      const { araclar, soforler } = r.result;
      if (!araclar.length) return done('Şu an boşta araç yok.');
      return done(`${target} için hangi aracı atayalım?\n${araclar.map((v) => `• ${v.plaka} · ${v.model}`).join('\n')}`
        + (soforler.length ? `\nMüsait şoförler: ${soforler.join(', ')}` : '\nMüsait şoför yok.'));
    }
    return assign(target, plate, driver);
  }

  const actionMatch = ACTION_TARGETS.find(([re]) => re.test(t));
  if (actionMatch || /(ilerlet|sonraki asama|tamamla|baslat)/.test(t)) {
    if (/(bekleyen|tum|hepsi|butun)/.test(t) && !orderNo) {
      const r = await tool(user, 'advance_pending');
      if (r.error) return fail(r);
      const { islenen, atlanan } = r.result;
      if (!islenen.length && !atlanan.length) return done('Şu an ilerletilebilecek iş yok.');
      return done([
        islenen.length ? `${islenen.length} sipariş ilerletildi:\n${islenen.map((x) => `• ${x.order_no} → ${x.durum}`).join('\n')}` : 'İlerletilen sipariş yok.',
        atlanan.length ? `Atlananlar:\n${atlanan.map((x) => `• ${x.order_no} · ${x.hata}`).join('\n')}` : null,
      ].filter(Boolean).join('\n'), islenen.length > 0);
    }

    const note = text.match(/teslim alan[:\s]+(.+)$/i)?.[1]?.trim();
    if (orderNo || contextOrder) return advance(orderNo || contextOrder, note ? `Teslim alan: ${note}` : undefined);

    const picked = await pickOrder('Hangi siparişi ilerletelim?', actionMatch?.[1]);
    if (picked.reply) return picked.reply;
    return advance(picked.order, note ? `Teslim alan: ${note}` : undefined);
  }

  if (orderNo) {
    const r = await tool(user, 'get_order', { order_no: orderNo });
    if (r.error) return fail(r);
    const o = r.result;
    return done([
      `${o.no} · ${o.musteri}`,
      `Durum: ${o.durum} (${o.asamada})${o.gecikme ? ` · +${o.gecikme} gecikme` : ''}`,
      `Rota: ${o.depo} → ${o.teslimat}`,
      o.arac ? `Araç: ${o.arac}${o.sofor ? ` · ${o.sofor}` : ''}` : 'Araç: atanmadı',
      o.kalan_yol ? `Kalan yol: ${o.kalan_yol}` : null,
      o.teslim_bekliyor ? 'Araç teslimat noktasında, teslim bekleniyor' : null,
      o.sonraki_adim ? `Sonraki adım: ${o.sonraki_adim}${o.bu_kullanici_ilerletebilir ? ' (sizin yapabileceğiniz)' : ''}` : null,
      o.not ? `Not: ${o.not}` : null,
    ].filter(Boolean).join('\n'));
  }

  /* --- Yönetim --- */
  if (/ekle/.test(t) && /(sofor|depo|lojistik|satis|yonetici|admin|personel|calisan)/.test(t) && !/(arac|musteri) ekle/.test(t)) {
    const role = ROLE_WORDS.find(([re]) => re.test(t))?.[1];
    const raw = text.match(/(.+?)\s+(?:adında|adinda|isimli|adlı|adli)\b/i)?.[1]
      || text.match(/ekle[:\s,]+(.+)$/i)?.[1];
    const name = (raw || '').replace(/^(yeni\s+)?(şoför|sofor|depo|lojistik|satış|satis|yönetici|yonetici|admin)(\s+(personeli|personel|elemanı|elemani|çalışanı|calisani))?\s*/i, '').replace(/[.:,]+$/, '').trim();
    if (!role) return done('Hangi rolde personel ekleyelim? Örnek: "Şoför ekle: Ahmet Kaya"');
    if (!name) return done(`Yeni ${ROLE_LABELS[role].toLocaleLowerCase('tr-TR')} personelinin adını yazın.`);
    const titled = name.split(/\s+/).map((w) => w.charAt(0).toLocaleUpperCase('tr-TR') + w.slice(1)).join(' ');
    const r = await tool(user, 'add_staff', { name: titled, role });
    return r.error ? fail(r)
      : done(`${titled} eklendi (${ROLE_LABELS[role]}).\nGiriş: ${r.result.email}${r.result.default_password ? ' · şifre 123456' : ''}`, true);
  }

  if (/arac ekle/.test(t)) {
    if (!plate) return done('Plakayı ve modeli yazın. Örnek: "Araç ekle 34 ABC 123 Ford Transit"');
    const model = text.slice(text.indexOf(plate.split(' ')[2]) + plate.split(' ')[2].length).replace(/[,.]/g, ' ').trim();
    if (!model) return done('Aracın modelini de yazın. Örnek: "Araç ekle 34 ABC 123 Ford Transit"');
    const r = await tool(user, 'add_vehicle', { plate, model });
    return r.error ? fail(r) : done(`${r.result.plate} filoya eklendi.`, true);
  }

  if (/musteri ekle/.test(t)) {
    const [name, destination] = (text.match(/müşteri ekle[:\s]+(.+)$/i) || text.match(/musteri ekle[:\s]+(.+)$/i) || [])[1]?.split(',').map((x) => x.trim()) || [];
    if (!name || !destination) return done('Müşteri adını ve teslimat noktasını yazın. Örnek: "Müşteri ekle: Demir Lojistik, Gebze OSB"');
    const r = await tool(user, 'add_customer', { name, destination });
    return r.error ? fail(r) : done(`${name} müşterisi eklendi.`, true);
  }

  const deactivate = /(pasife al|pasif yap|devre disi)/.test(t);
  const activate = /(aktif et|aktiflestir|aktif yap)/.test(t);
  if (deactivate || activate) {
    const target = text.replace(/\s*(pasife al|pasif yap|devre dışı bırak|devre disi birak|devre dışı|devre disi|aktif et|aktifleştir|aktiflestir|aktif yap)\S*\s*/i, ' ')
      .trim().replace(/['’](yı|yi|yu|yü|ı|i|u|ü|nı|ni)$/i, '').trim();
    if (!target) return done('Hangi kaydı güncelleyelim? Ad, plaka veya müşteri adı yazın.');
    const r = await tool(user, 'set_record_active', { name: target, active: activate });
    return r.error ? fail(r) : done(`${r.result.kayit} ${activate ? 'aktif edildi' : 'pasife alındı'}.`, true);
  }

  /* --- Listeler --- */
  if (/(bos|bosta|musait|uygun)/.test(t) && /(arac|sofor)/.test(t)) {
    const r = await tool(user, 'list_available_vehicles');
    if (r.error) return fail(r);
    const { araclar, soforler } = r.result;
    return done([
      araclar.length ? `Boştaki araçlar (${araclar.length}):\n${araclar.map((v) => `• ${v.plaka} · ${v.model}`).join('\n')}` : 'Boşta araç yok.',
      soforler.length ? `Müsait şoförler: ${soforler.join(', ')}` : 'Müsait şoför yok.',
    ].join('\n'));
  }

  if (/(personel|calisan|kullanici)/.test(t) && /(liste|kimler|goster|var)/.test(t)) {
    const r = await tool(user, 'list_staff');
    if (r.error) return fail(r);
    return done(r.result.personel.map((u) => `• ${u.ad} · ${u.rol}${u.gorev ? ` · ${u.gorev}` : ''}${u.aktif ? '' : ' · pasif'}`).join('\n'));
  }

  if (/musteri/.test(t) && /(liste|kimler|goster|var)/.test(t)) {
    const r = await tool(user, 'list_customers');
    if (r.error) return fail(r);
    return done(r.result.musteriler.map((c) => `• ${c.ad} · ${c.teslimat}`).join('\n'));
  }

  if (/arac/.test(t) && /(liste|tum|hepsi|filo)/.test(t)) {
    const r = await tool(user, 'list_vehicles');
    if (r.error) return fail(r);
    return done(r.result.araclar.map((v) => `• ${v.plaka} · ${v.model}${v.siparis ? ` · ${v.siparis}` : ''}${v.aktif ? '' : ' · pasif'}`).join('\n'));
  }

  if (/(yeni siparis|siparis olustur|siparis ac|siparis gir)/.test(t)) {
    const warehouse = WAREHOUSE_NAMES.find((w) => t.includes(norm(w.split(' ')[0])));
    const { rows } = await pool.query('SELECT name FROM customers WHERE active');
    const customer = rows.find((c) => t.includes(norm(c.name)))?.name;
    if (!customer || !warehouse) {
      return done('Müşteri adını ve depoyu yazın. Örnek: "Atlas Mobilya için İzmir deposundan yeni sipariş"');
    }
    const r = await tool(user, 'create_order', { customer, warehouse });
    return r.error ? fail(r) : done(`${r.result.order_no} oluşturuldu: ${customer}, ${warehouse}.`, true);
  }

  if (user.role === 'SOFOR' && /(gorev|islerim|bende|siparislerim|isim)/.test(t)) {
    const r = await tool(user, 'list_orders', {});
    if (r.error) return fail(r);
    const active = r.result.siparisler.filter((o) => !['Teslim Edildi', 'İptal Edildi'].includes(o.durum));
    return done(listText('Görevleriniz', { adet: active.length, siparisler: active }, 'Şu an atanmış göreviniz yok.'));
  }

  const listIntents = [
    [/gecik/, { only_delayed: true }, 'Geciken siparişler', 'Geciken sipariş yok.'],
    [/(teslim bekle|varis|varan|teslimat noktasi)/, { only_arrived: true }, 'Teslim bekleyenler', 'Teslimat noktasında bekleyen araç yok.'],
    [/(bende|bana|gorev|islerim|bekleyen is|yapacag)/, { only_my_tasks: true }, 'Sizi bekleyen işler', 'Şu an sizi bekleyen bir iş yok.'],
    [/(yolda|sevkiyatta|nerede)/, { status: 'SEVKIYATTA' }, 'Yoldaki siparişler', 'Yolda sipariş yok.'],
    [/iptal/, { status: 'IPTAL' }, 'İptal edilen siparişler', 'İptal edilen sipariş yok.'],
    [/(tum siparis|siparis liste|siparisler)/, {}, 'Siparişler', 'Sipariş yok.'],
  ];
  for (const [re, filter, title, empty] of listIntents) {
    if (re.test(t)) {
      const r = await tool(user, 'list_orders', filter);
      return r.error ? fail(r) : done(listText(title, r.result, empty));
    }
  }

  if (/(uyari|bildirim)/.test(t)) {
    const r = await tool(user, 'list_alerts');
    if (r.error) return fail(r);
    const a = r.result.uyarilar;
    return done(a.length ? `Uyarılar (${a.length}):\n${a.map((x) => `• ${x.no} · ${x.baslik} · ${x.detay}`).join('\n')}` : 'Aktif uyarı yok.');
  }

  if (/(ozet|durum|rapor|bugun|genel|nasil gidiyor)/.test(t)) {
    if (user.role === 'SOFOR') {
      const r = await tool(user, 'list_orders', {});
      const active = r.result.siparisler.filter((o) => !['Teslim Edildi', 'İptal Edildi'].includes(o.durum));
      return done(listText('Görevleriniz', { adet: active.length, siparisler: active }, 'Şu an atanmış göreviniz yok.'));
    }
    const r = await tool(user, 'get_summary');
    if (r.error) return fail(r);
    const sm = r.result;
    return done([
      `Aktif sipariş: ${sm.aktif}`,
      `Yolda: ${sm.yolda}${sm.teslim_bekleyen ? ` (${sm.teslim_bekleyen} teslim bekliyor)` : ''}`,
      `Geciken: ${sm.geciken}`,
      `Bugün teslim: ${sm.bugun_teslim}`,
      ['DEPO', 'LOJISTIK'].includes(user.role) ? `Sizi bekleyen: ${sm.sizi_bekleyen}` : null,
    ].filter(Boolean).join('\n'));
  }

  return done(`Bunu anlayamadım. Şunları deneyebilirsiniz:\n${examples()}`);
}

export function assistantInfo() {
  return { mode: API_KEY ? 'ai' : 'basic' };
}

export async function answer(user, messages) {
  const last = messages.at(-1);
  if (!last || last.role !== 'user') throw new HttpError(400, 'Mesaj bulunamadı');

  if (API_KEY) {
    try {
      return await askClaude(user, messages);
    } catch (err) {
      console.warn('Yapay zekâ asistanına ulaşılamadı, komut moduna geçildi:', err.message);
    }
  }
  return commandMode(user, messages);
}
