// Tests for scripts/build-areas.mjs and src/seo.js with made-up data (no network).
globalThis.__FAST = true;
import worker from '../src/worker.js';
import { resetMemo, prepare, route, sitemapXml, countyFromPath } from '../src/seo.js';
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

// Surrey is a county of towns; Birmingham is a city of neighbourhoods ("areas"); Liverpool has a file but is not in the index.
const quiet = { slug: 'quiet', name: 'Quiet', county: 'surrey', lat: 51.5, lng: -0.1, crime: { months: months.map(m => ({ m, n: 0 })), total: 0, perMonth: 0, cats: {} }, schools: { primary1mi: 0, secondary3mi: 0, independent2mi: 0, nearestPrimary: [], nearestSecondary: [] } };
const surreyData = Object.assign({}, out, { towns: out.towns.concat([quiet]) });
const brumData = Object.assign({}, out, { county: 'birmingham', countyName: 'Birmingham', unit: 'areas', towns: out.towns.map(t => Object.assign({}, t, { county: 'birmingham' })) });
const regionIndex = { v: 1, regions: [{ county: 'surrey', countyName: 'Surrey', unit: 'towns' }, { county: 'birmingham', countyName: 'Birmingham', unit: 'areas' }] };
const store = {
  'https://x.test/data/areas/index.json': JSON.stringify(regionIndex),
  'https://x.test/data/areas/surrey.json': JSON.stringify(surreyData),
  'https://x.test/data/areas/birmingham.json': JSON.stringify(brumData),
  'https://x.test/data/areas/liverpool.json': JSON.stringify(Object.assign({}, brumData, { county: 'liverpool', countyName: 'Liverpool' })),
};
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
/* ---- more than one region ---- */
resetMemo();
check('countyFromPath picks the region out of every kind of path', countyFromPath('/uk/surrey/gamma-town/crime') === 'surrey' && countyFromPath('/zh/uk/birmingham') === 'birmingham' && countyFromPath('/best/safest-areas-in-birmingham') === 'birmingham' && countyFromPath('/zh/best/safest-towns-in-surrey/') === 'surrey' && countyFromPath('/uk') === null && countyFromPath('/') === null && countyFromPath('/uk/../etc') === null);
x = await get('/uk');
check('/uk lists the regions in the index, not an unlisted one', x.r.status === 200 && x.t.includes('href="/uk/surrey"') && x.t.includes('href="/uk/birmingham"') && x.t.includes('/best/safest-areas-in-birmingham') && x.t.includes('/best/safest-towns-in-surrey') && !x.t.includes('liverpool') && x.t.includes('hreflang="zh-HK" href="https://nestuk.co.uk/zh/uk"') && !x.t.includes('noindex'), x.t.slice(0, 120));
x = await get('/uk/'); check('/uk/ with a trailing slash works too', x.r.status === 200 && x.t.includes('href="/uk/birmingham"'));
x = await get('/zh/uk'); check('/zh/uk is Chinese and lists the regions', x.r.status === 200 && x.t.includes('<html lang="zh-HK">') && x.t.includes('地區指南') && x.t.includes('/zh/uk/birmingham') && x.t.includes('伯明翰') && x.t.includes('hreflang="en-GB" href="https://nestuk.co.uk/uk"'));
x = await get('/uk/birmingham');
const noName = t => t.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/Gamma Town/g, 'Gamma');
const brumText = noName(x.t);
check('city page: "areas" wording, no "town" anywhere in the text', x.r.status === 200 && x.t.includes('Birmingham areas compared') && x.t.includes('/best/safest-areas-in-birmingham') && x.t.includes('/uk/birmingham/gamma-town') && !/\btowns?\b/i.test(brumText), brumText.match(/.{30}\btowns?\b.{20}/i));
x = await get('/uk/birmingham/gamma-town');
const brumTown = noName(x.t);
check('city area page: title, canonical, wording', x.r.status === 200 && /<title>Gamma Town, Birmingham/.test(x.t) && x.t.includes('<link rel="canonical" href="https://nestuk.co.uk/uk/birmingham/gamma-town">') && brumTown.includes('Birmingham areas') && brumTown.includes('Nearby areas') && !/\btowns?\b/i.test(brumTown), brumTown.match(/.{30}\btowns?\b.{20}/i));
x = await get('/uk/birmingham/gamma-town/schools'); check('city schools page has no "town centre"', x.r.status === 200 && !/town/i.test(noName(x.t)) && /centre of (the|each) area/.test(x.t));
x = await get('/best/safest-areas-in-birmingham'); check('city ranking page lives at safest-areas-in', x.r.status === 200 && x.t.includes('Safest areas in Birmingham') && x.t.includes('<link rel="canonical" href="https://nestuk.co.uk/best/safest-areas-in-birmingham">'));
x = await get('/best/safest-towns-in-birmingham'); check('city ranking is not served under the towns URL', x.r.status === 404);
x = await get('/best/safest-areas-in-surrey'); check('county ranking is not served under the areas URL', x.r.status === 404);
x = await get('/uk/liverpool'); check('a region with a file but not in the index is 404', x.r.status === 404 && x.t.includes('noindex'));
x = await get('/zh/uk/liverpool/gamma-town'); check('same for the Chinese pages', x.r.status === 404);
x = await get('/zh/uk/birmingham/gamma-town'); check('zh city page: 地區 wording, no 市鎮, Chinese region name', x.r.status === 200 && x.t.includes('伯明翰') && x.t.includes('地區') && !x.t.includes('市鎮') && !x.t.includes('市中心'), x.t.replace(/<[^>]*>/g, ' ').match(/.{20}(市鎮|市中心).{20}/));
x = await get('/zh/best/safest-areas-in-birmingham'); check('zh city ranking page', x.r.status === 200 && x.t.includes('最安全地區排名'));
x = await get('/zh/uk/surrey/gamma-town'); check('zh county pages keep 市鎮 wording', x.t.includes('市鎮') && x.t.includes('市中心'));
x = await get('/sitemap.xml');
check('sitemap covers every region once, the hub, and nothing from an unlisted region', x.t.includes('<loc>https://nestuk.co.uk/uk</loc>') && x.t.includes('/uk/surrey/gamma-town/crime') && x.t.includes('/uk/birmingham/gamma-town/crime') && x.t.includes('/best/safest-areas-in-birmingham') && x.t.includes('/zh/uk/birmingham') && !x.t.includes('liverpool') && !x.t.includes('/tiny') && !x.t.includes('/quiet'), x.t.slice(0, 200));
x = await get('/uk/surrey/quiet/crime'); check('a place with no recorded crimes does not crash the crime page', x.r.status === 200 && x.t.includes('noindex') && !x.t.includes('Top category'));
x = await get('/zh/uk/surrey/quiet/crime'); check('same for the Chinese crime page', x.r.status === 200 && x.t.includes('noindex'));
const idxOnly = { 'https://x.test/data/areas/index.json': JSON.stringify(regionIndex) };
resetMemo();
x = await get('/uk/birmingham', { ASSETS: { fetch: async (req) => idxOnly[req.url] ? new Response(idxOnly[req.url]) : new Response('nf', { status: 404 }) } });
check('listed region with a missing file: 404, not a crash', x.r.status === 404);
resetMemo();
const evil = { 'https://x.test/data/areas/index.json': JSON.stringify({ v: 1, regions: [{ county: '../secret' }, { county: 'surrey', countyName: 'Surrey' }] }), 'https://x.test/data/areas/surrey.json': JSON.stringify(surreyData) };
x = await get('/sitemap.xml', { ASSETS: { fetch: async (req) => evil[req.url] ? new Response(evil[req.url]) : new Response('nf', { status: 404 }) } });
check('index entries that are not plain slugs are ignored', x.r.status === 200 && x.t.includes('/uk/surrey/gamma-town') && !x.t.includes('secret'));
resetMemo();

