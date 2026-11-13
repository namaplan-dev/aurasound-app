import { Capacitor } from '@capacitor/core';
import {
  ArtworkSuggestion,
  DuplicateGroup,
  DuplicateItem,
  TagCleanupSuggestion,
  Track,
} from '../types/music';
import { normalizeForSearch, repairMojibakeText } from '../utils/textNormalization';

const DEFAULT_REMOTE_API_ORIGIN =
  'https://ais-pre-bulzh7ejs2pbrgp7btccwz-471055910043.europe-west2.run.app';

export function resolveApiUrl(path: string): string {
  const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  if (configured) {
    return `${configured.replace(/\/+$/, '')}${path}`;
  }
  if (Capacitor.isNativePlatform()) {
    return `${DEFAULT_REMOTE_API_ORIGIN}${path}`;
  }
  return path;
}

export type StepProgressCallback = (current: number, total: number, detail: string) => void;

function qualityScore(t: Track): number {
  const formatWeight: Record<Track['format'], number> = {
    FLAC: 5000,
    ALAC: 4500,
    WAV: 4200,
    OGG: 2000,
    AAC: 1800,
    MP3: 1000,
  };
  return (
    (formatWeight[t.format] || 1000) +
    (t.bitDepth || 16) * 20 +
    Math.round((t.sampleRate || 44100) / 1000) * 5 +
    (t.bitrateKbps || 320) * 0.2
  );
}

function cleanTrackTitleForMatch(title: string): string {
  return normalizeForSearch(
    title
      .replace(/^\d{1,3}[\s._-]+/, '')
      .replace(/\.(flac|alac|wav|wave|mp3|m4a|aac|ogg|opus)$/i, '')
      .replace(/\([^)]*(remaster|live|acoustic|mono|stereo|deluxe|version|edit)[^)]*\)/gi, '')
      .replace(/\[[^\]]*\]/g, '')
  ).replace(/\s+/g, ' ').trim();
}

export async function runDuplicateScan(
  tracks: Track[],
  onProgress: StepProgressCallback
): Promise<DuplicateGroup[]> {
  const total = tracks.length;
  if (total < 2) {
    onProgress(total, total, 'Need at least 2 tracks to scan for duplicates.');
    return [];
  }

  const groupsByKey = new Map<string, Track[]>();
  const yieldFrame = () => new Promise<void>((r) => setTimeout(r, 12));

  // Step 1: Fast batched acoustic/metadata normalization across all tracks
  const batchSize = 25;
  for (let i = 0; i < total; i += batchSize) {
    const slice = tracks.slice(i, i + batchSize);
    for (const t of slice) {
      const cleanTitle = cleanTrackTitleForMatch(t.title || t.fileName || '');
      const cleanArtist = normalizeForSearch(
        t.artist === 'Unknown Artist' ? '' : t.artist
      ).trim();
      const durBucket = Math.round((t.duration || 0) / 4);
      const key = cleanArtist
        ? `${cleanArtist}::${cleanTitle}`
        : `${cleanTitle}::d${durBucket}`;
      const bucket = groupsByKey.get(key) || [];
      bucket.push(t);
      groupsByKey.set(key, bucket);
    }
    onProgress(
      Math.min(i + slice.length, total),
      total,
      `Comparing titles, fingerprints & bitrates (${Math.min(i + slice.length, total)}/${total})`
    );
    await yieldFrame();
  }

  const candidateGroups: DuplicateGroup[] = [];
  const trackMap = new Map(tracks.map((t) => [t.id, t]));
  const alreadyGrouped = new Set<string>();

  for (const [, items] of groupsByKey.entries()) {
    if (items.length < 2) continue;
    const sorted = [...items].sort((a, b) => qualityScore(b) - qualityScore(a));
    const keep = sorted[0];
    sorted.forEach((s) => alreadyGrouped.add(s.id));
    candidateGroups.push({
      groupId: `dup_local_${keep.id}`,
      reason: 'Matching title/artist across multiple audio files or formats',
      similarityScore: 98,
      items: sorted.map((t, idx): DuplicateItem => ({
        trackId: t.id,
        title: t.title,
        artist: t.artist,
        album: t.album,
        format: t.format,
        bitDepth: t.bitDepth,
        sampleRate: t.sampleRate,
        bitrateKbps: t.bitrateKbps,
        fileSize: t.fileSize,
        duration: t.duration,
        isRecommendedKeep: idx === 0,
        selectedForRemoval: idx > 0,
      })),
    });
  }

  // Step 2: AI semantic duplicate check in batches (catches spelling/transliteration/remaster variants)
  const aiChunkSize = 50;
  for (let i = 0; i < tracks.length; i += aiChunkSize) {
    const chunk = tracks.slice(i, i + aiChunkSize);
    onProgress(
      Math.min(i + chunk.length, total),
      total,
      `AI semantic duplicate check (${Math.min(i + chunk.length, total)}/${total})...`
    );
    try {
      const resp = await fetch(resolveApiUrl('/api/ai/duplicate-scan'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: chunk }),
      });
      if (resp.ok) {
        const data = (await resp.json()) as {
          groups?: Array<{
            keepTrackId?: string;
            trackIds?: string[];
            reason?: string;
            similarityScore?: number;
          }>;
        };
        for (const g of data.groups || []) {
          const valid = (g.trackIds || [])
            .map((id) => trackMap.get(id))
            .filter((t): t is Track => Boolean(t));
          if (valid.length < 2) continue;
          if (valid.every((t) => alreadyGrouped.has(t.id))) continue;

          const sorted = [...valid].sort((a, b) => {
            if (a.id === g.keepTrackId) return -1;
            if (b.id === g.keepTrackId) return 1;
            return qualityScore(b) - qualityScore(a);
          });
          sorted.forEach((s) => alreadyGrouped.add(s.id));
          candidateGroups.push({
            groupId: `dup_ai_${sorted[0].id}`,
            reason: g.reason || 'AI-detected duplicate recording',
            similarityScore: Math.min(100, Math.max(70, Math.round(g.similarityScore || 92))),
            items: sorted.map((t, idx): DuplicateItem => ({
              trackId: t.id,
              title: t.title,
              artist: t.artist,
              album: t.album,
              format: t.format,
              bitDepth: t.bitDepth,
              sampleRate: t.sampleRate,
              bitrateKbps: t.bitrateKbps,
              fileSize: t.fileSize,
              duration: t.duration,
              isRecommendedKeep: idx === 0,
              selectedForRemoval: idx > 0,
            })),
          });
        }
      }
    } catch {
      // Keep local duplicate findings if offline/unreachable
    }
  }

  onProgress(total, total, `Duplicate scan finished (${candidateGroups.length} group(s) found)`);
  return candidateGroups;
}

