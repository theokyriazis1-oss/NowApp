/**
 * components/RoutePlanner.jsx
 *
 * Journey planner panel (public transport or walking only — no car).
 * Talks to the app server (/api/geocode, /api/route); reports the chosen
 * itinerary to the parent through onRouteChange so the map can draw it.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MODE_COLORS, MODE_LABELS, formatDuration, formatClock, toLocalInputValue,
} from '../lib/routeFormat';
import { VEHICLE_TYPES } from '../lib/vehicleTypes';

const SERVER = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

// ─── Place input with debounced search ──────────────────────────────────────
function PlaceInput({ label, value, onChange, userLocation, onRequestLocation, dotClass }) {
  // draft = what the user is typing; null means show the chosen place's name
  const [draft, setDraft] = useState(null);
  const text = draft ?? value?.name ?? '';
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);
  const seq = useRef(0);

  const search = useCallback((q) => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      const id = ++seq.current;
      try {
        const res = await fetch(`${SERVER}/api/geocode?q=${encodeURIComponent(q.trim())}`);
        const data = await res.json();
        if (id === seq.current) setResults(data.places ?? []);
      } catch {
        if (id === seq.current) setResults([]);
      }
    }, 400);
  }, []);

  const pick = (place) => {
    setOpen(false);
    setResults([]);
    setDraft(null);
    onChange(place);
  };

  const pickMyLocation = () => {
    if (userLocation) pick({ name: 'My location', lat: userLocation.lat, lng: userLocation.lng });
    else { onRequestLocation(); setOpen(false); }
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2 bg-dark-bg border border-dark-border rounded-xl px-3 py-2.5 focus-within:border-accent/60">
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotClass}`} />
        <input
          value={text}
          onChange={(e) => { setDraft(e.target.value); onChange(null); search(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={label}
          aria-label={label}
          className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder-gray-500 outline-none"
          style={{ userSelect: 'text' }}
        />
        {text && (
          <button
            type="button"
            aria-label={`Clear ${label}`}
            className="text-gray-500 hover:text-white text-lg leading-none"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setDraft(''); onChange(null); setResults([]); }}
          >×</button>
        )}
      </div>

      {open && (
        <ul className="absolute left-0 right-0 top-full mt-1 z-50 bg-dark-card border border-dark-border rounded-xl shadow-lg overflow-hidden">
          <li>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={pickMyLocation}
              className="w-full text-left px-3 py-2.5 text-sm text-accent hover:bg-dark-border flex items-center gap-2"
            >
              <span aria-hidden>◎</span> {userLocation ? 'My location' : 'Use my location'}
            </button>
          </li>
          {results.map((r, i) => (
            <li key={`${r.lat},${r.lng},${i}`}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(r)}
                className="w-full text-left px-3 py-2 hover:bg-dark-border"
              >
                <p className="text-sm text-white leading-tight truncate">{r.name}</p>
                <p className="text-xs text-gray-500 truncate">{r.displayName}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Mode icon (same artwork as the live vehicles on the map) ───────────────
function ModeIcon({ type, size = 20 }) {
  if (type === 'walk') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Walk">
        <circle cx="13" cy="4" r="2" fill="#9ca3af" />
        <path d="M9 21l2-6 3 2v4M11 15l1-5 3 2 2 1M12 10l-3 2-1 3" />
      </svg>
    );
  }
  const info = VEHICLE_TYPES[type] ?? VEHICLE_TYPES.bus;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={info.icon} alt={info.label} width={size} height={size} />;
}

// ─── Leg chip row for an itinerary card ─────────────────────────────────────
function LegChips({ legs }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-2">
      {legs.map((leg, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-gray-600 text-xs">›</span>}
          {leg.kind === 'walk' ? (
            <span className="flex items-center gap-1 text-xs text-gray-400 bg-dark-border rounded-md px-1.5 py-0.5">
              <ModeIcon type="walk" size={14} /> {Math.max(1, Math.round(leg.durationSec / 60))} min
            </span>
          ) : (
            <span
              className="flex items-center gap-1 text-xs font-bold rounded-md pl-1 pr-1.5 py-0.5 text-dark-bg"
              style={{ background: MODE_COLORS[leg.vehicleType] }}
            >
              <span className="bg-dark-bg/90 rounded-sm flex"><ModeIcon type={leg.vehicleType} size={16} /></span>
              {leg.line || MODE_LABELS[leg.vehicleType]}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

function LegDetails({ legs }) {
  return (
    <ol className="mt-3 space-y-4 border-l-2 border-dark-border ml-1 pl-4" onClick={(e) => e.stopPropagation()}>
      {legs.map((leg, i) => (
        <li key={i} className="relative">
          <span
            className="absolute -left-[22px] top-1 w-3 h-3 rounded-full border-2 border-dark-card"
            style={{ background: MODE_COLORS[leg.vehicleType] }}
          />
          {leg.kind === 'walk' ? (
            <p className="text-xs text-gray-300 flex items-center gap-1.5">
              <ModeIcon type="walk" size={14} />
              Walk {formatDuration(leg.durationSec)} to{' '}
              <span className="text-white">{leg.to.name === 'END' ? 'destination' : leg.to.name}</span>
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <ModeIcon type={leg.vehicleType} size={28} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-tight" style={{ color: MODE_COLORS[leg.vehicleType] }}>
                    {MODE_LABELS[leg.vehicleType]} {leg.line}
                  </p>
                  {leg.headsign && (
                    <p className="text-xs text-gray-300 leading-tight">towards <span className="text-white">{leg.headsign}</span></p>
                  )}
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-1.5">
                <span className="text-gray-500">Start</span> {formatClock(leg.startTime)} ·{' '}
                <span className="text-white font-medium">{leg.from.name}</span>
                {leg.from.track ? ` · platform ${leg.from.track}` : ''}
              </p>
              <p className="text-xs text-gray-400">
                <span className="text-gray-500">End</span>&nbsp;&nbsp; {formatClock(leg.endTime)} ·{' '}
                <span className="text-white font-medium">{leg.to.name}</span>
                {leg.to.track ? ` · platform ${leg.to.track}` : ''}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {formatDuration(leg.durationSec)}
                {leg.stops.length ? ` · ${leg.stops.length + 1} stops` : ''}
                {leg.agency ? ` · ${leg.agency}` : ''}
                {leg.realTime ? ' · live' : ''}
              </p>
              {leg.stops.length > 0 && (
                <details className="mt-1 text-xs text-gray-400">
                  <summary className="cursor-pointer text-gray-500 hover:text-gray-300">Stops on the way</summary>
                  <ul className="mt-1 space-y-0.5 pl-2 border-l border-dark-border">
                    {leg.stops.map((st, k) => <li key={k}>{st.name}</li>)}
                  </ul>
                </details>
              )}
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * @param {Object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {{lat:number,lng:number}|null} props.userLocation
 * @param {() => void} props.onRequestLocation
 * @param {(itinerary: any|null) => void} props.onRouteChange
 */