/* ---- place outline rule (public/place.js) ---- */
import { createRequire } from 'node:module';
const { placeArea } = createRequire(import.meta.url)('../public/place.js');
const sq = (a, b, c, d) => ({ type: 'Polygon', coordinates: [[[a, b], [c, b], [c, d], [a, d], [a, b]]] });
const v = placeArea({ category: 'boundary', addresstype: 'village', boundingbox: ['51.35', '51.37', '-0.62', '-0.59'], geojson: sq(-0.62, 51.35, -0.59, 51.37) });
check('place: village centre is the middle of its outline', Math.abs(v.lat - 51.36) < 1e-6 && Math.abs(v.lng + 0.605) < 1e-6 && v.poly.length === 5, v);
check('place: street result stays a point', placeArea({ category: 'highway', addresstype: 'road', boundingbox: ['51', '52', '-1', '0'] }) === null);
const L = { category: 'boundary', addresstype: 'town', lat: '0.1', lon: '1.0', boundingbox: ['0', '2', '0', '2'], geojson: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 0.2], [0.2, 0.2], [0.2, 2], [0, 2], [0, 0]]] } };
const l = placeArea(L);
check('place: L-shaped outline never puts the centre outside it', l.lat === 0.1 && l.lng === 1, l);
check('place: no outline falls back to bounding-box middle', placeArea({ category: 'place', addresstype: 'village', boundingbox: ['51.0', '51.2', '-0.4', '-0.2'] }).lat === 51.1);
/* the real reply for "deepcut" from Nominatim jsonv2 (a village node) */
const deepcut = placeArea({ osm_type: 'node', lat: '51.3061708', lon: '-0.7059665', category: 'place', type: 'village', addresstype: 'village', boundingbox: ['51.2861708', '51.3261708', '-0.7259665', '-0.6859665'] });
check('place: real Nominatim jsonv2 village node is recognised', deepcut && Math.abs(deepcut.lat - 51.3061708) < 1e-6 && Math.abs(deepcut.lng + 0.7059665) < 1e-6, deepcut);
check('place: older "class" field still works', placeArea({ class: 'place', addresstype: 'hamlet', boundingbox: ['1', '3', '1', '3'] }).lat === 2);
const busy = prepare({ towns: [['A', 200], ['B', 40], ['C', 50], ['D', 60], ['E', 70]].map(([n, c], i) => ({ slug: n.toLowerCase(), name: n, county: 'surrey', lat: 51 + i / 100, lng: -0.5, crime: { months: Array.from({ length: 12 }, (_, k) => ({ m: '2025-' + String(k + 1).padStart(2, '0'), n: c })), total: c * 12, perMonth: c, cats: { burglary: c * 12 } }, schools: { primary1mi: 1, secondary3mi: 1, independent2mi: 0, nearestPrimary: [], nearestSecondary: [] } })), county: 'surrey', countyName: 'Surrey', latest: '2026-08', built: '2026-10-23', radiusM: 600 });
const aPage = route('/uk/surrey/a', busy);
check('wording: very busy centre gets footfall caveat, no huge percentage', aPage.includes('footfall') === false && aPage.includes('more people pass through') && !/\d{3}% above/.test(aPage) && aPage.includes('well above the median'), aPage.slice(0, 50));

