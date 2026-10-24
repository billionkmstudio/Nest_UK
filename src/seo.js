// Nest UK – programmatic SEO pages, rendered from public/data/areas.json (built monthly by scripts/build-areas.mjs).
//   /uk/surrey                        county overview
//   /uk/surrey/<town>                 town page
//   /uk/surrey/<town>/crime           crime page
//   /uk/surrey/<town>/schools         schools page
//   /best/safest-towns-in-surrey      ranking
//   /sitemap.xml                      all indexable pages
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

function haversine(la1, ln1, la2, ln2) {
  const R = 6371000, r = Math.PI / 180, dLa = (la2 - la1) * r, dLn = (ln2 - ln1) * r;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* ------------------------------ data ------------------------------ */
let memo = { at: 0, data: null };
export async function loadAreas(env, origin) {
  if (memo.data && Date.now() - memo.at < 600000) return memo.data;
  try {
    const r = await env.ASSETS.fetch(new Request(origin + '/data/areas.json'));
    if (!r.ok) return null;
    const raw = await r.json();
    memo = { at: Date.now(), data: prepare(raw) };
    return memo.data;
  } catch (e) { return null; }
}
export function resetMemo() { memo = { at: 0, data: null }; }

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
  return { raw, towns, ranked, median, count: ranked.length, bySlug: new Map(towns.map(t => [t.slug, t])), countyName: raw.countyName, county: raw.county, latest: raw.latest, built: raw.built, radiusM: raw.radiusM };
}

/* ----------------------------- wording ----------------------------- */
function crimeSentence(t, D) {
  const c = t.crime, parts = [];
  parts.push(num(c.total) + ' crimes were recorded within ' + D.radiusM + ' m of the centre of ' + t.name + ' in the 12 months to ' + monthName(D.latest) + ', about ' + num(c.perMonth) + ' a month.');
  if (t.indexable) {
    const r = t.rank, n = D.count;
    if (r <= Math.ceil(n * 0.25)) parts.push('That is the ' + ordinal(r) + ' lowest of the ' + n + ' ' + D.countyName + ' towns compared, so it sits in the quieter quarter.');
    else if (r > n - Math.ceil(n * 0.25)) parts.push('That is the ' + ordinal(n - r + 1) + ' highest of the ' + n + ' ' + D.countyName + ' towns compared, so it sits in the busier quarter. Busy town centres record more crime because more people pass through, so this says little about the quieter residential streets around them.');
    else parts.push('That puts it ' + ordinal(r) + ' of ' + n + ' ' + D.countyName + ' towns, from lowest to highest.');
    if (t.vsMedian !== null && t.vsMedian > 100) parts.push('That is well above the median town, as larger town centres with shops and stations usually are.');
    else if (t.vsMedian !== null && Math.abs(t.vsMedian) >= 5) parts.push('It is ' + Math.abs(t.vsMedian) + '% ' + (t.vsMedian < 0 ? 'below' : 'above') + ' the median town.');
    else if (t.vsMedian !== null) parts.push('It is close to the median town.');
  }
  if (t.trend !== null && c.perMonth >= 20 && Math.abs(t.trend) >= 5) parts.push('The most recent months were ' + Math.abs(t.trend) + '% ' + (t.trend < 0 ? 'lower' : 'higher') + ' than the months before.');
  return parts.join(' ');
}
function topCats(t, n) {
  const e = Object.entries(t.crime.cats).sort((a, b) => b[1] - a[1]);
  return e.slice(0, n).map(([c, k]) => ({ c, k, pct: Math.round(k / t.crime.total * 100) }));
}
function schoolSentence(t) {
  const s = t.schools, p = s.nearestPrimary[0], q = s.nearestSecondary[0];
  const bits = [t.name + ' has ' + s.primary1mi + ' state primary ' + (s.primary1mi === 1 ? 'school' : 'schools') + ' within 1 mile and ' + s.secondary3mi + ' state secondary ' + (s.secondary3mi === 1 ? 'school' : 'schools') + ' within 3 miles of the town centre.'];
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

function layout({ title, desc, path: p, crumbs, h1, body, noindex, ld }) {
  const canonical = SITE + p;
  const bc = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c[0], item: SITE + c[1] })) };
  const ldAll = [bc].concat(ld || []).map(o => '<script type="application/ld+json">' + JSON.stringify(o).replace(/</g, '\\u003c') + '</script>').join('\n');
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(canonical)}">
${noindex ? '<meta name="robots" content="noindex,follow">' : ''}<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(canonical)}"><meta property="og:type" content="website">
<style>${CSS}</style>${ldAll}</head><body>
<header><a class="brand" href="/">Nest UK</a><a href="/">Check an address</a></header>
<main><nav class="crumbs">${crumbs.map((c, i) => i === crumbs.length - 1 ? esc(c[0]) : '<a href="' + esc(c[1]) + '">' + esc(c[0]) + '</a>').join(' › ')}</nav>
<h1>${esc(h1)}</h1>${body}</main>
<footer><p>Sources: crime data from <a href="https://data.police.uk/">data.police.uk</a>; school data from the Department for Education <a href="https://get-information-schools.service.gov.uk/">Get Information about Schools</a>. Contains public sector information licensed under the <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/">Open Government Licence v3.0</a>.</p>
<p>Figures are recorded crimes within about 600 m of the town centre, not a rate per resident, and busy town centres record more crime because more people pass through. Use them to compare areas, then check the exact address.</p></footer></body></html>`;
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
  const c = t.crime, s = t.schools, cats = topCats(t, 3);
  const faq = [
    ['How much crime is there in ' + t.name + '?', crimeSentence(t, D)],
    ['What are the most common crimes in ' + t.name + '?', 'The most common recorded categories within ' + D.radiusM + ' m of the centre are ' + cats.map(x => pretty(x.c).toLowerCase() + ' (' + x.pct + '%)').join(', ') + '.'],
    ['Are there good schools near ' + t.name + '?', schoolSentence(t) + ' School quality is not rated here: check Ofsted and the school’s own information before deciding.'],
  ];
  const nearby = t.nearby.length ? `<h2>Nearby towns</h2><ul>${t.nearby.map(o => `<li><a href="${townPath(o)}">${esc(o.name)}</a> – ${ordinal(o.rank)} of ${D.count} for lowest recorded crime</li>`).join('')}</ul>` : '';
  const body = `<p>${esc(crimeSentence(t, D))}</p>
