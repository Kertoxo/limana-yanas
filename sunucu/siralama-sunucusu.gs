/**
 * LİMANA YANAŞ — Sınırsız mod sıralama sunucusu (Google Apps Script + Google Sheets)
 *
 * KURULUM (bir kez, ~5 dakika):
 *  1. Kulübün Google hesabıyla yeni bir Google E-Tablo (Sheets) aç. Adı ör. "Limana Yanaş Sıralama".
 *  2. Menüden Uzantılar > Apps Script'e gir. Açılan Code.gs içindekileri sil, bu dosyanın tamamını yapıştır, kaydet.
 *  3. Sağ üstten Dağıt (Deploy) > Yeni dağıtım > Tür: Web uygulaması.
 *       - Şu kullanıcı olarak çalıştır: Ben (kulüp hesabı)
 *       - Erişimi olanlar: Herkes (Anyone)
 *     Dağıt'a bas, izinleri onayla.
 *  4. Verilen "Web uygulaması URL'si"ni (…/exec ile biter) kopyala ve oyundaki
 *     CONFIG.LEADERBOARD_URL satırına yapıştır.
 *
 * Kod değişirse: Dağıt > Dağıtımları yönet > kalem simgesi > Sürüm: Yeni sürüm > Dağıt. (Link aynı kalır.)
 *
 * TABLODA NE OLUR?
 *  - "Sıralama" sayfası: her cihaz (oyuncu) için tek satır, en iyi skoru ve o oyunun "Tekrar kodu".
 *    Ödül için buraya bakılır. Kazananı doğrulamak için: o satırdaki Tekrar kodu hücrelerini (G sütunundan
 *    itibaren) seçip kopyala, oyunun adresinin sonuna #tekrar ekleyip aç, yapıştır, "Doğrula"ya bas.
 *  - "Tüm Oyunlar" sayfası: gönderilen her oyunun kaydı (kontrol/hile incelemesi için).
 *  - Uygunsuz bir isim görürseniz "Sıralama" sayfasında o satırı silmeniz yeterli.
 *
 * GÜVENLİK ÖNLEMLERİ:
 *  - Her oyun başında sunucu tek kullanımlık bir bilet (token) ve bir "deniz haritası tohumu" verir.
 *    Buzdağlarının dizilişi bu tohumdan çıkar; oyuncu kolay bir harita seçemez.
 *  - Oyun bitince skorla birlikte hareket kaydı (tekrar kodu) gelir. Tohum, skor ve adım sayısı
 *    birbiriyle tutmazsa skor reddedilir. Tekrar kodu ile oyun birebir baştan oynatılabilir.
 *    Skor, oyun başladığından beri gerçekten geçen süreden büyükse reddedilir
 *    (ör. 2 dakikada "500 saniye" skoru gönderilemez).
 *  - İsimler sadece harf/boşluk/kesme/tire içerebilir, en fazla 30 karakter.
 *  - Tabloya formül enjekte edilemez (=, +, -, @ ile başlayan değerler metne çevrilir).
 *  - Aynı cihazdan art arda hızlı gönderim engellenir.
 *  - Sıralamada sadece "Ad S." görünür; soyadın tamamı ve cihaz kimliği dışarı verilmez.
 */

const SHEET_BEST = 'Sıralama';
const SHEET_LOG = 'Tüm Oyunlar';
const MAX_SCORE = 3600;           // 1 saatten uzun skor kabul edilmez
const GAME_VER = 'LY7';           // oyundaki GAME_VER ile aynı olmalı
const CHUNK = 45000;              // bir hücreye yazılacak en fazla karakter (Sheets sınırı 50.000)
const MAX_CHUNKS = 12;            // tekrar kodu için ayrılan sütun sayısı
const TOKEN_TTL = 21600;          // bilet ömrü: 6 saat (Apps Script önbellek sınırı)
const NAME_RE = /^\p{L}[\p{L} '\-.]{0,29}$/u;
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.action === 'start') return json_(startToken_());
    if (p.action === 'top') return json_(board_(String(p.id || ''), Number(p.limit) || 10));
    return json_({ ok: false, error: 'bad_action' });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'server' });
  }
}

function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > CHUNK * MAX_CHUNKS + 4000) return json_({ ok: false, error: 'bad_request' });
    const b = JSON.parse(raw);
    if (b && b.action === 'submit') return json_(submit_(b));
    return json_({ ok: false, error: 'bad_action' });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'server' });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function startToken_() {
  const token = Utilities.getUuid();
  const seed = Math.floor(Math.random() * 4294967296);
  CacheService.getScriptCache().put('t_' + token, JSON.stringify({ t: Date.now(), s: seed }), TOKEN_TTL);
  return { ok: true, token: token, seed: seed };
}

