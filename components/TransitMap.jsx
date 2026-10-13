/**
 * components/TransitMap.jsx
 *
 * MapLibre GL map via react-map-gl (Source + Layer, GPU-rendered).
 *
 * Layers, bottom to top:
 *   1. stops / stations
 *   2. route line  — dashed line from the selected vehicle through its upcoming stops
 *   3. trail line  — solid line along where the selected vehicle has been
 *   4. vehicle delay rings (ring colour = delay status)
 *   5. selection highlight
 *   6. vehicle icons — one distinct icon per mode (bus / tram / train / metro / ferry)
 *   7. line-number labels
 *   + the user's own location (pulsing dot + accuracy circle)
 */

'use client';

import { useRef, useCallback, useMemo, useEffect, useState } from 'react';
import Map, { Source, Layer, Marker, NavigationControl } from 'react-map-gl/maplibre';
import { setWorkerUrl } from 'maplibre-gl';
import { getDelayStatus, delayHexColor } from '../lib/delayStatus';
import { itineraryToGeoJSON, itineraryBounds } from '../lib/routeFormat';
import { VEHICLE_TYPES, TYPE_ORDER, getVehicleType } from '../lib/vehicleTypes';

// MapLibre v6 uses an ES-module worker that webpack can't bundle: serve it statically.
// This module is client-only (loaded via next/dynamic with ssr:false).
setWorkerUrl('/maplibre-gl-worker.mjs');

// MapLibre CSS is imported globally in styles/globals.css

const MAP_STYLE =
  process.env.NEXT_PUBLIC_MAP_STYLE ||
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// Font stack that exists on the CARTO glyph server
const FONT = ['Noto Sans Regular'];

/** Polygon approximating a circle of `radiusM` metres around a point. */
function circlePolygon(lng, lat, radiusM, steps = 48) {
  const coords = [];
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    coords.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} };
}

const EMPTY = { type: 'FeatureCollection', features: [] };

/**
 * @param {Object} props
 * @param {Object[]} props.vehicles
 * @param {Object[]} props.stops
 * @param {{lat:number,lng:number}|null} props.city
 * @param {{lat:number,lng:number,zoom?:number,key:number}|null} props.focus  fly-to request
 * @param {(v:Object)=>void} props.onVehicleSelect
 * @param {string|null} props.selectedId
 * @param {[number,number][]} props.trail        selected vehicle's past path [lng,lat]
 * @param {{name:string,lat:number,lng:number}[]} props.routeStops  selected vehicle's upcoming stops
 * @param {[number,number][]|null} props.routePath  road-snapped line through those stops (buses)
 * @param {{lat:number,lng:number,accuracy:number,heading:number|null}|null} props.userLocation
 */
