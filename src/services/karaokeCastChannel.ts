import { ThemeAccent, ThemeMode } from '../types/music';

export interface KaraokeCastPayload {
  trackId: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  lyrics?: string;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  updatedAtMs: number;
  karaokeOffsetMs: number;
  themeAccent: ThemeAccent;
  themeMode: ThemeMode;
}

const CHANNEL_NAME = 'aurasound_karaoke_cast';
const STORAGE_KEY = 'aurasound_karaoke_cast_state';

type CastListener = (payload: KaraokeCastPayload) => void;

const activeConnections = new Set<{
  readyState?: string;
  send?: (data: string) => void;
  close?: () => void;
}>();

let sharedChannel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!sharedChannel) {
    try {
      sharedChannel = new BroadcastChannel(CHANNEL_NAME);
    } catch {
      sharedChannel = null;
    }
  }
  return sharedChannel;
}

export function registerPresentationConnection(conn: {
  readyState?: string;
  send?: (data: string) => void;
  close?: () => void;
  addEventListener?: (type: string, cb: () => void) => void;
}) {
  activeConnections.add(conn);
  const current = readKaraokeCastState();
  if (current && conn.send && conn.readyState === 'connected') {
    try {
      conn.send(JSON.stringify(current));
    } catch {
      // ignore
    }
  }
  conn.addEventListener?.('close', () => {
    activeConnections.delete(conn);
  });
  conn.addEventListener?.('terminate', () => {
    activeConnections.delete(conn);
  });
}

export function getActiveCastConnectionCount(): number {
  for (const conn of Array.from(activeConnections)) {
    if (conn.readyState === 'closed' || conn.readyState === 'terminated') {
      activeConnections.delete(conn);
    }
  }
  return activeConnections.size;
}

let lastStorageWriteMs = 0;

export function broadcastKaraokeCastState(payload: KaraokeCastPayload): void {
  const ch = getChannel();
  if (ch) {
    try {
      ch.postMessage(payload);
    } catch {
      // ignore closed channel
    }
  }

  if (activeConnections.size > 0) {
    const serialized = JSON.stringify(payload);
    for (const conn of Array.from(activeConnections)) {
      if (conn.readyState === 'closed' || conn.readyState === 'terminated') {
        activeConnections.delete(conn);
        continue;
      }
      if (conn.readyState === 'connected' && conn.send) {
        try {
          conn.send(serialized);
        } catch {
          // ignore transient socket error
        }
      }
    }
  }

  // Throttle localStorage persistence slightly unless playback state or track changed
  const now = Date.now();
  if (now - lastStorageWriteMs >= 250 || !payload.isPlaying) {
    lastStorageWriteMs = now;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore quota limits
    }
  }
}

export function readKaraokeCastState(): KaraokeCastPayload | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as KaraokeCastPayload;
    if (!parsed || typeof parsed.trackId !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function subscribeKaraokeCastState(listener: CastListener): () => void {
  const ch = getChannel();
  const onChannelMsg = (ev: MessageEvent<KaraokeCastPayload>) => {
    if (ev.data && typeof ev.data.trackId === 'string') {
      listener(ev.data);
    }
  };
  ch?.addEventListener('message', onChannelMsg);

  const onStorage = (ev: StorageEvent) => {
    if (ev.key === STORAGE_KEY && ev.newValue) {
      try {
        const parsed = JSON.parse(ev.newValue) as KaraokeCastPayload;
        if (parsed && typeof parsed.trackId === 'string') {
          listener(parsed);
        }
      } catch {
        // ignore
      }
    }
  };
  window.addEventListener('storage', onStorage);

  // Also listen for Presentation API receiver messages when launched on an external TV screen
  const nav = navigator as Navigator & {
    presentation?: {
      receiver?: {
        connectionList?: Promise<{
          connections: Array<{
            addEventListener: (
              event: string,
              cb: (ev: { data?: string }) => void
            ) => void;
          }>;
          addEventListener: (event: string, cb: () => void) => void;
        }>;
      };
    };
  };

  let cancelled = false;
  if (nav.presentation?.receiver?.connectionList) {
    void nav.presentation.receiver.connectionList.then((list) => {
      if (cancelled) return;
      const attach = (conn: {
        addEventListener: (event: string, cb: (ev: { data?: string }) => void) => void;
      }) => {
        conn.addEventListener('message', (ev) => {
          if (typeof ev.data === 'string') {
            try {
              const parsed = JSON.parse(ev.data) as KaraokeCastPayload;
              if (parsed && typeof parsed.trackId === 'string') {
                listener(parsed);
              }
            } catch {
              // ignore malformed payload
            }
          }
        });
      };
      list.connections.forEach(attach);
      list.addEventListener('connectionavailable', () => {
        list.connections.forEach(attach);
      });
    });
  }

  return () => {
    cancelled = true;
    ch?.removeEventListener('message', onChannelMsg);
    window.removeEventListener('storage', onStorage);
  };
}
