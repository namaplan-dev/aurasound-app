import { Track } from '../types/music';
import { hasGarbledMojibake, repairMojibakeText } from '../utils/textNormalization';
import defaultVinylCover from '../assets/images/album_nocturne_vinyl_1794587934959.jpg';

const DEFAULT_FALLBACK_COVER = defaultVinylCover;

function readSynchsafeInt(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] & 0x7f) << 21) |
    ((bytes[offset + 1] & 0x7f) << 14) |
    ((bytes[offset + 2] & 0x7f) << 7) |
    (bytes[offset + 3] & 0x7f)
  );
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function decodeId3Text(encoding: number, payload: Uint8Array): string {
  if (payload.length === 0) return '';
  let raw = '';
  try {
    if (encoding === 0) {
      // ISO-8859-1 or mislabeled Windows-1251 Cyrillic
      for (let i = 0; i < payload.length; i++) {
        if (payload[i] === 0) break;
        raw += String.fromCharCode(payload[i]);
      }
      return repairMojibakeText(raw);
    }
    if (encoding === 1) {
      // UTF-16 with BOM
      const isLE = payload.length >= 2 && payload[0] === 0xff && payload[1] === 0xfe;
      const start = payload.length >= 2 && (payload[0] === 0xff || payload[0] === 0xfe) ? 2 : 0;
      const decoder = new TextDecoder(isLE ? 'utf-16le' : 'utf-16be');
      raw = decoder.decode(payload.subarray(start)).replace(/\0+$/g, '').trim();
      return hasGarbledMojibake(raw) ? repairMojibakeText(raw) : raw;
    }
    if (encoding === 2) {
      raw = new TextDecoder('utf-16be').decode(payload).replace(/\0+$/g, '').trim();
      return raw;
    }
    // encoding === 3: UTF-8
    raw = new TextDecoder('utf-8').decode(payload).replace(/\0+$/g, '').trim();
    return hasGarbledMojibake(raw) ? repairMojibakeText(raw) : raw;
  } catch {
    return raw.trim();
  }
}

interface ParsedTags {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  year?: string;
  composer?: string;
  sampleRate?: number;
  bitDepth?: number;
  coverDataUrl?: string;
}

function bytesToDataUrl(mime: string, data: Uint8Array): string | undefined {
  if (data.length < 32 || data.length > 4 * 1024 * 1024) return undefined;
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.subarray(i, i + chunk));
  }
  return `data:${mime || 'image/jpeg'};base64,${btoa(binary)}`;
}

function parseId3v2(buf: Uint8Array): ParsedTags {
  const tags: ParsedTags = {};
  if (buf.length < 10 || buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) {
    return tags;
  }
  const version = buf[3];
  const tagSize = readSynchsafeInt(buf, 6);
  const end = Math.min(buf.length, 10 + tagSize);
  let pos = 10;

  while (pos + 10 <= end) {
    if (version === 2) {
      const id = String.fromCharCode(buf[pos], buf[pos + 1], buf[pos + 2]);
      if (id === '\0\0\0') break;
      const size = (buf[pos + 3] << 16) | (buf[pos + 4] << 8) | buf[pos + 5];
      pos += 6;
      if (size <= 0 || pos + size > end) break;
      const frame = buf.subarray(pos, pos + size);
      if (id === 'TT2') tags.title = decodeId3Text(frame[0], frame.subarray(1));
      else if (id === 'TP1') tags.artist = decodeId3Text(frame[0], frame.subarray(1));
      else if (id === 'TAL') tags.album = decodeId3Text(frame[0], frame.subarray(1));
      else if (id === 'TCO') tags.genre = decodeId3Text(frame[0], frame.subarray(1));
      else if (id === 'TCM') tags.composer = decodeId3Text(frame[0], frame.subarray(1));
      pos += size;
    } else {
      const id = String.fromCharCode(buf[pos], buf[pos + 1], buf[pos + 2], buf[pos + 3]);
      if (id === '\0\0\0\0') break;
      const size = version === 4 ? readSynchsafeInt(buf, pos + 4) : readUint32BE(buf, pos + 4);
      pos += 10;
      if (size <= 0 || pos + size > end) break;
      const frame = buf.subarray(pos, pos + size);
      if (id === 'TIT2') tags.title = decodeId3Text(frame[0], frame.subarray(1));
      else if (id === 'TPE1') tags.artist = decodeId3Text(frame[0], frame.subarray(1));
      else if (id === 'TALB') tags.album = decodeId3Text(frame[0], frame.subarray(1));
      else if (id === 'TCON') tags.genre = decodeId3Text(frame[0], frame.subarray(1));
      else if (id === 'TCOM') tags.composer = decodeId3Text(frame[0], frame.subarray(1));
      else if (id === 'TYER' || id === 'TDRC') tags.year = decodeId3Text(frame[0], frame.subarray(1)).slice(0, 4);
      else if (id === 'APIC' && !tags.coverDataUrl && frame.length > 8) {
        let idx = 1;
        let mime = '';
        while (idx < frame.length && frame[idx] !== 0) {
          mime += String.fromCharCode(frame[idx++]);
        }
        idx += 2; // null terminator + picture type
        const enc = frame[0];
        if (enc === 1 || enc === 2) {
          while (idx + 1 < frame.length && !(frame[idx] === 0 && frame[idx + 1] === 0)) idx += 2;
          idx += 2;
        } else {
          while (idx < frame.length && frame[idx] !== 0) idx++;
          idx++;
        }
        if (idx < frame.length) {
          tags.coverDataUrl = bytesToDataUrl(mime || 'image/jpeg', frame.subarray(idx));
        }
      }
      pos += size;
    }
  }
  return tags;
}

