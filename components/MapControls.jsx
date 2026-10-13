/**
 * components/MapControls.jsx
 *
 * Floating map button: jump to the user's current location.
 */

'use client';

const btnClass =
  'w-12 h-12 flex items-center justify-center bg-dark-card border border-dark-border text-gray-300 hover:text-white hover:border-accent/50 hover:bg-dark-border transition-all duration-200 rounded-xl shadow-lg cursor-pointer select-none active:scale-95';

/**
 * @param {Object} props
 * @param {() => void} props.onLocate   fly the map to the user's position
 * @param {boolean} props.located       true once a position fix exists
 * @param {string|null} props.error     geolocation error message, if any
 */
export default function MapControls({ onLocate, located, error }) {
  const title = located
    ? 'Show my location'
    : error
      ? `Location unavailable: ${error}`
      : 'Waiting for location…';

  return (
    <div className="absolute right-2 bottom-[210px] z-40 flex flex-col gap-2">
      <button
        className={`${btnClass} ${located ? 'text-[#4285f4]' : 'opacity-60'}`}
        onClick={onLocate}
        title={title}
        aria-label="Show my location"
      >
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" fill="currentColor" />
          <circle cx="12" cy="12" r="8" />
          <path d="M12 1v3M12 20v3M1 12h3M20 12h3" />
        </svg>
      </button>
    </div>
  );
}
