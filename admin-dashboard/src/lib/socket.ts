import { io, Socket } from 'socket.io-client';

const BACKEND_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:4000';

let dashboardSocket: Socket | null = null;

export function connectDashboardSocket(token: string, campusId: string): Socket {
  if (dashboardSocket) {
    dashboardSocket.disconnect();
    dashboardSocket = null;
  }

  dashboardSocket = io(`${BACKEND_URL}/dashboard`, {
    auth: {
      token,
      campusId,
    },
    query: {
      campusId,
    },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 2000,
  });

  dashboardSocket.on('connect', () => {
    console.log(`[Socket] Connected to safety dashboard namespace for campus: ${campusId}`);
  });

  dashboardSocket.on('connect_error', (err) => {
    console.warn('[Socket] Connection error:', err.message);
  });

  dashboardSocket.on('disconnect', (reason) => {
    console.log('[Socket] Disconnected:', reason);
  });

  return dashboardSocket;
}

export function disconnectDashboardSocket(): void {
  if (dashboardSocket) {
    dashboardSocket.disconnect();
    dashboardSocket = null;
  }
}

export function getDashboardSocket(): Socket | null {
  return dashboardSocket;
}
