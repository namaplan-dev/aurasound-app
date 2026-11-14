import { Capacitor } from '@capacitor/core';
import {
  ArtworkSuggestion,
  DuplicateGroup,
  DuplicateItem,
  TagCleanupSuggestion,
  TaskItemProgress,
  Track,
} from '../types/music';
import { normalizeForSearch } from '../utils/textNormalization';

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

async function fetchWithClientTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 40000
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('AI request timed out. Try a smaller batch size.');
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}

export interface AiQuotaState {
  resetAtMs: number;
  retryAfterSeconds: number;
  quotaScope: 'minute' | 'daily';
  message: string;
}

export class AiQuotaExhaustedError extends Error {
  readonly code = 'AI_QUOTA_EXHAUSTED';
  readonly quota: AiQuotaState;

  constructor(quota: AiQuotaState) {
    super(quota.message);
    this.name = 'AiQuotaExhaustedError';
    this.quota = quota;
  }
}

let activeAiQuotaState: AiQuotaState | null = null;
const quotaListeners = new Set<(state: AiQuotaState | null) => void>();

function notifyQuotaListeners() {
  for (const listener of quotaListeners) {
    listener(activeAiQuotaState);
  }
}

export function getActiveAiQuotaState(): AiQuotaState | null {
  return activeAiQuotaState;
}

export function setActiveAiQuotaState(state: AiQuotaState | null) {
  activeAiQuotaState = state;
  notifyQuotaListeners();
}

export function clearActiveAiQuotaState() {
  if (!activeAiQuotaState) return;
  activeAiQuotaState = null;
  notifyQuotaListeners();
}

export function subscribeAiQuotaState(listener: (state: AiQuotaState | null) => void): () => void {
  quotaListeners.add(listener);
  listener(activeAiQuotaState);
  return () => {
    quotaListeners.delete(listener);
  };
}

export function formatAiQuotaCountdown(
  resetAtMs: number,
  nowMs = Date.now()
): {
  remainingSec: number;
  countdownText: string;
  readyTimeText: string;
  isRestored: boolean;
} {
  const remainingMs = Math.max(0, resetAtMs - nowMs);
  const remainingSec = Math.ceil(remainingMs / 1000);
  const isRestored = remainingSec <= 0;

  let countdownText = '0s';
  if (remainingSec > 0) {
    if (remainingSec < 60) {
      countdownText = `${remainingSec}s`;
    } else if (remainingSec < 3600) {
      const m = Math.floor(remainingSec / 60);
      const s = remainingSec % 60;
      countdownText = `${m}m ${String(s).padStart(2, '0')}s`;
    } else {
      const h = Math.floor(remainingSec / 3600);
      const m = Math.floor((remainingSec % 3600) / 60);
      countdownText = m > 0 ? `${h}h ${m}m` : `${h}h`;
    }
  }

  const targetDate = new Date(resetAtMs);
  const sameDay = targetDate.toDateString() === new Date(nowMs).toDateString();
  const readyTimeText = new Intl.DateTimeFormat(undefined, {
    ...(sameDay ? {} : { month: 'short', day: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  }).format(targetDate);

  return { remainingSec, countdownText, readyTimeText, isRestored };
}

export function buildAiQuotaStateFromPayload(
  payload: Record<string, unknown>,
  retryAfterHeader?: string | null
): AiQuotaState {
  const rawSeconds = Number(payload.retryAfterSeconds ?? retryAfterHeader ?? 60);
  const retryAfterSeconds =
    Number.isFinite(rawSeconds) && rawSeconds > 0 ? Math.ceil(rawSeconds) : 60;
  const parsedReset =
    typeof payload.resetAtIso === 'string' ? Date.parse(payload.resetAtIso) : NaN;
  const resetAtMs =
    Number.isFinite(parsedReset) && parsedReset > Date.now()
      ? parsedReset
      : Date.now() + retryAfterSeconds * 1000;
  const quotaScope: 'minute' | 'daily' =
    payload.quotaScope === 'daily' || retryAfterSeconds >= 3600 ? 'daily' : 'minute';
  const fallbackMsg =
    quotaScope === 'daily'
      ? 'Daily AI token allowance reached while scanning large track batches.'
      : 'AI temporarily ran out of tokens while scanning these tracks.';
  const message =
    typeof payload.error === 'string' && payload.error.trim()
      ? payload.error.trim()
      : fallbackMsg;
  return { resetAtMs, retryAfterSeconds, quotaScope, message };
}

export function parseAiErrorResponse(
  resp: Response,
  payload: Record<string, unknown>,
  fallbackMessage: string
): Error {
  const errorStr = typeof payload.error === 'string' ? payload.error : '';
  const isQuota =
    resp.status === 429 ||
    payload.code === 'AI_QUOTA_EXHAUSTED' ||
    /RESOURCE_EXHAUSTED|quota\s*(exceeded|limit|exhausted)|rate[\s_-]*limit|too\s+many\s+requests|out\s+of\s+tokens/i.test(
      errorStr
    );

  if (isQuota) {
    const quotaState = buildAiQuotaStateFromPayload(payload, resp.headers.get('Retry-After'));
    setActiveAiQuotaState(quotaState);
    return new AiQuotaExhaustedError(quotaState);
  }

  return new Error(errorStr || `${fallbackMessage} (HTTP ${resp.status}).`);
}

export type StepProgressCallback = (
  current: number,
  total: number,
  detail: string,
  item?: TaskItemProgress
) => void;

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
  )
    .replace(/\s+/g, ' ')
    .trim();
}

