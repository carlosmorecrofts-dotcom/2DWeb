// 2DWeb API. Every client-facing query carries the client id from the
// session, so one client can never read or change another's data.
// `handle(request, env)` is pure enough to test in Node with a stand-in database.

const J = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: Object.assign({ 'content-type': 'application/json', 'cache-control': 'no-store' }, headers),
});
const bad = (msg, status = 400) => J({ error: msg }, status);
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const rnd = (n = 16) => hex(crypto.getRandomValues(new Uint8Array(n)));
const enc = (s) => new TextEncoder().encode(s);
const fromHex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', enc(s)));
function same(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function hashPw(pw, salt) {
  const k = await crypto.subtle.importKey('raw', enc(pw), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(salt), iterations: 100000 }, k, 256));
}
// Easy to read out over the phone: four short words and a number.
const WORDS = ['coral', 'mango', 'river', 'tiger', 'cloud', 'lemon', 'amber', 'delta', 'forest', 'harbor', 'island', 'jungle', 'maple', 'ocean', 'pearl', 'quartz', 'sunny', 'tulip', 'velvet', 'willow'];
export function makePassword() {
  const r = crypto.getRandomValues(new Uint32Array(5));
  return `${WORDS[r[0] % 20]}-${WORDS[r[1] % 20]}-${WORDS[r[2] % 20]}-${10 + (r[3] % 90)}`;
}

const MIN_PW = 8;
const today = (tz) => new Date(Date.now() + (tz || 0) * 3600e3).toISOString().slice(0, 10);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s + 'T00:00:00Z'));
const text = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);
const intOrNull = (v) => (v === '' || v == null || isNaN(+v) ? null : Math.round(+v));
const flag = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
const okImg = (s) => !s || /^https:\/\/[^\s]+$/.test(s) || /^\/[A-Za-z0-9._\/-]+$/.test(s);

async function body(req) { try { return await req.json(); } catch { return {}; } }
async function log(db, clientId, what, ref, before, after) {
  await db.prepare('INSERT INTO changes (client_id, what, ref, before, after) VALUES (?, ?, ?, ?, ?)')
    .bind(clientId, what, ref || null, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null).run();
}

// ---- field checks: return { v } (values to save) or { error }
function checkItem(b, partial) {
  const v = {};
  if (!partial || 'name' in b) { v.name = text(b.name, 120); if (!v.name) return { error: 'Name is required' }; }
  if ('cat' in b) v.cat = text(b.cat, 60);
  if ('price' in b) {
    v.price = intOrNull(b.price);
    if (v.price != null && (v.price < 0 || v.price > 1e9)) return { error: 'Price must be a positive number' };
  }
  if ('desc' in b) v.desc = text(b.desc, 600);
  if ('img' in b) { v.img = text(b.img, 300); if (!okImg(v.img)) return { error: 'Photo must be a link starting with https://' }; }
  if ('soldout' in b) v.soldout = flag(b.soldout);
  if ('active' in b) v.active = flag(b.active);
  if ('sort' in b) v.sort = intOrNull(b.sort) || 0;
  return { v };
}
function checkPromo(b, partial) {
  const v = {};
  if (!partial || 'title' in b) { v.title = text(b.title, 120); if (!v.title) return { error: 'Title is required' }; }
  if ('text' in b) v.text = text(b.text, 600);
  if ('discount_pct' in b) {
    v.discount_pct = intOrNull(b.discount_pct);
    if (v.discount_pct != null && (v.discount_pct < 0 || v.discount_pct > 100)) return { error: 'Discount must be between 0 and 100' };
  }
  if ('code' in b) v.code = text(b.code, 30);
  for (const k of ['starts', 'ends']) {
    if (k in b) { v[k] = text(b[k], 10); if (v[k] && !isDate(v[k])) return { error: `${k === 'starts' ? 'Start' : 'End'} date must look like 2026-12-31` }; }
  }
  if (v.starts && v.ends && v.ends < v.starts) return { error: 'The end date is before the start date' };
  if ('active' in b) v.active = flag(b.active);
  return { v };
}

async function update(db, table, id, clientId, v) {
  const keys = Object.keys(v);
  if (!keys.length) return;
  await db.prepare(`UPDATE ${table} SET ${keys.map((k) => `"${k}" = ?`).join(', ')}, updated = datetime('now') WHERE id = ? AND client_id = ?`)
    .bind(...keys.map((k) => v[k]), id, clientId).run();
}

