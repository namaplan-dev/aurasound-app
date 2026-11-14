import { Track } from '../types/music';
import {
  deleteAudioBlobFromCache,
  getAudioBlobFromCache,
  saveAudioBlobToCache,
} from './offlineCacheService';
import { AudioTagUpdate, embedTagsIntoAudioBlob } from './audioTagWriter';

export interface StoredWebFileHandleEntry {
  trackId: string;
  fileName: string;
  fileHandle: FileSystemFileHandle;
  dirHandle: FileSystemDirectoryHandle;
  savedAt: number;
}

const HANDLES_DB_NAME = 'aurasound_handles_db';
const HANDLES_DB_VERSION = 1;
const HANDLES_STORE = 'file_handles';

interface FsPermissionHandle {
  queryPermission?: (desc: { mode: 'read' | 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?: (desc: { mode: 'read' | 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
}

async function ensureReadWritePermission(handle: FsPermissionHandle | null | undefined): Promise<boolean> {
  if (!handle) return false;
  try {
    if (typeof handle.queryPermission === 'function') {
      const state = await handle.queryPermission({ mode: 'readwrite' });
      if (state === 'granted') return true;
    }
    if (typeof handle.requestPermission === 'function') {
      const res = await handle.requestPermission({ mode: 'readwrite' });
      return res === 'granted';
    }
    return true;
  } catch {
    return false;
  }
}

function openHandlesDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLES_DB_NAME, HANDLES_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(HANDLES_STORE)) {
        db.createObjectStore(HANDLES_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveTrackFileHandle(
  trackId: string,
  fileName: string,
  fileHandle: FileSystemFileHandle,
  dirHandle: FileSystemDirectoryHandle
): Promise<void> {
  try {
    const db = await openHandlesDb();
    const entry: StoredWebFileHandleEntry = {
      trackId,
      fileName,
      fileHandle,
      dirHandle,
      savedAt: Date.now(),
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(HANDLES_STORE, 'readwrite');
      tx.objectStore(HANDLES_STORE).put(entry, trackId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Browser may block IndexedDB handle serialization in private mode
  }
}

export async function getTrackFileHandle(
  trackId: string
): Promise<StoredWebFileHandleEntry | null> {
  try {
    const db = await openHandlesDb();
    return await new Promise<StoredWebFileHandleEntry | null>((resolve, reject) => {
      const tx = db.transaction(HANDLES_STORE, 'readonly');
      const req = tx.objectStore(HANDLES_STORE).get(trackId);
      req.onsuccess = () => resolve((req.result as StoredWebFileHandleEntry) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function deleteTrackFileHandle(trackId: string): Promise<void> {
  try {
    const db = await openHandlesDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(HANDLES_STORE, 'readwrite');
      tx.objectStore(HANDLES_STORE).delete(trackId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

export interface WebDeleteSummary {
  diskDeletedCount: number;
  noHandleCount: number;
  permissionDeniedCount: number;
}

/**
 * Physically removes audio files from their source disk folders on Web (via File System Access API)
 * and deletes their cached blobs from IndexedDB.
 */
export async function deleteTracksFromWebFolder(tracks: Track[]): Promise<WebDeleteSummary> {
  let diskDeletedCount = 0;
  let noHandleCount = 0;
  let permissionDeniedCount = 0;

  for (const track of tracks) {
    await deleteAudioBlobFromCache(track.id);
    const entry = await getTrackFileHandle(track.id);
    if (!entry) {
      noHandleCount++;
      continue;
    }

    const granted = await ensureReadWritePermission(
      entry.dirHandle as unknown as FsPermissionHandle
    );
    if (!granted) {
      permissionDeniedCount++;
      continue;
    }

    try {
      await entry.dirHandle.removeEntry(entry.fileName || track.fileName || '');
      diskDeletedCount++;
      await deleteTrackFileHandle(track.id);
    } catch {
      // File may already have been moved/deleted externally
      await deleteTrackFileHandle(track.id);
    }
  }

  return { diskDeletedCount, noHandleCount, permissionDeniedCount };
}

export interface WebTagWriteSummary {
  diskWrittenCount: number;
  cacheUpdatedCount: number;
  permissionDeniedCount: number;
  unsupportedFormatCount: number;
}

/**
 * Rewrites embedded ID3v2/ID3v1/FLAC Vorbis tags directly inside Web disk files (via FileSystemFileHandle)
 * and updates IndexedDB cached audio blobs so edited metadata persists outside AuraSound.
 */
export async function writeTracksTagsToWebStorage(
  items: Array<{ track: Track; tags: AudioTagUpdate }>,
  onProgress?: (current: number, total: number, title: string) => void
): Promise<WebTagWriteSummary> {
  let diskWrittenCount = 0;
  let cacheUpdatedCount = 0;
  let permissionDeniedCount = 0;
  let unsupportedFormatCount = 0;

  for (let i = 0; i < items.length; i++) {
    const { track, tags } = items[i];
    onProgress?.(i + 1, items.length, track.title || track.fileName || 'Audio track');

    const entry = await getTrackFileHandle(track.id);
    let wroteToDisk = false;

    if (entry?.fileHandle) {
      const granted = await ensureReadWritePermission(
        entry.fileHandle as unknown as FsPermissionHandle
      );
      if (!granted) {
        permissionDeniedCount++;
      } else {
        try {
          const diskFile = await entry.fileHandle.getFile();
          const tagged = await embedTagsIntoAudioBlob(
            diskFile,
            entry.fileName || track.fileName || track.format,
            tags
          );
          if (tagged.wroteEmbedded) {
            const writable = await (
              entry.fileHandle as FileSystemFileHandle & {
                createWritable: () => Promise<{
                  write: (data: Blob | BufferSource) => Promise<void>;
                  close: () => Promise<void>;
                }>;
              }
            ).createWritable();
            await writable.write(tagged.blob);
            await writable.close();
            await saveAudioBlobToCache(track.id, tagged.blob);
            wroteToDisk = true;
            diskWrittenCount++;
            cacheUpdatedCount++;
          } else {
            unsupportedFormatCount++;
          }
        } catch {
          permissionDeniedCount++;
        }
      }
    }

    if (!wroteToDisk) {
      const cached = await getAudioBlobFromCache(track.id);
      if (cached) {
        try {
          const tagged = await embedTagsIntoAudioBlob(
            cached,
            track.fileName || track.format,
            tags
          );
          if (tagged.wroteEmbedded) {
            await saveAudioBlobToCache(track.id, tagged.blob);
            cacheUpdatedCount++;
          } else {
            unsupportedFormatCount++;
          }
        } catch {
          // ignore cache rewrite errors
        }
      }
    }
  }

  return {
    diskWrittenCount,
    cacheUpdatedCount,
    permissionDeniedCount,
    unsupportedFormatCount,
  };
}