<div class="card"><table><tr><th>Measure</th><th class="n">${esc(t.name)}</th></tr>
<tr><td>Recorded crimes, last 12 months</td><td class="n">${num(c.total)}</td></tr>
<tr><td>Average per month</td><td class="n">${num(c.perMonth)}</td></tr>
${t.indexable ? `<tr><td>Rank (1 = lowest crime of ${D.count} ${esc(D.countyName)} towns)</td><td class="n">${t.rank}</td></tr>` : ''}
<tr><td>State primary schools within 1 mile</td><td class="n">${s.primary1mi}</td></tr>
<tr><td>State secondary schools within 3 miles</td><td class="n">${s.secondary3mi}</td></tr>
<tr><td>Independent schools within 2 miles</td><td class="n">${s.independent2mi}</td></tr></table></div>
${cta(t, D)}
<div class="links"><a href="${townPath(t)}/crime">Crime in ${esc(t.name)} in detail →</a><a href="${townPath(t)}/schools">Schools near ${esc(t.name)} →</a></div>
<h2>Schools</h2><p>${esc(schoolSentence(t))}</p>
<h2>Frequently asked questions</h2>${faq.map(f => `<h3>${esc(f[0])}</h3><p>${esc(f[1])}</p>`).join('')}
${nearby}${stamp(D)}`;
  const ld = [{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(f => ({ '@type': 'Question', name: f[0], acceptedAnswer: { '@type': 'Answer', text: f[1] } })) },
    { '@context': 'https://schema.org', '@type': 'Place', name: t.name + ', ' + D.countyName, geo: { '@type': 'GeoCoordinates', latitude: t.lat, longitude: t.lng } }];
  return layout({
    title: t.name + ', ' + D.countyName + ': crime rate and schools | Nest UK',
    desc: num(c.total) + ' crimes recorded near ' + t.name + ' in the last 12 months' + (t.indexable ? ', ' + ordinal(t.rank) + ' lowest of ' + D.count + ' ' + D.countyName + ' towns' : '') + '. ' + s.primary1mi + ' state primaries within 1 mile. Updated monthly.',
    path: townPath(t), h1: t.name + ', ' + D.countyName + ': crime and schools at a glance', body, noindex: !t.indexable, ld,
    crumbs: [['Home', '/'], [D.countyName, '/uk/' + t.county], [t.name, townPath(t)]],
  });
}

function crimePage(t, D) {
  const c = t.crime, cats = Object.entries(c.cats).sort((a, b) => b[1] - a[1]);
  const peak = c.months.slice().sort((a, b) => b.n - a.n)[0], low = c.months.slice().sort((a, b) => a.n - b.n)[0];
  const body = `<p>${esc(crimeSentence(t, D))}</p>