export async function runDuplicateScan(
  tracks: Track[],
  onProgress: StepProgressCallback
): Promise<DuplicateGroup[]> {
  const total = tracks.length;
  if (total < 2) {
    onProgress(total, total, 'Need at least 2 tracks to scan for duplicates.', {
      label: tracks[0]?.title || 'Library check',
      current: 1,
      total: 1,
      percent: 100,
    });
    return [];
  }

  const groupsByKey = new Map<string, Track[]>();
  const yieldFrame = () => new Promise<void>((r) => setTimeout(r, 14));

  // Step 1: Per-track acoustic/metadata fingerprinting
  for (let i = 0; i < total; i++) {
    const t = tracks[i];
    onProgress(
      i,
      total,
      `Inspecting ${i + 1} / ${total}`,
      {
        label: `${t.artist} — ${t.title}`,
        current: 1,
        total: 2,
        percent: 50,
      }
    );

    const cleanTitle = cleanTrackTitleForMatch(t.title || t.fileName || '');
    const cleanArtist = normalizeForSearch(
      t.artist === 'Unknown Artist' ? '' : t.artist
    ).trim();
    const durBucket = Math.round((t.duration || 0) / 4);
    const key = cleanArtist ? `${cleanArtist}::${cleanTitle}` : `${cleanTitle}::d${durBucket}`;
    const bucket = groupsByKey.get(key) || [];
    bucket.push(t);
    groupsByKey.set(key, bucket);

    onProgress(
      i + 1,
      total,
      `Indexed ${i + 1} / ${total}`,
      {
        label: `${t.artist} — ${t.title}`,
        current: 2,
        total: 2,
        percent: 100,
      }
    );
    if (i % 4 === 3 || i === total - 1) {
      await yieldFrame();
    }
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

  // Step 2: AI semantic duplicate check in batches
  const aiChunkSize = 50;
  for (let i = 0; i < tracks.length; i += aiChunkSize) {
    const chunk = tracks.slice(i, i + aiChunkSize);
    const batchLabel = `AI Semantic Batch ${Math.floor(i / aiChunkSize) + 1} (${chunk[0]?.title || 'tracks'})`;
    onProgress(Math.min(i + chunk.length, total), total, batchLabel, {
      label: batchLabel,
      current: 1,
      total: 2,
      percent: 45,
    });
    try {
      const resp = await fetchWithClientTimeout(resolveApiUrl('/api/ai/duplicate-scan'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: chunk }),
      });
      if (resp.status === 429) {
        const errPayload = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
        parseAiErrorResponse(resp, errPayload, 'AI duplicate check paused due to token limit');
        break;
      }
      if (resp.ok) {
        clearActiveAiQuotaState();
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
    onProgress(Math.min(i + chunk.length, total), total, batchLabel, {
      label: batchLabel,
      current: 2,
      total: 2,
      percent: 100,
    });
  }

  onProgress(total, total, `Duplicate scan finished (${candidateGroups.length} group(s))`, {
    label: `Found ${candidateGroups.length} duplicate group(s)`,
    current: 1,
    total: 1,
    percent: 100,
  });
  return candidateGroups;
}

const GENERIC_ALBUM_REGEX = /^(|unknown album|unknown|local collection|local audio|music|downloads?|audio|various|none|n\/a)$/i;
const GENERIC_ARTIST_REGEX = /^(|unknown artist|unknown|various artists|artist|audio|n\/a)$/i;
const GENERIC_GENRE_REGEX = /^(|unknown|audio|music|other|genre|local)$/i;

export function scoreTrackMetadataNeeds(t: Track): number {
  let score = 0;
  if (GENERIC_ALBUM_REGEX.test((t.album || '').trim())) score += 40;
  if (GENERIC_ARTIST_REGEX.test((t.artist || '').trim())) score += 35;
  if (!t.year || !/^\d{4}$/.test(t.year.trim())) score += 25;
  if (GENERIC_GENRE_REGEX.test((t.genre || '').trim())) score += 15;
  if (/^\d{1,3}[\s._-]+|_|\.(mp3|flac|wav|m4a|ogg|aac|alac)$/i.test(t.title || '')) score += 20;
  if (/\[[^\]]+\]|\(\s*\d{2,3}\s*kbps\s*\)/i.test(t.title || '')) score += 15;
  if (/[^\x00-\x7F]/.test(t.title) && /[ÃÐÑ]/.test(t.title)) score += 30;
  return score;
}

