// Same security headers as public/_headers, for pages the Worker generates itself
// (/uk, /best, /zh, sitemap) — _headers only applies to static asset responses.
const SECURITY_HEADERS = {
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), payment=(), usb=()',
  'Content-Security-Policy-Report-Only': "default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://api.postcodes.io https://nominatim.openstreetmap.org https://data.police.uk https://overpass.openstreetmap.fr https://overpass-api.de https://overpass.kumi.systems https://gisrest.defra.gov.uk https://environment.data.gov.uk https://tiles.openfreemap.org https://unpkg.com; worker-src 'self' blob:; child-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; upgrade-insecure-requests",
};

export function withSecurityHeaders(resp) {
  const ct = resp.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return resp;
  const out = new Response(resp.body, resp);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!out.headers.has(k)) out.headers.set(k, v);
  }
  return out;
}
