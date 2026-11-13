import { Capacitor, registerPlugin } from '@capacitor/core';
import { Track } from '../types/music';

export type NativeWidgetAction = 'prev' | 'toggle' | 'next';

interface AuraWidgetPlugin {
  syncState(options: {
    title: string;
    artist: string;
    album: string;
    formatBadge: string;
    isPlaying: boolean;
  }): Promise<void>;
  consumePendingAction(): Promise<{ action?: string | null }>;
  addListener(
    eventName: 'widgetAction',
    listenerFunc: (data: { action?: string }) => void
  ): Promise<{ remove: () => Promise<void> }>;
}

const AuraWidget = registerPlugin<AuraWidgetPlugin>('AuraWidget');

function isAndroidNative(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function syncNativeWidgets(track: Track | null, isPlaying: boolean): Promise<void> {
  if (!isAndroidNative()) return;
  try {
    await AuraWidget.syncState({
      title: track?.title || 'AuraSound Hi-Fi',
      artist: track?.artist || 'Tap to browse library',
      album: track?.album || 'Local Studio Library',
      formatBadge: track
        ? `AURASOUND · ${track.format} ${track.bitDepth}b/${Math.round(track.sampleRate / 1000)}kHz`
        : 'AURASOUND · HI-FI',
      isPlaying,
    });
  } catch {
    // Ignore when running outside native APK
  }
}

export function subscribeNativeWidgetActions(
  onAction: (action: NativeWidgetAction) => void
): () => void {
  if (!isAndroidNative()) return () => {};

  let active = true;
  let handle: { remove: () => Promise<void> } | null = null;

  const dispatchIfValid = (raw?: string | null) => {
    if (raw === 'prev' || raw === 'toggle' || raw === 'next') {
      onAction(raw);
    }
  };

  void AuraWidget.consumePendingAction()
    .then((res) => {
      if (active) dispatchIfValid(res?.action);
    })
    .catch(() => {});

  void AuraWidget.addListener('widgetAction', (payload) => {
    if (active) dispatchIfValid(payload?.action);
  })
    .then((h) => {
      if (active) handle = h;
      else void h.remove();
    })
    .catch(() => {});

  return () => {
    active = false;
    if (handle) {
      void handle.remove();
    }
  };
}
