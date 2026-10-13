/**
 * server/gtfsStatic.js
 *
 * Loads the small lookup tables (routes.txt, stops.txt) out of the huge
 * national GTFS zip using HTTP range requests — we never download the full
 * ~230 MB archive.
 *
 *   routes: route_id -> { shortName, longName, vehicleType }
 *   stops : stop_id  -> { name, lat, lng }
 *   trips : trip_id  -> { headsign, shapeId }   (only trips currently running)
 *   shapes: shape_id -> encoded polyline        (the real route geometry)
 */

const fs    = require('fs');
const path  = require('path');
const zlib  = require('zlib');
const fetch = require('node-fetch');

const GTFS_URL   = process.env.GTFS_STATIC_URL || 'https://gtfs.ovapi.nl/nl/gtfs-nl.zip';
const REFRESH_MS = 12 * 60 * 60 * 1000;

const CACHE_DIR  = path.join(__dirname, '.cache');
const SHAPES_CACHE = path.join(CACHE_DIR, 'shapes.json');
const SHAPES_TTL_MS = 24 * 60 * 60 * 1000;

let trips  = new Map();
let shapes = new Map(); // shape_id -> encoded polyline (precision 5)
let shapesLoadedAt = null;
let routes = new Map();
let stops  = new Map();
let loadedAt = null;

// ─── Minimal zip reader over HTTP range requests ────────────────────────────
async function range(url, start, end) {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, timeout: 60_000 });
  if (res.status !== 206) throw new Error(`Range request not supported (HTTP ${res.status})`);
  return res.buffer();
}

