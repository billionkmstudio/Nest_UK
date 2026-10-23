/*
 * Nest UK – turn a Nominatim place result (village, town, suburb) into an area: the middle of its outline plus the outline
 * itself. Shared by the page (index.html) and scripts/check-area-points.mjs so both use the same rule.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NestPlace = factory();
}(typeof self !== 'undefined' ? self : this, function () {
/* A place name (village, town, suburb) is an area, not a point: use the middle of its outline, and keep the outline to draw.
   Streets, buildings and other point results are left as they are. */
const PLACE_TYPES = /^(village|town|city|suburb|hamlet|neighbourhood|neighborhood|quarter|borough|municipality|administrative|civil_parish|locality|isolated_dwelling|city_district|county|district)$/;
function ringCentroid(r){   // r: [[lng,lat],...]; planar area-weighted centroid, fine at town scale
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < r.length - 1; i++){
    const f = r[i][0] * r[i+1][1] - r[i+1][0] * r[i][1];
    a += f; cx += (r[i][0] + r[i+1][0]) * f; cy += (r[i][1] + r[i+1][1]) * f;
  }
  if (!a) return null;
  return {lng:cx / (3 * a), lat:cy / (3 * a), area:Math.abs(a) / 2};
}
function pointInRing(x, y, r){
  let inside = false;
  for (let i = 0, k = r.length - 1; i < r.length; k = i++){
    if (((r[i][1] > y) !== (r[k][1] > y)) && (x < (r[k][0] - r[i][0]) * (y - r[i][1]) / (r[k][1] - r[i][1]) + r[i][0])) inside = !inside;
  }
  return inside;
}
function placeArea(res){
  try{
    const typ = res.addresstype || res.type;
    if (!(res.class === 'place' || res.class === 'boundary') || !PLACE_TYPES.test(typ)) return null;
    const g = res.geojson, bb = (res.boundingbox || []).map(Number);
    let ring = null;
    if (g && g.type === 'Polygon') ring = g.coordinates[0];
    else if (g && g.type === 'MultiPolygon') ring = g.coordinates.map(p => p[0]).sort((a, b) => (ringCentroid(b) || {area:0}).area - (ringCentroid(a) || {area:0}).area)[0];
    let c = ring ? ringCentroid(ring) : null;
    if (c && !pointInRing(c.lng, c.lat, ring)) c = null;   // odd shapes: centroid outside the outline
    if (!c && bb.length === 4 && bb.every(isFinite)) c = {lat:(bb[0] + bb[1]) / 2, lng:(bb[2] + bb[3]) / 2};
    if (c && ring && !pointInRing(c.lng, c.lat, ring)) c = {lat:+res.lat, lng:+res.lon};   // L-shaped outlines: use the service's own point
    if (!c || !isFinite(c.lat) || !isFinite(c.lng)) return null;
    let poly = null;
    if (ring && ring.length > 3){ const step = Math.ceil(ring.length / 250); poly = ring.filter((_, i) => i % step === 0).map(p => [p[1], p[0]]); }
    return {lat:c.lat, lng:c.lng, poly};
  }catch(e){ return null; }
}

  return { placeArea: placeArea, ringCentroid: ringCentroid, pointInRing: pointInRing };
}));
