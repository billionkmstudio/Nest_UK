/*
 * Nest UK – DfE "Get Information about Schools" (GIAS) helpers.
 *
 * Shared by the browser (index.html loads this file) and by scripts/build-gias.mjs and the tests,
 * so the classification rules live in ONE place.
 *
 * Data file: /data/schools.json, built by scripts/build-gias.mjs from the GIAS "all establishment data" CSV.
 *   { v:1, built:'YYYY-MM-DD', rows:[ [urn, name, cls, phase, lat, lng, faith], ... ] }
 *   cls:   'S' state-funded, 'I' independent (fee-paying), 'P' special school that is not independent
 *   phase: 'n' nursery, 'p' primary, 's' secondary, 'a' all-through, 'u' unknown / 16+
 *   faith: 1 if GIAS records a religious character, else 0
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NestGias = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CELL = 0.02;            // grid cell size in degrees (about 2 km), for the spatial index
  var MATCH_M = 200;          // max distance between an OpenStreetMap school and a GIAS school
  var MIN_SIM = 0.6;          // min name similarity (0..1)
  var STOP = { the: 1, of: 1, and: 1, school: 1, schools: 1, academy: 1, '&': 1 };

  /* Independent = GIAS says so. Everything else that is a school is state-funded or a non-independent special school. */
  function classifyEstablishment(typeName, groupName) {
    var ty = String(typeName || ''), gr = String(groupName || '');
    if (/independent/i.test(gr) || /^other independent/i.test(ty) || /independent school/i.test(ty)) return 'I';
    if (/special/i.test(ty)) return 'P';
    return 'S';
  }

  function mapPhase(name) {
    var n = String(name || '').toLowerCase();
    if (n === 'nursery') return 'n';
    if (n === 'primary' || n === 'middle deemed primary') return 'p';
    if (n === 'secondary' || n === 'middle deemed secondary') return 's';
    if (n === 'all-through' || n === 'all through') return 'a';
    return 'u';
  }

  function hasFaith(religiousCharacter) {
    var r = String(religiousCharacter || '').trim().toLowerCase();
    return r && r !== 'none' && r !== 'does not apply' && r !== 'not applicable' ? 1 : 0;
  }

  var PHASE_NAME = { n: 'nursery', p: 'primary', s: 'secondary', a: 'allthrough', u: 'unknown' };

  function tokens(s) {
    return String(s || '').toLowerCase()
      .replace(/[‘’']/g, '')
      .replace(/[^a-z0-9& ]+/g, ' ')
      .split(/\s+/)
      .filter(function (w) { return w && !STOP[w]; });
  }

  function similarity(a, b) {
    var A = tokens(a), B = tokens(b);
    if (!A.length || !B.length) return 0;
    var setB = {}, hit = 0, i;
    for (i = 0; i < B.length; i++) setB[B[i]] = 1;
    for (i = 0; i < A.length; i++) if (setB[A[i]]) hit++;
    return hit / Math.min(A.length, B.length);
  }

  function haversine(la1, ln1, la2, ln2) {
    var R = 6371000, r = Math.PI / 180;
    var dLa = (la2 - la1) * r, dLn = (ln2 - ln1) * r;
    var x = Math.sin(dLa / 2) * Math.sin(dLa / 2) +
      Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLn / 2) * Math.sin(dLn / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  function cellKey(lat, lng) { return Math.floor(lat / CELL) + ',' + Math.floor(lng / CELL); }

  function addRow(byUrn, grid, r) {
    var rec = { urn: r[0], name: r[1], cls: r[2], phase: PHASE_NAME[r[3]] || 'unknown', la: r[4], ln: r[5], faith: !!r[6] };
    byUrn[rec.urn] = rec;
    var k = cellKey(rec.la, rec.ln);
    (grid[k] || (grid[k] = [])).push(rec);
  }

  function buildIndex(rows) {
    var byUrn = {}, grid = {};
    for (var i = 0; i < rows.length; i++) addRow(byUrn, grid, rows[i]);
    return { byUrn: byUrn, grid: grid, size: rows.length };
  }

  /* Same result as buildIndex, but hands the main thread back every `chunk` rows so a tap or keypress during
     the build is not blocked (INP). Browser only; scripts and tests keep using the synchronous buildIndex. */
  function yieldToMain() {
    if (typeof scheduler !== 'undefined' && scheduler && typeof scheduler.yield === 'function') return scheduler.yield();
    return new Promise(function (res) { setTimeout(res, 0); });
  }

  function buildIndexAsync(rows, chunk) {
    chunk = chunk > 0 ? chunk : 2500;
    var byUrn = {}, grid = {}, i = 0;
    function step() {
      var end = Math.min(i + chunk, rows.length);
      for (; i < end; i++) addRow(byUrn, grid, rows[i]);
      if (i >= rows.length) return Promise.resolve({ byUrn: byUrn, grid: grid, size: rows.length });
      return yieldToMain().then(step);
    }
    return step();
  }

  function urnFromTags(tags) {
    var keys = ['ref:edubase', 'ref:URN', 'ref:urn', 'ref:dfe'];
    for (var i = 0; i < keys.length; i++) {
      var v = tags && tags[keys[i]];
      if (v) {
        var m = String(v).match(/\d{5,7}/);
        if (m) return Number(m[0]);
      }
    }
    return null;
  }

  /* Find the GIAS record for an OpenStreetMap school: by URN tag if present, else by name + distance. */
  function match(index, tags, lat, lng) {
    if (!index) return null;
    var urn = urnFromTags(tags);
    if (urn && index.byUrn[urn]) return index.byUrn[urn];
    var name = tags && tags.name;
    if (!name || lat == null || lng == null) return null;
    var cy = Math.floor(lat / CELL), cx = Math.floor(lng / CELL), best = null, bestSim = 0, bestD = 1e9;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        var list = index.grid[(cy + dy) + ',' + (cx + dx)];
        if (!list) continue;
        for (var i = 0; i < list.length; i++) {
          var g = list[i], d = haversine(lat, lng, g.la, g.ln);
          if (d > MATCH_M) continue;
          var sim = similarity(name, g.name);
          if (sim < MIN_SIM) continue;
          if (sim > bestSim || (sim === bestSim && d < bestD)) { best = g; bestSim = sim; bestD = d; }
        }
      }
    }
    return best;
  }

  function detailsUrl(urn) {
    return 'https://get-information-schools.service.gov.uk/Establishments/Establishment/Details/' + urn;
  }

  return {
    classifyEstablishment: classifyEstablishment,
    mapPhase: mapPhase,
    hasFaith: hasFaith,
    buildIndex: buildIndex,
    buildIndexAsync: buildIndexAsync,
    match: match,
    similarity: similarity,
    urnFromTags: urnFromTags,
    detailsUrl: detailsUrl,
    haversine: haversine
  };
});
