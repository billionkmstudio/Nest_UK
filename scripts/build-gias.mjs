#!/usr/bin/env node
/*
 * Build public/data/schools.json from the DfE "Get Information about Schools" (GIAS) all-establishment CSV.
 *
 *   node scripts/build-gias.mjs <edubasealldataYYYYMMDD.csv> [out.json] [--built YYYY-MM-DD] [--min N]
 *
 * Source: https://get-information-schools.service.gov.uk/Downloads  (Open Government Licence v3.0)
 * The classification rules live in public/gias.js so the site, this script and the tests agree.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const G = require('../public/gias.js');

/* ---------- CSV (RFC 4180: quoted fields, doubled quotes, newlines inside quotes) ---------- */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', i = 0, q = false;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { q = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* ---------- British National Grid (OSGB36 easting/northing) -> WGS84 lat/lng ---------- */
const RAD = Math.PI / 180;
export function osgbToWgs84(E, N) {
  /* 1. grid -> OSGB36 lat/lon on the Airy 1830 ellipsoid (Ordnance Survey guide, inverse transverse Mercator) */
  const a = 6377563.396, b = 6356256.909, F0 = 0.9996012717;
  const phi0 = 49 * RAD, lam0 = -2 * RAD, N0 = -100000, E0 = 400000;
  const e2 = 1 - (b * b) / (a * a), n = (a - b) / (a + b), n2 = n * n, n3 = n * n * n;
  let phi = phi0, M = 0;
  do {
    phi = (N - N0 - M) / (a * F0) + phi;
    const Ma = (1 + n + (5 / 4) * n2 + (5 / 4) * n3) * (phi - phi0);
    const Mb = (3 * n + 3 * n2 + (21 / 8) * n3) * Math.sin(phi - phi0) * Math.cos(phi + phi0);
    const Mc = ((15 / 8) * n2 + (15 / 8) * n3) * Math.sin(2 * (phi - phi0)) * Math.cos(2 * (phi + phi0));
    const Md = (35 / 24) * n3 * Math.sin(3 * (phi - phi0)) * Math.cos(3 * (phi + phi0));
    M = b * F0 * (Ma - Mb + Mc - Md);
  } while (Math.abs(N - N0 - M) >= 0.00001);
  const sin = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi), sec = 1 / cos;
  const nu = a * F0 / Math.sqrt(1 - e2 * sin * sin);
  const rho = a * F0 * (1 - e2) / Math.pow(1 - e2 * sin * sin, 1.5);
  const eta2 = nu / rho - 1;
  const t2 = tan * tan, t4 = t2 * t2, t6 = t4 * t2;
  const nu3 = nu * nu * nu, nu5 = nu3 * nu * nu, nu7 = nu5 * nu * nu;
  const VII = tan / (2 * rho * nu);
  const VIII = tan / (24 * rho * nu3) * (5 + 3 * t2 + eta2 - 9 * t2 * eta2);
  const IX = tan / (720 * rho * nu5) * (61 + 90 * t2 + 45 * t4);
  const X = sec / nu;
  const XI = sec / (6 * nu3) * (nu / rho + 2 * t2);
  const XII = sec / (120 * nu5) * (5 + 28 * t2 + 24 * t4);
  const XIIA = sec / (5040 * nu7) * (61 + 662 * t2 + 1320 * t4 + 720 * t6);
  const dE = E - E0, dE2 = dE * dE, dE3 = dE2 * dE, dE4 = dE2 * dE2, dE5 = dE3 * dE2, dE6 = dE4 * dE2, dE7 = dE5 * dE2;
  const lat36 = phi - VII * dE2 + VIII * dE4 - IX * dE6;
  const lon36 = lam0 + X * dE - XI * dE3 + XII * dE5 - XIIA * dE7;

  /* 2. OSGB36 -> WGS84: 7-parameter Helmert (OS guide values, OSGB36 to ETRS89) */
  const sx = Math.sin(lat36), cx = Math.cos(lat36);
  const nu36 = a / Math.sqrt(1 - e2 * sx * sx);
  const x1 = nu36 * cx * Math.cos(lon36), y1 = nu36 * cx * Math.sin(lon36), z1 = nu36 * (1 - e2) * sx;
  const tx = 446.448, ty = -125.157, tz = 542.060;
  const s = -20.4894e-6 ;
  const arc = Math.PI / 648000;
  const rx = 0.1502 * arc, ry = 0.2470 * arc, rz = 0.8421 * arc;
  const x2 = tx + (1 + s) * x1 - rz * y1 + ry * z1;
  const y2 = ty + rz * x1 + (1 + s) * y1 - rx * z1;
  const z2 = tz - ry * x1 + rx * y1 + (1 + s) * z1;
  const aW = 6378137, bW = 6356752.314245, e2W = 1 - (bW * bW) / (aW * aW);
  const p = Math.sqrt(x2 * x2 + y2 * y2);
  let lat = Math.atan2(z2, p * (1 - e2W)), prev;
  do {
    prev = lat;
    const nuW = aW / Math.sqrt(1 - e2W * Math.sin(lat) * Math.sin(lat));
    lat = Math.atan2(z2 + e2W * nuW * Math.sin(lat), p);
  } while (Math.abs(lat - prev) > 1e-12);
  const lon = Math.atan2(y2, x2);
  return { lat: lat / RAD, lng: lon / RAD, lat36: lat36 / RAD, lng36: lon36 / RAD };
}

