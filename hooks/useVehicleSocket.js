/**
 * hooks/useVehicleSocket.js
 *
 * Custom React hook that manages the WebSocket connection to the transit server.
 *
 * Features:
 * - Connects via Socket.io and receives live vehicle updates
 * - Exponential backoff reconnection (handled by Socket.io internally)
 * - Returns connection status and last-update timestamp for UI indicators
 * - Falls back gracefully to REST API if WebSocket fails
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

/**
 * @typedef {Object} VehiclePosition
 * @property {string} id
 * @property {string} routeId
 * @property {string} tripId
 * @property {number} lat
 * @property {number} lng
 * @property {number} bearing
 * @property {number} speed
 * @property {number} timestamp
 */

/**
 * @typedef {Object} UseVehicleSocketReturn
 * @property {VehiclePosition[]} vehicles   Latest vehicle positions
 * @property {'connecting'|'connected'|'disconnected'|'error'} status
 * @property {string|null}  lastUpdate   ISO timestamp of last data update
 * @property {string|null}  errorMessage Last error message (if any)
 */

/** @returns {UseVehicleSocketReturn} */
export function useVehicleSocket() {
  const [vehicles, setVehicles] = useState([]);
  const [status, setStatus] = useState('connecting');
  const [lastUpdate, setLastUpdate] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const socketRef = useRef(null);

  const restFallback = useCallback(async () => {
    try {
      const res = await fetch(`${SOCKET_URL}/api/vehicles`);
      const data = await res.json();
      setVehicles(data.vehicles ?? []);
      setLastUpdate(data.timestamp);
    } catch {
      // Silently ignore — we'll retry via WS reconnect
    }
  }, []);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
      reconnectionAttempts: Infinity,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setStatus('connected');
      setErrorMessage(null);
    });

    socket.on('disconnect', () => {
      setStatus('disconnected');
    });

    socket.on('connect_error', () => {
      setStatus('error');
      setErrorMessage('Cannot reach transit server. Retrying…');
      // Attempt REST fallback
      restFallback();
    });

    socket.on('vehicles:update', ({ vehicles: newVehicles, timestamp }) => {
      setVehicles(newVehicles);
      setLastUpdate(timestamp);
      setErrorMessage(null);
    });

    socket.on('vehicles:error', ({ message }) => {
      setErrorMessage(message);
    });

    return () => {
      socket.disconnect();
    };
  }, [restFallback]);

  return { vehicles, status, lastUpdate, errorMessage };
}
