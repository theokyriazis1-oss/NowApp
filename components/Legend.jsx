/**
 * components/Legend.jsx
 *
 * Collapsible key: what each vehicle icon means and what the coloured
 * ring around a vehicle says about its delay.
 */

'use client';

import { useState } from 'react';
import { VEHICLE_TYPES, TYPE_ORDER } from '../lib/vehicleTypes';

const DELAY_KEY = [
  { color: '#8a9bb0', label: 'Early' },
  { color: '#3fb97f', label: 'On time' },
  { color: '#e0b341', label: '1–5 min late' },
  { color: '#e8803a', label: '5–10 min late' },
  { color: '#d9534f', label: '10+ min late' },
];

export default function Legend({ counts = {} }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="absolute left-4 bottom-4 z-40">
      {open ? (
        <div className="bg-dark-card border border-dark-border rounded-xl p-3 shadow-md text-xs text-gray-300 w-44">
          <button
            onClick={() => setOpen(false)}
            className="flex w-full items-center justify-between mb-2 text-white font-semibold"
            aria-label="Hide legend"
          >
            Legend <span className="text-gray-500 font-normal">Hide</span>
          </button>
          <ul className="space-y-1.5">
            {TYPE_ORDER.filter((t) => counts[t] !== 0).map((t) => (
              <li key={t} className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={VEHICLE_TYPES[t].icon} alt="" className="w-6 h-6" />
                <span className="flex-1">{VEHICLE_TYPES[t].label}</span>
                {counts[t] > 0 && <span className="text-gray-500">{counts[t]}</span>}
              </li>
            ))}
          </ul>
          <div className="border-t border-dark-border my-2" />
          <p className="text-gray-500 mb-1">Ring = delay</p>
          <ul className="space-y-1">
            {DELAY_KEY.map((d) => (
              <li key={d.label} className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full border-2" style={{ borderColor: d.color }} />
                {d.label}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="bg-dark-card border border-dark-border rounded-xl px-3 py-2 text-xs text-gray-300 hover:text-white shadow-lg"
          aria-label="Show legend"
        >
          Legend
        </button>
      )}
    </div>
  );
}
