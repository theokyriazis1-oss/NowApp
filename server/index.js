/**
 * server/index.js
 *
 * Real-time Dutch transit data pipeline — Node.js + Socket.io
 *
 * Primary data source  : https://ovzoeker.nl/api/snapshot
 *   - Gzip-compressed JSON (not protobuf)
 *   - 3,800+ vehicles including NS trains, Arriva, Connexxion, GVB, HTM, RET etc.
 *   - Refreshes every ~30 s on the source side
 *
 * Delay data           : https://gtfs.ovapi.nl/nl/tripUpdates.pb
 *   - GTFS-RT protobuf from OVapi
 *   - Contains delay in seconds per tripId
 *   - Matched against vehicles by tripId
 *
 * Operators in feed:
 *   NS (309 trains) · ARR/Arriva · CXX/Connexxion · QBUZZ · EBS ·
 *   GVB · RET · KEOLIS · HTM · and more
 *
 * Failure strategy:
 *   On any poll failure, last successful real data is served (stale cache).
 *   No mock data is ever generated.
 */

require('dotenv').config({ path: '.env.local' });

const express          = require('express');
const http             = require('http');
const { Server }       = require('socket.io');
const cors             = require('cors');
const zlib             = require('zlib');
const fetch            = require('node-fetch');
const { transit_realtime: { FeedMessage } } = require('gtfs-realtime-bindings');
const { getStops }     = require('./stopsService');
const { parseBbox, parseLatLng, NL } = require('./validate');
const { planRoute, geocode } = require('./routePlanner');
const gtfs             = require('./gtfsStatic');

// ─── Config ────────────────────────────────────────────────────────────────
const PORT             = process.env.PORT || 3001;
const POLL_INTERVAL_MS = 30_000;                         // 30 s — matches source refresh rate
const SNAPSHOT_URL     = 'https://ovzoeker.nl/api/snapshot';
const TRIP_UPDATES_URL = 'https://gtfs.ovapi.nl/nl/tripUpdates.pb';
const FETCH_TIMEOUT_MS = 20_000;

const DEFAULT_BBOX     = '52.10,6.75,52.34,7.03';

const inNL = (lat, lng) =>
  lat >= NL.minLat && lat <= NL.maxLat && lng >= NL.minLng && lng <= NL.maxLng;

// Allowed browser origins (comma-separated). Defaults to the local Next.js dev server.
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:3000,https://localhost,capacitor://localhost,http://localhost')
  .split(',').map((s) => s.trim()).filter(Boolean);

// ─── Express + Socket.io ───────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: ALLOWED_ORIGINS, methods: ['GET', 'POST'] } });

app.disable('x-powered-by');
app.use(cors({ origin: ALLOWED_ORIGINS }));

// Minimal per-IP rate limit for /api/stops (each miss triggers an Overpass query)
const RATE_WINDOW_MS = 60_000;
const RATE_MAX       = 30;
const hits = new Map();
function stopsRateLimit(req, res, next) {
  const now = Date.now();
  const entry = hits.get(req.ip);
  if (!entry || now > entry.reset) {
    hits.set(req.ip, { count: 1, reset: now + RATE_WINDOW_MS });
    return next();
  }
  if (++entry.count > RATE_MAX) return res.status(429).json({ stops: [], error: 'Too many requests' });
  next();
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of hits) if (now > e.reset) hits.delete(ip);
}, RATE_WINDOW_MS).unref();

// ─── State ─────────────────────────────────────────────────────────────────
/** @type {VehiclePosition[]} */
let cachedVehicles      = [];
let lastUpdateTimestamp = null;
let consecutiveFails    = 0;
/** @type {Map<string, {stopId:string,time:number,delay:number}[]>} tripId -> upcoming stop times */
let tripStops           = new Map();