// Tekrar kodunu çözer: LY7.<tohum36>.<skor x10>.<adım36>.<hareketler>
function parseReplay_(code) {
  const m = /^LY7\.([0-9a-z]{1,7})\.(\d{1,6})\.([0-9a-z]{1,8})\.([0-9a-z+,\-]*)$/.exec(String(code || ''));
  if (!m) return null;
  return { seed: parseInt(m[1], 36), tenths: Number(m[2]), ticks: parseInt(m[3], 36), moves: m[4] };
}

function clean_(s) {
  s = String(s || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function submit_(b) {
  const id = String(b.id || '');
  if (!ID_RE.test(id)) return { ok: false, error: 'bad_id' };
  const first = String(b.first || '').replace(/\s+/g, ' ').trim();
  const last = String(b.last || '').replace(/\s+/g, ' ').trim();
  if (!NAME_RE.test(first) || !NAME_RE.test(last)) return { ok: false, error: 'bad_name' };
  const score = Math.floor(Number(b.score) * 10) / 10;
  if (!(score > 0 && score <= MAX_SCORE)) return { ok: false, error: 'bad_score' };

  const cache = CacheService.getScriptCache();
  if (cache.get('r_' + id)) return { ok: false, error: 'rate' };
  const token = String(b.token || '');
  const startedRaw = token && cache.get('t_' + token);
  if (!startedRaw) return { ok: false, error: 'bad_token' };
  cache.remove('t_' + token);                              // tek kullanımlık
  let started;
  try { started = JSON.parse(startedRaw); } catch (e) { return { ok: false, error: 'bad_token' }; }
  const elapsed = (Date.now() - Number(started.t)) / 1000;
  if (score > elapsed + 3) return { ok: false, error: 'too_fast' };
  // Tekrar kodu kontrolü: sunucunun verdiği tohum, gönderilen skor ve adım sayısı birbirini tutmalı
  const code = String(b.replay || '');
  const rep = parseReplay_(code);
  if (!rep || code.length > CHUNK * MAX_CHUNKS) return { ok: false, error: 'bad_replay' };
  if (rep.seed !== Number(started.s)) return { ok: false, error: 'bad_replay' };
  if (rep.tenths !== Math.round(score * 10) || Math.floor(rep.ticks / 6) !== rep.tenths) return { ok: false, error: 'bad_replay' };
  cache.put('r_' + id, '1', 5);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActive();
    const log = sheet_(ss, SHEET_LOG, ['Zaman', 'Cihaz', 'Ad', 'Soyad', 'Skor (sn)', 'Gerçek süre (sn)', 'Hareket sayısı']);
    log.appendRow([new Date(), id, clean_(first), clean_(last), score, Math.round(elapsed), rep.moves ? rep.moves.split(',').length : 0]);

    const headers = ['Cihaz', 'Ad', 'Soyad', 'En iyi skor (sn)', 'Son oyun', 'Oyun sayısı'];
    for (let k = 1; k <= MAX_CHUNKS; k++) headers.push('Tekrar kodu ' + k);
    const best = sheet_(ss, SHEET_BEST, headers);
    const chunks = [];
    for (let k = 0; k < MAX_CHUNKS; k++) chunks.push(code.slice(k * CHUNK, (k + 1) * CHUNK));
    const data = best.getRange(1, 1, Math.max(1, best.getLastRow()), 6).getValues();
    let row = -1;
    for (let i = 1; i < data.length; i++) if (String(data[i][0]) === id) { row = i; break; }
    if (row < 0) {
      best.appendRow([id, clean_(first), clean_(last), score, new Date(), 1].concat(chunks));
    } else {
      const cur = Number(data[row][3]) || 0;
      best.getRange(row + 1, 2, 1, 5).setValues([[clean_(first), clean_(last), Math.max(cur, score), new Date(), (Number(data[row][5]) || 0) + 1]]);
      if (score > cur) best.getRange(row + 1, 7, 1, MAX_CHUNKS).setValues([chunks]);   // rekor kırıldıysa kaydı da güncelle
    }
  } finally {
    lock.releaseLock();
  }
  return board_(id, 10);
}

function sheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

function board_(id, limit) {
  limit = Math.max(1, Math.min(20, limit));
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_BEST);
  const rows = sh && sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues() : [];
  const list = rows
    .filter(function (r) { return r[0] && Number(r[3]) > 0; })
    .map(function (r) { return { id: String(r[0]), name: display_(r[1], r[2]), score: Number(r[3]) }; })
    .sort(function (a, b) { return b.score - a.score; });
  const i = list.findIndex(function (x) { return x.id === id; });
  return {
    ok: true,
    total: list.length,
    top: list.slice(0, limit).map(function (x, k) { return { rank: k + 1, name: x.name, score: x.score, me: x.id === id }; }),
    me: i >= 0 ? { rank: i + 1, score: list[i].score } : null,
  };
}

function display_(f, l) {
  f = String(f || '').replace(/^'/, '');
  l = String(l || '').replace(/^'/, '');
  return (f + (l ? ' ' + l.charAt(0).toLocaleUpperCase('tr-TR') + '.' : '')).slice(0, 34);
}
