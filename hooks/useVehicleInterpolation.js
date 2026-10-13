/**
 * hooks/useVehicleInterpolation.js
 *
 * Client-side interpolation engine for smooth vehicle animation.
 *
 * Problem: GTFS-RT feeds update every 10–30 seconds. Without interpolation,
 * vehicles "teleport" to their new positions — jarring UX.
 *
 * Solution: On each animation frame (~16ms), linearly interpolate every
 * vehicle between its last known position and the projected next position,
 * extrapolating using bearing + speed.
 *
 * This gives buttery-smooth movement even with slow-updating feeds.
 */

import { useState, useEffect, useRef, useMemo } from 'react';

const LERP_DURATION_MS = 10_000; // match server poll interval
const RAD = Math.PI / 180;

/**
 * Project a vehicle's position forward in time using its last known
 * bearing and speed.
 *
 * @param {number} lat  Starting latitude
 * @param {number} lng  Starting longitude
 * @param {number} bearing   Heading in degrees (0 = North)
 * @param {number} speed     Speed in m/s
 * @param {number} deltaMs   Elapsed milliseconds
 * @returns {{ lat: number, lng: number }}
 */
function projectPosition(lat, lng, bearing, speed, deltaMs) {
  const distanceMetres = speed * (deltaMs / 1000);
  const distanceDeg = distanceMetres / 111_320; // approximate metres→degrees
  const newLat = lat + Math.cos(bearing * RAD) * distanceDeg;
  const newLng = lng + Math.sin(bearing * RAD) * (distanceDeg / Math.cos(lat * RAD));
  return { lat: newLat, lng: newLng };
}

/**
 * Linearly interpolate between two numbers.
 * @param {number} a  Start value
 * @param {number} b  End value
 * @param {number} t  Progress [0..1]
 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Interpolate bearing via shortest arc to avoid spinning the wrong way.
 * @param {number} a  Start bearing (degrees)
 * @param {number} b  End bearing (degrees)
 * @param {number} t  Progress [0..1]
 */
function lerpBearing(a, b, t) {
  let diff = ((b - a + 540) % 360) - 180;
  return (a + diff * t + 360) % 360;
}

/**
 * @param {import('./useVehicleSocket').VehiclePosition[]} vehicles  Raw server positions
 * @returns {import('./useVehicleSocket').VehiclePosition[]}         Smoothly interpolated positions
 */
export function useVehicleInterpolation(vehicles) {
  // Store the "previous snapshot" and "current snapshot" keyed by vehicle ID
  const prevSnapshotRef = useRef({});
  const currentSnapshotRef = useRef({});
  const updateTimeRef = useRef(0);
  const rafRef = useRef(null);

  const [interpolated, setInterpolated] = useState([]);

  // When server sends new vehicle data, shift current → previous
  useEffect(() => {
    prevSnapshotRef.current = { ...currentSnapshotRef.current };
    const newSnapshot = {};
    for (const v of vehicles) {
      newSnapshot[v.id] = v;
    }
    currentSnapshotRef.current = newSnapshot;
    updateTimeRef.current = Date.now();
  }, [vehicles]);

  // Animation loop
  useEffect(() => {
    let running = true;

    function tick() {
      if (!running) return;

      const now = Date.now();
      const elapsed = now - updateTimeRef.current;
      const t = Math.min(elapsed / LERP_DURATION_MS, 1);

      const current = currentSnapshotRef.current;
      const prev = prevSnapshotRef.current;

      const result = Object.values(current).map((v) => {
        const p = prev[v.id];
        if (!p) return v; // New vehicle — no previous position to interpolate from

        // Project the "target" position slightly ahead based on current bearing+speed
        const projected = projectPosition(v.lat, v.lng, v.bearing, v.speed, elapsed);

        return {
          ...v,
          lat: lerp(p.lat, projected.lat, t),
          lng: lerp(p.lng, projected.lng, t),
          bearing: lerpBearing(p.bearing, v.bearing, t),
        };
      });

      setInterpolated(result);
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      running = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return interpolated;
}
