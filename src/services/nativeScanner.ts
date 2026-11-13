import { Capacitor, registerPlugin } from '@capacitor/core';
import { Track } from '../types/music';
import { createTrackFingerprint } from './metadataParser';
import { repairMojibakeText } from '../utils/textNormalization';

const DEFAULT_FALLBACK_COVER = '/pwa-512x512.png';

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

interface LocalMusicScannerPlugin {
  scanDeviceAudio(): Promise<{ tracks: NativeScannedTrack[]; count: number }>;
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

export async function scanAndroidDeviceLibrary(): Promise<Track[]> {
  if (!isNativeAndroidApp()) return [];
  const res = await LocalMusicScanner.scanDeviceAudio();
  const items = Array.isArray(res?.tracks) ? res.tracks : [];

  return items.map((item) => {
    const title = repairMojibakeText(item.title || item.fileName || 'Untitled Track');
    const artist = repairMojibakeText(item.artist || 'Unknown Artist');
    const album = repairMojibakeText(item.album || 'Local Collection');
    const genre = repairMojibakeText(item.genre || 'Local Audio');
    const fingerprint = createTrackFingerprint(title, artist, item.fileSize);
    const coverUrl = item.albumArtUri
      ? Capacitor.convertFileSrc(item.albumArtUri)
      : DEFAULT_FALLBACK_COVER;

    return {
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
    };
  });
}