/* ---------- build ---------- */
const NOT_SCHOOLS = /university|further education|sixth form college|higher education|children'?s centre|online provider|offshore|welsh establishment|institution funded by other government/i;
const OPEN = /^open/i;
const NEED = ['URN', 'EstablishmentName', 'TypeOfEstablishment (name)', 'EstablishmentTypeGroup (name)',
  'EstablishmentStatus (name)', 'PhaseOfEducation (name)', 'ReligiousCharacter (name)', 'Easting', 'Northing'];

export function buildRows(records) {
  const head = records[0] || [];
  const col = {};
  head.forEach((h, i) => { col[String(h).replace(/^﻿/, '').trim()] = i; });
  const missing = NEED.filter(k => !(k in col));
  if (missing.length) {
    const err = new Error('Missing expected GIAS columns: ' + missing.join(', ') + '\nColumns found: ' + Object.keys(col).join(' | '));
    err.code = 'GIAS_COLUMNS';
    throw err;
  }
  const rows = [], stat = { total: records.length - 1, closed: 0, nonSchool: 0, noCoords: 0, S: 0, I: 0, P: 0 };
  for (let r = 1; r < records.length; r++) {
    const x = records[r];
    if (x.length < head.length / 2) continue;
    const status = x[col['EstablishmentStatus (name)']];
    if (!OPEN.test(status)) { stat.closed++; continue; }
    const typeName = x[col['TypeOfEstablishment (name)']];
    if (NOT_SCHOOLS.test(typeName)) { stat.nonSchool++; continue; }
    const E = Number(x[col['Easting']]), N = Number(x[col['Northing']]);
    if (!E || !N) { stat.noCoords++; continue; }
    const urn = Number(x[col['URN']]);
    if (!urn) continue;
    const cls = G.classifyEstablishment(typeName, x[col['EstablishmentTypeGroup (name)']]);
    const ll = osgbToWgs84(E, N);
    rows.push([urn, x[col['EstablishmentName']], cls, G.mapPhase(x[col['PhaseOfEducation (name)']]),
      Math.round(ll.lat * 1e5) / 1e5, Math.round(ll.lng * 1e5) / 1e5, G.hasFaith(x[col['ReligiousCharacter (name)']])]);
    stat[cls]++;
  }
  rows.sort((p, q) => p[0] - q[0]);
  return { rows, stat };
}

function main() {
  const args = process.argv.slice(2);
  const flag = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
  const built = flag('--built', new Date().toISOString().slice(0, 10));
  const min = Number(flag('--min', 20000));
  const [csvPath, outArg] = args;
  if (!csvPath) { console.error('Usage: node scripts/build-gias.mjs <edubasealldata.csv> [out.json] [--built YYYY-MM-DD] [--min N]'); process.exit(2); }
  const out = outArg || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'schools.json');
  const text = fs.readFileSync(csvPath).toString('latin1');   // GIAS CSV is Windows-1252
  const { rows, stat } = buildRows(parseCsv(text));
  console.log('GIAS records:', stat.total, '| kept:', rows.length, '| state:', stat.S, '| independent:', stat.I, '| special:', stat.P,
    '| closed:', stat.closed, '| non-school:', stat.nonSchool, '| no coords:', stat.noCoords);
  if (rows.length < min) {
    console.error('Refusing to write: only ' + rows.length + ' schools (expected at least ' + min + '). The download may be incomplete.');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ v: 1, built, rows }));
  console.log('Wrote', out, (fs.statSync(out).size / 1024).toFixed(0) + ' KB');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
