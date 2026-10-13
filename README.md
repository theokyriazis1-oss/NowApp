# Now

Live map of Dutch buses, trams, trains, metros and ferries. Tap a vehicle to see its line, delay, where it has been and which stops it calls at next. Includes a walking + public transport route planner. Runs as a web app/PWA. Native apps live in the sibling projects `NowAndroid` and `NowIOS`.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (pages router) + React 18 |
| Map | MapLibre GL JS 6 via react-map-gl (native Source/Layer, WebGL — no DOM markers) |
| PWA | Serwist (`sw-src.js` → `public/sw.js`) |
| Real-time | Socket.io |
| Backend | Node.js + Express (`server/`) |
| Data | OVzoeker snapshot (positions), OVapi GTFS-RT `tripUpdates.pb` (delays), Overpass API (stops) |
| Styling | Tailwind CSS 3 |

## Quick start

```bash
npm install
npm run dev        # Next.js http://localhost:3000 + API/socket server http://localhost:3001
```

No API keys are needed. Config lives in `.env.local`:

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | API/socket server port | `3001` |
| `CORS_ORIGIN` | Comma-separated allowed browser origins | `http://localhost:3000` |
| `NEXT_PUBLIC_SOCKET_URL` | Server URL used by the browser | `http://localhost:3001` |
| `NEXT_PUBLIC_MAP_STYLE` | MapLibre style URL | CARTO Dark Matter |
| `NEXT_PUBLIC_MAPTILER_KEY` | Optional MapTiler key | – |

Set `CORS_ORIGIN` to your deployed site's origin (and any LAN origin you use in development) — other origins are rejected.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Next dev server + `node --watch` API server |
| `npm run build` | Production build (webpack, generates the service worker) |
| `npm start` | Runs `next start` and the API server together |
| `npm run lint` | ESLint (Next core-web-vitals + React hooks rules) |
| `npm test` | Node test runner (`server/*.test.js`) |

## Architecture

```
OVzoeker snapshot + OVapi tripUpdates   (fetched in parallel, every 30 s)
              │
              ▼
   server/index.js  ── decode, match delays by tripId, serve stale data on failure
              │  Socket.io push  (+ REST: /api/vehicles, /api/health, /api/stops?bbox=)
              ▼
   hooks/useVehicleSocket → useVehicleInterpolation (rAF smoothing)
              ▼
   components/TransitMap  (MapLibre GeoJSON sources + symbol layers)
```

### API

- `GET /api/health` – status, client count, last update
- `GET /api/vehicles` – latest cached vehicles
- `GET /api/stops?bbox=minLat,minLng,maxLat,maxLng` – stops from Overpass (cached 1 h). The bbox is validated (numeric, inside/near the Netherlands, ≤ 1° span) and the endpoint is rate-limited to 30 requests/min per IP.

## Project structure

```
server/        index.js (poller + API + sockets), stopsService.js, validate.js (+ tests)
pages/         _app.jsx, _document.jsx, index.jsx
components/    TransitMap, SearchBar, StatusBar, VehiclePopup, MapControls
hooks/         useVehicleSocket, useVehicleInterpolation, useStops
lib/           delayStatus.js, routeColors.js
public/        manifest.json, icons/, vehicle/train SVGs, MapLibre worker files
sw-src.js      Service-worker source (Serwist runtime caching rules)
```

## PWA

Tap **Add to Home Screen**. Map tiles and styles are cached (cache-first / stale-while-revalidate) for offline use; live API and socket traffic is network-first and never served stale. The service worker is disabled in development.

## Mobile apps

The Android and iOS apps are separate projects that wrap this same web app: `../NowAndroid` and `../NowIOS`. They talk to this API server over the network, so deploy it somewhere reachable from a phone and add the origins `https://localhost` and `capacitor://localhost` to `CORS_ORIGIN`.