export function prioritizeTracksForTagScan(tracks: Track[]): Track[] {
  return [...tracks].sort((a, b) => scoreTrackMetadataNeeds(b) - scoreTrackMetadataNeeds(a));
}

export interface KaraokeLine {
  timeSec: number;
  endSec: number;
  text: string;
  isSynced: boolean;
}

const LRC_TIMESTAMP_REGEX = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

export function parseLyricsForKaraoke(rawLyrics: string | undefined, trackDurationSec = 180): KaraokeLine[] {
  const raw = (rawLyrics || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return [];

  const duration = Math.max(10, Number(trackDurationSec) || 180);
  const rawLines = raw.split('\n');
  const syncedLines: Array<{ timeSec: number; text: string }> = [];

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Skip ID-style metadata headers like [ar:...], [ti:...], [al:...], [by:...], [length:...]
    if (/^\[(ar|ti|al|au|by|re|ve|length|offset):/i.test(trimmed)) continue;

    LRC_TIMESTAMP_REGEX.lastIndex = 0;
    const timestamps: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = LRC_TIMESTAMP_REGEX.exec(trimmed)) !== null) {
      const mins = Number.parseInt(match[1], 10);
      const secs = Number.parseInt(match[2], 10);
      const fracRaw = match[3] || '0';
      const frac =
        fracRaw.length === 3
          ? Number.parseInt(fracRaw, 10) / 1000
          : fracRaw.length === 2
          ? Number.parseInt(fracRaw, 10) / 100
          : Number.parseInt(fracRaw, 10) / 10;
      timestamps.push(mins * 60 + secs + frac);
    }

    if (timestamps.length > 0) {
      const lyricText = trimmed.replace(LRC_TIMESTAMP_REGEX, '').trim();
      if (!lyricText) continue;
      for (const ts of timestamps) {
        syncedLines.push({ timeSec: ts, text: lyricText });
      }
    }
  }

  if (syncedLines.length > 0) {
    syncedLines.sort((a, b) => a.timeSec - b.timeSec);
    return syncedLines.map((item, idx) => {
      const nextTime =
        idx < syncedLines.length - 1
          ? syncedLines[idx + 1].timeSec
          : Math.max(item.timeSec + 4.5, duration);
      return {
        timeSec: item.timeSec,
        endSec: Math.max(item.timeSec + 0.8, nextTime),
        text: item.text,
        isSynced: true,
      };
    });
  }

  // Fallback for untimed plain lyrics: distribute lines cleanly across playable window
  const plainLines = rawLines.map((l) => l.trim()).filter(Boolean);
  if (plainLines.length === 0) return [];
  const introOffset = Math.min(8, duration * 0.04);
  const outroBuffer = Math.min(8, duration * 0.05);
  const usableSpan = Math.max(10, duration - introOffset - outroBuffer);
  const step = usableSpan / plainLines.length;

  return plainLines.map((text, idx) => {
    const start = introOffset + idx * step;
    const end = idx < plainLines.length - 1 ? introOffset + (idx + 1) * step : duration;
    return {
      timeSec: start,
      endSec: Math.max(start + 1.0, end),
      text,
      isSynced: false,
    };
  });
}

