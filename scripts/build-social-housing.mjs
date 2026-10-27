// Builds public/data/social-housing.json: council housing stock and affordable housing completions per local authority.
//
//   node scripts/build-social-housing.mjs --ahs AHS_open_data.csv --t116 Live_Table_116.ods --t115 Live_Table_115.ods \
//        [--t1008 Live_Tables_1006_to_1008_Completions.ods] [--census scripts/census2021-social-ltla.json] [--out public/data/social-housing.json]
//
// Sources (MHCLG, Open Government Licence v3.0), England only:
//   --ahs   Affordable Housing Supply open data CSV (additional affordable homes, by current local authority, tenure and year)
//   --t116  Live Table 116: local authority (council) owned dwelling stock, by district, from 1979
//   --t115  Live Table 115: private registered provider (housing association) stock, by district, from 1997
//   --t1008 Live Tables 1006 to 1008 (Completions): used only to cross-check the CSV totals; the build fails if they disagree
//   --census  Census 2021 council / other social rented households per authority (written by build-social-oa.mjs); used to set `cr`,
//             the flag for authorities where the Census "council" answers agree with the council's own stock
// Tables 115 and 116 report old districts (for example Allerdale, Carlisle and Copeland); Table 116 maps each one to its
// current authority (LAD24CD, for example Cumberland), and that mapping is used for both tables.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import XLSX from 'xlsx';

// the page uses the same name rule to find an authority
const { norm } = createRequire(import.meta.url)('../public/social.js');

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const OUT = args.out || 'public/data/social-housing.json';
const YEARS_KEPT = 5;
// order of the numbers in each supply year array
// un = completions whose tenure the data does not record (they still count in the official totals)
export const KEYS = ['sr', 'ar', 'ir', 'so', 'aho', 'fh', 'un'];
const TENURE_KEY = {
  'Social Rent': 'sr',
  'Affordable Rent': 'ar',
  'London Affordable Rent': 'ar',   // counted with affordable rent, as the official tables do
  'Intermediate Rent': 'ir',
  'Shared Ownership': 'so',
  'Affordable Home Ownership': 'aho',
  'First Homes': 'fh',
  'Unknown': 'un',
};

export function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const num = v => {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.replace(/,/g, '').trim();
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
};

function sheetRows(file, sheet) {
  const wb = XLSX.readFile(file);
  if (!wb.Sheets[sheet]) throw new Error(file + ': no sheet ' + sheet + ' (found ' + wb.SheetNames.join(', ') + ')');
  return XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: true, defval: null });
}
function findHeader(rows, firstCell) {
  const i = rows.findIndex(r => r && String(r[0] || '').trim() === firstCell);
  if (i < 0) throw new Error('header row starting with "' + firstCell + '" not found');
  return i;
}

/* Table 116 / 115: stock per current authority at the latest year column */
export function readStock(file116, file115) {
  const r116 = sheetRows(file116, 'Local_Authority_Data');
  const h116 = findHeader(r116, 'Local authority code');
  const head116 = r116[h116].map(x => String(x == null ? '' : x).trim());
  const iOld = head116.indexOf('Local authority code'), iCur = head116.indexOf('LAD24CD'), iCurName = head116.indexOf('LAD24NM');
  if (iCur < 0 || iCurName < 0) throw new Error('Table 116: LAD24CD / LAD24NM columns not found');
  const yearCols = head116.map((h, i) => /^\d{4}$/.test(h) ? { y: +h, i } : null).filter(Boolean);
  const last116 = yearCols[yearCols.length - 1];

  const oldToCur = new Map(), curName = new Map();
  const council = new Map();
  for (const r of r116.slice(h116 + 1)) {
    const old = r && r[iOld], cur = r && r[iCur];
    if (!old || !cur || !/^E\d{8}$/.test(String(cur))) continue;
    oldToCur.set(String(old), String(cur));
    curName.set(String(cur), String(r[iCurName]));
    const v = num(r[last116.i]);
    const e = council.get(String(cur)) || { sum: 0, seen: false };
    if (v !== null) { e.sum += v; e.seen = true; }
    council.set(String(cur), e);
  }

  const r115 = sheetRows(file115, 'Local_Authority_Data');
  const h115 = findHeader(r115, 'Region code');
  const head115 = r115[h115].map(x => String(x == null ? '' : x).trim());
  const iOld115 = head115.indexOf('Local authority code');
  const yc115 = head115.map((h, i) => /^\d{4}$/.test(h) ? { y: +h, i } : null).filter(Boolean);
  const last115 = yc115[yc115.length - 1];
  if (last115.y !== last116.y) throw new Error('Tables 115 and 116 end in different years: ' + last115.y + ' vs ' + last116.y);
  const ha = new Map(), unmapped = [];
  for (const r of r115.slice(h115 + 1)) {
    const old = r && r[iOld115];
    if (!old || !/^E\d{8}$/.test(String(old))) continue;
    const cur = oldToCur.get(String(old)) || (curName.has(String(old)) ? String(old) : null);
    const v = num(r[last115.i]);
    if (!cur) { if (v) unmapped.push([old, v]); continue; }
    const e = ha.get(cur) || { sum: 0, seen: false };
    if (v !== null) { e.sum += v; e.seen = true; }
    ha.set(cur, e);
  }
  if (unmapped.length) throw new Error('Table 115 has stock for codes missing from Table 116: ' + JSON.stringify(unmapped.slice(0, 5)));
  return { year: last116.y, curName, council, ha, oldToCur };
}

