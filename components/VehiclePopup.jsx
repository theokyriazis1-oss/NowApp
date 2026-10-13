/**
 * components/VehiclePopup.jsx
 *
 * Slide-up vehicle detail panel — now includes a prominent delay badge
 * showing on-time status, minutes late, or minutes early.
 */

'use client';

import { useEffect, useState } from 'react';
import { getVehicleType, tripEnds } from '../lib/vehicleTypes';
import {
  getDelayStatus,
  formatDelay,
  delayTextClass,
  delayHexColor,
  delayBadge,
} from '../lib/delayStatus';

/**
 * @param {Object} props
 * @param {import('../hooks/useVehicleSocket').VehiclePosition|null} props.vehicle
 * @param {() => void} props.onClose
 */
export default function VehiclePopup({ vehicle, onClose, routeStops = [] }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Defer to the next frame so the slide-up transition plays
    const id = requestAnimationFrame(() => setVisible(!!vehicle));
    return () => cancelAnimationFrame(id);
  }, [vehicle]);

  if (!vehicle) return null;

  const typeInfo     = getVehicleType(vehicle.vehicleType);
  const ends         = tripEnds(vehicle.routeName, routeStops);
  const routeColor   = typeInfo.color;
  const speedKmh     = (vehicle.speed * 3.6).toFixed(1);
  const lastSeen     = vehicle.timestamp
    ? new Date(vehicle.timestamp * 1000).toLocaleTimeString()
    : 'Unknown';
  const compassLabels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const compassDir    = compassLabels[Math.round(vehicle.bearing / 45) % 8];

  // Delay
  const delaySecs  = vehicle.delaySeconds ?? 0;
  const status     = getDelayStatus(delaySecs);
  const delayLabel = formatDelay(delaySecs);
  const delayClass = delayTextClass(status);
  const delayColor = delayHexColor(status);
  const badge      = delayBadge(status);

  return (
    <div
      className={`
        fixed bottom-0 left-0 right-0 z-50
        bg-dark-card border-t border-dark-border
        rounded-t-2xl p-5 shadow-lg
        transition-transform duration-300 ease-out
        ${visible ? 'translate-y-0' : 'translate-y-full'}
        sm:left-auto sm:right-4 sm:bottom-4 sm:rounded-xl sm:max-w-sm sm:border
      `}
    >
      {/* Mobile handle bar */}
      <div className="flex justify-center mb-4 sm:hidden">
        <div className="w-10 h-1 bg-dark-border rounded-full" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-dark-bg"
            style={{ backgroundColor: typeInfo.color }}
          >
            {(vehicle.lineNumber || vehicle.routeId).slice(0, 4)}
          </div>
          <div>
            <p className="text-white font-semibold text-lg leading-none">
              {typeInfo.label} {vehicle.lineNumber || vehicle.routeId}
            </p>
            <p className="text-gray-400 text-xs mt-0.5">
              {vehicle.routeName || vehicle.agencyName || `ID: ${vehicle.id}`}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-white transition-colors p-1 rounded-lg hover:bg-dark-border"
          aria-label="Close"
        >
          <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </div>

      {/* ── Start → final destination + next stops ──────────────────────────── */}
      {(ends.origin || ends.destination || ends.between) && (
        <div className="mb-4 text-sm">
          {ends.origin && (
            <p className="text-gray-400"><span className="inline-block w-12 text-gray-500">From</span><span className="text-white">{ends.origin}</span></p>
          )}
          {ends.between && !ends.destination && (
            <p className="text-gray-400"><span className="inline-block w-12 text-gray-500">Route</span><span className="text-white">{ends.between}</span></p>
          )}
          {ends.destination && (
            <p className="text-gray-400"><span className="inline-block w-12 text-gray-500">To</span><span className="text-white font-semibold">{ends.destination}</span></p>
          )}
          {routeStops.length > 1 && (
            <ul className="mt-2 border-l-2 pl-3 space-y-0.5 text-xs text-gray-400" style={{ borderColor: typeInfo.color }}>
              {routeStops.slice(0, 4).map((st) => (
                <li key={st.id} className="flex justify-between gap-3">
                  <span className="truncate">{st.name}</span>
                  {st.time ? <span className="tabular-nums text-gray-500">{new Date(st.time * 1000).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}</span> : null}
                </li>
              ))}
              {routeStops.length > 4 && <li className="text-gray-600">+ {routeStops.length - 4} more</li>}
            </ul>
          )}
        </div>
      )}

      {/* ── Delay banner ─────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between rounded-xl px-4 py-3 mb-4"
        style={{ backgroundColor: `${delayColor}18`, border: `1px solid ${delayColor}40` }}
      >
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: delayColor }} />
          <div>
            <p className={`font-bold text-sm leading-none ${delayClass}`}>
              {badge.label}
            </p>
            <p className="text-gray-400 text-xs mt-0.5">{delayLabel}</p>
          </div>
        </div>

        {/* Delay pill showing exact minutes */}
        {status !== 'ontime' && (
          <div
            className="rounded-full px-3 py-1 text-xs font-bold"
            style={{ backgroundColor: `${delayColor}25`, color: delayColor }}
          >
            {delaySecs > 0 ? '+' : ''}{Math.round(delaySecs / 60)} min
          </div>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Speed"   value={speedKmh}   unit="km/h"                       color={routeColor} />
        <StatCard label="Heading" value={compassDir}  unit={`${Math.round(vehicle.bearing)}°`} color={routeColor} />
        <StatCard label="Updated" value={lastSeen}    unit=""                           color={routeColor} />
      </div>

      {/* Trip ID */}
      {vehicle.tripId && (
        <p className="text-gray-500 text-xs mt-3 text-center">
          Trip: {vehicle.tripId}
        </p>
      )}
    </div>
  );
}

function StatCard({ label, value, unit, color }) {
  return (
    <div className="bg-dark-bg rounded-xl p-3 text-center">
      <p className="text-gray-400 text-xs mb-1">{label}</p>
      <p className="font-bold text-lg leading-none" style={{ color }}>
        {value}
      </p>
      {unit && <p className="text-gray-500 text-xs mt-0.5">{unit}</p>}
    </div>
  );
}
