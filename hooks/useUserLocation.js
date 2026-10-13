/**
 * hooks/useUserLocation.js
 *
 * Watches the device position (Geolocation API) so the map can show where
 * the user is. Starts automatically; failures (denied, unavailable) leave
 * `position` null and set `error`.
 *
 * Returns { position, location, error, request }:
 *   position / location  same object: {lat, lng, accuracy, heading} or null
 *   request()            ask again (e.g. from a button after a denied prompt)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

const OPTIONS = { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 };

function toPosition({ coords }) {
  return {
    lat: coords.latitude,
    lng: coords.longitude,
    accuracy: coords.accuracy,
    heading: Number.isFinite(coords.heading) ? coords.heading : null,
  };
}

export function useUserLocation() {
  const [position, setPosition] = useState(null);
  const [error, setError]       = useState(null);

  const onSuccess = useCallback((p) => { setError(null); setPosition(toPosition(p)); }, []);
  const onError   = useCallback((err) => setError(err.message), []);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(onSuccess, onError, OPTIONS);
    return () => navigator.geolocation.clearWatch(id);
  }, [onSuccess, onError]);

  const request = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(onSuccess, onError, OPTIONS);
  }, [onSuccess, onError]);

  return useMemo(
    () => ({ position, location: position, error, request }),
    [position, error, request]
  );
}