// ─── REST endpoints ─────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({
  status: cachedVehicles.length > 0 ? 'ok' : 'no-data',
  connectedClients: io.engine.clientsCount,
  lastUpdate: lastUpdateTimestamp,
  vehicleCount: cachedVehicles.length,
  consecutiveFails,
  gtfs: gtfs.status(),
  tripsWithStops: tripStops.size,
}));
app.get('/api/vehicles', (_req, res) =>
  res.json({ vehicles: cachedVehicles, timestamp: lastUpdateTimestamp })
);
// ─── Road-snapped path for bus routes (OSRM) ────────────────────────────────
const OSRM_URL = process.env.OSRM_URL || 'https://router.project-osrm.org';
const pathCache = new Map(); // key -> { path, expires }
async function snapToRoads(tripId, stops) {
  if (stops.length < 2) return null;
  const key = `${tripId}|${stops.length}|${stops[0].id}`;
  const hit = pathCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.path;

  const pts = stops.slice(0, 60).map((s) => `${s.lng},${s.lat}`).join(';');
  let path = null;
  try {
    const res = await fetch(`${OSRM_URL}/route/v1/driving/${pts}?overview=full&geometries=geojson`, {
      headers: { 'User-Agent': 'Now/1.0 (personal project)' },
      timeout: 8000,
    });
    if (res.ok) {
      const data = await res.json();
      if (data.code === 'Ok') path = data.routes?.[0]?.geometry?.coordinates ?? null;
    }
  } catch { /* fall back to straight segments on the client */ }

  while (pathCache.size >= 300) pathCache.delete(pathCache.keys().next().value);
  pathCache.set(key, { path, expires: Date.now() + (path ? 10 * 60_000 : 60_000) });
  return path;
}

// Upcoming stops (with coordinates) for one trip — used to draw the route line.
// ?snap=1 additionally returns `path`, the stops joined along real roads (buses).
app.get('/api/trips/:tripId', async (req, res) => {
  const stopTimes = tripStops.get(req.params.tripId) ?? [];
  const now = Math.floor(Date.now() / 1000);
  const stops = [];
  for (const st of stopTimes) {
    if (st.time && st.time < now - 60) continue; // already passed
    const info = gtfs.getStop(st.stopId);
    if (!info) continue;
    stops.push({ id: st.stopId, name: info.name, lat: info.lat, lng: info.lng, time: st.time, delay: st.delay });
  }
  const trip  = gtfs.getTrip(req.params.tripId);
  const shape = gtfs.getShape(req.params.tripId); // the real, complete route geometry
  // No shape in the timetable: fall back to joining the upcoming stops along roads (buses)
  const path  = shape ? null : (req.query.snap ? await snapToRoads(req.params.tripId, stops) : null);
  res.json({ tripId: req.params.tripId, headsign: trip?.headsign ?? '', stops, shape, path });
});
app.get('/api/stops', stopsRateLimit, async (req, res) => {
  const bbox = parseBbox(req.query.bbox ?? DEFAULT_BBOX);
  if (!bbox) return res.status(400).json({ stops: [], error: 'Invalid bbox (minLat,minLng,maxLat,maxLng within the Netherlands)' });
  try {
    const stops = await getStops(bbox);
    res.json({ stops });
  } catch (err) {
    console.error('[Stops]', err.message);
    res.status(502).json({ stops: [], error: err.message });
  }
});

// ─── Vehicle-type detection ─────────────────────────────────────────────────
/**
 * The OVzoeker snapshot uses vehicleId format: "AGENCY:vehicle_number"
 * e.g. "NS:301830", "ARR:9034", "CXX:1139", "GVB:2053"
 */
function detectVehicle(vehicleId = '') {
  const ag = vehicleId.split(':')[0].toUpperCase();
  switch (ag) {
    case 'NS':     return { vehicleType: 'train', agencyName: 'NS' };
    case 'BGN':
    case 'BLAUWNET':
    case 'SYNTUS': return { vehicleType: 'train', agencyName: 'Blauwnet' };
    case 'ARR':    return { vehicleType: 'bus',   agencyName: 'Arriva' };
    case 'CXX':    return { vehicleType: 'bus',   agencyName: 'Connexxion' };
    case 'EBS':    return { vehicleType: 'bus',   agencyName: 'EBS' };
    case 'QBUZZ':  return { vehicleType: 'bus',   agencyName: 'Qbuzz' };
    case 'GVB':    return { vehicleType: 'tram',  agencyName: 'GVB' };
    case 'HTM':    return { vehicleType: 'tram',  agencyName: 'HTM' };
    case 'RET':    return { vehicleType: 'bus',   agencyName: 'RET' };
    case 'KEOLIS': return { vehicleType: 'bus',   agencyName: 'Keolis' };
    case 'U':      return { vehicleType: 'bus',   agencyName: 'U-OV' };
    default:       return { vehicleType: 'bus',   agencyName: ag || 'Unknown' };
  }
}