const small = prepare({ towns: [{ slug: 'tiny-town', name: 'Tiny Town', county: 'surrey', lat: 51, lng: -0.5, crime: { months: Array.from({ length: 12 }, (_, k) => ({ m: '2025-' + String(k + 1).padStart(2, '0'), n: k < 6 ? 3 : 9 })), total: 72, perMonth: 6, cats: { burglary: 72 } }, schools: { primary1mi: 1, secondary3mi: 1, independent2mi: 0, nearestPrimary: [], nearestSecondary: [] } },
  { slug: 'big-town', name: 'Big Town', county: 'surrey', lat: 51.1, lng: -0.5, crime: { months: Array.from({ length: 12 }, (_, k) => ({ m: '2025-' + String(k + 1).padStart(2, '0'), n: k < 6 ? 30 : 60 })), total: 540, perMonth: 45, cats: { burglary: 540 } }, schools: { primary1mi: 1, secondary3mi: 1, independent2mi: 0, nearestPrimary: [], nearestSecondary: [] } }], county: 'surrey', countyName: 'Surrey', latest: '2026-08', built: '2026-10-23', radiusM: 600 });
check('trend: not printed when under 20 crimes a month', !route('/uk/surrey/tiny-town', small).includes('than the months before'));
check('trend: printed for a bigger town', route('/uk/surrey/big-town', small).includes('higher than the months before'));


