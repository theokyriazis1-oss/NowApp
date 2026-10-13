/**
 * pages/index.jsx
 *
 * Main page — full-screen transit map with city search.
 *
 * Layout:
 *  - Full-screen MapLibre GL map (bus stops, train stations, live vehicles)
 *  - Search bar at the top centre (replaces old status pill)
 *  - Vehicle popup slides up from the bottom on tap
 */

import dynamic from 'next/dynamic';
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useVehicleSocket } from '../hooks/useVehicleSocket';
import { useVehicleInterpolation } from '../hooks/useVehicleInterpolation';
import { useStops } from '../hooks/useStops';
import { getDelayStatus } from '../lib/delayStatus';
import VehiclePopup from '../components/VehiclePopup';
import SearchBar from '../components/SearchBar';
import RoutePlanner from '../components/RoutePlanner';
import { useUserLocation } from '../hooks/useUserLocation';
import MapControls from '../components/MapControls';
import Legend from '../components/Legend';
import { useTrails } from '../hooks/useTrails';
import { useTripRoute } from '../hooks/useTripRoute';

const TransitMap = dynamic(() => import('../components/TransitMap'), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 bg-[#15181d] flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-[#4d8bf5] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-gray-400 text-sm">Loading map…</p>
      </div>
    </div>
  ),
});

const DEFAULT_CITY = { lat: 52.2215, lng: 6.8937, name: 'Enschede' };

export default function Home() {
  const [city,            setCity]            = useState(DEFAULT_CITY);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [plannerOpen,     setPlannerOpen]     = useState(false);
  const [route,           setRoute]           = useState(null);

  const { vehicles: rawVehicles, status } = useVehicleSocket();
  const vehicles = useVehicleInterpolation(rawVehicles);
  const { stops } = useStops(city);

  // Where am I? + request to fly the map somewhere
  const { position: userLocation, error: locationError, request: requestLocation } = useUserLocation();
  const [focus, setFocus] = useState(null);
  const flewToUser = useRef(false);

  // First GPS fix: centre the map on the user once
  useEffect(() => {
    if (userLocation && !flewToUser.current) {
      flewToUser.current = true;
      setFocus({ lat: userLocation.lat, lng: userLocation.lng, zoom: 14, key: Date.now() });
    }
  }, [userLocation]);

  const handleLocate = useCallback(() => {
    if (userLocation) setFocus({ lat: userLocation.lat, lng: userLocation.lng, zoom: 15, key: Date.now() });
  }, [userLocation]);

  // Selected vehicle: route ahead (from server) + trail behind (from history)
  const trails = useTrails(rawVehicles);
  const selectedId = selectedVehicle?.id ?? null;
  const { stops: routeStops, path: routePath } = useTripRoute(selectedVehicle?.tripId, selectedVehicle?.vehicleType === 'bus');

  const typeCounts = useMemo(() => {
    const c = { bus: 0, tram: 0, train: 0, metro: 0, ferry: 0 };
    for (const v of vehicles) if (c[v.vehicleType] !== undefined) c[v.vehicleType]++;
    return c;
  }, [vehicles]);

  const lateCount = useMemo(
    () => vehicles.filter(v => {
      const s = getDelayStatus(v.delaySeconds ?? 0);
      return s === 'late' || s === 'verylate';
    }).length,
    [vehicles]
  );

  const handleCitySelect  = useCallback((c) => setCity(c), []);
  const handleVehicleSelect = useCallback((v) => setSelectedVehicle(v), []);
  const handlePopupClose  = useCallback(() => setSelectedVehicle(null), []);
  const handleRouteChange = useCallback((r) => setRoute(r), []);

  return (
    <main className="fixed inset-0 bg-[#15181d] overflow-hidden">

      {/* Full-screen map */}
      <TransitMap
        vehicles={vehicles}
        stops={stops}
        city={city}
        focus={focus}
        onVehicleSelect={handleVehicleSelect}
        selectedId={selectedId}
        trail={selectedId ? trails.get(selectedId) : null}
        routeStops={routeStops}
        routePath={routePath}
        userLocation={userLocation}
        plannedRoute={route}
      />

      <MapControls onLocate={handleLocate} located={!!userLocation} error={locationError} />
      <Legend counts={typeCounts} />

      {/* Search bar — replaces old centre status pill */}
      <SearchBar
        onCitySelect={handleCitySelect}
        status={status}
        vehicleCount={vehicles.length}
        lateCount={lateCount}
      />

      {/* Route planner (walking + public transport) */}
      {!plannerOpen && (
        <button
          type="button"
          onClick={() => { if (!userLocation) requestLocation(); setPlannerOpen(true); }}
          className="fixed z-40 left-4 bottom-6 flex items-center gap-2 bg-accent text-dark-bg font-bold text-sm rounded-full px-4 py-3 shadow-lg active:scale-95 transition-transform"
          aria-label="Plan a route"
        >
          Directions
        </button>
      )}
      <RoutePlanner
        open={plannerOpen}
        onClose={() => setPlannerOpen(false)}
        userLocation={userLocation}
        onRequestLocation={requestLocation}
        onRouteChange={handleRouteChange}
      />

      {/* Vehicle detail popup */}
      <VehiclePopup
        vehicle={selectedVehicle}
        onClose={handlePopupClose}
        routeStops={routeStops}
      />

    </main>
  );
}
