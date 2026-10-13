/**
 * hooks/useTripRoute.js
 *
 * Fetches the upcoming stops (with coordinates) of the selected vehicle's trip
 * from the server, refreshing every 30 s while the vehicle stays selected.
 */

import { useEffect, useState } from 'react';

const SERVER = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

/**
 * @param {string|null|undefined} tripId
 * @param {boolean} [snap]  ask the server to join the stops along real roads (buses)
 * @returns {{ stops: {id:string,name:string,lat:number,lng:number,time:number,delay:number}[], path: [number,number][]|null }}
 */
export function useTripRoute(tripId, snap = false) {
  const [state, setState] = useState({ key: null, stops: [], path: null });
  const key = tripId ? `${tripId}|${snap}` : null;

  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;

    const load = () =>
      fetch(`${SERVER}/api/trips/${encodeURIComponent(tripId)}${snap ? '?snap=1' : ''}`)
        .then((r) => r.json())
        .then((d) => { if (!cancelled) setState({ key, stops: d.stops ?? [], path: d.path ?? null }); })
        .catch(() => {});

    load();
    const timer = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [tripId, snap, key]);

  // Ignore results that belong to a previously selected trip
  return state.key === key ? { stops: state.stops, path: state.path } : { stops: [], path: null };
}
