/**
 * hooks/useStops.js
 *
 * Fetches bus stops + train stations for the currently viewed city
 * from /api/stops?bbox=... (Overpass API, cached 1h on server).
 *
 * Refetches whenever the city changes.
 */

import { useState, useEffect, useRef } from 'react';

const SERVER = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

// Approx bounding box radius around a city centre (degrees)
const DELTA_LAT = 0.12; // ~13 km
const DELTA_LNG = 0.18; // ~12 km at NL latitude

/**
 * @param {{ lat: number, lng: number, name: string } | null} city
 * @returns {{ stops: Stop[], loading: boolean }}
 */
export function useStops(city) {
  const [stops,   setStops]   = useState([]);
  const [loading, setLoading] = useState(false);
  const lastCityRef = useRef(null);

  useEffect(() => {
    if (!city) return;
    // Skip refetch if same city name
    if (lastCityRef.current === city.name) return;
    lastCityRef.current = city.name;

    const bbox = [
      city.lat - DELTA_LAT,
      city.lng - DELTA_LNG,
      city.lat + DELTA_LAT,
      city.lng + DELTA_LNG,
    ].join(',');

    let cancelled = false;
    setLoading(true);

    fetch(`${SERVER}/api/stops?bbox=${bbox}`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setStops(data.stops ?? []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [city]);

  return { stops, loading };
}
