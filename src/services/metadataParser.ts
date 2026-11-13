import { Track } from '../types/music';
import { hasGarbledMojibake, repairMojibakeText } from '../utils/textNormalization';

const DEFAULT_FALLBACK_COVER = '/src/assets/images/album_nocturne_vinyl_1794587934959.jpg';

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

function detectFormat(fileName: string): Track['format'] {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (ext === 'flac') return 'FLAC';
  if (ext === 'alac' || ext === 'm4a') return 'ALAC';
  if (ext === 'wav' || ext === 'wave') return 'WAV';
  if (ext === 'ogg' || ext === 'oga' || ext === 'opus') return 'OGG';
  if (ext === 'aac') return 'AAC';
  return 'MP3';
}

function cleanFileNameTitle(fileName: string): { title: string; artist: string } {
  const withoutExt = fileName.replace(/\.[^/.]+$/, '').replace(/^\d+[\s._-]+/, '');
  const repaired = repairMojibakeText(withoutExt);
  const dashSplit = repaired.split(' - ');
  if (dashSplit.length >= 2) {
    return {
      artist: dashSplit[0].trim(),
      title: dashSplit.slice(1).join(' - ').trim(),
    };
  }
  return {
    artist: 'Unknown Artist',
    title: repaired.replace(/_/g, ' ').trim() || fileName,
  };
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

  const fallback = cleanFileNameTitle(file.name);
  const relPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || '';
  const folderParts = relPath.split('/').filter(Boolean);
  const folderPath = folderParts.length > 1 ? folderParts.slice(0, -1).join('/') : 'Local Imports';

  const title = repairMojibakeText(parsed.title || fallback.title);
  const artist = repairMojibakeText(parsed.artist || fallback.artist);
  const album = repairMojibakeText(
    parsed.album || (folderParts.length >= 2 ? folderParts[folderParts.length - 2] : 'Local Collection')
  );
  const genre = repairMojibakeText((parsed.genre || 'Hi-Res Local').replace(/^\(\d+\)/, '').trim()) || 'Hi-Res Local';

  const duration = await probeAudioDuration(file);
  const sampleRate = parsed.sampleRate || (format === 'FLAC' || format === 'WAV' ? 96000 : 44100);
  const bitDepth = parsed.bitDepth || (format === 'FLAC' || format === 'WAV' || format === 'ALAC' ? 24 : 16);
  const bitrateKbps =
    duration > 0 ? Math.max(128, Math.round((file.size * 8) / duration / 1000)) : format === 'FLAC' ? 1411 : 320;

  const fingerprint = createTrackFingerprint(title, artist, file.size);

  return {
    id: `local_${fingerprint}_${Date.now().toString(36)}`,
    title,
    artist,
    album,
    genre,
    year: parsed.year,
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
    addedAt: Date.now(),
    offlineCached: true,
    fingerprint,
  };
}
