/**
 * hooks/useTrails.js
 *
 * Remembers the recent path of every vehicle, built from the server's
 * position snapshots (one every ~30 s). Used to draw "where it has been".
 */

import { useEffect, useRef, useState } from 'react';

const MAX_POINTS = 40;     // ~20 minutes of history at one point per 30 s
const MIN_MOVE_DEG = 0.0002; // ~20 m: ignore GPS jitter / parked vehicles

/**
 * @param {{id:string,lat:number,lng:number}[]} vehicles  raw (non-interpolated) vehicles
 * @returns {Map<string, [number, number][]>} id -> [[lng, lat], ...] oldest first
 */
export function useTrails(vehicles) {
  const store = useRef(new Map());
  const [trails, setTrails] = useState(() => new Map());

  useEffect(() => {
    const seen = new Set();
    for (const v of vehicles) {
      seen.add(v.id);
      const path = store.current.get(v.id) ?? [];
      const last = path[path.length - 1];
      if (!last || Math.abs(last[0] - v.lng) > MIN_MOVE_DEG || Math.abs(last[1] - v.lat) > MIN_MOVE_DEG) {
        path.push([v.lng, v.lat]);
        if (path.length > MAX_POINTS) path.shift();
      }
      store.current.set(v.id, path);
    }
    for (const id of store.current.keys()) if (!seen.has(id)) store.current.delete(id);

    setTrails(new Map(store.current)); // new Map so consumers re-render
  }, [vehicles]);

  return trails;
}