export async function fetchLyricsForTrack(
  track: Pick<Track, 'title' | 'artist' | 'album' | 'duration'>
): Promise<{ lyrics: string; synced: boolean; source: string } | null> {
  const resp = await fetchWithClientTimeout(resolveApiUrl('/api/ai/lyrics'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
    }),
  });

  const payload = (await resp.json().catch(() => ({}))) as {
    lyrics?: string;
    synced?: boolean;
    source?: string;
    error?: string;
    [key: string]: unknown;
  };

  if (!resp.ok) {
    throw parseAiErrorResponse(resp, payload, 'Lyrics lookup failed');
  }
  clearActiveAiQuotaState();

  const lyrics = String(payload.lyrics || '').trim();
  if (!lyrics) return null;
  return {
    lyrics,
    synced: Boolean(payload.synced),
    source: String(payload.source || 'Lyrics Service'),
  };
}

export function applyTagSuggestionToTrack(t: Track, s: TagCleanupSuggestion): Track {
  const nextYear =
    s.suggestedYear !== undefined
      ? s.suggestedYear.trim() || undefined
      : t.year;
  const nextLyrics =
    s.suggestedLyrics !== undefined
      ? s.suggestedLyrics.trim() || undefined
      : t.lyrics;
  return {
    ...t,
    title: s.suggestedTitle || t.title,
    artist: s.suggestedArtist || t.artist,
    album: s.suggestedAlbum || t.album,
    genre: s.suggestedGenre || t.genre,
    year: nextYear,
    lyrics: nextLyrics,
  };
}

export function applyTagSuggestionsToList(
  tracks: Track[],
  suggestions: TagCleanupSuggestion[]
): Track[] {
  if (suggestions.length === 0) return tracks;
  const map = new Map(suggestions.map((s) => [s.trackId, s]));
  return tracks.map((t) => {
    const s = map.get(t.id);
    return s ? applyTagSuggestionToTrack(t, s) : t;
  });
}

export interface TagCleanupScanOptions {
  batchSize?: number;
  onBatchComplete?: (batchSuggestions: TagCleanupSuggestion[]) => void;
}