/* Affordable housing supply CSV: completions by current authority, year and tenure group */
export function readSupply(csvFile) {
  const rows = parseCsv(fs.readFileSync(csvFile, 'utf8'));
  const head = rows[0].map(s => s.trim());
  const col = n => { const i = head.indexOf(n); if (i < 0) throw new Error('CSV column not found: ' + n); return i; };
  const iCode = col('LA code 202425'), iName = col('LA name 202425'), iYear = col('Year'), iTen = col('Tenure'), iKind = col('Completions'), iUnits = col('Units');
  const data = new Map();   // code -> year -> [6]
  const names = new Map();
  let skipped = 0, skippedUnits = 0;
  for (const r of rows.slice(1)) {
    if (r[iKind] !== 'Completion') continue;
    const units = num(r[iUnits]);
    if (units === null) continue;
    const key = TENURE_KEY[r[iTen]];
    const code = r[iCode];
    if (!key || !/^E\d{8}$/.test(code)) { skipped++; skippedUnits += units; continue; }
    names.set(code, r[iName]);
    if (!data.has(code)) data.set(code, new Map());
    const y = data.get(code);
    if (!y.has(r[iYear])) y.set(r[iYear], [0, 0, 0, 0, 0, 0, 0]);
    y.get(r[iYear])[KEYS.indexOf(key)] += units;
  }
  return { data, names, skipped, skippedUnits };
}

/* Cross-check CSV totals with Live Table 1008C (total completions by authority and year).
   1008C reports the authority at the time, so abolished districts are first added up under the current authority
   using the same old-to-current mapping as Table 116. */
export function crossCheck(supply, file1008, years, oldToCur, nameToCur = new Map()) {
  const rows = sheetRows(file1008, 'Live_Table_1008C');
  const h = findHeader(rows, 'Region Code');
  const head = rows[h].map(x => String(x == null ? '' : x).trim());
  const iCode = head.indexOf('Local Authority Code'), iName = head.indexOf('Local Authority Name');
  const official = new Map();   // current code -> year -> total
  const recoded = {};           // code used by 1008C -> code used here, when only the code changed (same name)
  const unmapped = new Set();
  for (const r of rows.slice(h + 1)) {
    const old = r && r[iCode];
    if (!old || !/^E\d{8}$/.test(String(old))) continue;
    let cur = oldToCur.get(String(old));
    if (!cur) {
      const byName = nameToCur.get(norm(r[iName]));
      if (byName && byName !== String(old)) { cur = byName; recoded[String(old)] = byName; }
    }
    if (!cur) { unmapped.add(String(old)); continue; }
    if (!official.has(cur)) official.set(cur, new Map());
    const m = official.get(cur);
    for (const yr of years) {
      const ci = head.indexOf(yr);
      const v = ci < 0 ? null : num(r[ci]);
      if (v !== null) m.set(yr, (m.get(yr) || 0) + v);
    }
  }
  const bad = [];
  let compared = 0;
  for (const [cur, m] of official) {
    for (const yr of years) {
      if (!m.has(yr)) continue;
      const mine = ((supply.data.get(cur) || new Map()).get(yr) || [0, 0, 0, 0, 0, 0, 0]).reduce((a, b) => a + b, 0);
      compared++;
      if (mine !== m.get(yr)) bad.push({ code: cur, yr, csv: mine, table1008C: m.get(yr) });
    }
  }
  // authorities that have completions in the CSV but no row at all in 1008C
  for (const [cur, ym] of supply.data) {
    if (official.has(cur)) continue;
    for (const yr of years) {
      const mine = (ym.get(yr) || [0]).reduce((a, b) => a + b, 0);
      if (mine) bad.push({ code: cur, yr, csv: mine, table1008C: 'missing' });
    }
  }
  return { compared, bad, unmapped: [...unmapped], recoded };
}

/* Census 2021 asked households who their landlord is. Where a council has handed its homes to a housing association many
   tenants still answer "council", so the Census "council" count is far above the council's own stock (Surrey Heath: 477
   against 11). The nearby view therefore only splits council from housing association where the two agree.
   Census answers per local authority come from scripts/census2021-social-ltla.json (written by build-social-oa.mjs). */