// ─── Fetch trip delays from OVapi ───────────────────────────────────────────
// OVapi rate-limits aggressively (HTTP 429), so trip updates are refreshed on
// their own slower schedule and the last good data is reused in between.
const TRIP_UPDATES_INTERVAL_MS = 90_000;
const TRIP_UPDATES_BACKOFF_MS  = 5 * 60_000;
let delaysCache       = new Map();
let delaysFetchedAt   = 0;
let delaysBackoffUntil = 0;

async function refreshTripUpdates() {
  const now = Date.now();
  if (now < delaysBackoffUntil || now - delaysFetchedAt < TRIP_UPDATES_INTERVAL_MS) return;
  delaysFetchedAt = now; // count failed attempts too, so we never hammer the API

  try {
    const res = await fetch(TRIP_UPDATES_URL, {
      headers: { Accept: 'application/x-protobuf' },
      timeout: FETCH_TIMEOUT_MS,
    });
    if (res.status === 429) {
      delaysBackoffUntil = Date.now() + TRIP_UPDATES_BACKOFF_MS;
      console.warn('[TripUpdates] Rate limited (429) — backing off 5 min, keeping previous delays');
      return;
    }
    if (!res.ok) { console.warn('[TripUpdates] HTTP', res.status); return; }

    const feed   = FeedMessage.decode(new Uint8Array(await res.buffer()));
    const delays = new Map();
    const stopsByTrip = new Map();
    const nowSec = Math.floor(Date.now() / 1000);

    for (const entity of feed.entity) {
      const tu = entity.tripUpdate;
      if (!tu?.trip?.tripId) continue;
      let delay = null;
      const trail = [];
      for (const stu of tu.stopTimeUpdate ?? []) {
        if (stu.scheduleRelationship === 'SKIPPED' || stu.scheduleRelationship === 1) continue;
        const t = stu.departure ?? stu.arrival;
        if (!t) continue;
        const stopTime = Number(t.time ?? 0);
        if (stu.stopId) trail.push({ stopId: stu.stopId, time: stopTime, delay: Number(t.delay ?? 0) });
        if (delay === null && (stopTime === 0 || stopTime >= nowSec - 60)) delay = Number(t.delay ?? 0);
      }
      if (delay === null && tu.delay != null) delay = Number(tu.delay);
      if (delay !== null) delays.set(tu.trip.tripId, delay);
      if (trail.length) stopsByTrip.set(tu.trip.tripId, trail);
    }
    delaysCache = delays;
    tripStops = stopsByTrip;
  } catch (err) {
    console.warn('[TripUpdates] Failed (keeping previous delays):', err.message);
  }
}

async function fetchTripDelays() {
  await refreshTripUpdates();
  return delaysCache;
}

// ─── Fetch vehicle positions from OVzoeker ──────────────────────────────────
async function fetchSnapshot() {
  const res = await fetch(SNAPSHOT_URL, { timeout: FETCH_TIMEOUT_MS });
  if (!res.ok) throw new Error(`OVzoeker returned HTTP ${res.status}`);

  // Data is gzip-compressed JSON
  const compressed = await res.buffer();
  const raw = zlib.gunzipSync(compressed);
  return JSON.parse(raw.toString('utf8'));
}

function parseVehicles(data, delays) {
  // Snapshot is an array (or object) of individual per-operator GTFS-RT feeds
  const feedItems = Array.isArray(data) ? data : Object.values(data);
  const vehicles  = [];

  for (const feed of feedItems) {
    for (const entity of feed.entity ?? []) {
      const vp = entity.vehicle;
      if (!vp?.position) continue;

      const lat = vp.position.latitude;
      const lng = vp.position.longitude;
      if (!isFinite(lat) || !isFinite(lng) || !inNL(lat, lng)) continue;

      const tripId   = vp.trip?.trip_id   ?? '';
      const routeId  = vp.trip?.route_id  ?? '';
      const vehicleId= vp.vehicle?.id     ?? entity.id ?? '';
      const label    = vp.vehicle?.label  ?? '';

      const detected = detectVehicle(vehicleId);
      const route    = gtfs.getRoute(routeId);
      // GTFS route_type is authoritative; fall back to the operator guess
      const vehicleType = route?.vehicleType ?? detected.vehicleType;
      const agencyName  = detected.agencyName;

      vehicles.push({
        id:           vehicleId || entity.id,
        routeId,
        tripId,
        label,
        lat,
        lng,
        bearing:      vp.position.bearing  ?? 0,
        speed:        vp.position.speed    ?? 0,
        timestamp:    vp.timestamp         ?? Math.floor(Date.now() / 1000),
        delaySeconds: delays.get(tripId)   ?? 0,
        vehicleType,
        agencyName,
        lineNumber:   route?.shortName ?? '',
        headsign:     '',
        routeName:    route?.longName  ?? '',
      });
    }
  }

  return vehicles;
}