function parseFlac(buf: Uint8Array): ParsedTags {
  const tags: ParsedTags = {};
  if (
    buf.length < 12 ||
    buf[0] !== 0x66 ||
    buf[1] !== 0x4c ||
    buf[2] !== 0x61 ||
    buf[3] !== 0x43
  ) {
    return tags;
  }

  let pos = 4;
  while (pos + 4 <= buf.length) {
    const header = buf[pos];
    const isLast = (header & 0x80) !== 0;
    const blockType = header & 0x7f;
    const blockSize = (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3];
    pos += 4;
    if (pos + blockSize > buf.length) break;

    const block = buf.subarray(pos, pos + blockSize);
    if (blockType === 0 && block.length >= 18) {
      // STREAMINFO: sample rate (20 bits) + channels (3 bits) + bps (5 bits)
      const val = (block[10] << 16) | (block[11] << 8) | block[12];
      tags.sampleRate = (val >> 4) & 0xfffff;
      tags.bitDepth = (((block[12] & 0x01) << 4) | (block[13] >> 4)) + 1;
    } else if (blockType === 4 && block.length >= 8) {
      // VORBIS_COMMENT
      let cPos = 0;
      const vendorLen = readUint32LE(block, cPos);
      cPos += 4 + vendorLen;
      if (cPos + 4 <= block.length) {
        const count = readUint32LE(block, cPos);
        cPos += 4;
        for (let i = 0; i < count && cPos + 4 <= block.length; i++) {
          const len = readUint32LE(block, cPos);
          cPos += 4;
          if (cPos + len > block.length) break;
          const comment = repairMojibakeText(new TextDecoder('utf-8').decode(block.subarray(cPos, cPos + len)));
          cPos += len;
          const eqIdx = comment.indexOf('=');
          if (eqIdx > 0) {
            const key = comment.slice(0, eqIdx).toUpperCase();
            const val = comment.slice(eqIdx + 1).trim();
            if (key === 'TITLE') tags.title = val;
            else if (key === 'ARTIST') tags.artist = val;
            else if (key === 'ALBUM') tags.album = val;
            else if (key === 'GENRE') tags.genre = val;
            else if (key === 'COMPOSER') tags.composer = val;
            else if (key === 'DATE' || key === 'YEAR') tags.year = val.slice(0, 4);
          }
        }
      }
    } else if (blockType === 6 && !tags.coverDataUrl && block.length > 32) {
      // PICTURE block
      let pPos = 4;
      const mimeLen = readUint32BE(block, pPos);
      pPos += 4;
      const mime = new TextDecoder('ascii').decode(block.subarray(pPos, pPos + mimeLen));
      pPos += mimeLen;
      const descLen = readUint32BE(block, pPos);
      pPos += 4 + descLen + 16; // skip width, height, depth, colors
      if (pPos + 4 <= block.length) {
        const dataLen = readUint32BE(block, pPos);
        pPos += 4;
        if (pPos + dataLen <= block.length) {
          tags.coverDataUrl = bytesToDataUrl(mime || 'image/jpeg', block.subarray(pPos, pPos + dataLen));
        }
      }
    }

    pos += blockSize;
    if (isLast) break;
  }

  return tags;
}

