/* Tests for the GIAS pipeline.  Run: node scripts/test-gias.mjs
 * The CSV below is a small SYNTHETIC fixture (invented schools, real GIAS column names and type names),
 * not real DfE data. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parseCsv, buildRows, osgbToWgs84 } from './build-gias.mjs';

const G = createRequire(import.meta.url)('../public/gias.js');
let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log('ok  -', name); };

ok('OSGB -> WGS84 matches the Ordnance Survey worked example', () => {
  const r = osgbToWgs84(651409.903, 313177.270);
  assert.ok(Math.abs(r.lat36 - 52.657570) < 1e-5, 'OSGB36 lat ' + r.lat36);
  assert.ok(Math.abs(r.lng36 - 1.717922) < 1e-5, 'OSGB36 lng ' + r.lng36);
  assert.ok(Math.abs(r.lat - 52.65800) < 2e-4, 'WGS84 lat ' + r.lat);
  assert.ok(Math.abs(r.lng - 1.71607) < 2e-4, 'WGS84 lng ' + r.lng);
});

ok('OSGB -> WGS84 puts central London near Trafalgar Square', () => {
  const r = osgbToWgs84(530030, 180380);
  assert.ok(Math.abs(r.lat - 51.508) < 0.003 && Math.abs(r.lng - -0.128) < 0.004, r.lat + ',' + r.lng);
});

ok('CSV parser handles quotes, commas and newlines inside fields', () => {
  const t = parseCsv('a,b,c\r\n1,"x, ""y""",3\r\n4,"line1\nline2",6\r\n');
  assert.deepEqual(t, [['a', 'b', 'c'], ['1', 'x, "y"', '3'], ['4', 'line1\nline2', '6']]);
});

ok('type mapping: state, academy, free school, special and independent', () => {
  const c = G.classifyEstablishment;
  assert.equal(c('Community school', 'Local authority maintained schools'), 'S');
  assert.equal(c('Voluntary aided school', 'Local authority maintained schools'), 'S');
  assert.equal(c('Academy converter', 'Academies'), 'S');
  assert.equal(c('Academy sponsor led', 'Academies'), 'S');
  assert.equal(c('Free schools', 'Free Schools'), 'S');
  assert.equal(c('Studio schools', 'Free Schools'), 'S');
  assert.equal(c('City technology college', 'Academies'), 'S');
  assert.equal(c('Community special school', 'Special schools'), 'P');
  assert.equal(c('Non-maintained special school', 'Special schools'), 'P');
  assert.equal(c('Other independent school', 'Independent schools'), 'I');
  assert.equal(c('Other independent special school', 'Independent schools'), 'I');
});

ok('phase and faith mapping', () => {
  assert.equal(G.mapPhase('Primary'), 'p');
  assert.equal(G.mapPhase('Middle deemed secondary'), 's');
  assert.equal(G.mapPhase('All-through'), 'a');
  assert.equal(G.mapPhase('16 plus'), 'u');
  assert.equal(G.hasFaith('Roman Catholic'), 1);
  assert.equal(G.hasFaith('Does not apply'), 0);
  assert.equal(G.hasFaith('None'), 0);
});

const H = 'URN,EstablishmentName,TypeOfEstablishment (name),EstablishmentTypeGroup (name),EstablishmentStatus (name),PhaseOfEducation (name),ReligiousCharacter (name),Easting,Northing';
const CSV = [H,
  '900001,"Test St Peter’s Catholic School",Voluntary aided school,Local authority maintained schools,Open,Secondary,Roman Catholic,530030,180380',
  '900002,Testfield Prep School,Other independent school,Independent schools,Open,Primary,Does not apply,530400,180380',
  '900003,Testfield Academy,Academy converter,Academies,Open,Secondary,None,531500,180380',
  '900004,Closed Road Primary,Community school,Local authority maintained schools,Closed,Primary,None,530030,180380',
  '900005,Test University,University,Universities,Open,Not applicable,None,530030,180380',
  '900006,Nowhere Primary,Community school,Local authority maintained schools,Open,Primary,None,,',
  '900007,Testbrook Special School,Community special school,Special schools,Open,Not applicable,None,532500,180380'
].join('\r\n');

const built = buildRows(parseCsv(CSV));

ok('buildRows keeps open schools with coordinates and drops the rest', () => {
  assert.deepEqual(built.rows.map(r => r[0]), [900001, 900002, 900003, 900007]);
  assert.equal(built.stat.closed, 1);
  assert.equal(built.stat.nonSchool, 1);
  assert.equal(built.stat.noCoords, 1);
});

ok('buildRows fails loudly when GIAS columns change', () => {
  assert.throws(() => buildRows(parseCsv('URN,Name\n1,x')), /Missing expected GIAS columns/);
});

const index = G.buildIndex(built.rows);
const at = id => { const r = built.rows.find(x => x[0] === id); return { la: r[4], ln: r[5] }; };

ok('a state school wrongly tagged private in OSM is classed state when matched by name and place', () => {
  const p = at(900001);
  const g = G.match(index, { amenity: 'school', name: 'Test St Peter’s Catholic School', fee: 'yes', 'operator:type': 'private' }, p.la + 0.0003, p.ln);
  assert.ok(g, 'should match');
  assert.equal(g.cls, 'S');
  assert.equal(g.faith, true);
});

ok('a real independent school is classed independent', () => {
  const p = at(900002);
  const g = G.match(index, { amenity: 'school', name: 'Testfield Prep School' }, p.la, p.ln);
  assert.equal(g && g.cls, 'I');
  assert.equal(g.phase, 'primary');
});

ok('same-name schools on different sites are not mixed up (distance guard)', () => {
  const p = at(900003);
  assert.equal(G.match(index, { amenity: 'school', name: 'Testfield Academy' }, p.la + 0.02, p.ln), null);
});

ok('the URN tag wins over name and place', () => {
  const g = G.match(index, { amenity: 'school', name: 'Some other name', 'ref:edubase': '900007' }, 51.0, -1.0);
  assert.equal(g && g.urn, 900007);
  assert.equal(g.cls, 'P');
});

ok('unnamed or unmatched schools return null (the site shows "type unconfirmed")', () => {
  assert.equal(G.match(index, { amenity: 'school' }, 51.5, -0.1), null);
  assert.equal(G.match(index, { amenity: 'school', name: 'Zzz Unknown School' }, at(900001).la, at(900001).ln), null);
});

ok('infant and junior schools on one site stay distinct', () => {
  assert.ok(G.similarity('Oakfield Infant School', 'Oakfield Junior School') < 1);
  assert.equal(G.similarity('Oakfield Infant School', 'Oakfield Infant School'), 1);
});

console.log('\n' + passed + ' tests passed');
