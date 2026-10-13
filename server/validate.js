/**
 * server/validate.js
 *
 * Input validation helpers for the REST API.
 */

// Netherlands bounding box (with a small margin)
const NL = { minLat: 50.7, maxLat: 53.7, minLng: 3.2, maxLng: 7.3 };
const MARGIN = 0.5; // allow city bboxes that straddle the border
const MAX_SPAN_DEG = 1; // reject huge Overpass queries

/**
 * Parse "minLat,minLng,maxLat,maxLng". Returns a normalised string or null.
 * @param {unknown} input
 * @returns {string|null}
 */
function parseBbox(input) {
  if (typeof input !== 'string') return null;
  const parts = input.split(',');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^-?\d+(\.\d+)?$/.test(p.trim()) ? Number(p) : NaN));
  if (nums.some((n) => !Number.isFinite(n))) return null;

  const [minLat, minLng, maxLat, maxLng] = nums;
  if (minLat >= maxLat || minLng >= maxLng) return null;
  if (minLat < NL.minLat - MARGIN || maxLat > NL.maxLat + MARGIN) return null;
  if (minLng < NL.minLng - MARGIN || maxLng > NL.maxLng + MARGIN) return null;
  if (maxLat - minLat > MAX_SPAN_DEG || maxLng - minLng > MAX_SPAN_DEG) return null;

  return nums.map((n) => n.toFixed(4)).join(',');
}

/**
 * Parse "lat,lng" inside (or just around) the Netherlands. Returns {lat,lng} or null.
 * @param {unknown} input
 */
function parseLatLng(input) {
  if (typeof input !== 'string') return null;
  const parts = input.split(',');
  if (parts.length !== 2) return null;
  const [lat, lng] = parts.map((p) => (/^-?\d+(\.\d+)?$/.test(p.trim()) ? Number(p) : NaN));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < NL.minLat - MARGIN || lat > NL.maxLat + MARGIN) return null;
  if (lng < NL.minLng - MARGIN || lng > NL.maxLng + MARGIN) return null;
  return { lat, lng };
}

module.exports = { parseBbox, parseLatLng, NL };