function parseOggVorbisComments(buf: Uint8Array): ParsedTags {
  const tags: ParsedTags = {};
  // Locate "\x03vorbis" or "OpusTags" packet
  let start = -1;
  for (let i = 0; i + 8 < buf.length; i++) {
    if (
      buf[i] === 0x03 &&
      buf[i + 1] === 0x76 &&
      buf[i + 2] === 0x6f &&
      buf[i + 3] === 0x72 &&
      buf[i + 4] === 0x62 &&
      buf[i + 5] === 0x69 &&
      buf[i + 6] === 0x73
    ) {
      start = i + 7;
      break;
    }
    if (
      buf[i] === 0x4f &&
      buf[i + 1] === 0x70 &&
      buf[i + 2] === 0x75 &&
      buf[i + 3] === 0x73 &&
      buf[i + 4] === 0x54 &&
      buf[i + 5] === 0x61 &&
      buf[i + 6] === 0x67 &&
      buf[i + 7] === 0x73
    ) {
      start = i + 8;
      break;
    }
  }
  if (start < 0 || start + 8 > buf.length) return tags;

  const vendorLen = readUint32LE(buf, start);
  let pos = start + 4 + vendorLen;
  if (pos + 4 > buf.length || vendorLen > 4096) return tags;

  const count = readUint32LE(buf, pos);
  pos += 4;
  for (let i = 0; i < count && i < 128 && pos + 4 <= buf.length; i++) {
    const len = readUint32LE(buf, pos);
    pos += 4;
    if (len <= 0 || len > 16384 || pos + len > buf.length) break;
    const comment = repairMojibakeText(
      new TextDecoder('utf-8').decode(buf.subarray(pos, pos + len))
    );
    pos += len;
    const eq = comment.indexOf('=');
    if (eq > 0) {
      const key = comment.slice(0, eq).toUpperCase();
      const val = comment.slice(eq + 1).trim();
      if (key === 'TITLE') tags.title = val;
      else if (key === 'ARTIST') tags.artist = val;
      else if (key === 'ALBUM') tags.album = val;
      else if (key === 'GENRE') tags.genre = val;
      else if (key === 'COMPOSER') tags.composer = val;
      else if (key === 'DATE' || key === 'YEAR') tags.year = val.slice(0, 4);
    }
  }
  return tags;
}