// ─── Timetable lookups for the trips that are running right now ─────────────
const TRIPS_REFRESH_MS = 20 * 60_000;
let tripsLoadedAt = 0;
async function refreshTrips(vehicles) {
  if (Date.now() - tripsLoadedAt < TRIPS_REFRESH_MS) return;
  tripsLoadedAt = Date.now(); // count failures too, so we retry on the normal schedule
  const wanted = new Set(vehicles.map((v) => v.tripId).filter(Boolean));
  for (const id of tripStops.keys()) wanted.add(id);
  try { await gtfs.loadTrips(wanted); }
  catch (e) { console.warn('[GTFS] Trips load failed:', e.message); }
}

// ─── Poll loop ───────────────────────────────────────────────────────────────
async function pollAndBroadcast() {
  try {
    // fetchTripDelays never rejects (returns an empty Map on failure)
    const [delays, snapshot] = await Promise.all([fetchTripDelays(), fetchSnapshot()]);
    const vehicles = parseVehicles(snapshot, delays);

    // Headsign (final destination) + route shape come from the GTFS timetable
    await refreshTrips(vehicles);
    for (const v of vehicles) {
      const t = gtfs.getTrip(v.tripId);
      v.headsign = t?.headsign ?? '';
    }

    cachedVehicles      = vehicles;
    lastUpdateTimestamp = new Date().toISOString();
    consecutiveFails    = 0;

    io.emit('vehicles:update', { vehicles, timestamp: lastUpdateTimestamp });

    const buses  = vehicles.filter(v => v.vehicleType === 'bus').length;
    const trams  = vehicles.filter(v => v.vehicleType === 'tram').length;
    const trains = vehicles.filter(v => v.vehicleType === 'train').length;
    const late   = vehicles.filter(v => v.delaySeconds > 60).length;
    console.log(`[${lastUpdateTimestamp}] ${buses} buses  ${trams} trams  ${trains} trains  (${late} late)`);
  } catch (err) {
    consecutiveFails++;
    console.error(`[Poll fail #${consecutiveFails}] ${err.message}`);
    if (cachedVehicles.length > 0) {
      console.warn(`  → Serving stale data from ${lastUpdateTimestamp}`);
      io.emit('vehicles:update', { vehicles: cachedVehicles, timestamp: lastUpdateTimestamp, stale: true });
    } else {
      io.emit('vehicles:error', { message: `Feed temporarily unavailable. Retrying…`, timestamp: new Date().toISOString() });
    }
  }
}

// ─── Socket.io ───────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);
  if (cachedVehicles.length > 0)
    socket.emit('vehicles:update', { vehicles: cachedVehicles, timestamp: lastUpdateTimestamp });
  socket.on('disconnect', () => console.log(`[Socket] Disconnected: ${socket.id}`));
});

// ─── Start ───────────────────────────────────────────────────────────────────
server.listen(PORT, async () => {
  console.log(`\nNow server → http://localhost:${PORT}`);
  console.log(`Vehicles : ${SNAPSHOT_URL}`);
  console.log(`Delays   : ${TRIP_UPDATES_URL}\n`);

  getStops(parseBbox(DEFAULT_BBOX)).catch(e =>
    console.warn('[Stops pre-warm]', e.message)
  );

  gtfs.start(); // routes/stops lookup (non-blocking; vehicles fall back to operator guess)

  // Self-rescheduling loop: a slow poll can never overlap the next one
  const loop = async () => {
    await pollAndBroadcast();
    setTimeout(loop, POLL_INTERVAL_MS);
  };
  loop();
});

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException',  (err) => console.error('[uncaughtException]', err));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n[${sig}] shutting down…`);
    io.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