export async function runBatchedTagCleanupScan(
  tracks: Track[],
  onProgress: StepProgressCallback,
  options?: TagCleanupScanOptions
): Promise<TagCleanupSuggestion[]> {
  const total = tracks.length;
  if (total === 0) return [];

  const batchSize = Math.max(5, Math.min(40, Math.round(options?.batchSize ?? 15)));
  const totalBatches = Math.ceil(total / batchSize);
  const suggestionsById = new Map<string, TagCleanupSuggestion>();

  for (let i = 0; i < total; i += batchSize) {
    const chunk = tracks.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const first = chunk[0];

    onProgress(i, total, `AI inspecting batch ${batchNum}/${totalBatches} (${chunk.length} tracks)...`, {
      label: first ? `${first.artist} — ${first.title}` : `Batch ${batchNum}/${totalBatches}`,
      current: 0,
      total: chunk.length,
      percent: 12,
    });

    const resp = await fetchWithClientTimeout(resolveApiUrl('/api/ai/tag-cleanup'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tracks: chunk.map((t) => ({ ...t, hasLyrics: Boolean(t.lyrics?.trim()) })),
      }),
    });

    const payload = (await resp.json().catch(() => ({}))) as {
      error?: string;
      suggestions?: Array<Record<string, string>>;
      [key: string]: unknown;
    };

    if (!resp.ok) {
      throw parseAiErrorResponse(resp, payload, 'AI metadata service failed');
    }
    clearActiveAiQuotaState();

    const batchSuggestions: TagCleanupSuggestion[] = [];
    for (let k = 0; k < chunk.length; k++) {
      const orig = chunk[k];
      const match = (payload.suggestions || []).find((s) => s.trackId === orig.id);
      if (match) {
        const nextTitle = (match.suggestedTitle || orig.title).trim() || orig.title;
        const nextArtist = (match.suggestedArtist || orig.artist).trim() || orig.artist;
        const nextAlbum = (match.suggestedAlbum || orig.album).trim() || orig.album;
        const nextGenre = (match.suggestedGenre || orig.genre).trim() || orig.genre;
        const nextYear = (match.suggestedYear || orig.year || '').trim();
        const origYear = (orig.year || '').trim();
        const origLyrics = (orig.lyrics || '').trim();
        const nextLyrics = (match.suggestedLyrics || origLyrics).trim();

        const hasRealChange =
          nextTitle !== orig.title.trim() ||
          nextArtist !== orig.artist.trim() ||
          nextAlbum !== orig.album.trim() ||
          nextGenre !== orig.genre.trim() ||
          (Boolean(nextYear) && nextYear !== origYear) ||
          (Boolean(nextLyrics) && nextLyrics !== origLyrics);

        if (hasRealChange) {
          const item: TagCleanupSuggestion = {
            trackId: orig.id,
            currentTitle: orig.title,
            currentArtist: orig.artist,
            currentAlbum: orig.album,
            currentGenre: orig.genre,
            currentYear: origYear,
            currentLyrics: origLyrics || undefined,
            suggestedTitle: nextTitle,
            suggestedArtist: nextArtist,
            suggestedAlbum: nextAlbum,
            suggestedGenre: nextGenre,
            suggestedYear: nextYear,
            suggestedLyrics: nextLyrics || undefined,
            reason: (match.reason || 'AI identified & corrected metadata').trim(),
            selected: true,
          };
          suggestionsById.set(orig.id, item);
          batchSuggestions.push(item);
        }
      }

      const itemPercent = Math.round(((k + 1) / Math.max(1, chunk.length)) * 100);
      onProgress(
        i + k + 1,
        total,
        `Batch ${batchNum}/${totalBatches} · Fixed ${batchSuggestions.length} in batch`,
        {
          label: `${orig.artist} — ${orig.title}`,
          current: k + 1,
          total: chunk.length,
          percent: itemPercent,
        }
      );
    }

    if (batchSuggestions.length > 0) {
      options?.onBatchComplete?.(batchSuggestions);
    }
  }

  return Array.from(suggestionsById.values());
}

