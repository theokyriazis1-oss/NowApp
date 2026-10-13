'use client';

/**
 * components/SearchBar.jsx
 *
 * City search bar powered by Nominatim (OpenStreetMap geocoding).
 * Shows connection status dot + live vehicle count on the right.
 * Replaces the old centre status pill.
 */

import { useState, useRef, useCallback } from 'react';

export default function SearchBar({ onCitySelect, status, vehicleCount }) {
  const [query,   setQuery]   = useState('Enschede');
  const [results, setResults] = useState([]);
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);
  const inputRef = useRef(null);

  const search = useCallback((q) => {
    clearTimeout(timerRef.current);
    if (!q.trim() || q.length < 2) { setResults([]); setOpen(false); return; }

    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const url =
          `https://nominatim.openstreetmap.org/search` +
          `?q=${encodeURIComponent(q)}` +
          `&countrycodes=nl&format=json&limit=8&addressdetails=1`;
        const res  = await fetch(url, { headers: { 'Accept-Language': 'nl,en' } });
        const data = await res.json();
        // Filter to city/town/village/municipality entries only
        const filtered = data.filter(r =>
          r.type === 'city' || r.type === 'town' || r.type === 'village' ||
          r.type === 'municipality' || r.class === 'place' || r.class === 'boundary'
        );
        setResults(filtered.slice(0, 6));
        setOpen(filtered.length > 0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 380);
  }, []);

  const handleSelect = useCallback((r) => {
    const name = r.display_name.split(',')[0].trim();
    setQuery(name);
    setOpen(false);
    setResults([]);
    onCitySelect({
      lat:         parseFloat(r.lat),
      lng:         parseFloat(r.lon),
      name,
      displayName: r.display_name,
    });
  }, [onCitySelect]);

  const handleBlur = () => {
    // Small delay so click on result fires before blur hides the list
    setTimeout(() => setOpen(false), 150);
  };

  const dotClass = {
    connected:    'bg-green-400',
    connecting:   'bg-yellow-400 animate-pulse',
    disconnected: 'bg-gray-500',
    error:        'bg-orange-400',
  }[status] ?? 'bg-gray-500';

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 w-full max-w-md px-4 pointer-events-none">
      <div className="relative pointer-events-auto">

        {/* ── Input bar ──────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2.5 bg-[#1d2128] border border-[#2d333c] rounded-xl px-4 py-3 shadow-lg">
          {/* Search icon */}
          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>

          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-white placeholder-gray-500 text-sm outline-none min-w-0"
            value={query}
            placeholder="Search a Dutch city…"
            onChange={(e) => { setQuery(e.target.value); search(e.target.value); }}
            onFocus={() => results.length > 0 && setOpen(true)}
            onBlur={handleBlur}
            onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
          />

          {/* Spinner while searching */}
          {loading && (
            <div className="w-3.5 h-3.5 border-2 border-[#4d8bf5] border-t-transparent rounded-full animate-spin flex-shrink-0" />
          )}

          {/* Status dot + count */}
          <div className="flex items-center gap-1.5 flex-shrink-0 pl-1 border-l border-[#2d333c]">
            <span className={`w-2 h-2 rounded-full ${dotClass}`} />
            {vehicleCount > 0 && (
              <span className="text-gray-400 text-xs tabular-nums">{vehicleCount}</span>
            )}
          </div>
        </div>

        {/* ── Dropdown results ────────────────────────────────────────────── */}
        {open && results.length > 0 && (
          <ul className="absolute top-full mt-2 w-full bg-[#1d2128] border border-[#2d333c] rounded-xl shadow-lg overflow-hidden z-50">
            {results.map((r) => {
              const parts  = r.display_name.split(',');
              const city   = parts[0].trim();
              const region = parts.slice(1, 3).join(',').trim();
              return (
                <li key={r.place_id}>
                  <button
                    className="w-full text-left px-4 py-3 hover:bg-[#2d333c] transition-colors flex items-start gap-3"
                    onMouseDown={(e) => { e.preventDefault(); handleSelect(r); }}
                  >
                    <svg className="w-4 h-4 text-gray-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <div>
                      <p className="text-white text-sm font-medium leading-tight">{city}</p>
                      <p className="text-gray-500 text-xs mt-0.5 leading-tight">{region}</p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
