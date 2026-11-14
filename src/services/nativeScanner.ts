import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { Track } from '../types/music';
import { createTrackFingerprint, inferHierarchyFromPath } from './metadataParser';
import { repairMojibakeText } from '../utils/textNormalization';
import defaultVinylCover from '../assets/images/album_nocturne_vinyl_1794587934959.jpg';

const DEFAULT_FALLBACK_COVER = defaultVinylCover;

interface NativeScannedTrack {
  mediaId: number;
  title: string;
  artist: string;
  album: string;
  genre: string;
  year?: string;
  composer?: string;
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

export interface NativeTagWriteItem {
  contentUri?: string;
  filePath?: string;
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  year?: string;
  composer?: string;
}

export interface NativeDeleteResult {
  deletedCount: number;
  cancelled: boolean;
  diskDeleted: boolean;
}

export interface NativeTagWriteResult {
  updatedCount: number;
  embeddedCount?: number;
  cancelled: boolean;
}

interface LocalMusicScannerPlugin {
  scanDeviceAudio(): Promise<{ tracks: NativeScannedTrack[]; count: number }>;
  deleteAudioFiles(options: {
    uris: string[];
    paths: string[];
  }): Promise<NativeDeleteResult>;
  writeAudioTags(options: {
    updates: NativeTagWriteItem[];
  }): Promise<NativeTagWriteResult>;
  setAsRingtone(options: {
    contentUri?: string;
    filePath?: string;
  }): Promise<{ success: boolean; cancelled: boolean; uri?: string }>;
  addListener(
    eventName: 'scanProgress' | 'tagWriteProgress',
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

export async function setNativeRingtone(
  track: Track
): Promise<{ success: boolean; cancelled: boolean; uri?: string }> {
  if (!isNativeAndroidApp()) {
    return { success: false, cancelled: false };
  }
  return LocalMusicScanner.setAsRingtone({
    contentUri: track.nativeUri,
    filePath: track.nativePath,
  });
}

export async function deleteNativeAudioFiles(tracks: Track[]): Promise<NativeDeleteResult> {
  if (!isNativeAndroidApp()) {
    return { deletedCount: 0, cancelled: false, diskDeleted: false };
  }
  const uris = tracks
    .map((t) => t.nativeUri)
    .filter((u): u is string => Boolean(u && u.trim()));
  const paths = tracks
    .map((t) => t.nativePath)
    .filter((p): p is string => Boolean(p && p.trim()));

  if (uris.length === 0 && paths.length === 0) {
    return { deletedCount: 0, cancelled: false, diskDeleted: false };
  }
  return LocalMusicScanner.deleteAudioFiles({ uris, paths });
}

export async function writeNativeAudioTags(
  updates: NativeTagWriteItem[],
  onProgress?: (progress: NativeScanProgress) => void
): Promise<NativeTagWriteResult> {
  if (!isNativeAndroidApp() || updates.length === 0) {
    return { updatedCount: 0, embeddedCount: 0, cancelled: false };
  }
  let handle: PluginListenerHandle | null = null;
  if (onProgress) {
    try {
      handle = await LocalMusicScanner.addListener('tagWriteProgress', (ev) => {
        onProgress({
          current: ev?.current ?? 0,
          total: ev?.total ?? updates.length,
          fileName: ev?.fileName || 'Writing audio tags...',
        });
      });
    } catch {
      handle = null;
    }
  }

  try {
    return await LocalMusicScanner.writeAudioTags({ updates });
  } finally {
    if (handle) {
      void handle.remove();
    }
  }
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
    const resolved = inferHierarchyFromPath(
      item.folderPath || item.filePath,
      item.fileName,
      item.title,
      item.artist,
      item.album
    );
    const title = resolved.title;
    const artist = resolved.artist;
    const album = resolved.album;
    const genre = repairMojibakeText(item.genre || 'Local Audio');
    const yearMatch = String(item.year || '').match(/\b(19\d{2}|20\d{2})\b/);
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
      year: yearMatch ? yearMatch[1] : undefined,
      composer: item.composer ? repairMojibakeText(item.composer) : undefined,
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
      skipCount: 0,
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
