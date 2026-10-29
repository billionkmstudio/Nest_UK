// Nest UK – programmatic SEO pages, rendered from public/data/areas/<region>.json (built monthly by scripts/build-areas.mjs).
// A region is a county of towns (Surrey) or a city split into neighbourhoods (Birmingham). public/data/areas/index.json lists them.
//   /uk                               all regions
//   /uk/surrey                        region overview
//   /uk/surrey/<town>                 town (or neighbourhood) page
//   /uk/surrey/<town>/crime           crime page
//   /uk/surrey/<town>/schools         schools page
//   /best/safest-towns-in-surrey      ranking ("safest-areas-in-birmingham" for a city)
//   /zh/uk/...  /zh/best/...          Traditional Chinese versions of the same pages (hreflang-linked)
//   /sitemap.xml                      all indexable pages of all regions
// Every number on a page comes from the data file. A town with too little data is marked noindex and left out of
// the sitemap and the rankings.

const SITE = 'https://nestuk.co.uk';
const MIN_CRIMES = 30;           // below this a town is too thin to index
const MI = 1609.34;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = n => Math.round(n).toLocaleString('en-GB');
const pretty = c => { const s = String(c).replace('anti-social', 'anti-social').replace(/-(?!social)/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); };
const ordinal = n => { const v = n % 100; return n + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th'); };
const monthName = m => new Date(m + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const miles = d => (d / MI < 0.1 ? Math.round(d) + ' m' : (d / MI).toFixed(1) + ' mi');
const walk = d => '~' + Math.max(1, Math.round(d * 1.25 / 80)) + ' min walk';
const gias = urn => 'https://get-information-schools.service.gov.uk/Establishments/Establishment/Details/' + urn;

/* Wording that depends on the kind of place. Surrey is a county of towns; the big cities are lists of neighbourhoods
   ("areas"). The "towns" wording is exactly what the pages used before, so existing pages do not change. */
const UNITS = {
  towns: { pl: 'towns', sg: 'town', Sg: 'Town', aSg: 'a town', theSg: 'the town', centre: 'the town centre', eachCentre: 'each town centre',
    centres: 'Town centres', busy: 'Busy town centres', bigCentres: 'larger town centres with shops and stations',
    zh: '市鎮', zhC: '市中心', zhAround: '市中心', zhHub: '市中心' },
  areas: { pl: 'areas', sg: 'area', Sg: 'Area', aSg: 'an area', theSg: 'the area', centre: 'the centre of the area', eachCentre: 'the centre of each area',
    centres: 'Busy centres', busy: 'Busy centres', bigCentres: 'areas with big shopping streets and stations',
    zh: '地區', zhC: '中心點', zhAround: '該地區的中心點', zhHub: '商業中心區' },
};
const unitOf = D => (D && D.unit === 'areas' ? UNITS.areas : UNITS.towns);
const bestPath = D => '/best/safest-' + unitOf(D).pl + '-in-' + D.county;

function haversine(la1, ln1, la2, ln2) {
  const R = 6371000, r = Math.PI / 180, dLa = (la2 - la1) * r, dLn = (ln2 - ln1) * r;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* ------------------------------ data ------------------------------ */
// public/data/areas/index.json lists the regions; each region has its own file, so a visitor only loads one of them.
let memo = new Map();   // 'index' or 'c:<region>' -> { at, data }
const TTL = 600000;
const SLUG = /^[a-z0-9-]+$/;
async function fetchJSON(env, origin, p) {
  const r = await env.ASSETS.fetch(new Request(origin + p));
  return r.ok ? await r.json() : null;
}
export async function loadIndex(env, origin) {
  const m = memo.get('index');
  if (m && Date.now() - m.at < TTL) return m.data;
  try {
    const raw = await fetchJSON(env, origin, '/data/areas/index.json');
    const regions = raw && Array.isArray(raw.regions) ? raw.regions.filter(r => r && SLUG.test(r.county || '')) : [];
    if (!regions.length) return null;
    const data = { regions };
    memo.set('index', { at: Date.now(), data });
    return data;
  } catch (e) { return null; }
}
export async function loadAreas(env, origin, county) {
  if (!SLUG.test(county || '')) return null;
  const m = memo.get('c:' + county);
  if (m && Date.now() - m.at < TTL) return m.data;
  try {
    const idx = await loadIndex(env, origin);
    if (!idx || !idx.regions.some(r => r.county === county)) return null;   // only regions listed in the index are served
    const raw = await fetchJSON(env, origin, '/data/areas/' + county + '.json');
    if (!raw || raw.county !== county) return null;
    const data = prepare(raw);
    memo.set('c:' + county, { at: Date.now(), data });
    return data;
  } catch (e) { return null; }
}
export function resetMemo() { memo = new Map(); }

export function prepare(raw) {
  const towns = (raw.towns || []).map(t => Object.assign({}, t));
  towns.forEach(t => { t.indexable = !!(t.crime && t.crime.total >= MIN_CRIMES); });
  const ranked = towns.filter(t => t.indexable).sort((a, b) => a.crime.total - b.crime.total || a.name.localeCompare(b.name));
  ranked.forEach((t, i) => { t.rank = i + 1; });
  const totals = ranked.map(t => t.crime.total);
  const median = totals.length ? totals[Math.floor(totals.length / 2)] : 0;
  towns.forEach(t => {
    if (!t.crime) return;
    const ms = t.crime.months;
    const a = ms.slice(0, Math.floor(ms.length / 2)).reduce((s, x) => s + x.n, 0);
    const b = ms.slice(Math.floor(ms.length / 2)).reduce((s, x) => s + x.n, 0);
    t.trend = a > 0 ? Math.round((b - a) / a * 100) : null;   // later half vs earlier half, %
    t.vsMedian = median ? Math.round((t.crime.total - median) / median * 100) : null;
  });
  towns.forEach(t => {
    t.nearby = towns.filter(o => o !== t && o.indexable)
      .map(o => ({ o, d: haversine(t.lat, t.lng, o.lat, o.lng) })).sort((x, y) => x.d - y.d).slice(0, 4).map(x => x.o);
  });
  return { raw, towns, ranked, median, count: ranked.length, bySlug: new Map(towns.map(t => [t.slug, t])), countyName: raw.countyName, county: raw.county, unit: raw.unit === 'areas' ? 'areas' : 'towns', latest: raw.latest, built: raw.built, radiusM: raw.radiusM };
}

/* ----------------------------- wording ----------------------------- */
function crimeSentence(t, D) {
  const c = t.crime, parts = [], U = unitOf(D);
  parts.push(num(c.total) + ' crimes were recorded within ' + D.radiusM + ' m of the centre of ' + t.name + ' in the 12 months to ' + monthName(D.latest) + ', about ' + num(c.perMonth) + ' a month.');
  if (t.indexable) {
    const r = t.rank, n = D.count;
    if (r <= Math.ceil(n * 0.25)) parts.push('That is the ' + ordinal(r) + ' lowest of the ' + n + ' ' + D.countyName + ' ' + U.pl + ' compared, so it sits in the quieter quarter.');
    else if (r > n - Math.ceil(n * 0.25)) parts.push('That is the ' + ordinal(n - r + 1) + ' highest of the ' + n + ' ' + D.countyName + ' ' + U.pl + ' compared, so it sits in the busier quarter. ' + U.busy + ' record more crime because more people pass through, so this says little about the quieter residential streets around them.');
    else parts.push('That puts it ' + ordinal(r) + ' of ' + n + ' ' + D.countyName + ' ' + U.pl + ', from lowest to highest.');
    if (t.vsMedian !== null && t.vsMedian > 100) parts.push('That is well above the median ' + U.sg + ', as ' + U.bigCentres + ' usually are.');
    else if (t.vsMedian !== null && Math.abs(t.vsMedian) >= 5) parts.push('It is ' + Math.abs(t.vsMedian) + '% ' + (t.vsMedian < 0 ? 'below' : 'above') + ' the median ' + U.sg + '.');
    else if (t.vsMedian !== null) parts.push('It is close to the median ' + U.sg + '.');
  }
  if (t.trend !== null && c.perMonth >= 20 && Math.abs(t.trend) >= 5) parts.push('The most recent months were ' + Math.abs(t.trend) + '% ' + (t.trend < 0 ? 'lower' : 'higher') + ' than the months before.');
  return parts.join(' ');
}
function topCats(t, n) {
  const e = Object.entries(t.crime.cats).sort((a, b) => b[1] - a[1]);
  return e.slice(0, n).map(([c, k]) => ({ c, k, pct: Math.round(k / t.crime.total * 100) }));
}
function schoolSentence(t, D) {
  const s = t.schools, p = s.nearestPrimary[0], q = s.nearestSecondary[0];
  const bits = [t.name + ' has ' + s.primary1mi + ' state primary ' + (s.primary1mi === 1 ? 'school' : 'schools') + ' within 1 mile and ' + s.secondary3mi + ' state secondary ' + (s.secondary3mi === 1 ? 'school' : 'schools') + ' within 3 miles of ' + unitOf(D).centre + '.'];
  if (p) bits.push('The nearest state primary is ' + p.name + ' (' + miles(p.d) + ').');
  if (q) bits.push('The nearest state secondary is ' + q.name + ' (' + miles(q.d) + ').');
  return bits.join(' ');
}

/* ----------------------------- layout ----------------------------- */
const CSS = `:root{--bg:#fff;--fg:#14213d;--mut:#5b6472;--card:#f3f5f9;--line:#dde2ea;--acc:#1d4ed8}
@media(prefers-color-scheme:dark){:root{--bg:#10151f;--fg:#e6eaf2;--mut:#9aa4b5;--card:#182030;--line:#2a3447;--acc:#7aa2ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
a{color:var(--acc)}header,main,footer{max-width:780px;margin:0 auto;padding:0 16px}
header{display:flex;justify-content:space-between;align-items:center;padding-top:14px;padding-bottom:6px}
header a.brand{font-weight:700;text-decoration:none;color:var(--fg)}nav.crumbs{font-size:14px;color:var(--mut);padding-top:6px}
h1{font-size:1.7rem;line-height:1.25;margin:.6em 0 .4em}h2{font-size:1.2rem;margin:1.6em 0 .4em}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:14px 0}
table{border-collapse:collapse;width:100%;font-size:15px}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}
td.n,th.n{text-align:right;white-space:nowrap}.btn{display:inline-block;background:var(--acc);color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:600}
@media(prefers-color-scheme:dark){.btn{color:#10151f}}
.mut{color:var(--mut);font-size:14px}.links a{display:inline-block;margin:4px 10px 4px 0}footer{padding-bottom:40px;margin-top:32px;color:var(--mut);font-size:13px}svg{max-width:100%;height:auto}`;

const footEn = U => `<footer><p>Sources: crime data from <a href="https://data.police.uk/">data.police.uk</a>; school data from the Department for Education <a href="https://get-information-schools.service.gov.uk/">Get Information about Schools</a>. Contains public sector information licensed under the <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/">Open Government Licence v3.0</a>.</p>
<p>Figures are recorded crimes within about 600 m of ${U.centre}, not a rate per resident, and ${U.busy.toLowerCase()} record more crime because more people pass through. Use them to compare areas, then check the exact address.</p>
<p><a href="/privacy">About &amp; privacy</a></p></footer>`;
const footZh = U => `<footer><p>資料來源：罪案數字來自 <a href="https://data.police.uk/">data.police.uk</a>；學校資料來自英國教育部 <a href="https://get-information-schools.service.gov.uk/">Get Information about Schools</a>。內容包含根據 <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/">Open Government Licence v3.0</a> 授權的公共部門資料。</p>\n<p>數字為${U.zhC}約 600 米範圍內警方記錄的罪案宗數，並非按居民人口計算的比率；人流較多的${U.zhHub}記錄的罪案自然較多。請用來比較不同地區，再查看確實地址。地名及學校名稱保留英文，方便搜尋及核對。</p>
<p><a href="/privacy">About &amp; privacy（英文）</a></p></footer>`;

function layout({ title, desc, path: p, crumbs, h1, body, noindex, ld, lang = 'en', D, hub }) {
  const U = hub ? UNITS.areas : unitOf(D);   // the all-regions page covers towns and neighbourhoods, so it uses the neutral wording
  const zh = lang === 'zh';
  const canonical = SITE + p;
  const hasAlt = /^\/(zh\/)?(uk(\/|$)|best\/)/.test(p);
  const enPath = zh ? p.slice(3) : p, zhPath = zh ? p : '/zh' + p;
  const bc = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c[0], item: SITE + c[1] })) };
  const ldAll = [bc].concat(ld || []).map(o => '<script type="application/ld+json">' + JSON.stringify(o).replace(/</g, '\\u003c') + '</script>').join('\n');
  return `<!doctype html><html lang="${zh ? 'zh-HK' : 'en-GB'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(canonical)}">
${hasAlt ? `<link rel="alternate" hreflang="en-GB" href="${SITE}${enPath}"><link rel="alternate" hreflang="zh-HK" href="${SITE}${zhPath}"><link rel="alternate" hreflang="x-default" href="${SITE}${enPath}">` : ''}
${noindex ? '<meta name="robots" content="noindex,follow">' : ''}<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(canonical)}"><meta property="og:type" content="website">
<style>${CSS}</style>${ldAll}</head><body>
<header><a class="brand" href="/">Nest UK</a><span>${hasAlt ? `<a href="${zh ? enPath : zhPath}" hreflang="${zh ? 'en-GB' : 'zh-HK'}">${zh ? 'English' : '中文'}</a> · ` : ''}<a href="${zh ? '/?lang=zh' : '/'}">${zh ? '查詢地址' : 'Check an address'}</a></span></header>
<main><nav class="crumbs">${crumbs.map((c, i) => i === crumbs.length - 1 ? esc(c[0]) : '<a href="' + esc(c[1]) + '">' + esc(c[0]) + '</a>').join(' › ')}</nav>
<h1>${esc(h1)}</h1>${body}</main>
${zh ? footZh(U) : footEn(U)}</body></html>`;
}