export default function TransitMap({
  vehicles, stops, city, focus, onVehicleSelect, selectedId, trail, routeStops, routePath, userLocation, plannedRoute = null,
}) {
  const mapRef      = useRef(null);
  const mapReady    = useRef(false);          // true after onLoad fires
  const pendingFly  = useRef(null);           // fly request queued before map was ready
  const [iconsReady, setIconsReady] = useState(false);

  // ── Safe flyTo helper ─────────────────────────────────────────────────────
  const flyTo = useCallback((c, zoom = 13) => {
    if (!c || !mapRef.current || !mapReady.current) return;
    try {
      mapRef.current.flyTo({
        center: [c.lng, c.lat],
        zoom,
        duration: 1400,
        essential: true,
      });
    } catch (err) {
      console.warn('[Map] flyTo error:', err.message);
    }
  }, []);

  const requestFly = useCallback((c, zoom) => {
    if (!c) return;
    if (mapReady.current) flyTo(c, zoom);
    else pendingFly.current = { c, zoom }; // queue until onLoad
  }, [flyTo]);

  // Fly to a searched city
  useEffect(() => { requestFly(city, 13); }, [city, requestFly]);

  // Fly to an explicit focus request (e.g. "my location" button)
  useEffect(() => { if (focus) requestFly(focus, focus.zoom ?? 15); }, [focus, requestFly]);

  // ── Planned route: GeoJSON + fit the map to it ────────────────────────────
  const routeData = useMemo(() => itineraryToGeoJSON(plannedRoute), [plannedRoute]);

  useEffect(() => {
    const bounds = itineraryBounds(plannedRoute);
    if (!bounds || !mapRef.current || !mapReady.current) return;
    try {
      mapRef.current.fitBounds(bounds, {
        // Keep the route clear of the planner panel (left on desktop, bottom on phones)
        padding: window.innerWidth >= 640
          ? { top: 90, bottom: 40, left: 420, right: 60 }
          : { top: 100, bottom: Math.round(window.innerHeight * 0.55), left: 30, right: 30 },
        duration: 1000,
        maxZoom: 16,
      });
    } catch { /* map not ready */ }
  }, [plannedRoute]);

  // ── Load icons + mark map ready ───────────────────────────────────────────
  const onLoad = useCallback((e) => {
    mapReady.current = true;
    const map = e.target;

    let pending = TYPE_ORDER.length;
    const done = () => { if (--pending === 0) setIconsReady(true); };

    TYPE_ORDER.forEach((type) => {
      const name = `icon-${type}`;
      if (map.hasImage(name)) { done(); return; }
      const img = new Image(64, 64);
      img.onload  = () => { if (!map.hasImage(name)) map.addImage(name, img); done(); };
      img.onerror = done;
      img.src = VEHICLE_TYPES[type].icon;
    });

    if (pendingFly.current) {
      flyTo(pendingFly.current.c, pendingFly.current.zoom);
      pendingFly.current = null;
    }
  }, [flyTo]);

  // ── Click: select vehicle (generous hit box so small icons are easy to tap) ─
  const HIT = 16; // px around the pointer
  const queryVehicles = useCallback((map, point) => map.queryRenderedFeatures(
    [[point.x - HIT, point.y - HIT], [point.x + HIT, point.y + HIT]],
    { layers: ['vehicles-icons'] }
  ), []);

  const onClick = useCallback((e) => {
    if (!mapRef.current || !mapReady.current) return;
    try {
      const map = mapRef.current.getMap();
      const features = queryVehicles(map, e.point);
      if (!features.length) { onVehicleSelect(null); return; } // tap on empty map = deselect
      // Prefer the icon nearest to the pointer
      const nearest = features
        .map((f) => {
          const p = map.project(f.geometry.coordinates);
          return { f, d: (p.x - e.point.x) ** 2 + (p.y - e.point.y) ** 2 };
        })
        .sort((a, b) => a.d - b.d)[0].f;
      const vehicle = vehicles.find((v) => v.id === nearest.properties.id);
      if (vehicle) onVehicleSelect(vehicle);
    } catch { /* map not ready */ }
  }, [vehicles, onVehicleSelect, queryVehicles]);

  // ── Cursor change on hover ────────────────────────────────────────────────
  const onMouseMove = useCallback((e) => {
    if (!mapRef.current || !mapReady.current) return;
    try {
      const map = mapRef.current.getMap();
      map.getCanvas().style.cursor = queryVehicles(map, e.point).length ? 'pointer' : '';
    } catch { /* ignore */ }
  }, [queryVehicles]);

  // ── GeoJSON: vehicles ─────────────────────────────────────────────────────
  const vehiclesGeoJSON = useMemo(() => ({
    type: 'FeatureCollection',
    features: (vehicles ?? []).map((v) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [v.lng, v.lat] },
      properties: {
        id:          v.id,
        bearing:     v.bearing ?? 0,
        vehicleType: VEHICLE_TYPES[v.vehicleType] ? v.vehicleType : 'bus',
        ringColor:   delayHexColor(getDelayStatus(v.delaySeconds ?? 0)),
        line:        v.lineNumber ?? '',
      },
    })),
  }), [vehicles]);

  // ── GeoJSON: stops ────────────────────────────────────────────────────────
  const stopsGeoJSON = useMemo(() => ({
    type: 'FeatureCollection',
    features: (stops ?? []).map((s) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      properties: { id: s.id, name: s.name, type: s.type },
    })),
  }), [stops]);

  // ── GeoJSON: selected vehicle's route + trail ─────────────────────────────
  const selected = useMemo(
    () => (selectedId ? (vehicles ?? []).find((v) => v.id === selectedId) : null),
    [vehicles, selectedId]
  );
  const modeColor = getVehicleType(selected?.vehicleType).color;

  const routeGeoJSON = useMemo(() => {
    if (!selected || !routeStops?.length) return EMPTY;
    // Road-snapped path when available (buses), else straight segments between stops
    const ahead = routePath?.length > 1 ? routePath : routeStops.map((s) => [s.lng, s.lat]);
    const coordinates = [[selected.lng, selected.lat], ...ahead];
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: {} }],
    };
  }, [selected, routeStops, routePath]);

  const routeStopsGeoJSON = useMemo(() => ({
    type: 'FeatureCollection',
    features: (selected ? routeStops ?? [] : []).map((s) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      properties: { name: s.name },
    })),
  }), [selected, routeStops]);

  const trailGeoJSON = useMemo(() => {
    if (!selected || !trail?.length) return EMPTY;
    const coordinates = [...trail, [selected.lng, selected.lat]];
    if (coordinates.length < 2) return EMPTY;
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: {} }],
    };
  }, [selected, trail]);

  const selectedGeoJSON = useMemo(() => (selected ? {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [selected.lng, selected.lat] }, properties: {} }],
  } : EMPTY), [selected]);

  // ── GeoJSON: user accuracy circle ─────────────────────────────────────────
  const accuracyGeoJSON = useMemo(() => (userLocation ? {
    type: 'FeatureCollection',
    features: [circlePolygon(userLocation.lng, userLocation.lat, Math.max(userLocation.accuracy, 10))],
  } : EMPTY), [userLocation]);

  return (
    <Map
      ref={mapRef}
      initialViewState={{ longitude: 6.8937, latitude: 52.2215, zoom: 13 }}
      mapStyle={MAP_STYLE}
      attributionControl={false}
      style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}
      onLoad={onLoad}
      onClick={onClick}
      onMouseMove={onMouseMove}
      maxZoom={19}
      doubleClickZoom
      touchZoomRotate
    >
      <NavigationControl position="bottom-right" showCompass={false} />
      {/* ── Stops ──────────────────────────────────────────────────────────── */}
      <Source id="stops" type="geojson" data={stopsGeoJSON}>
        <Layer
          id="bus-stops"
          type="circle"
          minzoom={12}
          filter={['==', ['get', 'type'], 'bus_stop']}
          paint={{
            'circle-radius':         ['interpolate', ['linear'], ['zoom'], 12, 3, 16, 6],
            'circle-color':          '#8a9bb0',
            'circle-opacity':        0.8,
            'circle-stroke-width':   1,
            'circle-stroke-color':   '#ffffff',
            'circle-stroke-opacity': 0.35,
          }}
        />
        <Layer
          id="train-stations"
          type="circle"
          minzoom={9}
          filter={['==', ['get', 'type'], 'train_station']}
          paint={{
            'circle-radius':         ['interpolate', ['linear'], ['zoom'], 9, 6, 15, 14],
            'circle-color':          '#4d8bf5',
            'circle-opacity':        0.9,
            'circle-stroke-width':   2,
            'circle-stroke-color':   '#ffffff',
            'circle-stroke-opacity': 0.5,
          }}
        />
        <Layer
          id="station-labels"
          type="symbol"
          minzoom={11}
          filter={['==', ['get', 'type'], 'train_station']}
          layout={{
            'text-field':  ['get', 'name'],
            'text-font':   FONT,
            'text-size':   11,
            'text-offset': [0, 1.6],
            'text-anchor': 'top',
          }}
          paint={{
            'text-color':      '#ffffff',
            'text-halo-color': '#15181d',
            'text-halo-width': 1.5,
          }}
        />
      </Source>

      {/* ── Selected vehicle: upcoming route (dashed) ──────────────────────── */}
      <Source id="route" type="geojson" data={routeGeoJSON}>
        <Layer
          id="route-casing"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': '#15181d', 'line-width': 8, 'line-opacity': 0.7 }}
        />
        <Layer
          id="route-line"
          type="line"
          layout={{ 'line-join': 'round' }}
          paint={{ 'line-color': modeColor, 'line-width': 4, 'line-dasharray': [2, 1.5] }}
        />
      </Source>
      <Source id="route-stops" type="geojson" data={routeStopsGeoJSON}>
        <Layer
          id="route-stop-dots"
          type="circle"
          paint={{
            'circle-radius':       5,
            'circle-color':        '#15181d',
            'circle-stroke-width': 3,
            'circle-stroke-color': modeColor,
          }}
        />
        <Layer
          id="route-stop-labels"
          type="symbol"
          minzoom={10}
          layout={{
            'text-field':  ['get', 'name'],
            'text-font':   FONT,
            'text-size':   12,
            'text-offset': [0, 1.1],
            'text-anchor': 'top',
            'text-optional': true,
          }}
          paint={{ 'text-color': '#ffffff', 'text-halo-color': '#15181d', 'text-halo-width': 2 }}
        />
      </Source>

      {/* ── Selected vehicle: where it has been (solid) ────────────────────── */}
      <Source id="trail" type="geojson" data={trailGeoJSON}>
        <Layer
          id="trail-casing"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': '#15181d', 'line-width': 8, 'line-opacity': 0.7 }}
        />
        <Layer
          id="trail-line"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': modeColor, 'line-width': 4, 'line-opacity': 0.55 }}
        />
      </Source>

      {/* ── Planned route (walk = dashed grey, transit = solid, mode colour) ── */}
      <Source id="plan-lines" type="geojson" data={routeData.lines}>
        <Layer
          id="plan-casing"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': '#15181d', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 5, 16, 11], 'line-opacity': 0.85 }}
        />
        <Layer
          id="plan-transit"
          type="line"
          filter={['==', ['get', 'kind'], 'transit']}
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 16, 7] }}
        />
        <Layer
          id="plan-walk"
          type="line"
          filter={['==', ['get', 'kind'], 'walk']}
          layout={{ 'line-cap': 'butt', 'line-join': 'round' }}
          paint={{ 'line-color': '#e5e7eb', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 16, 5], 'line-dasharray': [1.2, 1.4] }}
        />
      </Source>
      <Source id="plan-points" type="geojson" data={routeData.points}>
        <Layer
          id="plan-stops"
          type="circle"
          minzoom={11}
          filter={['==', ['get', 'role'], 'stop']}
          paint={{ 'circle-radius': 3, 'circle-color': '#ffffff', 'circle-stroke-width': 1, 'circle-stroke-color': '#15181d' }}
        />
        <Layer
          id="plan-boarding"
          type="circle"
          filter={['==', ['get', 'role'], 'board']}
          paint={{ 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-width': 3, 'circle-stroke-color': '#15181d' }}
        />
        <Layer
          id="plan-boarding-labels"
          type="symbol"
          minzoom={10}
          filter={['==', ['get', 'role'], 'board']}
          layout={{ 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 12, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-optional': true }}
          paint={{ 'text-color': '#ffffff', 'text-halo-color': '#15181d', 'text-halo-width': 1.6 }}
        />
        <Layer
          id="plan-leg-icons"
          type="symbol"
          filter={['==', ['get', 'role'], 'leg']}
          layout={{
            'icon-image': ['get', 'icon'],
            'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.4, 14, 0.6],
            'icon-allow-overlap': true,
            'text-field': ['format', ['get', 'line'], { 'font-scale': 1.1 }, '\n', {}, ['get', 'headsign'], { 'font-scale': 0.85 }],
            'text-font': FONT,
            'text-size': 13,
            'text-offset': [0, 1.6],
            'text-anchor': 'top',
            'text-optional': true,
          }}
          paint={{ 'text-color': '#ffffff', 'text-halo-color': '#15181d', 'text-halo-width': 2 }}
        />
        <Layer
          id="plan-end-labels"
          type="symbol"
          filter={['any', ['==', ['get', 'role'], 'origin'], ['==', ['get', 'role'], 'destination']]}
          layout={{ 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 13, 'text-offset': [0, -1.4], 'text-anchor': 'bottom', 'text-allow-overlap': true }}
          paint={{ 'text-color': '#ffffff', 'text-halo-color': '#15181d', 'text-halo-width': 2 }}
        />
        <Layer
          id="plan-origin"
          type="circle"
          filter={['==', ['get', 'role'], 'origin']}
          paint={{ 'circle-radius': 8, 'circle-color': '#4d8bf5', 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' }}
        />
        <Layer
          id="plan-destination"
          type="circle"
          filter={['==', ['get', 'role'], 'destination']}
          paint={{ 'circle-radius': 9, 'circle-color': '#e8803a', 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' }}
        />
      </Source>

      {/* ── Vehicles ───────────────────────────────────────────────────────── */}
      <Source id="vehicles" type="geojson" data={vehiclesGeoJSON}>
        {/* Delay ring: colour = delay status */}
        <Layer
          id="vehicles-glow"
          type="circle"
          paint={{
            'circle-radius':       ['interpolate', ['linear'], ['zoom'], 10, 9, 16, 22],
            'circle-color':        ['get', 'ringColor'],
            'circle-opacity':      0.22,
            'circle-stroke-width': 2,
            'circle-stroke-color': ['get', 'ringColor'],
            'circle-stroke-opacity': 0.95,
          }}
        />
        {/* Icons — only shown after custom images loaded */}
        {iconsReady && (
          <Layer
            id="vehicles-icons"
            type="symbol"
            layout={{
              'icon-image': [
                'match', ['get', 'vehicleType'],
                'tram',  'icon-tram',
                'train', 'icon-train',
                'metro', 'icon-metro',
                'ferry', 'icon-ferry',
                'icon-bus',
              ],
              'icon-rotate':             ['get', 'bearing'],
              'icon-rotation-alignment': 'map',
              'icon-size':               ['interpolate', ['linear'], ['zoom'], 9, 0.3, 13, 0.45, 16, 0.8, 19, 1.2],
              'icon-allow-overlap':      true,
              'icon-ignore-placement':   true,
            }}
          />
        )}
        {/* Line number under each vehicle (zoomed in) */}
        <Layer
          id="vehicles-labels"
          type="symbol"
          minzoom={13}
          filter={['!=', ['get', 'line'], '']}
          layout={{
            'text-field':  ['get', 'line'],
            'text-font':   FONT,
            'text-size':   12,
            'text-offset': [0, 1.9],
            'text-anchor': 'top',
            'text-allow-overlap': false,
          }}
          paint={{ 'text-color': '#ffffff', 'text-halo-color': '#15181d', 'text-halo-width': 2 }}
        />
      </Source>

      {/* ── Selection highlight ────────────────────────────────────────────── */}
      <Source id="selected" type="geojson" data={selectedGeoJSON}>
        <Layer
          id="selected-ring"
          type="circle"
          paint={{
            'circle-radius':       ['interpolate', ['linear'], ['zoom'], 9, 16, 16, 32],
            'circle-color':        '#ffffff',
            'circle-opacity':      0.08,
            'circle-stroke-width': 3,
            'circle-stroke-color': '#ffffff',
          }}
        />
      </Source>

      {/* ── You are here ───────────────────────────────────────────────────── */}
      <Source id="user-accuracy" type="geojson" data={accuracyGeoJSON}>
        <Layer
          id="user-accuracy-fill"
          type="fill"
          paint={{ 'fill-color': '#4285f4', 'fill-opacity': 0.12 }}
        />
        <Layer
          id="user-accuracy-outline"
          type="line"
          paint={{ 'line-color': '#4285f4', 'line-width': 1, 'line-opacity': 0.4 }}
        />
      </Source>
      {userLocation && (
        <Marker longitude={userLocation.lng} latitude={userLocation.lat} anchor="center" style={{ zIndex: 5 }}>
          <div className="user-dot" title="You are here">
            <span className="user-dot-pulse" />
            {userLocation.heading !== null && (
              <span className="user-dot-heading" style={{ transform: `rotate(${userLocation.heading}deg)` }} />
            )}
            <span className="user-dot-core" />
          </div>
        </Marker>
      )}
    </Map>
  );
}