function findAsciiSequence(buf: Uint8Array, seq: string, from = 0): number {
  const target = Array.from(seq).map((ch) => ch.charCodeAt(0));
  for (let i = from; i + target.length <= buf.length; i++) {
    let ok = true;
    for (let j = 0; j < target.length; j++) {
      if (buf[i + j] !== target[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

function parseMp4Ilst(buf: Uint8Array): ParsedTags {
  const tags: ParsedTags = {};
  const ilstIdx = findAsciiSequence(buf, 'ilst');
  if (ilstIdx < 4 || ilstIdx + 8 > buf.length) return tags;

  const ilstSize = readUint32BE(buf, ilstIdx - 4);
  const ilstEnd = Math.min(buf.length, ilstIdx - 4 + Math.max(ilstSize, 16));
  let pos = ilstIdx + 4;

  while (pos + 8 <= ilstEnd) {
    const atomSize = readUint32BE(buf, pos);
    if (atomSize < 8 || pos + atomSize > ilstEnd) break;
    const atomType = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]);

    const dataIdx = findAsciiSequence(buf.subarray(0, pos + atomSize), 'data', pos + 8);
    if (dataIdx >= pos + 12 && dataIdx + 12 <= pos + atomSize) {
      const dataSize = readUint32BE(buf, dataIdx - 4);
      const dataEnd = Math.min(pos + atomSize, dataIdx - 4 + dataSize);
      const typeFlag = readUint32BE(buf, dataIdx + 4) & 0xff;
      const payload = buf.subarray(dataIdx + 12, dataEnd);

      if (atomType === 'covr' && !tags.coverDataUrl && payload.length > 32) {
        const mime = typeFlag === 14 ? 'image/png' : 'image/jpeg';
        tags.coverDataUrl = bytesToDataUrl(mime, payload);
      } else if (typeFlag === 1 && payload.length > 0) {
        const textVal = repairMojibakeText(new TextDecoder('utf-8').decode(payload));
        if (atomType === '\u00a9nam') tags.title = textVal;
        else if (atomType === '\u00a9ART') tags.artist = textVal;
        else if (atomType === 'aART' && !tags.artist) tags.artist = textVal;
        else if (atomType === '\u00a9alb') tags.album = textVal;
        else if (atomType === '\u00a9gen') tags.genre = textVal;
        else if (atomType === '\u00a9wrt') tags.composer = textVal;
        else if (atomType === '\u00a9day') tags.year = textVal.slice(0, 4);
      }
    }
    pos += atomSize;
  }

  return tags;
}

function detectFormat(fileName: string): Track['format'] {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (ext === 'flac') return 'FLAC';
  if (ext === 'alac' || ext === 'm4a') return 'ALAC';
  if (ext === 'wav' || ext === 'wave') return 'WAV';
  if (ext === 'ogg' || ext === 'oga' || ext === 'opus') return 'OGG';
  if (ext === 'aac') return 'AAC';
  return 'MP3';
}

const GENERIC_FOLDER_NAMES = new Set([
  '',
  'music',
  'downloads',
  'download',
  'audio',
  'sounds',
  'media',
  'my music',
  'local imports',
  'device music',
  'internal storage',
  'sdcard',
  'external',
  'storage',
  'emulated',
  '0',
]);

function isGenericFolderName(name: string): boolean {
  return GENERIC_FOLDER_NAMES.has(name.trim().toLowerCase());
}

function isMissingTag(val: string | undefined, kind: 'artist' | 'album' | 'title'): boolean {
  const clean = (val || '').trim().toLowerCase();
  if (!clean || clean === '<unknown>' || clean === 'unknown' || clean === 'n/a') return true;
  if (kind === 'artist') {
    return clean === 'unknown artist' || clean === 'various' || clean === 'artist';
  }
  if (kind === 'album') {
    return (
      clean === 'unknown album' ||
      clean === 'local collection' ||
      clean === 'local audio' ||
      clean === 'audio' ||
      GENERIC_FOLDER_NAMES.has(clean)
    );
  }
  return false;
}

export function cleanFileNameTitle(fileName: string): { title: string; artist: string } {
  const stripped = fileName
    .replace(/\.[^/.]+$/, '')
    .replace(/\s+(mp3|flac|wav|m4a|ogg|aac|alac)$/i, '')
    .replace(/\[[^\]]*(flac|mp3|wav|alac|aac|ogg|kbps|web|cd|vinyl|remaster)[^\]]*\]/gi, '')
    .replace(/\(\s*\d{2,3}\s*kbps\s*\)/gi, '')
    .replace(/_/g, ' ')
    .replace(/^\s*\d{1,3}[\s._-]+(?=\S)/, '')
    .replace(/\s+/g, ' ')
    .trim();

  const repaired = repairMojibakeText(stripped);
  const dashSplit = repaired.split(/\s+[-–—]\s+/);
  if (dashSplit.length >= 2) {
    const candidateArtist = dashSplit[0].replace(/^\d{1,3}[\s._-]+/, '').trim();
    const candidateTitle = dashSplit
      .slice(1)
      .join(' - ')
      .replace(/^\d{1,3}[\s._-]+(?=\S)/, '')
      .trim();
    if (candidateArtist && candidateTitle) {
      return {
        artist: candidateArtist,
        title: candidateTitle,
      };
    }
  }
  return {
    artist: 'Unknown Artist',
    title: repaired || fileName,
  };
}

export function inferHierarchyFromPath(
  folderPath: string | undefined,
  fileName: string | undefined,
  rawTitle?: string,
  rawArtist?: string,
  rawAlbum?: string
): { title: string; artist: string; album: string } {
  const fallback = cleanFileNameTitle(fileName || rawTitle || 'Untitled Track');
  const parts = (folderPath || '')
    .split(/[\\/]/)
    .map((p) => repairMojibakeText(p.replace(/_/g, ' ').trim()))
    .filter(Boolean);

  const parentFolder = parts.length >= 1 ? parts[parts.length - 1] : '';
  const grandParentFolder = parts.length >= 2 ? parts[parts.length - 2] : '';

  let title = repairMojibakeText(rawTitle || '').trim();
  if (!title || title === fileName || /^\d{1,3}[\s._-]+/.test(title)) {
    title = fallback.title;
  }

  let artist = repairMojibakeText(rawArtist || '').trim();
  if (isMissingTag(artist, 'artist')) {
    if (!isMissingTag(fallback.artist, 'artist')) {
      artist = fallback.artist;
    } else if (grandParentFolder && !isGenericFolderName(grandParentFolder)) {
      artist = grandParentFolder;
    } else {
      artist = 'Unknown Artist';
    }
  }

  let album = repairMojibakeText(rawAlbum || '').trim();
  if (isMissingTag(album, 'album')) {
    if (parentFolder && !isGenericFolderName(parentFolder) && parentFolder.toLowerCase() !== artist.toLowerCase()) {
      album = parentFolder;
    } else {
      album = 'Local Collection';
    }
  }

  return { title, artist, album };
}

export function createTrackFingerprint(title: string, artist: string, size?: number): string {
  const raw = `${title.toLowerCase()}|${artist.toLowerCase()}|${size || 0}`;
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fp_${(hash >>> 0).toString(36)}`;
}

function probeAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = 'metadata';
    const cleanup = () => {
      audio.src = '';
      URL.revokeObjectURL(url);
    };
    const timer = window.setTimeout(() => {
      cleanup();
      resolve(180);
    }, 2500);
    audio.onloadedmetadata = () => {
      window.clearTimeout(timer);
      const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 180;
      cleanup();
      resolve(Math.round(dur));
    };
    audio.onerror = () => {
      window.clearTimeout(timer);
      cleanup();
      resolve(180);
    };
    audio.src = url;
  });
}

export async function parseLocalAudioFile(file: File): Promise<Track> {
  const headSlice = await file.slice(0, Math.min(file.size, 512 * 1024)).arrayBuffer();
  const bytes = new Uint8Array(headSlice);
  const format = detectFormat(file.name);

  let parsed: ParsedTags = {};
  if (format === 'FLAC') {
    parsed = parseFlac(bytes);
  } else if (format === 'OGG') {
    parsed = parseOggVorbisComments(bytes);
  } else if (format === 'ALAC' || format === 'AAC') {
    parsed = parseMp4Ilst(bytes);
    if (!parsed.title && !parsed.artist) {
      parsed = parseId3v2(bytes);
    }
  } else {
    parsed = parseId3v2(bytes);
  }

  // Fallback ID3v1 check at end of MP3 if title missing
  if (!parsed.title && file.size > 128) {
    const tail = new Uint8Array(await file.slice(file.size - 128, file.size).arrayBuffer());
    if (tail[0] === 0x54 && tail[1] === 0x41 && tail[2] === 0x47) {
      parsed.title = decodeId3Text(0, tail.subarray(3, 33)) || parsed.title;
      parsed.artist = decodeId3Text(0, tail.subarray(33, 63)) || parsed.artist;
      parsed.album = decodeId3Text(0, tail.subarray(63, 93)) || parsed.album;
      parsed.year = decodeId3Text(0, tail.subarray(93, 97)) || parsed.year;
    }
  }

  const relPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || '';
  const folderParts = relPath.split('/').filter(Boolean);
  const folderPath = folderParts.length > 1 ? folderParts.slice(0, -1).join('/') : 'Local Imports';

  const resolved = inferHierarchyFromPath(
    folderParts.length > 1 ? folderPath : '',
    file.name,
    parsed.title,
    parsed.artist,
    parsed.album
  );
  const genre =
    repairMojibakeText((parsed.genre || 'Hi-Res Local').replace(/^\(\d+\)/, '').trim()) ||
    'Hi-Res Local';

  const duration = await probeAudioDuration(file);
  const sampleRate = parsed.sampleRate || (format === 'FLAC' || format === 'WAV' ? 96000 : 44100);
  const bitDepth =
    parsed.bitDepth || (format === 'FLAC' || format === 'WAV' || format === 'ALAC' ? 24 : 16);
  const bitrateKbps =
    duration > 0
      ? Math.max(128, Math.round((file.size * 8) / duration / 1000))
      : format === 'FLAC'
      ? 1411
      : 320;

  const fingerprint = createTrackFingerprint(resolved.title, resolved.artist, file.size);

  return {
    id: `local_${fingerprint}_${Date.now().toString(36)}`,
    title: resolved.title,
    artist: resolved.artist,
    album: resolved.album,
    genre,
    year: parsed.year,
    composer: parsed.composer ? repairMojibakeText(parsed.composer) : undefined,
    duration,
    format,
    sampleRate,
    bitDepth,
    bitrateKbps,
    coverUrl: parsed.coverDataUrl || DEFAULT_FALLBACK_COVER,
    source: 'local',
    folderPath,
    fileName: file.name,
    fileSize: file.size,
    favorite: false,
    rating: 0,
    playCount: 0,
    skipCount: 0,
    addedAt: Date.now(),
    offlineCached: true,
    fingerprint,
  };
}
