// Tests for scripts/build-areas.mjs and src/seo.js with made-up data (no network).
globalThis.__FAST = true;
import worker from '../src/worker.js';
import { resetMemo, prepare, route, sitemapXml } from '../src/seo.js';
import { buildAreas, summariseCrime, summariseSchools, monthList, slugify } from './build-areas.mjs';

let fails = 0; const check = (n, ok, x) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' -> ' + JSON.stringify(x))); };

/* ---- build script ---- */
check('monthList', monthList('2026-02', 3).join() === '2025-12,2026-01,2026-02');
check('slugify', slugify('Staines-upon-Thames') === 'staines-upon-thames' && slugify('St. Ives') === 'st-ives');
const months = monthList('2026-08', 12);
const ok = Object.fromEntries(months.map(m => [m, Array(10).fill('burglary').concat(['shoplifting'])]));
check('summariseCrime totals', summariseCrime(months, ok).total === 132 && summariseCrime(months, ok).cats.burglary === 120);
const bad = Object.assign({}, ok); months.slice(0, 4).forEach(m => { bad[m] = null; });
check('summariseCrime needs 9 months', summariseCrime(months, bad) === null);
const rows = [
  [1, 'Near Primary', 'S', 'p', 51.2370, -0.5700, 0], [2, 'Near Secondary', 'S', 's', 51.2400, -0.5700, 1],
  [3, 'Fee Paying', 'I', 'a', 51.2380, -0.5710, 0], [4, 'Far Primary', 'S', 'p', 51.30, -0.57, 0], [5, 'All Through', 'S', 'a', 51.2365, -0.5705, 0],
];
const sc = summariseSchools(rows, 51.2362, -0.5704);
check('schools: independents excluded from state counts', sc.primary1mi === 2 && sc.secondary3mi === 2 && sc.independent2mi === 1, sc);
check('schools: nearest sorted', sc.nearestPrimary[0].name === 'All Through' && sc.nearestSecondary.length === 2, sc);

const config = { county: 'surrey', countyName: 'Surrey', towns: [['Alpha', 51.2, -0.5], ['Beta', 51.3, -0.4], ['Gamma Town', 51.4, -0.3], ['Tiny', 51.1, -0.2]] };
const sizes = { Alpha: 5, Beta: 20, 'Gamma Town': 60, Tiny: 1 };
const fakeFetch = async (u) => {
  u = String(u);
  if (u.includes('crime-last-updated')) return new Response(JSON.stringify({ date: '2026-08-01' }));
  const m = u.match(/poly=([\d.-]+),([\d.-]+):/);
  const lat = parseFloat(m[1]);
  const name = lat > 51.38 ? 'Gamma Town' : lat > 51.28 ? 'Beta' : lat > 51.15 ? 'Alpha' : 'Tiny';
  const mo = u.match(/date=(\d{4}-\d{2})/)[1];
  if (name === 'Beta' && mo === '2026-08') return new Response('{}', { status: 500 });   // one missing month is tolerated
  return new Response(JSON.stringify(Array.from({ length: sizes[name] }, (_, i) => ({ category: i % 2 ? 'burglary' : 'anti-social-behaviour' }))));
};
const out = await buildAreas({ fetchFn: fakeFetch, schoolRows: rows, config, delayMs: 0 });
check('build: all towns present', out.towns.length === 4 && out.latest === '2026-08', out);
check('build: tolerates one failed month', out.towns[1].crime && out.towns[1].crime.months.length === 11, out.towns[1].crime && out.towns[1].crime.months.length);
const keep = await buildAreas({ fetchFn: async u => String(u).includes('last-updated') ? new Response(JSON.stringify({ date: '2026-08-01' })) : new Response('{}', { status: 500 }), schoolRows: rows, config, previous: out, delayMs: 0 });
check('build: failed town keeps previous numbers', keep.towns[0].crime.total === out.towns[0].crime.total, keep.towns[0].crime);

/* ---- pages ---- */
const D = prepare(out);
check('rank: fewest crimes first, thin town not ranked', D.ranked.map(t => t.name).join() === 'Beta,Gamma Town' || D.ranked.map(t => t.name).join() === 'Alpha,Beta,Gamma Town', D.ranked.map(t => t.name));
const tiny = D.bySlug.get('tiny');
check('thin town is noindex', tiny.indexable === false);
const sm = sitemapXml(D);
check('sitemap excludes noindex town', !sm.includes('/tiny') && sm.includes('/uk/surrey/gamma-town/crime') && sm.includes('/best/safest-towns-in-surrey'), sm);

const store = { 'https://x.test/data/areas.json': JSON.stringify(out) };
const env = { ASSETS: { fetch: async (req) => store[req.url] ? new Response(store[req.url]) : new Response('nf', { status: 404 }) } };
const get = async (p, e = env) => { const r = await worker.fetch(new Request('https://x.test' + p), e, { waitUntil() {} }); return { r, t: await r.text() }; };
resetMemo();
let x = await get('/uk/surrey/gamma-town');
check('town page 200 with canonical, title, FAQ JSON-LD', x.r.status === 200 && x.t.includes('<link rel="canonical" href="https://nestuk.co.uk/uk/surrey/gamma-town">') && /<title>Gamma Town, Surrey/.test(x.t) && x.t.includes('FAQPage') && x.t.includes('BreadcrumbList'), x.r.status);
check('town page: indexable has no noindex', !x.t.includes('noindex'));
check('town page: numbers from data', x.t.includes('720') && x.t.includes('Gamma Town'), x.t.slice(0, 200));
x = await get('/uk/surrey/tiny'); check('thin town page has noindex', x.r.status === 200 && x.t.includes('noindex'));
x = await get('/uk/surrey/gamma-town/crime'); check('crime page has chart and categories', x.t.includes('<svg') && x.t.includes('Anti-social behaviour') && x.t.includes('Burglary'));
x = await get('/uk/surrey/alpha/schools'); check('schools page links DfE record', x.t.includes('Establishment/Details/1') && x.t.includes('Near Primary'), x.t.slice(0, 100));
x = await get('/uk/surrey'); check('county page lists towns', x.r.status === 200 && x.t.includes('/uk/surrey/beta'));
x = await get('/best/safest-towns-in-surrey'); check('ranking page', x.r.status === 200 && x.t.includes('Safest towns in Surrey'));
x = await get('/uk/surrey/nowhere'); check('unknown town 404 noindex', x.r.status === 404 && x.t.includes('noindex'));
x = await get('/uk/surrey/gamma-town/<script>'); check('odd path 404, no reflection', x.r.status === 404 && !x.t.includes('<script>alert'));
x = await get('/sitemap.xml'); check('sitemap served as xml', x.r.status === 200 && /xml/.test(x.r.headers.get('content-type')) && x.t.includes('/uk/surrey/gamma-town'));
resetMemo();
x = await get('/sitemap.xml', { ASSETS: { fetch: async () => new Response('nf', { status: 404 }) } });
check('no data file: sitemap falls back to homepage only', x.r.status === 200 && x.t.includes('https://nestuk.co.uk/') && !x.t.includes('/uk/'));
x = await get('/uk/surrey/gamma-town', { ASSETS: { fetch: async () => new Response('nf', { status: 404 }) } });
check('no data file: pages 404 (not a crash)', x.r.status === 404);
check('pages contain no raw template placeholders', !/\{R\}|undefined|NaN|\[object/.test((await get('/uk/surrey/gamma-town')).t));
console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