const cta = (t, D) => `<p><a class="btn" href="/?q=${encodeURIComponent(t.name + ', ' + D.countyName)}">Check an exact address in ${esc(t.name)}</a></p>`;
const stamp = D => `<p class="mut">Crime data to ${esc(monthName(D.latest))}; school list from DfE data built ${esc(D.built)}. Updated monthly.</p>`;
const townPath = t => '/uk/' + t.county + '/' + t.slug;

function barChart(t) {
  const ms = t.crime.months, max = Math.max(...ms.map(x => x.n), 1), W = 600, H = 150, bw = W / ms.length;
  const bars = ms.map((x, i) => {
    const h = Math.round(x.n / max * (H - 30));
    return `<g><title>${esc(monthName(x.m))}: ${x.n}</title><rect x="${(i * bw + 3).toFixed(1)}" y="${H - 18 - h}" width="${(bw - 6).toFixed(1)}" height="${h}" rx="3" fill="#2563eb"/><text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 5}" font-size="10" text-anchor="middle" fill="currentColor">${esc(x.m.slice(5))}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Recorded crimes per month in ${esc(t.name)}">${bars}</svg>`;
}

/* ------------------------------ pages ------------------------------ */
function townPage(t, D) {
  const c = t.crime, s = t.schools, cats = topCats(t, 3), U = unitOf(D);
  const faq = [
    ['How much crime is there in ' + t.name + '?', crimeSentence(t, D)],
    ['What are the most common crimes in ' + t.name + '?', 'The most common recorded categories within ' + D.radiusM + ' m of the centre are ' + cats.map(x => pretty(x.c).toLowerCase() + ' (' + x.pct + '%)').join(', ') + '.'],
    ['Are there good schools near ' + t.name + '?', schoolSentence(t, D) + ' School quality is not rated here: check Ofsted and the school’s own information before deciding.'],
  ];
  const nearby = t.nearby.length ? `<h2>Nearby ${U.pl}</h2><ul>${t.nearby.map(o => `<li><a href="${townPath(o)}">${esc(o.name)}</a> – ${ordinal(o.rank)} of ${D.count} for lowest recorded crime</li>`).join('')}</ul>` : '';
  const body = `<p>${esc(crimeSentence(t, D))}</p>
<div class="card"><table><tr><th>Measure</th><th class="n">${esc(t.name)}</th></tr>
<tr><td>Recorded crimes, last 12 months</td><td class="n">${num(c.total)}</td></tr>
<tr><td>Average per month</td><td class="n">${num(c.perMonth)}</td></tr>
${t.indexable ? `<tr><td>Rank (1 = lowest crime of ${D.count} ${esc(D.countyName)} ${U.pl})</td><td class="n">${t.rank}</td></tr>` : ''}
<tr><td>State primary schools within 1 mile</td><td class="n">${s.primary1mi}</td></tr>
<tr><td>State secondary schools within 3 miles</td><td class="n">${s.secondary3mi}</td></tr>
<tr><td>Independent schools within 2 miles</td><td class="n">${s.independent2mi}</td></tr></table></div>
${cta(t, D)}
<div class="links"><a href="${townPath(t)}/crime">Crime in ${esc(t.name)} in detail →</a><a href="${townPath(t)}/schools">Schools near ${esc(t.name)} →</a></div>
<h2>Schools</h2><p>${esc(schoolSentence(t, D))}</p>
<h2>Frequently asked questions</h2>${faq.map(f => `<h3>${esc(f[0])}</h3><p>${esc(f[1])}</p>`).join('')}
${nearby}${stamp(D)}`;
  const ld = [{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(f => ({ '@type': 'Question', name: f[0], acceptedAnswer: { '@type': 'Answer', text: f[1] } })) },
    { '@context': 'https://schema.org', '@type': 'Place', name: t.name + ', ' + D.countyName, geo: { '@type': 'GeoCoordinates', latitude: t.lat, longitude: t.lng } }];
  return layout({ D,
    title: t.name + ', ' + D.countyName + ': crime rate and schools | Nest UK',
    desc: num(c.total) + ' crimes recorded near ' + t.name + ' in the last 12 months' + (t.indexable ? ', ' + ordinal(t.rank) + ' lowest of ' + D.count + ' ' + D.countyName + ' ' + U.pl : '') + '. ' + s.primary1mi + ' state primaries within 1 mile. Updated monthly.',
    path: townPath(t), h1: t.name + ', ' + D.countyName + ': crime and schools at a glance', body, noindex: !t.indexable, ld,
    crumbs: [['Home', '/'], [D.countyName, '/uk/' + t.county], [t.name, townPath(t)]],
  });
}

function crimePage(t, D) {
  const c = t.crime, cats = Object.entries(c.cats).sort((a, b) => b[1] - a[1]), U = unitOf(D);
  const peak = c.months.slice().sort((a, b) => b.n - a.n)[0], low = c.months.slice().sort((a, b) => a.n - b.n)[0];
  const body = `<p>${esc(crimeSentence(t, D))}</p>
<h2>Recorded crimes by month</h2>${barChart(t)}
<p class="mut">Busiest month: ${esc(monthName(peak.m))} (${peak.n}). Quietest month: ${esc(monthName(low.m))} (${low.n}).</p>
<h2>What kinds of crime</h2><table><tr><th>Category</th><th class="n">Crimes</th><th class="n">Share</th></tr>
${cats.map(([k, n]) => `<tr><td>${esc(pretty(k))}</td><td class="n">${num(n)}</td><td class="n">${Math.round(n / c.total * 100)}%</td></tr>`).join('')}</table>
<h2>How to read this</h2><p>Police.uk records the approximate location of each crime, and the count here covers a square about ${D.radiusM * 2} m across centred on ${U.theSg}. A busy high street records more crime than a quiet residential road, so a street-by-street check matters more than ${U.theSg} figure.</p>
${cta(t, D)}<p><a href="${townPath(t)}">← ${esc(t.name)} overview</a> · <a href="${bestPath(D)}">Safest ${U.pl} in ${esc(D.countyName)}</a></p>${stamp(D)}`;
  return layout({ D,
    title: t.name + ' crime rate: ' + num(c.total) + ' recorded crimes in 12 months | Nest UK',
    desc: 'Crime in ' + t.name + ', ' + D.countyName + ': ' + num(c.total) + ' recorded crimes in the last 12 months, by month and category.' + (cats.length ? ' Top category: ' + pretty(cats[0][0]).toLowerCase() + '.' : ''),
    path: townPath(t) + '/crime', h1: 'Crime in ' + t.name + ', ' + D.countyName, body, noindex: !t.indexable,
    crumbs: [['Home', '/'], [D.countyName, '/uk/' + t.county], [t.name, townPath(t)], ['Crime', townPath(t) + '/crime']],
  });
}

function schoolTable(list) {
  if (!list.length) return '<p>No state schools found nearby in the DfE data.</p>';
  return `<table><tr><th>School</th><th class="n">Distance</th></tr>${list.map(x => `<tr><td><a href="${gias(x.urn)}" rel="nofollow noopener">${esc(x.name)}</a>${x.faith ? ' <span class="mut">(faith school)</span>' : ''}${x.all ? ' <span class="mut">(all-through)</span>' : ''}</td><td class="n">${miles(x.d)} · ${walk(x.d)}</td></tr>`).join('')}</table>`;
}
function schoolsPage(t, D) {
  const s = t.schools, U = unitOf(D);
  const body = `<p>${esc(schoolSentence(t, D))}</p>
<h2>Nearest state primary schools</h2>${schoolTable(s.nearestPrimary)}
<h2>Nearest state secondary schools</h2>${schoolTable(s.nearestSecondary)}
<p>There ${s.independent2mi === 1 ? 'is 1 independent (fee-paying) school' : 'are ' + s.independent2mi + ' independent (fee-paying) schools'} within 2 miles; these are not counted above.</p>
<h2>How to read this</h2><p>School types come from the Department for Education’s register (GIAS), so academies and free schools count as state schools. Distances are in a straight line from ${U.centre}; a school’s admissions area, catchment and Ofsted rating matter more than distance, so check each school’s own page before choosing a home.</p>
${cta(t, D)}<p><a href="${townPath(t)}">← ${esc(t.name)} overview</a></p>${stamp(D)}`;
  return layout({ D,
    title: 'Schools near ' + t.name + ', ' + D.countyName + ': state primary and secondary | Nest UK',
    desc: s.primary1mi + ' state primary schools within 1 mile and ' + s.secondary3mi + ' state secondary schools within 3 miles of ' + t.name + ', with distances and DfE links.',
    path: townPath(t) + '/schools', h1: 'Schools near ' + t.name + ', ' + D.countyName, body, noindex: !t.indexable,
    crumbs: [['Home', '/'], [D.countyName, '/uk/' + t.county], [t.name, townPath(t)], ['Schools', townPath(t) + '/schools']],
  });
}

function rankingTable(D) {
  return `<table><tr><th class="n">#</th><th>${unitOf(D).Sg}</th><th class="n">Crimes (12 mo)</th><th class="n">Per month</th></tr>${D.ranked.map(t => `<tr><td class="n">${t.rank}</td><td><a href="${townPath(t)}">${esc(t.name)}</a></td><td class="n">${num(t.crime.total)}</td><td class="n">${num(t.crime.perMonth)}</td></tr>`).join('')}</table>`;
}
function countyPage(D) {
  const U = unitOf(D);
  const body = `<p>We compare ${D.count} ${esc(D.countyName)} ${U.pl} by recorded crime within ${D.radiusM} m of ${U.centre} over the 12 months to ${esc(monthName(D.latest))}, and show the school picture for each. The median ${U.sg} recorded ${num(D.median)} crimes.</p>
<p><a href="${bestPath(D)}">See the full ranking: safest ${U.pl} in ${esc(D.countyName)} →</a></p>
<h2>All ${esc(D.countyName)} ${U.pl}</h2><ul>${D.ranked.map(t => `<li><a href="${townPath(t)}">${esc(t.name)}</a></li>`).join('')}</ul>${stamp(D)}`;
  return layout({ D,
    title: D.countyName + ' ' + U.pl + ' compared: crime and schools | Nest UK',
    desc: 'Compare ' + D.count + ' ' + D.countyName + ' ' + U.pl + ' by recorded crime and nearby state schools, using Police.uk and DfE data. Updated monthly.',
    path: '/uk/' + D.county, h1: D.countyName + ' ' + U.pl + ': crime and schools compared', body,
    crumbs: [['Home', '/'], [D.countyName, '/uk/' + D.county]],
  });
}
function rankingPage(D) {
  const first = D.ranked[0], last = D.ranked[D.ranked.length - 1], U = unitOf(D);
  const body = `<p>${esc(first.name)} recorded the fewest crimes of the ${D.count} ${esc(D.countyName)} ${U.pl} we compared (${num(first.crime.total)} in 12 months), and ${esc(last.name)} the most (${num(last.crime.total)}). Counts are recorded crimes within ${D.radiusM} m of ${U.eachCentre}, 12 months to ${esc(monthName(D.latest))}.</p>
${rankingTable(D)}<p class="mut">This is a count of recorded crime near the centre, not a rate per resident. ${U.centres} with shops, stations and nightlife record more crime than the surrounding residential streets, so ${U.aSg} ranked lower is not necessarily less safe to live in. Check the exact address.</p>${stamp(D)}`;
  return layout({ D,
    title: 'Safest ' + U.pl + ' in ' + D.countyName + ' by recorded crime | Nest UK',
    desc: 'Ranking of ' + D.count + ' ' + D.countyName + ' ' + U.pl + ' by recorded crime in the last 12 months. ' + first.name + ' has the fewest, ' + last.name + ' the most.',
    path: bestPath(D), h1: 'Safest ' + U.pl + ' in ' + D.countyName + ' by recorded crime', body,
    crumbs: [['Home', '/'], [D.countyName, '/uk/' + D.county], ['Safest ' + U.pl, bestPath(D)]],
  });
}

/* ------------------------- Traditional Chinese pages ------------------------- */
// Same data, same rules (noindex, rankings) as the English pages. Town and school names stay in English so they
// can be searched and checked against the sources.
const ZH_COUNTY = { surrey: '薩里郡', birmingham: '伯明翰', manchester: '曼徹斯特', liverpool: '利物浦' };
const ZH_CAT = {
  'anti-social-behaviour': '反社會行為', 'bicycle-theft': '單車盜竊', 'burglary': '入屋盜竊', 'criminal-damage-arson': '刑事毀壞及縱火',
  'drugs': '毒品', 'other-crime': '其他罪案', 'other-theft': '其他盜竊', 'possession-of-weapons': '管有武器', 'public-order': '擾亂公共秩序',
  'robbery': '搶劫', 'shoplifting': '店舖盜竊', 'theft-from-the-person': '隨身財物盜竊', 'vehicle-crime': '車輛相關罪案', 'violent-crime': '暴力及性罪案',
};
const zhCat = c => ZH_CAT[c] || pretty(c);
const zhMonth = m => { const [y, mm] = m.split('-'); return y + '年' + Number(mm) + '月'; };
const zhMiles = d => (d / MI < 0.1 ? Math.round(d) + ' 米' : (d / MI).toFixed(1) + ' 英里');
const zhWalk = d => '步行約 ' + Math.max(1, Math.round(d * 1.25 / 80)) + ' 分鐘';
const zhCounty = D => D.countyName + (ZH_COUNTY[D.county] ? '（' + ZH_COUNTY[D.county] + '）' : '');
const zhCountyIn = D => D.countyName + (ZH_COUNTY[D.county] ? ' ' + ZH_COUNTY[D.county] : '');   // for use inside brackets
const zhPath = p => '/zh' + p;
const zhCta = (t, D) => `<p><a class="btn" href="/?q=${encodeURIComponent(t.name + ', ' + D.countyName)}&amp;lang=zh">查詢 ${esc(t.name)} 的實際地址</a></p>`;
const zhStamp = D => `<p class="mut">罪案資料截至 ${esc(zhMonth(D.latest))}；學校名單根據英國教育部資料（${esc(D.built)} 更新）。每月更新。</p>`;
const zhCrumbHome = ['Nest UK 首頁', '/'];

function zhCrimeSentence(t, D) {
  const c = t.crime, parts = [], U = unitOf(D);
  parts.push('截至 ' + zhMonth(D.latest) + ' 的 12 個月內，' + t.name + ' ' + U.zhC + ' ' + D.radiusM + ' 米範圍內共錄得 ' + num(c.total) + ' 宗警方記錄罪案，平均每月約 ' + num(c.perMonth) + ' 宗。');
  if (t.indexable) {
    const r = t.rank, n = D.count;
    if (r <= Math.ceil(n * 0.25)) parts.push('在比較的 ' + n + ' 個 ' + D.countyName + ' ' + U.zh + '中，罪案宗數由低至高排第 ' + r + ' 位，屬較寧靜的四分之一。');
    else if (r > n - Math.ceil(n * 0.25)) parts.push('在比較的 ' + n + ' 個 ' + D.countyName + ' ' + U.zh + '中，罪案宗數由高至低排第 ' + (n - r + 1) + ' 位，屬較繁忙的四分之一。' + U.zhHub + '人流多，記錄的罪案自然較多，不一定反映周邊住宅街道的情況。');
    else parts.push('在 ' + n + ' 個 ' + D.countyName + ' ' + U.zh + '中，罪案宗數由低至高排第 ' + r + ' 位。');
    if (t.vsMedian !== null && t.vsMedian > 100) parts.push('遠高於' + U.zh + '中位數，有商店及車站的較大' + U.zh + '通常如此。');
    else if (t.vsMedian !== null && Math.abs(t.vsMedian) >= 5) parts.push('比' + U.zh + '中位數' + (t.vsMedian < 0 ? '低 ' : '高 ') + Math.abs(t.vsMedian) + '%。');
    else if (t.vsMedian !== null) parts.push('與' + U.zh + '中位數相若。');
  }
  if (t.trend !== null && c.perMonth >= 20 && Math.abs(t.trend) >= 5) parts.push('最近半年的宗數比之前半年' + (t.trend < 0 ? '低 ' : '高 ') + Math.abs(t.trend) + '%。');
  return parts.join('');
}
function zhSchoolSentence(t, D) {
  const s = t.schools, p = s.nearestPrimary[0], q = s.nearestSecondary[0];
  const bits = [t.name + ' ' + unitOf(D).zhC + ' 1 英里內有 ' + s.primary1mi + ' 間公立小學（state primary），3 英里內有 ' + s.secondary3mi + ' 間公立中學（state secondary）。'];
  if (p) bits.push('最近的公立小學是 ' + p.name + '（' + zhMiles(p.d) + '）。');
  if (q) bits.push('最近的公立中學是 ' + q.name + '（' + zhMiles(q.d) + '）。');
  return bits.join('');
}
function zhBarChart(t) { return barChart(t).replace('aria-label="Recorded crimes per month in ' + esc(t.name) + '"', 'aria-label="' + esc(t.name) + ' 每月警方記錄罪案宗數"'); }

function zhTownPage(t, D) {
  const c = t.crime, s = t.schools, cats = topCats(t, 3), cn = zhCounty(D), tp = townPath(t), U = unitOf(D);
  const faq = [
    [t.name + ' 治安好嗎？罪案多不多？', zhCrimeSentence(t, D)],
    [t.name + ' 最常見的罪案類型是什麼？', U.zhC + ' ' + D.radiusM + ' 米範圍內，記錄最多的類別是 ' + cats.map(x => zhCat(x.c) + '（' + x.pct + '%）').join('、') + '。'],
    [t.name + ' 附近有好學校嗎？', zhSchoolSentence(t, D) + '本頁不評級學校，決定前請查看 Ofsted 報告及學校自己的資料。'],
  ];
  const nearby = t.nearby.length ? `<h2>附近${U.zh}</h2><ul>${t.nearby.map(o => `<li><a href="${zhPath(townPath(o))}">${esc(o.name)}</a>：在 ${D.count} 個${U.zh}中罪案宗數由低至高排第 ${o.rank} 位</li>`).join('')}</ul>` : '';
  const body = `<p>${esc(zhCrimeSentence(t, D))}</p>
<div class="card"><table><tr><th>項目</th><th class="n">${esc(t.name)}</th></tr>
<tr><td>過去 12 個月警方記錄罪案</td><td class="n">${num(c.total)} 宗</td></tr>
<tr><td>平均每月</td><td class="n">${num(c.perMonth)} 宗</td></tr>
${t.indexable ? `<tr><td>排名（1 = ${D.count} 個 ${esc(D.countyName)} ${U.zh}中罪案最少）</td><td class="n">${t.rank}</td></tr>` : ''}
<tr><td>1 英里內公立小學</td><td class="n">${s.primary1mi} 間</td></tr>
<tr><td>3 英里內公立中學</td><td class="n">${s.secondary3mi} 間</td></tr>
<tr><td>2 英里內私立（independent）學校</td><td class="n">${s.independent2mi} 間</td></tr></table></div>
${zhCta(t, D)}
<div class="links"><a href="${zhPath(tp)}/crime">${esc(t.name)} 罪案詳情 →</a><a href="${zhPath(tp)}/schools">${esc(t.name)} 附近學校 →</a></div>
<h2>學校</h2><p>${esc(zhSchoolSentence(t, D))}</p>
<h2>常見問題</h2>${faq.map(f => `<h3>${esc(f[0])}</h3><p>${esc(f[1])}</p>`).join('')}
${nearby}${zhStamp(D)}`;
  const ld = [{ '@context': 'https://schema.org', '@type': 'FAQPage', inLanguage: 'zh-HK', mainEntity: faq.map(f => ({ '@type': 'Question', name: f[0], acceptedAnswer: { '@type': 'Answer', text: f[1] } })) },
    { '@context': 'https://schema.org', '@type': 'Place', name: t.name + ', ' + D.countyName, geo: { '@type': 'GeoCoordinates', latitude: t.lat, longitude: t.lng } }];
  return layout({ D,
    lang: 'zh', title: t.name + '（' + zhCountyIn(D) + '）治安、罪案及學校一覽｜Nest UK',
    desc: t.name + ' 過去 12 個月錄得 ' + num(c.total) + ' 宗警方記錄罪案' + (t.indexable ? '，在 ' + D.count + ' 個 ' + D.countyName + ' ' + U.zh + '中由低至高排第 ' + t.rank + ' 位' : '') + '。1 英里內有 ' + s.primary1mi + ' 間公立小學、3 英里內有 ' + s.secondary3mi + ' 間公立中學。資料來自 Police.uk 及英國教育部，每月更新。',
    path: zhPath(tp), h1: t.name + '（' + zhCountyIn(D) + '）：治安與學校概覽', body, noindex: !t.indexable, ld,
    crumbs: [zhCrumbHome, [cn, zhPath('/uk/' + t.county)], [t.name, zhPath(tp)]],
  });
}
function zhCrimePage(t, D) {
  const c = t.crime, cn = zhCounty(D), tp = townPath(t), U = unitOf(D), cats = Object.entries(c.cats).sort((a, b) => b[1] - a[1]);
  const peak = c.months.slice().sort((a, b) => b.n - a.n)[0], low = c.months.slice().sort((a, b) => a.n - b.n)[0];
  const body = `<p>${esc(zhCrimeSentence(t, D))}</p>
<h2>每月警方記錄罪案</h2>${zhBarChart(t)}
<p class="mut">最多的一個月：${esc(zhMonth(peak.m))}（${peak.n} 宗）。最少的一個月：${esc(zhMonth(low.m))}（${low.n} 宗）。</p>
<h2>罪案類型</h2><table><tr><th>類別</th><th class="n">宗數</th><th class="n">佔比</th></tr>
${cats.map(([k, n]) => `<tr><td>${esc(zhCat(k))}</td><td class="n">${num(n)}</td><td class="n">${Math.round(n / c.total * 100)}%</td></tr>`).join('')}</table>
<h2>如何解讀</h2><p>Police.uk 只記錄每宗罪案的大約位置，這裏統計的是以${U.zhAround}為中心、邊長約 ${D.radiusM * 2} 米的範圍。繁忙的商業街記錄的罪案會比寧靜的住宅街多，所以請把數字當作比較不同地區的參考，而不是某條街的保證。</p>
${zhCta(t, D)}<p><a href="${zhPath(tp)}">← ${esc(t.name)} 概覽</a> · <a href="${zhPath(bestPath(D))}">${esc(D.countyName)} 最安全${U.zh}排名</a></p>${zhStamp(D)}`;
  return layout({ D,
    lang: 'zh', title: t.name + ' 治安：12 個月錄得 ' + num(c.total) + ' 宗罪案｜Nest UK',
    desc: t.name + '（' + zhCountyIn(D) + '）過去 12 個月錄得 ' + num(c.total) + ' 宗警方記錄罪案，附每月走勢及罪案類型。' + (cats.length ? '最多的類別：' + zhCat(cats[0][0]) + '。' : ''),
    path: zhPath(tp) + '/crime', h1: t.name + ' 治安及罪案數字', body, noindex: !t.indexable,
    crumbs: [zhCrumbHome, [cn, zhPath('/uk/' + t.county)], [t.name, zhPath(tp)], ['罪案', zhPath(tp) + '/crime']],
  });
}
function zhSchoolTable(list) {
  if (!list.length) return '<p>英國教育部資料中，附近沒有找到公立學校。</p>';
  return `<table><tr><th>學校</th><th class="n">距離</th></tr>${list.map(x => `<tr><td><a href="${gias(x.urn)}" rel="nofollow noopener">${esc(x.name)}</a>${x.faith ? ' <span class="mut">（宗教學校）</span>' : ''}${x.all ? ' <span class="mut">（一條龍學校）</span>' : ''}</td><td class="n">${zhMiles(x.d)} · ${zhWalk(x.d)}</td></tr>`).join('')}</table>`;
}
function zhSchoolsPage(t, D) {
  const s = t.schools, cn = zhCounty(D), tp = townPath(t), U = unitOf(D);
  const body = `<p>${esc(zhSchoolSentence(t, D))}</p>
<h2>最近的公立小學（state primary）</h2>${zhSchoolTable(s.nearestPrimary)}
<h2>最近的公立中學（state secondary）</h2>${zhSchoolTable(s.nearestSecondary)}
<p>2 英里內有 ${s.independent2mi} 間私立（independent，需繳學費）學校，不計入上面的數字。</p>
<h2>如何解讀</h2><p>學校類別來自英國教育部登記冊（GIAS），所以 academy 及 free school 都算公立學校。距離是由${U.zhAround}起計的直線距離；學校的入學名額分配以學區及入學準則為準，並非只看距離，請向學校及當地議會查詢。</p>
${zhCta(t, D)}<p><a href="${zhPath(tp)}">← ${esc(t.name)} 概覽</a></p>${zhStamp(D)}`;
  return layout({ D,
    lang: 'zh', title: t.name + ' 附近學校：公立小學及中學一覽｜Nest UK',
    desc: t.name + '（' + zhCountyIn(D) + '）1 英里內有 ' + s.primary1mi + ' 間公立小學、3 英里內有 ' + s.secondary3mi + ' 間公立中學，附距離及英國教育部資料連結。',
    path: zhPath(tp) + '/schools', h1: t.name + ' 附近學校', body, noindex: !t.indexable,
    crumbs: [zhCrumbHome, [cn, zhPath('/uk/' + t.county)], [t.name, zhPath(tp)], ['學校', zhPath(tp) + '/schools']],
  });
}
function zhRankingTable(D) {
  return `<table><tr><th class="n">#</th><th>${unitOf(D).zh}</th><th class="n">12 個月罪案宗數</th><th class="n">每月</th></tr>${D.ranked.map(t => `<tr><td class="n">${t.rank}</td><td><a href="${zhPath(townPath(t))}">${esc(t.name)}</a></td><td class="n">${num(t.crime.total)}</td><td class="n">${num(t.crime.perMonth)}</td></tr>`).join('')}</table>`;
}
function zhCountyPage(D) {
  const cn = zhCounty(D), U = unitOf(D);
  const body = `<p>我們比較 ${D.count} 個 ${esc(D.countyName)} ${U.zh}，以截至 ${esc(zhMonth(D.latest))} 的 12 個月內、${U.zhC} ${D.radiusM} 米範圍的警方記錄罪案宗數作比較，並列出每個${U.zh}附近的學校情況。${U.zh}中位數為 ${num(D.median)} 宗。適合計劃移居英國（包括 BNO 簽證持有人）、正在比較 ${esc(D.countyName)} 不同${U.zh}的家庭參考。</p>
<p><a href="${zhPath(bestPath(D))}">查看完整排名：${esc(D.countyName)} 最安全${U.zh} →</a></p>
<h2>${esc(D.countyName)} 所有${U.zh}</h2><ul>${D.ranked.map(t => `<li><a href="${zhPath(townPath(t))}">${esc(t.name)}</a></li>`).join('')}</ul>${zhStamp(D)}`;
  return layout({ D,
    lang: 'zh', title: cn + U.zh + '比較：治安及學校｜Nest UK',
    desc: '比較 ' + D.count + ' 個 ' + D.countyName + ' ' + U.zh + '的警方記錄罪案及附近公立學校，資料來自 Police.uk 及英國教育部，每月更新。',
    path: zhPath('/uk/' + D.county), h1: cn + U.zh + '比較：治安及學校', body,
    crumbs: [zhCrumbHome, [cn, zhPath('/uk/' + D.county)]],
  });
}
function zhRankingPage(D) {
  const first = D.ranked[0], last = D.ranked[D.ranked.length - 1], cn = zhCounty(D), U = unitOf(D);
  const body = `<p>在我們比較的 ${D.count} 個 ${esc(D.countyName)} ${U.zh}中，${esc(first.name)} 記錄的罪案最少（12 個月 ${num(first.crime.total)} 宗），${esc(last.name)} 最多（${num(last.crime.total)} 宗）。數字為截至 ${esc(zhMonth(D.latest))} 的 12 個月內，各${U.zh}中心 ${D.radiusM} 米範圍的警方記錄罪案宗數。</p>
${zhRankingTable(D)}<p class="mut">這是${U.zhC}附近的罪案宗數，不是按居民人口計算的比率。有商店、車站及夜生活的${U.zhHub}，記錄的罪案會比周邊住宅區多，所以排名較後的${U.zh}，其住宅街道不一定較不安全。請把排名當作起點，再查看確實地址。</p>${zhStamp(D)}`;
  return layout({ D,
    lang: 'zh', title: cn + '最安全' + U.zh + '排名（按警方記錄罪案）｜Nest UK',
    desc: D.count + ' 個 ' + D.countyName + ' ' + U.zh + '過去 12 個月警方記錄罪案排名：' + first.name + ' 最少，' + last.name + ' 最多。',
    path: zhPath(bestPath(D)), h1: cn + '最安全' + U.zh + '排名', body,
    crumbs: [zhCrumbHome, [cn, zhPath('/uk/' + D.county)], ['最安全' + U.zh, zhPath(bestPath(D))]],
  });
}
function routeZh(p, D) {
  const q = p.slice(3) || '/';
  if (q === '/uk/' + D.county) return zhCountyPage(D);
  if (q === bestPath(D)) return zhRankingPage(D);
  const m = q.match(new RegExp('^/uk/' + D.county + '/([a-z0-9-]+)(?:/(crime|schools))?$'));
  if (!m) return null;
  const t = D.bySlug.get(m[1]);
  if (!t || !t.crime) return null;
  return m[2] === 'crime' ? zhCrimePage(t, D) : m[2] === 'schools' ? zhSchoolsPage(t, D) : zhTownPage(t, D);
}

export function sitemapXml(arg) {
  const list = Array.isArray(arg) ? arg : [arg];
  const urls = ['/uk'];
  list.forEach(D => {
    urls.push('/uk/' + D.county, bestPath(D));
    D.ranked.forEach(t => { urls.push(townPath(t), townPath(t) + '/crime', townPath(t) + '/schools'); });
  });
  const lm = list.map(D => D.built || '').sort().pop() || new Date().toISOString().slice(0, 10);
  const alt = u => '<xhtml:link rel="alternate" hreflang="en-GB" href="' + SITE + u + '"/><xhtml:link rel="alternate" hreflang="zh-HK" href="' + SITE + '/zh' + u + '"/><xhtml:link rel="alternate" hreflang="x-default" href="' + SITE + u + '"/>';
  const entry = (loc, u, withAlt) => '  <url><loc>' + SITE + loc + '</loc><lastmod>' + lm + '</lastmod>' + (withAlt ? alt(u) : '') + '</url>';
  const lines = ['  <url><loc>' + SITE + '/</loc><lastmod>' + lm + '</lastmod></url>'];
  urls.forEach(u => { lines.push(entry(u, u, true)); lines.push(entry('/zh' + u, u, true)); });
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' + lines.join('\n') + '\n</urlset>\n';
}
const staticSitemap = () => '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>' + SITE + '/</loc></url>\n</urlset>\n';

/* ------------------------------ all-regions page ------------------------------ */
export function hubPage(Ds) {
  const rows = Ds.map(D => { const U = unitOf(D); return `<tr><td><a href="/uk/${D.county}">${esc(D.countyName)}</a></td><td class="n">${D.count} ${U.pl}</td><td class="n"><a href="${bestPath(D)}">Safest ${U.pl} →</a></td></tr>`; }).join('');
  const body = `<p>Compare towns and neighbourhoods by recorded crime in the last 12 months and the state schools nearby, using Police.uk and Department for Education data. Pick a place to see how each area compares, then check an exact address.</p>
<div class="card"><table><tr><th>Place</th><th class="n">Compared</th><th class="n">Ranking</th></tr>${rows}</table></div>
<p class="mut">Updated monthly. Figures are recorded crimes near the centre of each area, not a rate per resident.</p>`;
  return layout({ hub: true,
    title: 'UK area guides: crime and schools by town and neighbourhood | Nest UK',
    desc: 'Compare UK towns and neighbourhoods by recorded crime and nearby state schools, using Police.uk and Department for Education data. Updated monthly.',
    path: '/uk', h1: 'Area guides: crime and schools by town and neighbourhood', body,
    crumbs: [['Home', '/'], ['Area guides', '/uk']],
  });
}
export function zhHubPage(Ds) {
  const rows = Ds.map(D => { const U = unitOf(D); return `<tr><td><a href="${zhPath('/uk/' + D.county)}">${esc(zhCounty(D))}</a></td><td class="n">${D.count} 個${U.zh}</td><td class="n"><a href="${zhPath(bestPath(D))}">最安全${U.zh} →</a></td></tr>`; }).join('');
  const body = `<p>按過去 12 個月的警方記錄罪案及附近公立學校，比較英國各地的市鎮及街區，資料來自 Police.uk 及英國教育部。先揀地區，睇睇各處的比較，再查看確實地址。</p>
<div class="card"><table><tr><th>地區</th><th class="n">比較數目</th><th class="n">排名</th></tr>${rows}</table></div>
<p class="mut">每月更新。數字為各地區中心附近的警方記錄罪案宗數，並非按居民人口計算的比率。</p>`;
  return layout({ hub: true,
    lang: 'zh', title: '英國地區指南：各市鎮及街區的治安與學校｜Nest UK',
    desc: '按警方記錄罪案及附近公立學校，比較英國各地的市鎮及街區。資料來自 Police.uk 及英國教育部，每月更新。',
    path: zhPath('/uk'), h1: '地區指南：治安與學校', body,
    crumbs: [zhCrumbHome, ['地區指南', zhPath('/uk')]],
  });
}

/* ----------------------------- routing ----------------------------- */
const html = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600, s-maxage=86400' } });

// Which region a path belongs to: /uk/<region>/..., /best/safest-towns-in-<region>, and the same under /zh.
export function countyFromPath(pathname) {
  const m = String(pathname).replace(/\/+$/, '').match(/^(?:\/zh)?(?:\/uk\/([a-z0-9-]+)|\/best\/safest-(?:towns|areas)-in-([a-z0-9-]+))(?:\/|$)/);
  return m ? (m[1] || m[2]) : null;
}

export function route(pathname, D) {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p.startsWith('/zh/')) return routeZh(p, D);
  if (p === '/uk/' + D.county) return countyPage(D);
  if (p === bestPath(D)) return rankingPage(D);
  const m = p.match(new RegExp('^/uk/' + D.county + '/([a-z0-9-]+)(?:/(crime|schools))?$'));
  if (!m) return null;
  const t = D.bySlug.get(m[1]);
  if (!t || !t.crime) return null;
  return m[2] === 'crime' ? crimePage(t, D) : m[2] === 'schools' ? schoolsPage(t, D) : townPage(t, D);
}

const xml = body => new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
const notAvailable = () => html('<!doctype html><title>Not available yet</title><meta name="robots" content="noindex"><p>These pages are not available yet.</p>', 404);

export async function seoHandler(request, env, ctx, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('method not allowed', { status: 405 });
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const idx = await loadIndex(env, url.origin);
  const loadAll = async () => (await Promise.all(idx.regions.map(r => loadAreas(env, url.origin, r.county)))).filter(Boolean);
  if (p === '/sitemap.xml') {
    const Ds = idx ? await loadAll() : [];
    return xml(Ds.length ? sitemapXml(Ds) : staticSitemap());
  }
  if (!idx) return notAvailable();
  if (p === '/uk' || p === '/zh/uk') {
    const Ds = await loadAll();
    return Ds.length ? html(p === '/uk' ? hubPage(Ds) : zhHubPage(Ds)) : notAvailable();
  }
  const county = countyFromPath(p);
  const D = county ? await loadAreas(env, url.origin, county) : null;
  const page = D ? route(url.pathname, D) : null;
  if (page) return html(page);
  const back = D ? '<p><a href="/uk/' + D.county + '">See all ' + esc(D.countyName) + ' ' + unitOf(D).pl + '</a></p>' : '<p><a href="/uk">See all area guides</a></p>';
  return html(layout({ title: 'Page not found | Nest UK', desc: 'Page not found', path: url.pathname, h1: 'Page not found', noindex: true, crumbs: [['Home', '/']], body: back }), 404);
}
