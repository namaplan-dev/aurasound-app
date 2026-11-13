import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { Track } from '../types/music';
import { createTrackFingerprint } from './metadataParser';
import { repairMojibakeText } from '../utils/textNormalization';
import defaultVinylCover from '../assets/images/album_nocturne_vinyl_1794587934959.jpg';

const DEFAULT_FALLBACK_COVER = defaultVinylCover;

interface NativeScannedTrack {
  mediaId: number;
  title: string;
  artist: string;
  album: string;
  genre: string;
  durationSec: number;
  fileName: string;
  folderPath: string;
  filePath: string;
  contentUri: string;
  albumArtUri: string;
  fileSize: number;
  format: Track['format'];
  sampleRate: number;
  bitDepth: number;
  bitrateKbps: number;
  addedAt: number;
}

export interface NativeScanProgress {
  current: number;
  total: number;
  fileName: string;
}

interface LocalMusicScannerPlugin {
  scanDeviceAudio(): Promise<{ tracks: NativeScannedTrack[]; count: number }>;
  addListener(
    eventName: 'scanProgress',
    listenerFunc: (event: NativeScanProgress) => void
  ): Promise<PluginListenerHandle>;
}

const LocalMusicScanner = registerPlugin<LocalMusicScannerPlugin>('LocalMusicScanner');

export function isNativeAndroidApp(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export function resolveNativePlaybackUrl(track: Track): string | null {
  if (!isNativeAndroidApp()) return null;
  const target = track.nativeUri || track.nativePath;
  if (!target) return null;
  return Capacitor.convertFileSrc(target);
}

export async function scanAndroidDeviceLibrary(
  onProgress?: (progress: NativeScanProgress) => void
): Promise<Track[]> {
  if (!isNativeAndroidApp()) return [];

  let handle: PluginListenerHandle | null = null;
  if (onProgress) {
    try {
      handle = await LocalMusicScanner.addListener('scanProgress', (ev) => {
        onProgress({
          current: ev?.current ?? 0,
          total: ev?.total ?? 0,
          fileName: ev?.fileName || 'Scanning audio files...',
        });
      });
    } catch {
      handle = null;
    }
  }

  let res: { tracks: NativeScannedTrack[]; count: number };
  try {
    res = await LocalMusicScanner.scanDeviceAudio();
  } finally {
    if (handle) {
      void handle.remove();
    }
  }

  const items = Array.isArray(res?.tracks) ? res.tracks : [];
  const totalItems = items.length;
  const mapped: Track[] = [];

  for (let i = 0; i < totalItems; i++) {
    const item = items[i];
    const title = repairMojibakeText(item.title || item.fileName || 'Untitled Track');
    const artist = repairMojibakeText(item.artist || 'Unknown Artist');
    const album = repairMojibakeText(item.album || 'Local Collection');
    const genre = repairMojibakeText(item.genre || 'Local Audio');
    const fingerprint = createTrackFingerprint(title, artist, item.fileSize);
    const coverUrl = item.albumArtUri
      ? Capacitor.convertFileSrc(item.albumArtUri)
      : DEFAULT_FALLBACK_COVER;

    mapped.push({
      id: `android_${item.mediaId}_${fingerprint}`,
      title,
      artist,
      album,
      genre,
      duration: Math.max(1, item.durationSec || 180),
      format: item.format || 'MP3',
      sampleRate: item.sampleRate || 44100,
      bitDepth: item.bitDepth || 16,
      bitrateKbps: item.bitrateKbps || 320,
      coverUrl,
      source: 'local',
      folderPath: item.folderPath || 'Device Music',
      fileName: item.fileName,
      fileSize: item.fileSize,
      nativeUri: item.contentUri,
      nativePath: item.filePath,
      favorite: false,
      rating: 0,
      playCount: 0,
      addedAt: item.addedAt || Date.now(),
      offlineCached: true,
      fingerprint,
    });

    if (onProgress && (i % 25 === 0 || i === totalItems - 1)) {
      onProgress({
        current: i + 1,
        total: totalItems,
        fileName: title,
      });
    }
  }

  return mapped;
}