<h2>Recorded crimes by month</h2>${barChart(t)}
<p class="mut">Busiest month: ${esc(monthName(peak.m))} (${peak.n}). Quietest month: ${esc(monthName(low.m))} (${low.n}).</p>
<h2>What kinds of crime</h2><table><tr><th>Category</th><th class="n">Crimes</th><th class="n">Share</th></tr>
${cats.map(([k, n]) => `<tr><td>${esc(pretty(k))}</td><td class="n">${num(n)}</td><td class="n">${Math.round(n / c.total * 100)}%</td></tr>`).join('')}</table>
<h2>How to read this</h2><p>Police.uk records the approximate location of each crime, and the count here covers a square about ${D.radiusM * 2} m across centred on the town. A busy high street records more crime than a quiet residential road, so a street-by-street check matters more than the town figure.</p>
${cta(t, D)}<p><a href="${townPath(t)}">← ${esc(t.name)} overview</a> · <a href="/best/safest-towns-in-${t.county}">Safest towns in ${esc(D.countyName)}</a></p>${stamp(D)}`;
  return layout({
    title: t.name + ' crime rate: ' + num(c.total) + ' recorded crimes in 12 months | Nest UK',
    desc: 'Crime in ' + t.name + ', ' + D.countyName + ': ' + num(c.total) + ' recorded crimes in the last 12 months, by month and category. Top category: ' + pretty(cats[0][0]).toLowerCase() + '.',
    path: townPath(t) + '/crime', h1: 'Crime in ' + t.name + ', ' + D.countyName, body, noindex: !t.indexable,
    crumbs: [['Home', '/'], [D.countyName, '/uk/' + t.county], [t.name, townPath(t)], ['Crime', townPath(t) + '/crime']],
  });
}

function schoolTable(list) {
  if (!list.length) return '<p>No state schools found nearby in the DfE data.</p>';
  return `<table><tr><th>School</th><th class="n">Distance</th></tr>${list.map(x => `<tr><td><a href="${gias(x.urn)}" rel="nofollow noopener">${esc(x.name)}</a>${x.faith ? ' <span class="mut">(faith school)</span>' : ''}${x.all ? ' <span class="mut">(all-through)</span>' : ''}</td><td class="n">${miles(x.d)} · ${walk(x.d)}</td></tr>`).join('')}</table>`;
}
function schoolsPage(t, D) {
  const s = t.schools;
  const body = `<p>${esc(schoolSentence(t))}</p>
