/**
 * lib/vehicleTypes.js
 *
 * Per-mode metadata shared by the map layers, popup and legend.
 * Icons live in public/vehicle-icons/<type>.svg (nose pointing up).
 */

export const VEHICLE_TYPES = {
  bus:   { label: 'Bus',   color: '#3b82f6', icon: '/vehicle-icons/bus.svg' },
  tram:  { label: 'Tram',  color: '#22c55e', icon: '/vehicle-icons/tram.svg' },
  train: { label: 'Train', color: '#facc15', icon: '/vehicle-icons/train.svg' },
  metro: { label: 'Metro', color: '#a855f7', icon: '/vehicle-icons/metro.svg' },
  ferry: { label: 'Ferry', color: '#38bdf8', icon: '/vehicle-icons/ferry.svg' },
};

export const TYPE_ORDER = ['bus', 'tram', 'train', 'metro', 'ferry'];

export const getVehicleType = (type) => VEHICLE_TYPES[type] ?? VEHICLE_TYPES.bus;

/**
 * Start and final destination of a live trip.
 * Only reported when the last known stop is one end of the line (the realtime
 * feed does not always list every stop); otherwise `between` holds the route name.
 */
export function tripEnds(routeName, stops) {
  const parts = (routeName || '').split(/\s+<->\s+|\s+-\s+|\s+→\s+/).map((p) => p.trim()).filter(Boolean);
  const destination = stops?.length ? stops[stops.length - 1].name : '';
  const norm = (x) => x.toLowerCase().replace(/[^a-z0-9 ]/g, '');
  const matches = (part) => {
    const a = norm(part), b = norm(destination);
    return !!a && !!b && (a.includes(b) || b.includes(a) || a.split(' ')[0] === b.split(' ')[0]);
  };

  if (parts.length >= 2) {
    const first = parts[0], last = parts[parts.length - 1];
    if (!destination) return { origin: '', destination: '', between: parts.join(' – ') };
    if (matches(last)) return { origin: first, destination };
    if (matches(first)) return { origin: last, destination };
    // Last known stop is mid-route: don't guess the direction, show the line's two ends instead
    return { origin: '', destination: '', between: parts.join(' – ') };
  }
  return { origin: '', destination: '', between: parts[0] || '' };
}