/* ---- Chinese pages ---- */
resetMemo();
let z = await get('/zh/uk/surrey/gamma-town');
check('zh town page 200, zh-HK, own canonical', z.r.status === 200 && z.t.includes('<html lang="zh-HK">') && z.t.includes('<link rel="canonical" href="https://nestuk.co.uk/zh/uk/surrey/gamma-town">'), z.t.slice(0, 160));
check('zh town page: hreflang pair + x-default to English', z.t.includes('hreflang="en-GB" href="https://nestuk.co.uk/uk/surrey/gamma-town"') && z.t.includes('hreflang="zh-HK" href="https://nestuk.co.uk/zh/uk/surrey/gamma-town"') && z.t.includes('hreflang="x-default" href="https://nestuk.co.uk/uk/surrey/gamma-town"'));
check('zh town page: Chinese title, numbers from data, English town name kept', z.t.includes('治安、罪案及學校一覽') && z.t.includes('720') && z.t.includes('Gamma Town'));
check('zh town page: FAQ JSON-LD in Chinese, indexable', z.t.includes('"@type":"FAQPage"') && z.t.includes('治安好嗎') && !z.t.includes('noindex'));
check('zh town page: CTA opens the app in Chinese', z.t.includes('/?q=Gamma%20Town%2C%20Surrey&amp;lang=zh'));
check('zh page links to English and English page links to zh', z.t.includes('href="/uk/surrey/gamma-town" hreflang="en-GB">English') && (await get('/uk/surrey/gamma-town')).t.includes('href="/zh/uk/surrey/gamma-town" hreflang="zh-HK">中文'));
x = await get('/zh/uk/surrey/tiny'); check('zh thin town is noindex like English', x.r.status === 200 && x.t.includes('noindex'));
x = await get('/zh/uk/surrey/gamma-town/crime'); check('zh crime page: chart, Chinese categories', x.t.includes('<svg') && x.t.includes('反社會行為') && x.t.includes('入屋盜竊') && !x.t.includes('Anti-social'));
x = await get('/zh/uk/surrey/gamma-town/schools'); check('zh schools page', x.r.status === 200 && x.t.includes('最近的公立小學') && x.t.includes('附近學校'));
x = await get('/zh/uk/surrey'); check('zh county page lists towns, mentions BNO', x.t.includes('/zh/uk/surrey/gamma-town') && x.t.includes('BNO') && !x.t.includes('/zh/uk/surrey/tiny"'));
x = await get('/zh/best/safest-towns-in-surrey'); check('zh ranking page', x.r.status === 200 && x.t.includes('最安全市鎮排名') && x.t.indexOf('Beta') < x.t.indexOf('Gamma Town') || x.t.indexOf('Alpha') < x.t.indexOf('Gamma Town'));
x = await get('/zh/uk/surrey/nowhere'); check('zh unknown town is 404', x.r.status === 404);
x = await get('/zh/'); check('zh root is 404, not a crash', x.r.status === 404);
const sm2 = sitemapXml(D);
check('sitemap: zh pages with hreflang alternates, thin town still out', sm2.includes('<loc>https://nestuk.co.uk/zh/uk/surrey/gamma-town/crime</loc>') && sm2.includes('xmlns:xhtml') && sm2.includes('hreflang="zh-HK" href="https://nestuk.co.uk/zh/best/safest-towns-in-surrey"') && !sm2.includes('/zh/uk/surrey/tiny'));
check('English county page links to nothing broken: still no zh noindex leak', !(await get('/uk/surrey')).t.includes('noindex'));

console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
