// Runs the real API (functions/api/_app.js) against a real SQLite database (node:sqlite),
// shaped like Cloudflare D1. No network, no account, no keys.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle, makePassword } from '../functions/api/_app.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };

function d1() {
  const s = new DatabaseSync(':memory:');
  s.exec(fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8'));
  return { prepare(sql) {
    const st = s.prepare(sql);
    const mk = (args) => ({
      first: async () => st.get(...args) || null,
      all: async () => ({ results: st.all(...args) }),
      run: async () => { const r = st.run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
    });
    return { bind: (...args) => mk(args), ...mk([]) };
  } };
}
const env = { DB: d1(), ADMIN_SECRET: 'master-secret-for-tests' };
const call = async (method, p, { body, token, master, ip } = {}) => {
  const h = { 'content-type': 'application/json' };
  if (token) h.authorization = 'Bearer ' + token;
  if (master) h['x-admin-secret'] = 'master-secret-for-tests';
  if (ip) h['cf-connecting-ip'] = ip;
  const r = await handle(new Request('https://x.test/api/' + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env);
  return { status: r.status, j: await r.json().catch(() => ({})), headers: r.headers };
};

// ---- master
ok((await call('POST', 'master/clients', { body: { slug: 'take', name: 'TAKE' } })).status === 401, 'master needs the secret');
ok((await call('POST', 'master/clients', { master: true, body: { slug: 'Bad Name', name: 'x' } })).status === 400, 'slug rules');
ok((await call('POST', 'master/clients', { master: true, body: { slug: 'take', name: 'TAKE', email: 'take@example.com', password: 'short' } })).status === 400, 'short password refused');
const a = await call('POST', 'master/clients', { master: true, body: { slug: 'take', name: 'TAKE Canggu', email: 'Take@Example.com', tz_hours: 8 } });
ok(a.status === 201 && a.j.password && a.j.password.length >= 8, 'client A created with a password');
ok((await call('POST', 'master/clients', { master: true, body: { slug: 'take', name: 'again', email: 'again@example.com' } })).status === 409, 'duplicate site refused');
const b = await call('POST', 'master/clients', { master: true, body: { slug: 'shop', name: 'Other Shop', email: 'shop@example.com', password: 'my-own-password' } });
ok(b.status === 201 && b.j.password === 'my-own-password', 'client B with a chosen password');
ok(/^[a-z]+-[a-z]+-[a-z]+-\d\d$/.test(makePassword()), 'generated password is readable');
const stored = env.DB.prepare('SELECT pw_hash FROM clients WHERE slug = ?');
ok(!JSON.stringify(await stored.bind('take').first()).includes(a.j.password), 'password is not stored in clear');

// ---- sign in
ok((await call('GET', 'items')).status === 401, 'no token, no access');
ok((await call('GET', 'items', { token: 'f'.repeat(64) })).status === 401, 'made-up token refused');
ok((await call('POST', 'login', { body: { email: 'take@example.com', password: 'wrong-password' }, ip: '1.1.1.1' })).status === 401, 'wrong password');
ok((await call('POST', 'login', { body: { email: 'nobody@example.com', password: 'x' }, ip: '1.1.1.1' })).status === 401, 'unknown site gives the same answer');
const la = await call('POST', 'login', { body: { email: 'take@example.com', password: a.j.password }, ip: '2.2.2.2' });
const lb = await call('POST', 'login', { body: { email: 'shop@example.com', password: 'my-own-password' }, ip: '3.3.3.3' });
ok(la.status === 200 && la.j.token && lb.status === 200, 'both clients sign in');
const TA = la.j.token, TB = lb.j.token;
for (let i = 0; i < 5; i++) await call('POST', 'login', { body: { email: 'shop@example.com', password: 'nope' + i }, ip: '9.9.9.9' });
ok((await call('POST', 'login', { body: { email: 'shop@example.com', password: 'my-own-password' }, ip: '9.9.9.9' })).status === 429, 'five failures lock that site and address for a while');
ok((await call('POST', 'login', { body: { email: 'shop@example.com', password: 'my-own-password' }, ip: '4.4.4.4' })).status === 200, 'the lock does not stop the real owner elsewhere');

// ---- email sign-in
ok((await call('POST', 'master/clients', { master: true, body: { slug: 'noemail', name: 'No Email' } })).status === 400, 'a client needs an email');
ok((await call('POST', 'master/clients', { master: true, body: { slug: 'badmail', name: 'Bad', email: 'not-an-email' } })).status === 400, 'a bad email is refused');
ok((await call('POST', 'master/clients', { master: true, body: { slug: 'second', name: 'Second', email: 'TAKE@example.com' } })).status === 409, 'one email, one site (any capital letters)');
ok((await call('POST', 'login', { body: { email: ' TAKE@Example.com ', password: a.j.password }, ip: '7.7.7.7' })).status === 200, 'capital letters and spaces in the email do not matter');
ok((await call('POST', 'login', { body: { client: 'take', password: a.j.password }, ip: '7.7.7.8' })).status === 401, 'the old site-name sign-in is gone');
const me = await call('GET', 'me', { token: TA });
ok(me.j.email === 'take@example.com' && me.j.plan === null, 'me shows the email and no plan yet');
ok((await call('POST', 'master/clients/take/plan', { body: { plan: 'standard', paid_until: '2027-01-31' } })).status === 401, 'plan needs the secret');
ok((await call('POST', 'master/clients/take/plan', { master: true, body: { plan: 'standard', paid_until: 'soon' } })).status === 400, 'bad paid-until date refused');
ok((await call('POST', 'master/clients/take/plan', { master: true, body: { plan: 'standard', paid_until: '2027-01-31' } })).status === 200, 'plan and paid-until can be set');
ok((await call('GET', 'me', { token: TA })).j.paid_until === '2027-01-31', 'me shows paid-until');

// ---- sign up
const su = await call('POST', 'signup', { body: { name: 'Café Été Bali', email: 'Owner@Cafe.com', password: 'a-good-password' }, ip: '20.0.0.1' });
ok(su.status === 201 && su.j.token && su.j.client.slug === 'cafe-ete-bali' && su.j.client.email === 'owner@cafe.com', 'sign up makes the account, the site name from the business name');
ok((await call('GET', 'items', { token: su.j.token })).j.items.length === 0, 'a new account starts empty and is signed in');
ok((await call('POST', 'signup', { body: { name: 'Café Été Bali', email: 'other@cafe.com', password: 'a-good-password' }, ip: '20.0.0.2' })).j.client.slug === 'cafe-ete-bali-2', 'a taken site name gets a number');
ok((await call('POST', 'signup', { body: { name: 'Dup', email: 'OWNER@cafe.com', password: 'a-good-password' }, ip: '20.0.0.3' })).status === 409, 'an email that has an account is refused');
ok((await call('POST', 'signup', { body: { name: 'X', email: 'x@y.com', password: 'short' }, ip: '20.0.0.4' })).status === 400, 'sign up needs an 8 character password');
ok((await call('POST', 'signup', { body: { name: 'X', email: 'nope', password: 'a-good-password' }, ip: '20.0.0.5' })).status === 400, 'sign up needs a real email');
ok((await call('POST', 'signup', { body: { email: 'z@y.com', password: 'a-good-password' }, ip: '20.0.0.6' })).status === 400, 'sign up needs a business name');
ok((await call('POST', 'login', { body: { email: 'owner@cafe.com', password: 'a-good-password' }, ip: '20.0.0.7' })).status === 200, 'the new owner can sign in again');
for (let i = 0; i < 5; i++) await call('POST', 'signup', { body: { name: 'Bot' + i, email: 'bot' + i + '@x.com', password: 'a-good-password' }, ip: '66.6.6.6' });
ok((await call('POST', 'signup', { body: { name: 'Bot9', email: 'bot9@x.com', password: 'a-good-password' }, ip: '66.6.6.6' })).status === 429, 'one address cannot make endless accounts');

// ---- products
const bad1 = await call('POST', 'items', { token: TA, body: { name: '' } });
ok(bad1.status === 400, 'name required');
ok((await call('POST', 'items', { token: TA, body: { name: 'X', price: -5 } })).status === 400, 'negative price refused');
ok((await call('POST', 'items', { token: TA, body: { name: 'X', img: 'javascript:alert(1)' } })).status === 400, 'script link refused as a photo');
const i1 = await call('POST', 'items', { token: TA, body: { name: 'Nasi Goreng', price: 20000, cat: 'Local food', desc: 'Rice and egg' } });
ok(i1.status === 201 && i1.j.ref === 'nasi-goreng', 'item created with a clean id');
const i2 = await call('POST', 'items', { token: TA, body: { name: 'Nasi Goreng', price: 25000 } });
ok(i2.status === 201 && i2.j.ref !== 'nasi-goreng', 'same name gets its own id');
ok((await call('PUT', 'items/' + i1.j.id, { token: TA, body: { price: 22000 } })).status === 200, 'price change');
const list = (await call('GET', 'items', { token: TA })).j.items;
ok(list.length === 2 && list[0].price === 22000 && list[0].name === 'Nasi Goreng', 'change kept, other fields untouched');
ok((await call('PUT', 'items/' + i1.j.id, { token: TA, body: { soldout: true } })).status === 200, 'mark sold out');

// ---- isolation: B can never see or touch A's data
ok((await call('GET', 'items', { token: TB })).j.items.length === 0, 'B sees none of A\'s products');
ok((await call('PUT', 'items/' + i1.j.id, { token: TB, body: { price: 1 } })).status === 404, 'B cannot edit A\'s product');
ok((await call('DELETE', 'items/' + i1.j.id, { token: TB })).status === 404, 'B cannot delete A\'s product');
ok((await call('GET', 'items', { token: TA })).j.items[0].price === 22000, 'A\'s product untouched after B\'s attempts');

// ---- promotions and dates (client A is on UTC+8)
const day = (n) => new Date(Date.now() + 8 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
ok((await call('POST', 'promos', { token: TA, body: { title: 'x', discount_pct: 150 } })).status === 400, 'discount over 100 refused');
ok((await call('POST', 'promos', { token: TA, body: { title: 'x', starts: '2026-12-10', ends: '2026-12-01' } })).status === 400, 'end before start refused');
ok((await call('POST', 'promos', { token: TA, body: { title: 'x', starts: 'tomorrow' } })).status === 400, 'bad date refused');
await call('POST', 'promos', { token: TA, body: { title: 'Live now', discount_pct: 10, code: 'HELLO', starts: day(-1), ends: day(2) } });
await call('POST', 'promos', { token: TA, body: { title: 'Last day today', ends: day(0) } });
await call('POST', 'promos', { token: TA, body: { title: 'Starts later', starts: day(3) } });
await call('POST', 'promos', { token: TA, body: { title: 'Already ended', ends: day(-1) } });
const off = await call('POST', 'promos', { token: TA, body: { title: 'Turned off' } });
await call('PUT', 'promos/' + off.j.id, { token: TA, body: { active: 0 } });
ok((await call('PUT', 'promos/' + off.j.id, { token: TB, body: { active: 1 } })).status === 404, 'B cannot touch A\'s promotion');

// ---- the public feed the website reads
const pub = await call('GET', 'public/take');
const titles = pub.j.promos.map((p) => p.title).sort();
ok(JSON.stringify(titles) === JSON.stringify(['Last day today', 'Live now']), 'public feed: only promotions live today (' + titles + ')');
ok(pub.j.items.length === 2 && pub.j.items[0].soldout === 1, 'public feed has the items and the sold-out flag');
ok(!JSON.stringify(pub.j).includes('pw_') && !JSON.stringify(pub.j).includes('client_id'), 'public feed leaks no internals');
ok(pub.headers.get('access-control-allow-origin') === '*', 'public feed can be read from the client\'s website');
await call('PUT', 'items/' + i2.j.id, { token: TA, body: { active: false } });
ok((await call('GET', 'public/take')).j.items.length === 1, 'hidden product leaves the public feed');
ok((await call('GET', 'public/shop')).j.items.length === 0, 'B\'s feed has none of A\'s');
ok((await call('GET', 'public/ghost')).status === 404, 'unknown site is a 404');
ok((await call('POST', 'public/take')).status !== 200, 'the public feed is read-only');

// ---- import, history, password
ok((await call('POST', 'master/clients/take/import', { master: true, body: { items: [{ id: 'tea', name: 'Tea', price: 5000, cat: 'Drinks' }, { id: 'nasi-goreng', name: 'dup' }] } })).j.imported === 2, 'import runs');
ok((await call('GET', 'items', { token: TA })).j.items.filter((x) => x.ref === 'nasi-goreng').length === 1, 'import never overwrites an existing product');
const h = (await call('GET', 'history', { token: TA })).j.changes;
ok(h.some((c) => c.what === 'item changed' && JSON.parse(c.before).price === 20000 && JSON.parse(c.after).price === 22000), 'history records before and after');
ok((await call('GET', 'history', { token: TB })).j.changes.length === 0, 'B\'s history is empty');
ok((await call('POST', 'password', { token: TA, body: { current: 'wrong', password: 'brand-new-password' } })).status === 401, 'password change needs the current one');
ok((await call('POST', 'password', { token: TA, body: { current: a.j.password, password: 'short' } })).status === 400, 'new password length checked');
ok((await call('POST', 'password', { token: TA, body: { current: a.j.password, password: 'brand-new-password' } })).status === 200, 'password changed');
ok((await call('POST', 'login', { body: { email: 'take@example.com', password: a.j.password }, ip: '5.5.5.5' })).status === 401, 'old password stops working');
ok((await call('POST', 'login', { body: { email: 'take@example.com', password: 'brand-new-password' }, ip: '5.5.5.5' })).status === 200, 'new password works');
const reset = await call('POST', 'master/clients/take/password', { master: true });
ok(reset.status === 200 && (await call('GET', 'items', { token: TA })).status === 401, 'a reset ends every old sign-in');
await call('POST', 'logout', { token: TB });
ok((await call('GET', 'items', { token: TB })).status === 401, 'sign out ends the session');
ok((await call('DELETE', 'items/' + i1.j.id, { token: (await call('POST', 'login', { body: { email: 'take@example.com', password: reset.j.password }, ip: '6.6.6.6' })).j.token })).status === 200, 'delete works');

// ---- the app itself: installable, on-brand, calm
const site = (f) => fs.readFileSync(path.join(ROOT, 'site', f), 'utf8');
const man = JSON.parse(site('manifest.webmanifest'));
ok(man.display === 'standalone' && man.start_url && man.scope && man.name && man.short_name, 'manifest is installable');
ok(man.icons.some((i) => i.sizes === '512x512' && /png/.test(i.type)) && man.icons.some((i) => i.sizes === '256x256' || i.sizes === '192x192'), 'manifest has the 512 and a smaller icon');
ok(man.icons.every((i) => fs.existsSync(path.join(ROOT, 'site', i.src))), 'every manifest icon file exists');
ok(/serviceWorker/.test(site('index.html')) && /manifest\.webmanifest/.test(site('index.html')), 'page links the manifest and registers the worker');
ok(/beforeinstallprompt/.test(site('index.html')), 'page offers an Install button');
ok(/indexOf\('\/api\/'\)/.test(site('sw.js')), 'service worker never caches the API');
const html = site('index.html');
ok(!/@keyframes|animation\s*:/i.test(html + site('assets/djinja-visuals.css').replace(/@keyframes[^}]*\}[^}]*\}/g, '').replace(/animation[^;]*;/g, '')) || !/@keyframes|animation\s*:/i.test(html), 'the page itself has no animation (nothing pulses)');
ok(/class="dj"/.test(html) && /djinja-visuals\.css/.test(html), 'uses the Djinja-C stylesheet');
ok(!/[–—]/.test(html + site('manifest.webmanifest')), 'no long dashes in what people read');
ok(!/<img[^>]+src="http/.test(html) && !/src="https?:/.test(html), 'no third-party scripts or images');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
