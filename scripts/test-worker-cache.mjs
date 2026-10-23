// Tests for the Worker's /api/crime*, /api/overpass endpoints with stubbed fetch and caches (no network).
import worker from '../src/worker.js';

const store = new Map();
globalThis.caches = { default: {
  async match(req) { const v = store.get(req.url); return v ? v.clone() : undefined; },
  async put(req, res) { store.set(req.url, res); },
} };
const ctx = { waitUntil(p) { pending.push(p); } };
let pending = [];
let calls = [];
let floodMode = 'ok', policeMode = 'ok', overpassMode = 'ok';
const crimeRow = { category: 'burglary', location: { latitude: '51.2', longitude: '-0.5', street: { name: 'High St' } } };
globalThis.fetch = async (u, o) => {
  u = String(u); calls.push(u);
  const R = (status, body) => new Response(JSON.stringify(body), { status });
  if (u.includes('crime-last-updated')) return policeMode === 'down' ? R(500, {}) : R(200, { date: '2026-08-01' });
  if (u.includes('crimes-street')) {
    if (policeMode === 'down') return R(500, {});
    if (policeMode === 'cap' && u.includes('lat=')) return R(503, {});
    return R(200, [crimeRow]);
  }
  if (u.includes('flood-monitoring')) return floodMode === 'down' ? R(500, {}) : R(200, { items: [{ severityLevel: 3, severity: 'Flood alert', description: 'River Wey', extra: 'x' }] });
  if (u.includes('interpreter')) {
    if (overpassMode === 'down' || (overpassMode === 'first-down' && u.includes('overpass-api.de'))) return R(429, {});
    return R(200, { elements: [{ type: 'node', id: 1 }] });
  }
  return R(404, {});
};
const call = async (path) => { pending = []; const r = await worker.fetch(new Request('https://nestuk.co.uk' + path), {}, ctx); await Promise.all(pending); return { r, j: await r.json() }; };
let fails = 0; const check = (n, ok, x) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' -> ' + JSON.stringify(x))); };

let x = await call('/api/crime-last-updated');
check('last-updated returns month', x.j.month === '2026-08', x.j);
calls = []; x = await call('/api/crime-last-updated');
check('second call served from cache', calls.length === 0 && x.j.month === '2026-08', calls);

x = await call('/api/crime?lat=51.2361&lng=-0.5704&date=2026-08');
check('crime ok, mapped fields', x.r.status === 200 && x.j.list[0].c === 'burglary' && x.j.list[0].s === 'High St' && x.j.capped === false, x.j);
calls = []; x = await call('/api/crime?lat=51.23611&lng=-0.57041&date=2026-08');
check('nearby coordinates share the cache entry (snapped)', calls.length === 0, calls);

policeMode = 'cap'; calls = [];
x = await call('/api/crime?lat=51.5&lng=-0.1&date=2026-07');
check('503 falls back to capped poly in the Worker', x.j.capped === true && calls.some(u => u.includes('poly=')), { j: x.j, calls });
calls = []; x = await call('/api/crime?lat=51.5&lng=-0.1&date=2026-06&capped=1');
check('capped=1 skips the failing point query', !calls.some(u => u.includes('lat=')) && x.j.capped === true, calls);

policeMode = 'down';
x = await call('/api/crime?lat=51.2361&lng=-0.5704&date=2026-05');
check('upstream down and nothing cached -> 502', x.r.status === 502, x);
store.delete('https://cache.nestuk.internal/last?'); // force fresh attempt
x = await call('/api/crime-last-updated');
check('stale last-updated served when police.uk is down', x.j.month === '2026-08' && x.j.stale === true, x.j);
for (const k of [...store.keys()]) if (k.includes('/last')) store.delete(k);
x = await call('/api/crime-last-updated');
check('nothing cached + down -> guess three months back', x.j.guess === true && /^\d{4}-\d{2}$/.test(x.j.month), x.j);

x = await call('/api/crime?lat=40&lng=0&date=2026-08'); check('outside UK rejected', x.r.status === 400, x);
x = await call('/api/crime?lat=51.2&lng=-0.5&date=bad'); check('bad month rejected', x.r.status === 400, x);

policeMode = 'ok';
x = await call('/api/overpass?kind=edu&lat=51.2361&lng=-0.5704');
check('overpass ok', x.r.status === 200 && x.j.elements.length === 1, x);
calls = []; x = await call('/api/overpass?kind=edu&lat=51.2361&lng=-0.5704');
check('overpass cached', calls.length === 0, calls);
x = await call('/api/overpass?kind=evil&lat=51.2&lng=-0.5'); check('unknown kind rejected (not an open proxy)', x.r.status === 400, x);
x = await call('/api/overpass?kind=toString&lat=51.2&lng=-0.5'); check('prototype names rejected', x.r.status === 400, x);
overpassMode = 'first-down'; calls = [];
x = await call('/api/overpass?kind=bus&lat=51.2&lng=-0.5');
check('falls back to next mirror', x.r.status === 200 && calls.length === 2, calls);
overpassMode = 'down';
x = await call('/api/overpass?kind=roads&lat=51.3&lng=-0.5'); check('all mirrors down -> 502', x.r.status === 502, x);
check('error responses are not cached', ![...store.keys()].some(k => k.includes('kind=roads') && !k.includes('stale')));

x = await call('/api/flood-warnings?lat=51.2361&lng=-0.5704');
check('flood warnings ok and trimmed', x.r.status === 200 && x.j.items[0].severityLevel === 3 && !('extra' in x.j.items[0]), x.j);
calls = []; x = await call('/api/flood-warnings?lat=51.23611&lng=-0.57041'); check('flood warnings cached', calls.length === 0, calls);
floodMode = 'down';
for (const k of [...store.keys()]) if (k.includes('/fw?') || k.includes('/fw%')) store.delete(k);
for (const k of [...store.keys()]) if (k.endsWith('/fw?lat=51.2361&lng=-0.5704')) store.delete(k);
x = await call('/api/flood-warnings?lat=51.2361&lng=-0.5704'); check('stale warnings when EA is down', x.j.stale === true && x.j.items.length === 1, x.j);
x = await call('/api/flood-warnings?lat=60&lng=-9'); check('flood warnings outside range rejected', x.r.status === 400, x);

console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
