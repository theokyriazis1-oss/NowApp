/**
 * server/routePlanner.js
 *
 * Journey planning (public transport + walking only — no car) via the free
 * Transitous MOTIS API, plus place search via Nominatim.
 * Responses are normalised so the client never sees the raw upstream shape.
 */

const fetch = require('node-fetch');

const PLAN_URL    = process.env.ROUTE_PLAN_URL || 'https://api.transitous.org/api/v5/plan';
const GEOCODE_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT  = 'Now/1.0 (personal project)';

const cache = new Map(); // key -> { value, expires }
const MAX_CACHE = 200;

function cached(key, ttlMs, producer) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = producer().catch((err) => { cache.delete(key); throw err; });
  while (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
  cache.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

// ─── Encoded polyline -> [[lng, lat], …] ────────────────────────────────────
function decodePolyline(str, precision = 6) {
  const factor = 10 ** precision;
  const out = [];
  let index = 0, lat = 0, lng = 0;
  while (index < str.length) {
    for (const axis of [0, 1]) {
      let shift = 0, result = 0, byte;
      do {
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta; else lng += delta;
    }
    out.push([lng / factor, lat / factor]);
  }
  return out;
}

const WALKING_LIKE = new Set(['WALK', 'BIKE', 'RENTAL', 'CAR', 'FLEX']);
const TRANSIT_TYPE = {
  BUS: 'bus', COACH: 'bus', TRAM: 'tram', SUBWAY: 'metro', METRO: 'metro',
  FERRY: 'ferry', RAIL: 'train', HIGHSPEED_RAIL: 'train', LONG_DISTANCE: 'train',
  NIGHT_RAIL: 'train', REGIONAL_FAST_RAIL: 'train', REGIONAL_RAIL: 'train',
  SUBURBAN: 'train',
};

function normaliseLeg(leg) {
  const geom = leg.legGeometry;
  const coords = geom?.points ? decodePolyline(geom.points, geom.precision ?? 6) : [];
  const isWalk = leg.mode === 'WALK';
  return {
    kind:        isWalk ? 'walk' : 'transit',
    vehicleType: isWalk ? 'walk' : (TRANSIT_TYPE[leg.mode] ?? 'bus'),
    line:        leg.routeShortName || leg.displayName || '',
    headsign:    leg.headsign || '',
    agency:      leg.agencyName || '',
    from:        { name: leg.from?.name ?? '', lat: leg.from?.lat, lng: leg.from?.lon, track: leg.from?.track ?? null },
    to:          { name: leg.to?.name ?? '',   lat: leg.to?.lat,   lng: leg.to?.lon,   track: leg.to?.track ?? null },
    startTime:   leg.startTime,
    endTime:     leg.endTime,
    durationSec: leg.duration,
    realTime:    !!leg.realTime,
    cancelled:   !!leg.cancelled,
    stops:       (leg.intermediateStops ?? []).map((s) => ({ name: s.name, lat: s.lat, lng: s.lon })),
    coordinates: coords,
  };
}

function normaliseItinerary(it) {
  const legs = it.legs.filter((l) => !WALKING_LIKE.has(l.mode) || l.mode === 'WALK').map(normaliseLeg);
  const walkSec = legs.filter((l) => l.kind === 'walk').reduce((a, l) => a + (l.durationSec || 0), 0);
  return {
    startTime:   it.startTime,
    endTime:     it.endTime,
    durationSec: it.duration,
    transfers:   it.transfers ?? Math.max(0, legs.filter((l) => l.kind === 'transit').length - 1),
    walkSec,
    legs,
  };
}

/**
 * @param {{from:{lat:number,lng:number}, to:{lat:number,lng:number}, mode:'transit'|'walk', time?:string, arriveBy?:boolean}} q
 */
async function planRoute({ from, to, mode, time, arriveBy }) {
  const when = time ? new Date(time) : new Date();
  const params = new URLSearchParams({
    fromPlace: `${from.lat},${from.lng}`,
    toPlace:   `${to.lat},${to.lng}`,
    time:      when.toISOString(),
    arriveBy:  String(!!arriveBy),
    directModes: 'WALK',
    numItineraries: '5',
  });
  if (mode === 'walk') params.set('transitModes', '');
  else params.set('transitModes', 'TRANSIT');

  // Bucket the time to the minute so repeated searches share the cache
  const key = `${params.get('fromPlace')}|${params.get('toPlace')}|${mode}|${arriveBy}|${when.toISOString().slice(0, 16)}`;
  return cached(key, 60_000, async () => {
    const res = await fetch(`${PLAN_URL}?${params}`, { headers: { 'User-Agent': USER_AGENT }, timeout: 30_000 });
    if (!res.ok) throw new Error(`Route service HTTP ${res.status}`);
    const data = await res.json();
    const raw = mode === 'walk' ? data.direct ?? [] : data.itineraries ?? [];
    const itineraries = raw.map(normaliseItinerary).filter((i) => i.legs.length);
    return { itineraries };
  });
}

/** Place search (addresses, stations, POIs) restricted to the Netherlands. */
async function geocode(q) {
  const key = `geo|${q.toLowerCase()}`;
  return cached(key, 10 * 60_000, async () => {
    const params = new URLSearchParams({ q, countrycodes: 'nl', format: 'json', limit: '6', addressdetails: '0' });
    const res = await fetch(`${GEOCODE_URL}?${params}`, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'nl,en' }, timeout: 15_000,
    });
    if (!res.ok) throw new Error(`Geocoder HTTP ${res.status}`);
    const rows = await res.json();
    return {
      places: rows.map((r) => ({
        name: r.display_name.split(',').slice(0, 2).join(',').trim(),
        displayName: r.display_name,
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
      })),
    };
  });
}

module.exports = { planRoute, geocode, decodePolyline };