export async function runSingleItemAiScan(targetTracks: Track[]): Promise<TagCleanupSuggestion[]> {
  if (targetTracks.length === 0) return [];
  const batchSize = 25;
  const suggestionsById = new Map<string, TagCleanupSuggestion>();

  for (let i = 0; i < targetTracks.length; i += batchSize) {
    const chunk = targetTracks.slice(i, i + batchSize);
    const resp = await fetchWithClientTimeout(resolveApiUrl('/api/ai/tag-cleanup'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tracks: chunk.map((t) => ({ ...t, hasLyrics: Boolean(t.lyrics?.trim()) })),
      }),
    });

    const payload = (await resp.json().catch(() => ({}))) as {
      error?: string;
      suggestions?: Array<Record<string, string>>;
      [key: string]: unknown;
    };

    if (!resp.ok) {
      throw parseAiErrorResponse(resp, payload, 'AI metadata service failed');
    }
    clearActiveAiQuotaState();

    for (const orig of chunk) {
      const match = (payload.suggestions || []).find((s) => s.trackId === orig.id);
      if (!match) continue;
      const nextTitle = (match.suggestedTitle || orig.title).trim() || orig.title;
      const nextArtist = (match.suggestedArtist || orig.artist).trim() || orig.artist;
      const nextAlbum = (match.suggestedAlbum || orig.album).trim() || orig.album;
      const nextGenre = (match.suggestedGenre || orig.genre).trim() || orig.genre;
      const nextYear = (match.suggestedYear || orig.year || '').trim();
      const origYear = (orig.year || '').trim();
      const origLyrics = (orig.lyrics || '').trim();
      const nextLyrics = (match.suggestedLyrics || origLyrics).trim();

      const hasRealChange =
        nextTitle !== orig.title.trim() ||
        nextArtist !== orig.artist.trim() ||
        nextAlbum !== orig.album.trim() ||
        nextGenre !== orig.genre.trim() ||
        (Boolean(nextYear) && nextYear !== origYear) ||
        (Boolean(nextLyrics) && nextLyrics !== origLyrics);

      if (hasRealChange) {
        suggestionsById.set(orig.id, {
          trackId: orig.id,
          currentTitle: orig.title,
          currentArtist: orig.artist,
          currentAlbum: orig.album,
          currentGenre: orig.genre,
          currentYear: origYear,
          currentLyrics: origLyrics || undefined,
          suggestedTitle: nextTitle,
          suggestedArtist: nextArtist,
          suggestedAlbum: nextAlbum,
          suggestedGenre: nextGenre,
          suggestedYear: nextYear,
          suggestedLyrics: nextLyrics || undefined,
          reason: (match.reason || 'AI identified & corrected metadata').trim(),
          selected: true,
        });
      }
    }
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
    const first = chunk[0];
    onProgress(i, total, `Matching artwork (${i + 1}–${Math.min(i + chunk.length, total)}/${total})`, {
      label: first ? `${first.artist} — ${first.album || first.title}` : 'Album Art Query',
      current: 1,
      total: 3,
      percent: 33,
    });

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
          aiQuota?: Record<string, unknown>;
          results?: Array<{
            trackId: string;
            coverUrl: string;
            sourceLabel?: string;
          }>;
        };
        if (data.aiQuota) {
          setActiveAiQuotaState(buildAiQuotaStateFromPayload({
            error: data.aiQuota.message,
            retryAfterSeconds: data.aiQuota.retryAfterSeconds,
            resetAtIso: data.aiQuota.resetAtIso,
            quotaScope: data.aiQuota.quotaScope,
          }));
        } else {
          clearActiveAiQuotaState();
        }
        for (let k = 0; k < chunk.length; k++) {
          const orig = chunk[k];
          const match = (data.results || []).find((r) => r.trackId === orig.id);
          if (match && match.coverUrl) {
            const target = trackMap.get(orig.id);
            if (target) {
              found.push({
                trackId: target.id,
                title: target.title,
                artist: target.artist,
                album: target.album,
                currentCoverUrl: target.coverUrl,
                suggestedCoverUrl: match.coverUrl,
                sourceLabel: match.sourceLabel || 'Original Release Artwork',
                selected: true,
              });
            }
          }
          onProgress(i + k + 1, total, `Checked ${i + k + 1} / ${total}`, {
            label: `${orig.artist} — ${orig.title}`,
            current: 3,
            total: 3,
            percent: 100,
          });
        }
      }
    } catch {
      handledByServer = false;
    }

    if (!handledByServer) {
      for (let j = 0; j < chunk.length; j++) {
        const t = chunk[j];
        onProgress(i + j, total, `Querying catalog for "${t.title}"`, {
          label: `${t.artist} — ${t.title}`,
          current: 1,
          total: 2,
          percent: 50,
        });
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
        onProgress(i + j + 1, total, `Checked ${i + j + 1} / ${total}`, {
          label: `${t.artist} — ${t.title}`,
          current: 2,
          total: 2,
          percent: 100,
        });
      }
    }
  }

  return found;
}

export async function resizeArtworkFileToDataUrl(
  file: File,
  onProgress?: StepProgressCallback
): Promise<string> {
  onProgress?.(1, 4, `Reading image "${file.name}"...`, {
    label: file.name,
    current: 1,
    total: 4,
    percent: 25,
  });

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read selected artwork image.'));
    reader.readAsDataURL(file);
  });

  onProgress?.(2, 4, 'Decoding artwork dimensions...', {
    label: file.name,
    current: 2,
    total: 4,
    percent: 50,
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Unsupported artwork image format.'));
    el.src = rawDataUrl;
  });

  onProgress?.(3, 4, 'Optimizing cover art to 512×512 hi-res JPEG...', {
    label: file.name,
    current: 3,
    total: 4,
    percent: 75,
  });
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
  onProgress?.(4, 4, 'Original album cover ready to apply.', {
    label: file.name,
    current: 4,
    total: 4,
    percent: 100,
  });
  return optimized;
}
