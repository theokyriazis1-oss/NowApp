/**
 * lib/routeFormat.js — formatting + styling helpers for the route planner.
 */

import { VEHICLE_TYPES } from './vehicleTypes';

// Same colours/labels as the live-vehicle icons so a bus looks like a bus everywhere
export const MODE_COLORS = {
  walk: '#9ca3af',
  ...Object.fromEntries(Object.entries(VEHICLE_TYPES).map(([k, v]) => [k, v.color])),
};

export const MODE_LABELS = {
  walk: 'Walk',
  ...Object.fromEntries(Object.entries(VEHICLE_TYPES).map(([k, v]) => [k, v.label])),
};

export function formatDuration(sec) {
  const m = Math.max(1, Math.round(sec / 60));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, '0')} min`;
}

export function formatClock(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

/** Local "YYYY-MM-DDTHH:mm" value for <input type="datetime-local">. */
export function toLocalInputValue(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Middle coordinate of a line (by vertex count) — good enough for a label anchor. */
function midpoint(coords) {
  return coords[Math.floor(coords.length / 2)];
}

/** GeoJSON for drawing one itinerary on the map. */
export function itineraryToGeoJSON(itinerary) {
  const lines = [];
  const points = [];
  if (!itinerary) return { lines: emptyFC(), points: emptyFC() };

  const last = itinerary.legs.length - 1;
  itinerary.legs.forEach((leg, i) => {
    if (leg.coordinates.length > 1) {
      lines.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: leg.coordinates },
        properties: { kind: leg.kind, color: MODE_COLORS[leg.vehicleType] ?? '#4d8bf5' },
      });
    }
    if (leg.kind === 'transit') {
      leg.stops.forEach((s) => points.push(pt(s.lng, s.lat, { role: 'stop', name: s.name })));
      points.push(pt(leg.from.lng, leg.from.lat, { role: 'board', name: `${formatClock(leg.startTime)} ${leg.from.name}` }));
      points.push(pt(leg.to.lng, leg.to.lat, { role: 'board', name: `${formatClock(leg.endTime)} ${leg.to.name}` }));
      // Mode icon + line number in the middle of each public transport leg
      const mid = leg.coordinates.length ? midpoint(leg.coordinates) : [leg.from.lng, leg.from.lat];
      points.push(pt(mid[0], mid[1], {
        role: 'leg',
        icon: `icon-${leg.vehicleType}`,
        line: leg.line || MODE_LABELS[leg.vehicleType],
        headsign: leg.headsign ? `→ ${leg.headsign}` : '',
      }));
    }
    if (i === 0) points.push(pt(leg.from.lng, leg.from.lat, { role: 'origin', name: 'Start' }));
    if (i === last) points.push(pt(leg.to.lng, leg.to.lat, { role: 'destination', name: 'Destination' }));
  });
  return { lines: { type: 'FeatureCollection', features: lines }, points: { type: 'FeatureCollection', features: points } };
}

export function itineraryBounds(itinerary) {
  let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90, any = false;
  for (const leg of itinerary?.legs ?? []) {
    for (const [lng, lat] of leg.coordinates) {
      any = true;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return any ? [[minLng, minLat], [maxLng, maxLat]] : null;
}

const emptyFC = () => ({ type: 'FeatureCollection', features: [] });
const pt = (lng, lat, properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties });
