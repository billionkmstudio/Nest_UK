/*
 * Nest UK – Overpass query builders.
 * Shared by the browser (index.html) and the Worker (/api/overpass), so the Worker builds the query
 * itself from a fixed "kind" and is never an open Overpass proxy.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NestQueries = factory();
}(typeof self !== 'undefined' ? self : this, function () {
function eduQuery(lat, lng){
  const p = lat + ',' + lng;
  return '[out:json][timeout:25];\n(\n' +
    '  nwr["amenity"="school"](around:4800,' + p + ');\n' +
    '  nwr["amenity"="kindergarten"](around:2400,' + p + ');\n' +
    ');\nout center tags qt;';
}
function extraQuery(lat, lng){
  const p = lat + ',' + lng;
  return '[out:json][timeout:25];\n(\n' +
    '  nwr["amenity"~"^(university|college)$"](around:8000,' + p + ');\n' +
    '  nwr["railway"~"^(station|halt)$"](around:5000,' + p + ');\n' +
    ');\nout center tags qt;';
}
function lifeQuery(lat, lng){
  const p = lat + ',' + lng;
  return '[out:json][timeout:30];\n' +
    'way["highway"]["name"~"^High (Street|St)$",i](around:1500,' + p + ')->.hs;\n(\n' +
    '  nwr["shop"="mall"](around:5000,' + p + ');\n' +
    '  nwr["shop"="supermarket"](around:1600,' + p + ');\n' +
    '  nwr["shop"~"^(supermarket|convenience|greengrocer|butcher|general|food|deli)$"]["name"~"oriental|asian|chinese|wing yip|hoo hing|wai yee hong|see woo|loon fung|hong kong",i](around:4000,' + p + ');\n' +
    '  nwr["amenity"~"^(restaurant|cafe|pub|fast_food)$"](around:1500,' + p + ');\n' +
    '  nwr["amenity"~"^(restaurant|fast_food)$"]["cuisine"~"chinese|cantonese|dim_sum|hong_kong|asian|taiwanese|sichuan|szechuan",i](around:3000,' + p + ');\n' +
    '  nwr["leisure"~"^(sports_centre|fitness_centre)$"](around:3000,' + p + ');\n' +
    '  nwr["leisure"="swimming_pool"]["access"~"^(yes|public)$"](around:3000,' + p + ');\n' +
    ')->.pois;\n.pois out center tags;\n.hs out geom;\n' +
    'nwr["shop"](around:500,' + p + ');\nout count;';
}
function roadsQuery(lat, lng){
  return '[out:json][timeout:30];\nway["highway"~"^(motorway|trunk|primary)$"](around:3000,' + lat + ',' + lng + ');\nout geom;';
}
function busQuery(lat, lng){
  const dy = 1500 / 110574, dx = 1500 / (111320 * Math.cos(lat * Math.PI / 180));
  const bb = [lat - dy, lng - dx, lat + dy, lng + dx].map(v => v.toFixed(5)).join(',');
  return '[out:json][timeout:30];\nnode["highway"="bus_stop"](around:800,' + lat + ',' + lng + ');\nout qt;\nrel["route"="bus"](around:1200,' + lat + ',' + lng + ');\nout geom(' + bb + ');';
}

function carsQuery(lat, lng) {
  const p = lat + ',' + lng;
  return '[out:json][timeout:30];\n(\n' +
    '  nwr["amenity"="fuel"](around:4800,' + p + ');\n' +
    '  nwr["amenity"="charging_station"](around:3300,' + p + ');\n' +
    ');\nout center tags qt;';
}
  return { cars: carsQuery, edu: eduQuery, extra: extraQuery, life: lifeQuery, roads: roadsQuery, bus: busQuery };
}));