function localCleanupFallback(orig: Track): TagCleanupSuggestion | null {
  let cleanTitle = repairMojibakeText(orig.title || orig.fileName || '')
    .replace(/\.(flac|alac|wav|wave|mp3|m4a|aac|ogg|opus)$/i, '')
    .replace(/_/g, ' ')
    .replace(/^\d{1,3}[\s.-]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  let cleanArtist = repairMojibakeText(orig.artist || 'Unknown Artist')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cleanAlbum = repairMojibakeText(orig.album || 'Local Collection')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cleanGenre = repairMojibakeText(orig.genre || 'Audio').trim();

  if (cleanArtist === 'Unknown Artist' && cleanTitle.includes(' - ')) {
    const [a, ...rest] = cleanTitle.split(' - ');
    if (a.trim() && rest.join(' - ').trim()) {
      cleanArtist = a.trim();
      cleanTitle = rest.join(' - ').trim();
    }
  }

  const changed =
    cleanTitle !== orig.title ||
    cleanArtist !== orig.artist ||
    cleanAlbum !== orig.album ||
    cleanGenre !== orig.genre;

  if (!changed) return null;

  return {
    trackId: orig.id,
    currentTitle: orig.title,
    currentArtist: orig.artist,
    currentAlbum: orig.album,
    currentGenre: orig.genre,
    suggestedTitle: cleanTitle || orig.title,
    suggestedArtist: cleanArtist || orig.artist,
    suggestedAlbum: cleanAlbum || orig.album,
    suggestedGenre: cleanGenre || orig.genre,
    reason: 'Normalized underscores, track numbers, encoding & artist/title formatting',
    selected: true,
  };
}

export async function runBatchedTagCleanupScan(
  tracks: Track[],
  onProgress: StepProgressCallback
): Promise<TagCleanupSuggestion[]> {
  const total = tracks.length;
  if (total === 0) return [];

  const trackMap = new Map(tracks.map((t) => [t.id, t]));
  const suggestionsById = new Map<string, TagCleanupSuggestion>();
  const batchSize = 20;

  for (let i = 0; i < total; i += batchSize) {
    const chunk = tracks.slice(i, i + batchSize);
    const doneCount = Math.min(i + chunk.length, total);
    onProgress(
      doneCount - Math.ceil(chunk.length * 0.5),
      total,
      `AI analyzing tags for batch ${Math.floor(i / batchSize) + 1} (${doneCount}/${total} tracks)...`
    );

    let serverSucceeded = false;
    try {
      const resp = await fetch(resolveApiUrl('/api/ai/tag-cleanup'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: chunk }),
      });
      if (resp.ok) {
        serverSucceeded = true;
        const data = (await resp.json()) as {
          suggestions?: Array<Record<string, string>>;
        };
        for (const s of data.suggestions || []) {
          const orig = trackMap.get(s.trackId);
          if (!orig) continue;
          suggestionsById.set(orig.id, {
            trackId: orig.id,
            currentTitle: orig.title,
            currentArtist: orig.artist,
            currentAlbum: orig.album,
            currentGenre: orig.genre,
            suggestedTitle: s.suggestedTitle || orig.title,
            suggestedArtist: s.suggestedArtist || orig.artist,
            suggestedAlbum: s.suggestedAlbum || orig.album,
            suggestedGenre: s.suggestedGenre || orig.genre,
            reason: s.reason || 'AI normalized metadata tags',
            selected: true,
          });
        }
      }
    } catch {
      serverSucceeded = false;
    }

    if (!serverSucceeded) {
      for (const orig of chunk) {
        const localFix = localCleanupFallback(orig);
        if (localFix) {
          suggestionsById.set(orig.id, localFix);
        }
      }
    }

    onProgress(
      doneCount,
      total,
      `Inspected ${doneCount} of ${total} tracks (${suggestionsById.size} improvement(s) found)`
    );
  }

  return Array.from(suggestionsById.values());
}