async function readCentralDirectory(url) {
  const head = await fetch(url, { method: 'HEAD', timeout: 30_000 });
  const size = Number(head.headers.get('content-length'));
  if (!size) throw new Error('No content-length on GTFS zip');

  const tail = await range(url, Math.max(0, size - 65536), size - 1);
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('Zip end-of-central-directory not found');

  const cdSize   = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff) throw new Error('Zip64 archives are not supported');

  const cd = await range(url, cdOffset, cdOffset + cdSize - 1);
  const entries = new Map();
  for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50; ) {
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    entries.set(cd.toString('utf8', p + 46, p + 46 + nameLen), {
      method:         cd.readUInt16LE(p + 10),
      compressedSize: cd.readUInt32LE(p + 20),
      localOffset:    cd.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readEntry(url, entry) {
  // Local header is 30 bytes + name + extra (lengths may differ from the central dir)
  const lh = await range(url, entry.localOffset, entry.localOffset + 29);
  const dataStart = entry.localOffset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
  const data = await range(url, dataStart, dataStart + entry.compressedSize - 1);
  if (entry.method === 0) return data;
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error(`Unsupported zip compression method ${entry.method}`);
}

/** Stream an entry's decompressed bytes (for the big files we never hold in memory). */
async function streamEntry(url, entry, onChunk) {
  const lh = await range(url, entry.localOffset, entry.localOffset + 29);
  const start = entry.localOffset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${start + entry.compressedSize - 1}` }, timeout: 0 });
  if (res.status !== 206) throw new Error(`Range request not supported (HTTP ${res.status})`);
  await new Promise((resolve, reject) => {
    const src = entry.method === 8 ? res.body.pipe(zlib.createInflateRaw()) : res.body;
    src.on('data', onChunk).on('end', resolve).on('error', reject);
    res.body.on('error', reject);
  });
}

// ─── Polyline encoding (precision 5) ────────────────────────────────────────
function encodePolyline(points) {
  let out = '', pLat = 0, pLng = 0;
  const enc = (v) => {
    v = v < 0 ? ~(v << 1) : v << 1;
    let r = '';
    while (v >= 0x20) { r += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
    return r + String.fromCharCode(v + 63);
  };
  for (const [lat, lng] of points) {
    const la = Math.round(lat * 1e5), ln = Math.round(lng * 1e5);
    out += enc(la - pLat) + enc(ln - pLng);
    pLat = la; pLng = ln;
  }
  return out;
}

function decodePolyline(str) {
  const out = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const axis of [0, 1]) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += d; else lng += d;
    }
    out.push([lng / 1e5, lat / 1e5]); // GeoJSON order
  }
  return out;
}

// ─── CSV ────────────────────────────────────────────────────────────────────
function parseCsvLine(line) {
  const out = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsv(buf) {
  const lines = buf.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = parseCsvLine(l);
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    return row;
  });
}

// ─── GTFS route_type -> app vehicle type (basic + extended/HVT codes) ───────
function routeTypeToVehicleType(t) {
  const n = Number(t);
  if (n === 0 || (n >= 900 && n < 1000)) return 'tram';
  if (n === 1 || (n >= 400 && n < 500))  return 'metro';
  if (n === 2 || (n >= 100 && n < 200))  return 'train';
  if (n === 4 || (n >= 1000 && n < 1200)) return 'ferry';
  return 'bus';
}

// ─── trips.txt (6 MB): headsign + shape per trip, only for trips we care about ─
async function loadTrips(wanted) {
  if (!wanted || !wanted.size) return;
  const entries = await readCentralDirectory(GTFS_URL);
  const buf = await readEntry(GTFS_URL, entries.get('trips.txt'));
  const text = buf.toString('utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  const iTrip = header.indexOf('trip_id'), iHead = header.indexOf('trip_headsign'), iShape = header.indexOf('shape_id');

  const next = new Map();
  for (let n = 1; n < lines.length; n++) {
    const line = lines[n];
    if (!line) continue;
    const comma = line.indexOf(',');
    // Cheap pre-filter: trip_id is usually not the first column, so parse fully only when needed
    const cells = parseCsvLine(line);
    const id = cells[iTrip];
    if (wanted.has(id)) next.set(id, { headsign: cells[iHead] || '', shapeId: cells[iShape] || '' });
    void comma;
  }
  trips = next;
  console.log(`[GTFS] Loaded ${trips.size} active trips (headsigns + shape ids)`);
}

// ─── shapes.txt (75 MB gz): streamed once a day, cached on disk ─────────────
async function loadShapes() {
  try {
    const st = fs.statSync(SHAPES_CACHE);
    if (Date.now() - st.mtimeMs < SHAPES_TTL_MS) {
      shapes = new Map(Object.entries(JSON.parse(fs.readFileSync(SHAPES_CACHE, 'utf8'))));
      shapesLoadedAt = new Date(st.mtimeMs).toISOString();
      console.log(`[GTFS] Loaded ${shapes.size} route shapes from disk cache`);
      return;
    }
  } catch { /* no cache yet */ }

  console.log('[GTFS] Downloading route shapes (~75 MB, once a day)…');
  const entries = await readCentralDirectory(GTFS_URL);
  const entry = entries.get('shapes.txt');
  if (!entry) throw new Error('shapes.txt missing from GTFS zip');

  const out = new Map();
  let header = null, iId, iLat, iLng, tail = '', curId = null, pts = [];
  const flush = () => { if (curId !== null && pts.length > 1) out.set(curId, encodePolyline(pts)); pts = []; };
  const handleLine = (line) => {
    if (!line) return;
    const c = line.split(',');
    if (!header) {
      header = c.map((h) => h.replace(/^\uFEFF/, '').trim());
      iId = header.indexOf('shape_id'); iLat = header.indexOf('shape_pt_lat'); iLng = header.indexOf('shape_pt_lon');
      return;
    }
    const id = c[iId];
    if (id !== curId) { flush(); curId = id; }
    pts.push([parseFloat(c[iLat]), parseFloat(c[iLng])]);
  };

  await streamEntry(GTFS_URL, entry, (chunk) => {
    const lines = (tail + chunk.toString('utf8')).split('\n');
    tail = lines.pop();
    for (const l of lines) handleLine(l.replace(/\r$/, ''));
  });
  handleLine(tail.replace(/\r$/, ''));
  flush();

  shapes = out;
  shapesLoadedAt = new Date().toISOString();
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(SHAPES_CACHE, JSON.stringify(Object.fromEntries(out)));
  } catch (e) { console.warn('[GTFS] Could not write shapes cache:', e.message); }
  console.log(`[GTFS] Loaded ${shapes.size} route shapes`);
}

// ─── Public API ─────────────────────────────────────────────────────────────
async function load() {
  const entries = await readCentralDirectory(GTFS_URL);
  const need = (name) => {
    const e = entries.get(name);
    if (!e) throw new Error(`${name} missing from GTFS zip`);
    return e;
  };

  const [routesBuf, stopsBuf] = await Promise.all([
    readEntry(GTFS_URL, need('routes.txt')),
    readEntry(GTFS_URL, need('stops.txt')),
  ]);

  const newRoutes = new Map();
  for (const r of parseCsv(routesBuf)) {
    newRoutes.set(r.route_id, {
      shortName:   r.route_short_name || '',
      longName:    r.route_long_name  || '',
      vehicleType: routeTypeToVehicleType(r.route_type),
    });
  }

  const newStops = new Map();
  for (const s of parseCsv(stopsBuf)) {
    const lat = parseFloat(s.stop_lat), lng = parseFloat(s.stop_lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      newStops.set(s.stop_id, { name: s.stop_name || '', lat, lng });
    }
  }

  routes = newRoutes;
  stops = newStops;
  loadedAt = new Date().toISOString();
  console.log(`[GTFS] Loaded ${routes.size} routes and ${stops.size} stops`);
}

/** Load now (non-fatal on failure) and refresh periodically. */
function start() {
  const run = () => load().catch((e) => console.warn('[GTFS] Static load failed:', e.message));
  const first = run();
  setInterval(run, REFRESH_MS).unref();
  // Shapes are big: load in the background, once a day (disk-cached)
  loadShapes().catch((e) => console.warn('[GTFS] Shapes load failed:', e.message));
  setInterval(() => loadShapes().catch((e) => console.warn('[GTFS] Shapes load failed:', e.message)), SHAPES_TTL_MS).unref();
  return first;
}

const getRoute = (routeId) => routes.get(routeId);
const getStop  = (stopId)  => stops.get(stopId);
const getTrip  = (tripId)  => trips.get(tripId);
/** Full route geometry as [[lng, lat], ...] for a trip, or null. */
const getShape = (tripId) => {
  const t = trips.get(tripId);
  const enc = t && shapes.get(t.shapeId);
  return enc ? decodePolyline(enc) : null;
};
const status   = () => ({ routes: routes.size, stops: stops.size, trips: trips.size, shapes: shapes.size, loadedAt, shapesLoadedAt });

module.exports = { start, load, loadTrips, loadShapes, getRoute, getStop, getTrip, getShape, status, parseCsv, routeTypeToVehicleType };
