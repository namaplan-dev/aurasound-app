import { Playlist, Track } from '../types/music';
import { normalizeForSearch } from '../utils/textNormalization';

export interface ParsedM3uResult {
  playlistName: string;
  matchedTrackIds: string[];
  totalEntries: number;
}

function getBaseFileName(rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, '/').trim();
  const parts = normalized.split('/');
  return (parts[parts.length - 1] || normalized).trim();
}

/**
 * Parses .m3u / .m3u8 playlist text (Rocket Player & standard Android/desktop format)
 * and resolves entries to tracks present in the user's library.
 */
export function parseM3uPlaylist(
  fileName: string,
  content: string,
  libraryTracks: Track[]
): ParsedM3uResult {
  const defaultName =
    fileName.replace(/\.(m3u8?|pls)$/i, '').replace(/_/g, ' ').trim() || 'Imported Playlist';

  const byFileName = new Map<string, Track>();
  const byRelPath = new Map<string, Track>();
  const byArtistTitle = new Map<string, Track>();
  const byTitle = new Map<string, Track>();

  for (const t of libraryTracks) {
    if (t.fileName) {
      byFileName.set(t.fileName.toLowerCase(), t);
      if (t.folderPath) {
        byRelPath.set(`${t.folderPath}/${t.fileName}`.replace(/\\/g, '/').toLowerCase(), t);
      }
    }
    const normTitle = normalizeForSearch(t.title);
    const normArtist = normalizeForSearch(t.artist);
    if (normTitle) {
      byTitle.set(normTitle, t);
      if (normArtist && normArtist !== 'unknown artist') {
        byArtistTitle.set(`${normArtist}::${normTitle}`, t);
      }
    }
  }

  let playlistName = defaultName;
  const lines = content.split(/\r?\n/);
  let pendingExtTitle = '';
  const matchedIds: string[] = [];
  const seenIds = new Set<string>();
  let totalEntries = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#PLAYLIST:')) {
      const custom = line.slice('#PLAYLIST:'.length).trim();
      if (custom) playlistName = custom;
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      const commaIdx = line.indexOf(',');
      pendingExtTitle = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : '';
      continue;
    }

    if (line.startsWith('#')) continue;

    totalEntries++;
    const normalizedLine = line.replace(/\\/g, '/').toLowerCase();
    const baseName = getBaseFileName(line).toLowerCase();
    let matched: Track | undefined;

    // 1. Match full relative folder/file suffix
    for (const [relKey, track] of byRelPath.entries()) {
      if (normalizedLine.endsWith(relKey) || relKey.endsWith(normalizedLine)) {
        matched = track;
        break;
      }
    }

    // 2. Match exact filename
    if (!matched && baseName) {
      matched = byFileName.get(baseName);
    }

    // 3. Match #EXTINF "Artist - Title" or "Title"
    if (!matched && pendingExtTitle) {
      const parts = pendingExtTitle.split(/\s+[-–—]\s+/);
      if (parts.length >= 2) {
        const key = `${normalizeForSearch(parts[0])}::${normalizeForSearch(parts.slice(1).join(' - '))}`;
        matched = byArtistTitle.get(key);
      }
      if (!matched) {
        matched = byTitle.get(normalizeForSearch(pendingExtTitle));
      }
    }

    // 4. Match filename stripped of extension against normalized track title
    if (!matched && baseName) {
      const stripped = baseName.replace(/\.[^/.]+$/, '').replace(/^\d{1,3}[\s._-]+/, '');
      matched = byTitle.get(normalizeForSearch(stripped));
    }

    pendingExtTitle = '';
    if (matched && !seenIds.has(matched.id)) {
      seenIds.add(matched.id);
      matchedIds.push(matched.id);
    }
  }

  return {
    playlistName,
    matchedTrackIds: matchedIds,
    totalEntries,
  };
}

/**
 * Exports a playlist in Rocket Player-compatible UTF-8 #EXTM3U (.m3u8) format.
 */
export function exportPlaylistAsM3u8(playlist: Playlist, libraryTracks: Track[]): void {
  const trackMap = new Map(libraryTracks.map((t) => [t.id, t]));
  const items = playlist.trackIds
    .map((id) => trackMap.get(id))
    .filter((t): t is Track => Boolean(t));

  const lines: string[] = ['#EXTM3U', `#PLAYLIST:${playlist.name}`];
  for (const t of items) {
    const dur = Math.max(0, Math.round(t.duration || 0));
    const displayArtist = t.artist && t.artist !== 'Unknown Artist' ? `${t.artist} - ` : '';
    lines.push(`#EXTINF:${dur},${displayArtist}${t.title}`);
    if (t.nativePath) {
      lines.push(t.nativePath);
    } else if (t.folderPath && t.fileName) {
      lines.push(`${t.folderPath}/${t.fileName}`);
    } else if (t.fileName) {
      lines.push(t.fileName);
    } else {
      lines.push(`${t.artist || 'Unknown'} - ${t.title}.${(t.format || 'mp3').toLowerCase()}`);
    }
  }

  const blob = new Blob([lines.join('\n') + '\n'], {
    type: 'audio/x-mpegurl;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeName = playlist.name.replace(/[<>:"/\\|?*]+/g, '_').trim() || 'playlist';
  link.href = url;
  link.download = `${safeName}.m3u8`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