// The sign-in is the owner's email: the same email as their Djinja-C account, so a payment can be matched to a site.
function cleanEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  return e.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null;
}

async function newClient(db, slug, name, tz, pw, email) {
  const salt = rnd(16);
  await db.prepare('INSERT INTO clients (slug, name, tz_hours, pw_hash, pw_salt, email) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(slug, name, tz, await hashPw(pw, salt), salt, email).run();
}

export async function handle(request, env) {
  const db = env.DB;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const method = request.method;
  const [a, b2, c2] = path;

  // ---- public: what a client's website reads
  if (a === 'public' && b2 && method === 'GET') {
    const cl = await db.prepare('SELECT * FROM clients WHERE slug = ? AND active = 1').bind(b2).first();
    if (!cl) return bad('Unknown site', 404);
    const day = today(cl.tz_hours);
    const items = await db.prepare('SELECT ref, cat, name, price, desc, img, soldout FROM items WHERE client_id = ? AND active = 1 ORDER BY sort, id').bind(cl.id).all();
    const promos = await db.prepare("SELECT title, text, discount_pct, code, starts, ends FROM promos WHERE client_id = ? AND active = 1 AND (starts IS NULL OR starts <= ?) AND (ends IS NULL OR ends >= ?) ORDER BY id DESC").bind(cl.id, day, day).all();
    return J({ client: cl.name, items: items.results, promos: promos.results },
      200, { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=30' });
  }
  if (a === 'public' && method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET', 'access-control-max-age': '86400' } });

  // ---- master (Carlos): create clients, reset passwords
  if (a === 'master') {
    if (!same(request.headers.get('x-admin-secret') || '', env.ADMIN_SECRET || '')) return bad('Not allowed', 401);
    if (b2 === 'clients' && !c2 && method === 'GET') {
      const r = await db.prepare('SELECT slug, name, email, plan, paid_until, tz_hours, active, created FROM clients ORDER BY id').all();
      return J({ clients: r.results });
    }
    if (b2 === 'clients' && !c2 && method === 'POST') {
      const b = await body(request);
      const slug = text(b.slug, 40);
      const name = text(b.name, 120);
      if (!slug || !/^[a-z0-9-]+$/.test(slug)) return bad('Site name: lowercase letters, numbers and dashes only');
      if (!name) return bad('Business name is required');
      const email = cleanEmail(b.email);
      if (!email) return bad("The owner's email is required: it is their sign-in and links their Djinja-C account");
      let pw = text(b.password, 100) || makePassword();
      if (pw.length < MIN_PW) return bad(`Password needs at least ${MIN_PW} characters`);
      if (await db.prepare('SELECT 1 AS x FROM clients WHERE slug = ?').bind(slug).first()) return bad('That site already exists', 409);
      if (await db.prepare('SELECT 1 AS x FROM clients WHERE email = ?').bind(email).first()) return bad('That email already has a site', 409);
      await newClient(db, slug, name, intOrNull(b.tz_hours) || 0, pw, email);
      return J({ slug, email, password: pw, note: 'Shown once. Give it to the client.' }, 201);
    }
    if (b2 === 'clients' && c2 && path[3] === 'password' && method === 'POST') {
      const cl = await db.prepare('SELECT id FROM clients WHERE slug = ?').bind(c2).first();
      if (!cl) return bad('Unknown site', 404);
      const b = await body(request);
      const pw = text(b.password, 100) || makePassword();
      if (pw.length < MIN_PW) return bad(`Password needs at least ${MIN_PW} characters`);
      const salt = rnd(16);
      await db.prepare('UPDATE clients SET pw_hash = ?, pw_salt = ? WHERE id = ?').bind(await hashPw(pw, salt), salt, cl.id).run();
      await db.prepare('DELETE FROM sessions WHERE client_id = ?').bind(cl.id).run();
      return J({ slug: c2, password: pw, note: 'Shown once. All old sign-ins were ended.' });
    }
    if (b2 === 'clients' && c2 && path[3] === 'plan' && method === 'POST') {
      const cl = await db.prepare('SELECT id FROM clients WHERE slug = ?').bind(c2).first();
      if (!cl) return bad('Unknown site', 404);
      const b = await body(request);
      const plan = text(b.plan, 40) || null;
      const until = b.paid_until ? String(b.paid_until) : null;
      if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) return bad('paid_until must be YYYY-MM-DD');
      await db.prepare('UPDATE clients SET plan = ?, paid_until = ? WHERE id = ?').bind(plan, until, cl.id).run();
      return J({ slug: c2, plan, paid_until: until });
    }
    if (b2 === 'clients' && c2 && path[3] === 'import' && method === 'POST') {
      const cl = await db.prepare('SELECT id FROM clients WHERE slug = ?').bind(c2).first();
      if (!cl) return bad('Unknown site', 404);
      const b = await body(request);
      if (!Array.isArray(b.items) || !b.items.length || b.items.length > 1000) return bad('Send items: [...] (1 to 1000)');
      let n = 0;
      for (const it of b.items) {
        const ref = text(it.ref || it.id, 80);
        const k = checkItem(it, false);
        if (!ref || k.error) continue;
        const f = Object.assign({ cat: null, price: null, desc: null, img: null }, k.v);
        await db.prepare('INSERT INTO items (client_id, ref, cat, name, price, desc, img, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (client_id, ref) DO NOTHING')
          .bind(cl.id, ref, f.cat, f.name, f.price, f.desc, f.img, n).run();
        n++;
      }
      return J({ imported: n });
    }
    return bad('Not found', 404);
  }

  // ---- sign up: a business makes its own account with its email (the same email as its Djinja-C account)
  if (a === 'signup' && method === 'POST') {
    const b = await body(request);
    const ip = request.headers.get('cf-connecting-ip') || 'x';
    const key = 'signup|' + ip;
    const recent = await db.prepare("SELECT COUNT(*) AS n FROM login_fails WHERE key = ? AND at > datetime('now', '-60 minutes')").bind(key).first();
    if (recent && recent.n >= 5) return bad('Too many sign-ups from here. Try again in an hour.', 429);
    const name = text(b.name, 120);
    const email = cleanEmail(b.email);
    const pw = String(b.password || '');
    if (!name) return bad('Your business name is required');
    if (!email) return bad('Enter a valid email: it is your sign-in and links your Djinja-C account');
    if (pw.length < MIN_PW) return bad(`Password needs at least ${MIN_PW} characters`);
    await db.prepare('INSERT INTO login_fails (key) VALUES (?)').bind(key).run();
    if (await db.prepare('SELECT 1 AS x FROM clients WHERE email = ?').bind(email).first()) return bad('That email already has an account. Sign in instead.', 409);
    // The site's short name is made from the business name; a number is added if it is taken.
    const base = (name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30)) || 'site';
    let slug = base;
    for (let i = 2; await db.prepare('SELECT 1 AS x FROM clients WHERE slug = ?').bind(slug).first(); i++) slug = base + '-' + i;
    await newClient(db, slug, name, 0, pw, email);
    const cl = await db.prepare('SELECT * FROM clients WHERE slug = ?').bind(slug).first();
    const t = rnd(32);
    await db.prepare("INSERT INTO sessions (hash, client_id, expires) VALUES (?, ?, datetime('now', '+30 days'))").bind(await sha(t), cl.id).run();
    return J({ token: t, client: { slug: cl.slug, name: cl.name, email: cl.email } }, 201);
  }

  // ---- sign in
  if (a === 'login' && method === 'POST') {
    const b = await body(request);
    const email = cleanEmail(b.email) || '';
    const pw = String(b.password || '');
    const key = `${email}|${request.headers.get('cf-connecting-ip') || 'x'}`;
    const fails = await db.prepare("SELECT COUNT(*) AS n FROM login_fails WHERE key = ? AND at > datetime('now', '-15 minutes')").bind(key).first();
    if (fails && fails.n >= 5) return bad('Too many tries. Wait 15 minutes.', 429);
    const cl = email ? await db.prepare('SELECT * FROM clients WHERE email = ? AND active = 1').bind(email).first() : null;
    // Same work whether or not the email exists, so timing does not reveal it.
    const salt = cl ? cl.pw_salt : '00'.repeat(16);
    const got = await hashPw(pw, salt);
    if (!cl || !same(got, cl.pw_hash)) {
      await db.prepare('INSERT INTO login_fails (key) VALUES (?)').bind(key).run();
      return bad('Wrong email or password', 401);
    }
    const t = rnd(32);
    await db.prepare("INSERT INTO sessions (hash, client_id, expires) VALUES (?, ?, datetime('now', '+30 days'))").bind(await sha(t), cl.id).run();
    return J({ token: t, client: { slug: cl.slug, name: cl.name, email: cl.email } });
  }

  // ---- forgot password: email a one-hour link. The answer is the same whether or not the
  // email has an account, so nobody can use this to find out who is a customer.
  if (a === 'forgot' && method === 'POST') {
    const b = await body(request);
    const email = cleanEmail(b.email);
    if (!email) return bad('Enter a valid email: it is your sign-in and links your Djinja-C account');
    if (!env.RESEND_API_KEY && !env.sendMail) return bad('Password reset by email is not available yet.', 503);
    const key = 'forgot|' + (request.headers.get('cf-connecting-ip') || 'x');
    const recent = await db.prepare("SELECT COUNT(*) AS n FROM login_fails WHERE key = ? AND at > datetime('now', '-60 minutes')").bind(key).first();
    if (recent && recent.n >= 5) return bad('Too many tries. Try again in an hour.', 429);
    await db.prepare('INSERT INTO login_fails (key) VALUES (?)').bind(key).run();
    const cl = await db.prepare('SELECT id, name FROM clients WHERE email = ? AND active = 1').bind(email).first();
    if (cl) {
      const t = rnd(32);
      await db.prepare('DELETE FROM resets WHERE client_id = ?').bind(cl.id).run();
      await db.prepare("INSERT INTO resets (hash, client_id, expires) VALUES (?, ?, datetime('now', '+60 minutes'))").bind(await sha(t), cl.id).run();
      const link = `${url.origin}/?reset=${t}`;
      const m = resetMail(b.lang, link);
      try {
        if (env.sendMail) await env.sendMail({ to: email, subject: m.subject, text: m.text, link });
        else {
          const r = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
            body: JSON.stringify({ from: '2DWeb <no-reply@djinja-c.com>', to: [email], subject: m.subject, text: m.text, html: m.html }),
          });
          if (!r.ok) return bad('The email could not be sent. Try again in a few minutes.', 502);
        }
      } catch { return bad('The email could not be sent. Try again in a few minutes.', 502); }
    }
    return J({ ok: true });
  }
  if (a === 'reset' && method === 'POST') {
    const b = await body(request);
    const t = String(b.token || '');
    const pw = String(b.password || '');
    if (pw.length < MIN_PW) return bad(`New password needs at least ${MIN_PW} characters`);
    const row = /^[a-f0-9]{64}$/.test(t)
      ? await db.prepare("SELECT r.hash, c.* FROM resets r JOIN clients c ON c.id = r.client_id WHERE r.hash = ? AND r.expires > datetime('now') AND c.active = 1").bind(await sha(t)).first()
      : null;
    if (!row) return bad('This reset link has expired or was already used. Ask for a new one.', 400);
    const salt = rnd(16);
    await db.prepare('UPDATE clients SET pw_hash = ?, pw_salt = ? WHERE id = ?').bind(await hashPw(pw, salt), salt, row.id).run();
    await db.prepare('DELETE FROM resets WHERE client_id = ?').bind(row.id).run();
    await db.prepare('DELETE FROM sessions WHERE client_id = ?').bind(row.id).run();
    const s = rnd(32);
    await db.prepare("INSERT INTO sessions (hash, client_id, expires) VALUES (?, ?, datetime('now', '+30 days'))").bind(await sha(s), row.id).run();
    return J({ token: s, client: { slug: row.slug, name: row.name, email: row.email } });
  }

  // ---- everything below needs a signed-in client
  const tok = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const sess = /^[a-f0-9]{64}$/.test(tok)
    ? await db.prepare("SELECT c.* FROM sessions s JOIN clients c ON c.id = s.client_id WHERE s.hash = ? AND s.expires > datetime('now') AND c.active = 1").bind(await sha(tok)).first()
    : null;
  if (!sess) return bad('Please sign in', 401);
  const cid = sess.id;

  if (a === 'me' && method === 'GET') return J({ slug: sess.slug, name: sess.name, email: sess.email, plan: sess.plan, paid_until: sess.paid_until });
  if (a === 'logout' && method === 'POST') {
    await db.prepare('DELETE FROM sessions WHERE hash = ?').bind(await sha(tok)).run();
    return J({ ok: true });
  }
  if (a === 'password' && method === 'POST') {
    const b = await body(request);
    if (!same(await hashPw(String(b.current || ''), sess.pw_salt), sess.pw_hash)) return bad('Current password is wrong', 401);
    const pw = String(b.password || '');
    if (pw.length < MIN_PW) return bad(`New password needs at least ${MIN_PW} characters`);
    const salt = rnd(16);
    await db.prepare('UPDATE clients SET pw_hash = ?, pw_salt = ? WHERE id = ?').bind(await hashPw(pw, salt), salt, cid).run();
    await db.prepare('DELETE FROM sessions WHERE client_id = ? AND hash <> ?').bind(cid, await sha(tok)).run();
    return J({ ok: true });
  }
  if (a === 'history' && method === 'GET') {
    const r = await db.prepare('SELECT id, what, ref, before, after, at FROM changes WHERE client_id = ? ORDER BY id DESC LIMIT 100').bind(cid).all();
    return J({ changes: r.results });
  }

  // items
  if (a === 'items') {
    if (!b2 && method === 'GET') {
      const r = await db.prepare('SELECT * FROM items WHERE client_id = ? ORDER BY sort, id').bind(cid).all();
      return J({ items: r.results });
    }
    if (!b2 && method === 'POST') {
      const b = await body(request);
      const k = checkItem(b, false);
      if (k.error) return bad(k.error);
      let ref = (text(b.ref, 80) || k.v.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item').slice(0, 60);
      if (await db.prepare('SELECT 1 AS x FROM items WHERE client_id = ? AND ref = ?').bind(cid, ref).first()) ref = `${ref}-${rnd(2)}`;
      const f = Object.assign({ cat: null, price: null, desc: null, img: null, soldout: 0, active: 1 }, k.v);
      const mx = await db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM items WHERE client_id = ?').bind(cid).first();
      const r = await db.prepare('INSERT INTO items (client_id, ref, cat, name, price, desc, img, soldout, active, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(cid, ref, f.cat, f.name, f.price, f.desc, f.img, f.soldout, f.active, 'sort' in k.v ? k.v.sort : mx.n).run();
      await log(db, cid, 'item added', ref, null, f);
      return J({ id: r.meta ? r.meta.last_row_id : undefined, ref }, 201);
    }
    if (b2 && /^\d+$/.test(b2)) {
      const row = await db.prepare('SELECT * FROM items WHERE id = ? AND client_id = ?').bind(+b2, cid).first();
      if (!row) return bad('Not found', 404);
      if (method === 'PUT') {
        const k = checkItem(await body(request), true);
        if (k.error) return bad(k.error);
        await update(db, 'items', row.id, cid, k.v);
        await log(db, cid, 'item changed', row.ref, pick(row, k.v), k.v);
        return J({ ok: true });
      }
      if (method === 'DELETE') {
        await db.prepare('DELETE FROM items WHERE id = ? AND client_id = ?').bind(row.id, cid).run();
        await log(db, cid, 'item deleted', row.ref, row, null);
        return J({ ok: true });
      }
    }
  }

  // promotions
  if (a === 'promos') {
    if (!b2 && method === 'GET') {
      const r = await db.prepare('SELECT * FROM promos WHERE client_id = ? ORDER BY id DESC').bind(cid).all();
      return J({ promos: r.results, today: today(sess.tz_hours) });
    }
    if (!b2 && method === 'POST') {
      const k = checkPromo(await body(request), false);
      if (k.error) return bad(k.error);
      const f = Object.assign({ text: null, discount_pct: null, code: null, starts: null, ends: null, active: 1 }, k.v);
      const r = await db.prepare('INSERT INTO promos (client_id, title, text, discount_pct, code, starts, ends, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(cid, f.title, f.text, f.discount_pct, f.code, f.starts, f.ends, f.active).run();
      await log(db, cid, 'promotion added', f.title, null, f);
      return J({ id: r.meta ? r.meta.last_row_id : undefined }, 201);
    }
    if (b2 && /^\d+$/.test(b2)) {
      const row = await db.prepare('SELECT * FROM promos WHERE id = ? AND client_id = ?').bind(+b2, cid).first();
      if (!row) return bad('Not found', 404);
      if (method === 'PUT') {
        const nb = await body(request);
        const k = checkPromo(nb, true);
        if (k.error) return bad(k.error);
        const st = 'starts' in k.v ? k.v.starts : row.starts, en = 'ends' in k.v ? k.v.ends : row.ends;
        if (st && en && en < st) return bad('The end date is before the start date');
        await update(db, 'promos', row.id, cid, k.v);
        await log(db, cid, 'promotion changed', row.title, pick(row, k.v), k.v);
        return J({ ok: true });
      }
      if (method === 'DELETE') {
        await db.prepare('DELETE FROM promos WHERE id = ? AND client_id = ?').bind(row.id, cid).run();
        await log(db, cid, 'promotion deleted', row.title, row, null);
        return J({ ok: true });
      }
    }
  }
  return bad('Not found', 404);
}
// The reset email, in the language the page was showing.
const MAIL = {
  en: ['Reset your 2DWeb password', 'Someone asked to reset the password for your 2DWeb account.', 'Choose a new password', 'The link works for one hour. If it was not you, ignore this email: your password stays the same.'],
  pt: ['Redefinir a palavra-passe do 2DWeb', 'Foi pedido para redefinir a palavra-passe da sua conta 2DWeb.', 'Escolher nova palavra-passe', 'O link funciona durante uma hora. Se não foi você, ignore este email: a sua palavra-passe não muda.'],
  es: ['Restablece tu contraseña de 2DWeb', 'Alguien pidió restablecer la contraseña de tu cuenta 2DWeb.', 'Elegir una contraseña nueva', 'El enlace funciona durante una hora. Si no fuiste tú, ignora este email: tu contraseña no cambia.'],
  fr: ['Réinitialisez votre mot de passe 2DWeb', 'Une réinitialisation du mot de passe de votre compte 2DWeb a été demandée.', 'Choisir un nouveau mot de passe', "Le lien fonctionne pendant une heure. Si ce n'était pas vous, ignorez cet email : votre mot de passe ne change pas."],
  de: ['2DWeb-Passwort zurücksetzen', 'Für Ihr 2DWeb-Konto wurde das Zurücksetzen des Passworts angefordert.', 'Neues Passwort wählen', 'Der Link gilt eine Stunde. Wenn Sie das nicht waren, ignorieren Sie diese E-Mail: Ihr Passwort bleibt gleich.'],
  it: ['Reimposta la password di 2DWeb', 'È stato chiesto di reimpostare la password del tuo account 2DWeb.', 'Scegli una nuova password', "Il link funziona per un'ora. Se non sei stato tu, ignora questa email: la tua password non cambia."],
  id: ['Atur ulang kata sandi 2DWeb', 'Ada permintaan untuk mengatur ulang kata sandi akun 2DWeb Anda.', 'Pilih kata sandi baru', 'Tautan berlaku satu jam. Jika bukan Anda, abaikan email ini: kata sandi Anda tidak berubah.'],
  zh: ['重置你的 2DWeb 密码', '有人请求重置你的 2DWeb 账户密码。', '设置新密码', '该链接一小时内有效。如果不是你本人操作，请忽略此邮件，你的密码不会改变。'],
  ja: ['2DWeb のパスワードを再設定', '2DWeb アカウントのパスワード再設定が依頼されました。', '新しいパスワードを設定', 'リンクの有効期限は1時間です。心当たりがない場合はこのメールを無視してください。パスワードは変わりません。'],
  ko: ['2DWeb 비밀번호 재설정', '2DWeb 계정의 비밀번호 재설정이 요청되었습니다.', '새 비밀번호 설정', '링크는 1시간 동안 유효합니다. 본인이 요청하지 않았다면 이 이메일을 무시하세요. 비밀번호는 그대로 유지됩니다.'],
  ru: ['Сброс пароля 2DWeb', 'Поступил запрос на сброс пароля вашей учётной записи 2DWeb.', 'Задать новый пароль', 'Ссылка действует один час. Если это были не вы, просто проигнорируйте письмо: пароль останется прежним.'],
};
function resetMail(lang, link) {
  const m = MAIL[lang] || MAIL.en;
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return {
    subject: m[0],
    text: `${m[1]}\n\n${m[2]}: ${link}\n\n${m[3]}\n\nDjinja-C`,
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#14202e;max-width:520px"><p>${esc(m[1])}</p><p><a href="${link}" style="display:inline-block;background:#00a04c;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">${esc(m[2])}</a></p><p style="color:#556">${esc(m[3])}</p><p style="color:#889">Djinja-C</p></div>`,
  };
}
function pick(row, v) { const o = {}; for (const k of Object.keys(v)) o[k] = row[k]; return o; }