export const COUNCIL_AGREE = 0.2;      // Census council count within 20% of the council's stock
export const COUNCIL_MIN_STOCK = 1000; // below this the percentages mean little
export function councilSplitReliable(stock, censusCouncil) {
  return stock !== null && stock >= COUNCIL_MIN_STOCK && censusCouncil !== null && Math.abs(censusCouncil - stock) / stock <= COUNCIL_AGREE;
}
function readCensus(file, stock) {
  if (!file || !fs.existsSync(file)) return null;
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const sums = new Map(), unmapped = [];
  for (const [old, v] of Object.entries(j.la || {})) {
    const cur = stock.oldToCur.get(old) || (stock.curName.has(old) ? old : null);
    if (!cur) { unmapped.push(old); continue; }
    sums.set(cur, (sums.get(cur) || 0) + v[0]);
  }
  if (unmapped.length) throw new Error('Census local authorities missing from Table 116: ' + unmapped.join(', '));
  return sums;
}

export function build({ ahs, t116, t115, t1008, census }) {
  const stock = readStock(t116, t115);
  const censusCouncil = readCensus(census, stock);
  const supply = readSupply(ahs);
  // The CSV still uses E08000016 (Barnsley) and E08000019 (Sheffield); the stock tables use the codes since 2023.
  // Re-key those by name so that every authority has one code, and keep the old one as an alias.
  const nameToCode = new Map([...stock.curName].map(([code, n]) => [norm(n), code]));
  const csvAlias = {};
  for (const [code, ym] of [...supply.data]) {
    if (stock.curName.has(code)) continue;
    const to = nameToCode.get(norm(supply.names.get(code)));
    if (!to) throw new Error('Supply CSV authority not found in the stock tables: ' + code + ' ' + supply.names.get(code));
    supply.data.delete(code);
    supply.data.set(to, ym);
    supply.names.set(to, supply.names.get(code));
    csvAlias[code] = to;
  }
  const allYears = [...new Set([...supply.data.values()].flatMap(m => [...m.keys()]))].sort();
  const years = allYears.slice(-YEARS_KEPT);

  const nameToCur = new Map([...stock.curName].map(([code, n]) => [norm(n), code]));
  const check = t1008 ? crossCheck(supply, t1008, years, stock.oldToCur, nameToCur) : null;
  if (check && check.bad.length) {
    throw new Error('CSV totals differ from Live Table 1008C in ' + check.bad.length + ' of ' + check.compared + ' cells, e.g. ' + JSON.stringify(check.bad.slice(0, 5)));
  }

  if (check && check.unmapped.length) throw new Error('Live Table 1008C has authorities that could not be matched: ' + check.unmapped.join(', '));
  const codes = new Set([...stock.curName.keys(), ...supply.data.keys()]);
  const la = {}, names = {};
  for (const code of [...codes].sort()) {
    const n = stock.curName.get(code) || supply.names.get(code);
    const c = stock.council.get(code), h = stock.ha.get(code);
    const s = {};
    const ys = supply.data.get(code);
    for (const y of years) s[y] = ys && ys.get(y) ? ys.get(y) : [0, 0, 0, 0, 0, 0, 0];
    const cc = c && c.seen ? c.sum : null;
    la[code] = { n, c: cc, h: h && h.seen ? h.sum : null, s };
    if (censusCouncil) la[code].cr = councilSplitReliable(cc, censusCouncil.has(code) ? censusCouncil.get(code) : null) ? 1 : 0;
    names[norm(n)] = code;
    if (supply.names.get(code)) names[norm(supply.names.get(code))] = code;
  }
  return {
    out: {
      v: 1,
      built: new Date().toISOString().slice(0, 10),
      stockDate: stock.year + '-03-31',
      years,
      keys: KEYS,
      src: 'MHCLG Live Tables 115 and 116 (dwelling stock) and Affordable Housing Supply open data. Open Government Licence v3.0.',
      alias: Object.assign({}, check ? check.recoded : {}, csvAlias),   // other codes that postcodes.io may return for the same authority
      la, names,
    },
    report: { census: !!censusCouncil, stockYear: stock.year, years, supplySkipped: supply.skipped, supplySkippedUnits: supply.skippedUnits, check },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  if (!args.census) { const d = new URL('./census2021-social-ltla.json', import.meta.url).pathname; if (fs.existsSync(d)) args.census = d; }
  for (const k of ['ahs', 't116', 't115']) if (!args[k]) { console.error('missing --' + k); process.exit(2); }
  const { out, report } = build(args);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  const L = Object.values(out.la);
  const sum = f => L.reduce((a, x) => a + (f(x) || 0), 0);
  console.log('wrote', OUT, fs.statSync(OUT).size, 'bytes,', L.length, 'authorities');
  if (report.census) console.log('council split reliable (Census agrees with council stock within ' + COUNCIL_AGREE * 100 + '%): ' + L.filter(x => x.cr === 1).length + ' of ' + L.length + ' authorities');
  else console.log('no Census file: council split flags not written');
  console.log('stock at 31 March ' + report.stockYear + ': council', sum(x => x.c), ' housing association', sum(x => x.h));
  for (const y of out.years) console.log('completions ' + y + ': ' + sum(x => x.s[y].reduce((a, b) => a + b, 0)));
  console.log('CSV rows left out (no current authority code or unknown tenure):', report.supplySkipped, 'rows,', report.supplySkippedUnits, 'homes');
  if (report.check) console.log('cross-check vs Live Table 1008C:', report.check.compared, 'authority-year cells compared, all equal');
}