export default function RoutePlanner({ open, onClose, userLocation, onRequestLocation, onRouteChange }) {
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const [mode, setMode] = useState('transit');
  const [timeMode, setTimeMode] = useState('now'); // now | depart | arrive
  const [when, setWhen] = useState(() => toLocalInputValue());
  const [itineraries, setItineraries] = useState([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searched, setSearched] = useState(false);
  const [swapKey, setSwapKey] = useState(0); // remounts the inputs so typed drafts reset on swap


  // Default the start to the user's position when it first becomes known
  const usedLocation = useRef(false);
  useEffect(() => {
    if (userLocation && !from && !usedLocation.current) {
      usedLocation.current = true;
      setFrom({ name: 'My location', lat: userLocation.lat, lng: userLocation.lng });
    }
  }, [userLocation, from]);

  // Tell the map which itinerary to draw
  useEffect(() => {
    onRouteChange(open ? itineraries[selected] ?? null : null);
  }, [open, itineraries, selected, onRouteChange]);

  const canSearch = !!from && !!to && !loading;

  const search = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const params = new URLSearchParams({
        from: `${from.lat},${from.lng}`,
        to: `${to.lat},${to.lng}`,
        mode,
      });
      if (timeMode !== 'now') {
        params.set('time', new Date(when).toISOString());
        params.set('arriveBy', String(timeMode === 'arrive'));
      }
      const res = await fetch(`${SERVER}/api/route?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setItineraries(data.itineraries ?? []);
      setSelected(0);
    } catch (err) {
      setItineraries([]);
      setError(err.message || 'Could not plan the route');
    } finally {
      setLoading(false);
    }
  }, [from, to, mode, timeMode, when]);

  const swap = () => { setFrom(to); setTo(from); setItineraries([]); setSearched(false); setSwapKey((k) => k + 1); };

  if (!open) return null;

  const segBtn = (active) =>
    `flex-1 text-xs font-semibold rounded-lg px-3 py-2 transition-colors ${
      active ? 'bg-accent text-dark-bg' : 'bg-dark-bg text-gray-300 hover:text-white border border-dark-border'
    }`;

  return (
    <aside
      className="fixed z-50 bg-dark-card border border-dark-border shadow-lg text-white
                 inset-x-0 bottom-0 max-h-[75vh] rounded-t-2xl
                 sm:inset-x-auto sm:left-4 sm:top-20 sm:bottom-4 sm:w-96 sm:max-h-none sm:rounded-xl
                 flex flex-col"
      aria-label="Route planner"
    >
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h2 className="text-base font-bold">Plan a route</h2>
        <button type="button" onClick={onClose} aria-label="Close route planner" className="text-gray-400 hover:text-white text-2xl leading-none px-1">×</button>
      </div>

      <div className="px-4 pb-3 space-y-2">
        <div className="flex items-start gap-2">
          <div className="flex-1 space-y-2">
            <PlaceInput
              key={`from-${swapKey}`} label="From" value={from} onChange={setFrom} dotClass="bg-accent"
              userLocation={userLocation} onRequestLocation={onRequestLocation}
            />
            <PlaceInput
              key={`to-${swapKey}`} label="To" value={to} onChange={setTo} dotClass="bg-late"
              userLocation={userLocation} onRequestLocation={onRequestLocation}
            />
          </div>
          <button
            type="button" onClick={swap} aria-label="Swap start and destination" title="Swap"
            className="mt-6 w-8 h-8 flex items-center justify-center rounded-lg border border-dark-border text-gray-300 hover:text-white hover:border-accent/50"
          >⇅</button>
        </div>

        <div className="flex gap-2" role="group" aria-label="Travel mode">
          <button type="button" className={segBtn(mode === 'transit')} onClick={() => setMode('transit')}>Public transport</button>
          <button type="button" className={segBtn(mode === 'walk')} onClick={() => setMode('walk')}>Walking</button>
        </div>

        {mode === 'transit' && (
          <div className="flex gap-2 items-center">
            <select
              value={timeMode} onChange={(e) => setTimeMode(e.target.value)} aria-label="When"
              className="bg-dark-bg border border-dark-border rounded-lg text-xs text-white px-2 py-2 outline-none"
            >
              <option value="now">Leave now</option>
              <option value="depart">Depart at</option>
              <option value="arrive">Arrive by</option>
            </select>
            {timeMode !== 'now' && (
              <input
                type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
                className="flex-1 min-w-0 bg-dark-bg border border-dark-border rounded-lg text-xs text-white px-2 py-1.5 outline-none"
                style={{ colorScheme: 'dark', userSelect: 'text' }}
              />
            )}
          </div>
        )}

        <button
          type="button" onClick={search} disabled={!canSearch}
          className="w-full rounded-xl py-2.5 text-sm font-bold bg-accent text-dark-bg disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? 'Searching…' : 'Find route'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2" style={{ userSelect: 'text' }}>
        {error && <p className="text-sm text-late bg-late/10 border border-late/30 rounded-xl px-3 py-2">{error}</p>}
        {searched && !loading && !error && itineraries.length === 0 && (
          <p className="text-sm text-gray-400">
            {mode === 'walk'
              ? 'No walking route found. Walking directions only work for fairly short distances — try Public transport.'
              : 'No route found for that time. Try another time or place.'}
          </p>
        )}

        {itineraries.map((it, i) => {
          const isSel = i === selected;
          const transitLegs = it.legs.filter((l) => l.kind === 'transit');
          return (
            <div
              key={`${it.startTime}-${i}`} role="button" tabIndex={0} onClick={() => setSelected(i)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSelected(i)}
              className={`w-full text-left cursor-pointer rounded-xl border px-3 py-2.5 transition-colors ${
                isSel ? 'border-accent bg-accent/5' : 'border-dark-border bg-dark-bg hover:border-gray-600'
              }`}
              aria-pressed={isSel}
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-base font-bold">{formatDuration(it.durationSec)}</p>
                {transitLegs.length > 0 && (
                  <p className="text-xs text-gray-400">{formatClock(it.startTime)} – {formatClock(it.endTime)}</p>
                )}
              </div>
              <LegChips legs={it.legs} />
              {transitLegs.length > 0 && (
                <p className="text-xs text-gray-500 mt-1.5">
                  {it.transfers === 0 ? 'Direct' : `${it.transfers} transfer${it.transfers > 1 ? 's' : ''}`} · {formatDuration(it.walkSec)} walking
                </p>
              )}
              {isSel && <LegDetails legs={it.legs} />}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
