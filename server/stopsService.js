/**
 * server/stopsService.js
 *
 * Fetches bus stops and train stations from Overpass API (OpenStreetMap).
 * Accepts a dynamic bounding box so the client can query for any Dutch city.
 * Results are cached in memory for 1 hour per bbox.
 */

const fetch = require('node-fetch');

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_CACHE_ENTRIES = 100;

/** @type {Map<string, { stops: Stop[], expires: number }>} */
const cache = new Map();

/**
 * @typedef {Object} Stop
 * @property {string} id
 * @property {number} lat
 * @property {number} lng
 * @property {string} name
 * @property {'bus_stop'|'train_station'} type
 */

/**
 * @param {string} bbox  "minLat,minLng,maxLat,maxLng"
 * @returns {Promise<Stop[]>}
 */
async function getStops(bbox) {
  const cached = cache.get(bbox);
  if (cached && Date.now() < cached.expires) return cached.stops;

  console.log(`[Stops] Fetching Overpass for bbox=${bbox}…`);

  const query = `
[out:json][timeout:30];
(
  node["highway"="bus_stop"](${bbox});
  node["public_transport"="stop_position"]["bus"="yes"](${bbox});
  node["railway"="station"](${bbox});
  node["railway"="halt"](${bbox});
);
out body;`.trim();

  const response = await fetch(OVERPASS_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    `data=${encodeURIComponent(query)}`,
    timeout: 35_000,
  });

  if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);

  const data  = await response.json();
  const stops = [];
  const seen  = new Set();

  for (const el of data.elements) {
    if (el.type !== 'node') continue;
    const key = `${el.lat.toFixed(4)},${el.lon.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const isStation = el.tags.railway === 'station' || el.tags.railway === 'halt';
    stops.push({
      id:   String(el.id),
      lat:  el.lat,
      lng:  el.lon,
      name: el.tags.name || el.tags['name:nl'] || el.tags.ref || (isStation ? 'Station' : 'Halte'),
      type: isStation ? 'train_station' : 'bus_stop',
    });
  }

  console.log(`[Stops] ${stops.length} stops loaded (bbox=${bbox})`);
  // Bound memory: evict expired entries, then the oldest if still over the cap
  const now = Date.now();
  for (const [k, v] of cache) if (v.expires <= now) cache.delete(k);
  while (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(bbox, { stops, expires: now + CACHE_TTL_MS });
  return stops;
}

module.exports = { getStops };
