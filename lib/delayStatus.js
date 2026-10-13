/**
 * lib/delayStatus.js
 *
 * Shared utilities for interpreting delaySeconds into human-readable
 * status labels, colors, and severity levels.
 *
 * Thresholds (industry standard, matches GTFS-RT convention):
 *   Early:    delay < -60 s
 *   On time: -60 s ≤ delay ≤ +60 s
 *   Slight:  +61 s – +299 s   (1–4 min late)
 *   Late:   +300 s – +599 s   (5–9 min late)
 *   Very late: ≥ +600 s       (10+ min late)
 */

/** @typedef {'early'|'ontime'|'slight'|'late'|'verylate'} DelayStatus */

/**
 * Classify delay seconds into a status string.
 * @param {number} secs
 * @returns {DelayStatus}
 */
export function getDelayStatus(secs) {
  if (secs <= -60)  return 'early';
  if (secs <=  60)  return 'ontime';
  if (secs <  300)  return 'slight';
  if (secs <  600)  return 'late';
  return 'verylate';
}

/**
 * Human-readable delay label, e.g. "3 min late", "On time", "2 min early"
 * @param {number} secs
 * @returns {string}
 */
export function formatDelay(secs) {
  const abs  = Math.abs(secs);
  const mins = Math.round(abs / 60);
  const s    = getDelayStatus(secs);

  if (s === 'ontime')   return 'On time';
  if (s === 'early')    return mins === 0 ? 'Slightly early' : `${mins} min early`;
  if (s === 'slight')   return `${mins} min late`;
  if (s === 'late')     return `${mins} min late`;
  return `${mins}+ min late`;
}

/**
 * Tailwind text color class for a given status.
 * @param {DelayStatus} status
 * @returns {string}
 */
export function delayTextClass(status) {
  return {
    early:    'text-early',
    ontime:   'text-ok',
    slight:   'text-slight',
    late:     'text-late',
    verylate: 'text-verylate',
  }[status];
}

/**
 * CSS hex color for a given status (for non-Tailwind use, e.g. map paint).
 * @param {DelayStatus} status
 * @returns {string}
 */
export function delayHexColor(status) {
  return {
    early:    '#8a9bb0',
    ontime:   '#3fb97f',
    slight:   '#e0b341',
    late:     '#e8803a',
    verylate: '#d9534f',
  }[status];
}

/**
 * Short badge label for compact display.
 * @param {DelayStatus} status
 * @returns {{ label: string }}
 */
export function delayBadge(status) {
  return {
    early:    { label: 'Early' },
    ontime:   { label: 'On time' },
    slight:   { label: 'Slight' },
    late:     { label: 'Late' },
    verylate: { label: 'Very late' },
  }[status];
}