<h2>Nearest state primary schools</h2>${schoolTable(s.nearestPrimary)}
<h2>Nearest state secondary schools</h2>${schoolTable(s.nearestSecondary)}
<p>There ${s.independent2mi === 1 ? 'is 1 independent (fee-paying) school' : 'are ' + s.independent2mi + ' independent (fee-paying) schools'} within 2 miles; these are not counted above.</p>
<h2>How to read this</h2><p>School types come from the Department for Education’s register (GIAS), so academies and free schools count as state schools. Distances are in a straight line from the town centre; a school’s admissions area, catchment and Ofsted rating matter more than distance, so check each school’s own page before choosing a home.</p>
${cta(t, D)}<p><a href="${townPath(t)}">← ${esc(t.name)} overview</a></p>${stamp(D)}`;
  return layout({
    title: 'Schools near ' + t.name + ', ' + D.countyName + ': state primary and secondary | Nest UK',
    desc: s.primary1mi + ' state primary schools within 1 mile and ' + s.secondary3mi + ' state secondary schools within 3 miles of ' + t.name + ', with distances and DfE links.',
    path: townPath(t) + '/schools', h1: 'Schools near ' + t.name + ', ' + D.countyName, body, noindex: !t.indexable,
    crumbs: [['Home', '/'], [D.countyName, '/uk/' + t.county], [t.name, townPath(t)], ['Schools', townPath(t) + '/schools']],
  });
}

function rankingTable(D) {
  return `<table><tr><th class="n">#</th><th>Town</th><th class="n">Crimes (12 mo)</th><th class="n">Per month</th></tr>${D.ranked.map(t => `<tr><td class="n">${t.rank}</td><td><a href="${townPath(t)}">${esc(t.name)}</a></td><td class="n">${num(t.crime.total)}</td><td class="n">${num(t.crime.perMonth)}</td></tr>`).join('')}</table>`;
}
function countyPage(D) {
  const body = `<p>We compare ${D.count} ${esc(D.countyName)} towns by recorded crime within ${D.radiusM} m of the town centre over the 12 months to ${esc(monthName(D.latest))}, and show the school picture for each. The median town recorded ${num(D.median)} crimes.</p>
<p><a href="/best/safest-towns-in-${D.county}">See the full ranking: safest towns in ${esc(D.countyName)} →</a></p>
<h2>All ${esc(D.countyName)} towns</h2><ul>${D.ranked.map(t => `<li><a href="${townPath(t)}">${esc(t.name)}</a></li>`).join('')}</ul>${stamp(D)}`;
  return layout({
    title: D.countyName + ' towns compared: crime and schools | Nest UK',
    desc: 'Compare ' + D.count + ' ' + D.countyName + ' towns by recorded crime and nearby state schools, using Police.uk and DfE data. Updated monthly.',
    path: '/uk/' + D.county, h1: D.countyName + ' towns: crime and schools compared', body,
    crumbs: [['Home', '/'], [D.countyName, '/uk/' + D.county]],
  });
}
function rankingPage(D) {
  const first = D.ranked[0], last = D.ranked[D.ranked.length - 1];
  const body = `<p>${esc(first.name)} recorded the fewest crimes of the ${D.count} ${esc(D.countyName)} towns we compared (${num(first.crime.total)} in 12 months), and ${esc(last.name)} the most (${num(last.crime.total)}). Counts are recorded crimes within ${D.radiusM} m of each town centre, 12 months to ${esc(monthName(D.latest))}.</p>
${rankingTable(D)}<p class="mut">This is a count of recorded crime near the centre, not a rate per resident. Town centres with shops, stations and nightlife record more crime than the surrounding residential streets, so a town ranked lower is not necessarily less safe to live in. Check the exact address.</p>${stamp(D)}`;
  return layout({
    title: 'Safest towns in ' + D.countyName + ' by recorded crime | Nest UK',
    desc: 'Ranking of ' + D.count + ' ' + D.countyName + ' towns by recorded crime in the last 12 months. ' + first.name + ' has the fewest, ' + last.name + ' the most.',
    path: '/best/safest-towns-in-' + D.county, h1: 'Safest towns in ' + D.countyName + ' by recorded crime', body,
    crumbs: [['Home', '/'], [D.countyName, '/uk/' + D.county], ['Safest towns', '/best/safest-towns-in-' + D.county]],
  });
}

export function sitemapXml(D) {
  const urls = ['/', '/uk/' + D.county, '/best/safest-towns-in-' + D.county];
  D.ranked.forEach(t => { urls.push(townPath(t), townPath(t) + '/crime', townPath(t) + '/schools'); });
  const lm = D.built || new Date().toISOString().slice(0, 10);
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(u => '  <url><loc>' + SITE + u + '</loc><lastmod>' + lm + '</lastmod></url>').join('\n') + '\n</urlset>\n';
}
const staticSitemap = () => '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>' + SITE + '/</loc></url>\n</urlset>\n';

/* ----------------------------- routing ----------------------------- */
const html = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600, s-maxage=86400' } });

export function route(pathname, D) {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/uk/' + D.county) return countyPage(D);
  if (p === '/best/safest-towns-in-' + D.county) return rankingPage(D);
  const m = p.match(new RegExp('^/uk/' + D.county + '/([a-z0-9-]+)(?:/(crime|schools))?$'));
  if (!m) return null;
  const t = D.bySlug.get(m[1]);
  if (!t || !t.crime) return null;
  return m[2] === 'crime' ? crimePage(t, D) : m[2] === 'schools' ? schoolsPage(t, D) : townPage(t, D);
}

export async function seoHandler(request, env, ctx, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('method not allowed', { status: 405 });
  const D = await loadAreas(env, url.origin);
  if (url.pathname === '/sitemap.xml') {
    return new Response(D ? sitemapXml(D) : staticSitemap(), { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
  }
  if (!D) return html('<!doctype html><title>Not available yet</title><meta name="robots" content="noindex"><p>These pages are not available yet.</p>', 404);
  const page = route(url.pathname, D);
  return page ? html(page) : html(layout({ title: 'Page not found | Nest UK', desc: 'Page not found', path: url.pathname, h1: 'Page not found', noindex: true, crumbs: [['Home', '/']], body: '<p><a href="/uk/' + D.county + '">See all ' + esc(D.countyName) + ' towns</a></p>' }), 404);
}