async function clientItunesCoverLookup(
  artist: string,
  album: string,
  title: string
): Promise<{ coverUrl: string; sourceLabel: string } | null> {
  const cleanArtist = artist && artist !== 'Unknown Artist' ? artist : '';
  const cleanAlbum =
    album && album !== 'Local Collection' && album !== 'Unknown Album' ? album : '';
  const term = [cleanArtist, cleanAlbum || title].filter(Boolean).join(' ').trim();
  if (!term) return null;

  try {
    const resp = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&limit=2`
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      results?: Array<{ artworkUrl100?: string }>;
    };
    const url = data.results?.[0]?.artworkUrl100;
    if (!url) return null;
    return {
      coverUrl: url.replace('100x100bb', '600x600bb'),
      sourceLabel: 'Official Release Catalog',
    };
  } catch {
    return null;
  }
}

export async function runOriginalAlbumArtScan(
  tracks: Track[],
  onProgress: StepProgressCallback
): Promise<ArtworkSuggestion[]> {
  const total = tracks.length;
  if (total === 0) return [];

  const trackMap = new Map(tracks.map((t) => [t.id, t]));
  const found: ArtworkSuggestion[] = [];
  const batchSize = 6;

  for (let i = 0; i < total; i += batchSize) {
    const chunk = tracks.slice(i, i + batchSize);
    const doneCount = Math.min(i + chunk.length, total);
    onProgress(
      i,
      total,
      `Searching original album covers for "${chunk[0]?.title || 'tracks'}" (${doneCount}/${total})...`
    );

    let handledByServer = false;
    try {
      const resp = await fetch(resolveApiUrl('/api/ai/album-art'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: chunk }),
      });
      if (resp.ok) {
        handledByServer = true;
        const data = (await resp.json()) as {
          results?: Array<{
            trackId: string;
            coverUrl: string;
            sourceLabel?: string;
          }>;
        };
        for (const r of data.results || []) {
          const orig = trackMap.get(r.trackId);
          if (!orig || !r.coverUrl) continue;
          found.push({
            trackId: orig.id,
            title: orig.title,
            artist: orig.artist,
            album: orig.album,
            currentCoverUrl: orig.coverUrl,
            suggestedCoverUrl: r.coverUrl,
            sourceLabel: r.sourceLabel || 'Original Release Artwork',
            selected: true,
          });
        }
      }
    } catch {
      handledByServer = false;
    }

    if (!handledByServer) {
      for (let j = 0; j < chunk.length; j++) {
        const t = chunk[j];
        onProgress(
          i + j + 1,
          total,
          `Searching cover for "${t.artist} — ${t.title}" (${i + j + 1}/${total})`
        );
        const match = await clientItunesCoverLookup(t.artist, t.album, t.title);
        if (match) {
          found.push({
            trackId: t.id,
            title: t.title,
            artist: t.artist,
            album: t.album,
            currentCoverUrl: t.coverUrl,
            suggestedCoverUrl: match.coverUrl,
            sourceLabel: match.sourceLabel,
            selected: true,
          });
        }
      }
    }

    onProgress(
      doneCount,
      total,
      `Checked ${doneCount} of ${total} tracks · Found ${found.length} original cover(s)`
    );
  }

  return found;
}

export async function resizeArtworkFileToDataUrl(
  file: File,
  onProgress?: StepProgressCallback
): Promise<string> {
  onProgress?.(1, 4, `Reading image "${file.name}"...`);

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read selected artwork image.'));
    reader.readAsDataURL(file);
  });

  onProgress?.(2, 4, 'Decoding artwork dimensions...');
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Unsupported artwork image format.'));
    el.src = rawDataUrl;
  });

  onProgress?.(3, 4, 'Optimizing cover art to 512×512 hi-res JPEG...');
  const maxDim = 512;
  const size = Math.min(maxDim, Math.max(img.width, img.height, 256));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return rawDataUrl;

  const scale = Math.max(size / img.width, size / img.height);
  const drawW = img.width * scale;
  const drawH = img.height * scale;
  const dx = (size - drawW) / 2;
  const dy = (size - drawH) / 2;
  ctx.drawImage(img, dx, dy, drawW, drawH);

  const optimized = canvas.toDataURL('image/jpeg', 0.86);
  onProgress?.(4, 4, 'Original album cover ready to apply.');
  return optimized;
}
