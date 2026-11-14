export interface AudioTagUpdate {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  year?: string;
  composer?: string;
}

export interface TagWriteResult {
  bytes: Uint8Array;
  wroteEmbedded: boolean;
  formatWritten: 'id3v2' | 'flac' | 'none';
}

function writeUint32BE(out: Uint8Array, offset: number, value: number): void {
  out[offset] = (value >>> 24) & 0xff;
  out[offset + 1] = (value >>> 16) & 0xff;
  out[offset + 2] = (value >>> 8) & 0xff;
  out[offset + 3] = value & 0xff;
}

function writeUint32LE(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
  out[offset + 2] = (value >>> 16) & 0xff;
  out[offset + 3] = (value >>> 24) & 0xff;
}

function writeSynchsafeInt(out: Uint8Array, offset: number, value: number): void {
  out[offset] = (value >>> 21) & 0x7f;
  out[offset + 1] = (value >>> 14) & 0x7f;
  out[offset + 2] = (value >>> 7) & 0x7f;
  out[offset + 3] = value & 0x7f;
}

function readUint32BE(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] << 24) |
      (buf[offset + 1] << 16) |
      (buf[offset + 2] << 8) |
      buf[offset + 3]) >>>
    0
  );
}

function readUint32LE(buf: Uint8Array, offset: number): number {
  return (
    (buf[offset] |
      (buf[offset + 1] << 8) |
      (buf[offset + 2] << 16) |
      (buf[offset + 3] << 24)) >>>
    0
  );
}

function readSynchsafeInt(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] & 0x7f) << 21) |
    ((buf[offset + 1] & 0x7f) << 14) |
    ((buf[offset + 2] & 0x7f) << 7) |
    (buf[offset + 3] & 0x7f)
  );
}

function encodeId3v23TextFrame(frameId: string, text: string): Uint8Array {
  // ID3v2.3 UTF-16LE with BOM (0x01 FF FE ...) — universal across Windows, macOS, Android, Rocket Player
  const strLen = text.length;
  const payloadLen = 1 + 2 + strLen * 2;
  const frame = new Uint8Array(10 + payloadLen);
  frame[0] = frameId.charCodeAt(0);
  frame[1] = frameId.charCodeAt(1);
  frame[2] = frameId.charCodeAt(2);
  frame[3] = frameId.charCodeAt(3);
  writeUint32BE(frame, 4, payloadLen);
  frame[8] = 0;
  frame[9] = 0;
  frame[10] = 0x01; // UTF-16 with BOM
  frame[11] = 0xff;
  frame[12] = 0xfe;
  for (let i = 0; i < strLen; i++) {
    const code = text.charCodeAt(i);
    frame[13 + i * 2] = code & 0xff;
    frame[14 + i * 2] = (code >>> 8) & 0xff;
  }
  return frame;
}

function buildId3v1Bytes(
  base: Uint8Array,
  tags: AudioTagUpdate
): Uint8Array {
  const out = new Uint8Array(128);
  out.set(base.subarray(0, 128));
  out[0] = 0x54; // T
  out[1] = 0x41; // A
  out[2] = 0x47; // G

  const writeFixedAscii = (offset: number, len: number, value?: string) => {
    if (value === undefined) return;
    for (let i = 0; i < len; i++) out[offset + i] = 0;
    const trimmed = value.slice(0, len);
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed.charCodeAt(i);
      out[offset + i] = ch <= 0xff ? ch : 0x3f;
    }
  };

  writeFixedAscii(3, 30, tags.title);
  writeFixedAscii(33, 30, tags.artist);
  writeFixedAscii(63, 30, tags.album);
  if (tags.year !== undefined) {
    const yr = tags.year.match(/\d{4}/)?.[0] || '';
    writeFixedAscii(93, 4, yr);
  }
  return out;
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

const REPLACED_ID3_FRAMES = new Set([
  'TIT2',
  'TPE1',
  'TALB',
  'TCON',
  'TYER',
  'TDRC',
  'TCOM',
  'TT2',
  'TP1',
  'TAL',
  'TCO',
  'TYE',
  'TCM',
]);

function rewriteMp3Tags(source: Uint8Array, tags: AudioTagUpdate): TagWriteResult {
  const hasId3v2 =
    source.length >= 10 &&
    source[0] === 0x49 &&
    source[1] === 0x44 &&
    source[2] === 0x33;

  let audioStart = 0;
  const preservedFrames: Uint8Array[] = [];

  if (hasId3v2) {
    const version = source[3];
    const flags = source[5];
    const oldTagSize = readSynchsafeInt(source, 6);
    const oldEnd = Math.min(source.length, 10 + oldTagSize);
    audioStart = oldEnd;

    let pos = 10;
    // Skip extended header if present
    if ((flags & 0x40) !== 0 && pos + 4 <= oldEnd) {
      const extSize =
        version === 4 ? readSynchsafeInt(source, pos) : readUint32BE(source, pos);
      pos += version === 4 ? extSize : 4 + extSize;
    }

    while (pos + 10 <= oldEnd) {
      if (version === 2) {
        if (source[pos] === 0) break;
        const size =
          (source[pos + 3] << 16) | (source[pos + 4] << 8) | source[pos + 5];
        pos += 6;
        if (size <= 0 || pos + size > oldEnd) break;
        pos += size;
      } else {
        const frameId = String.fromCharCode(
          source[pos],
          source[pos + 1],
          source[pos + 2],
          source[pos + 3]
        );
        if (source[pos] === 0 || frameId === '\0\0\0\0') break;
        const size =
          version === 4
            ? readSynchsafeInt(source, pos + 4)
            : readUint32BE(source, pos + 4);
        const frameFlags0 = source[pos + 8];
        const frameFlags1 = source[pos + 9];
        pos += 10;
        if (size <= 0 || pos + size > oldEnd) break;

        if (!REPLACED_ID3_FRAMES.has(frameId)) {
          const rebuilt = new Uint8Array(10 + size);
          rebuilt[0] = source[pos - 10];
          rebuilt[1] = source[pos - 9];
          rebuilt[2] = source[pos - 8];
          rebuilt[3] = source[pos - 7];
          writeUint32BE(rebuilt, 4, size);
          rebuilt[8] = frameFlags0;
          rebuilt[9] = frameFlags1;
          rebuilt.set(source.subarray(pos, pos + size), 10);
          preservedFrames.push(rebuilt);
        }
        pos += size;
      }
    }
  }

  const newFrames: Uint8Array[] = [];
  if (tags.title !== undefined && tags.title.trim()) {
    newFrames.push(encodeId3v23TextFrame('TIT2', tags.title.trim()));
  }
  if (tags.artist !== undefined && tags.artist.trim()) {
    newFrames.push(encodeId3v23TextFrame('TPE1', tags.artist.trim()));
  }
  if (tags.album !== undefined && tags.album.trim()) {
    newFrames.push(encodeId3v23TextFrame('TALB', tags.album.trim()));
  }
  if (tags.genre !== undefined && tags.genre.trim()) {
    newFrames.push(encodeId3v23TextFrame('TCON', tags.genre.trim()));
  }
  if (tags.year !== undefined) {
    const cleanYear = tags.year.match(/\b(19\d{2}|20\d{2})\b/)?.[1] || tags.year.trim();
    if (cleanYear) {
      newFrames.push(encodeId3v23TextFrame('TYER', cleanYear));
    }
  }
  if (tags.composer !== undefined && tags.composer.trim()) {
    newFrames.push(encodeId3v23TextFrame('TCOM', tags.composer.trim()));
  }

  const allFrames = [...newFrames, ...preservedFrames];
  let framesSize = 0;
  for (const f of allFrames) framesSize += f.length;

  const paddingSize = 256;
  const totalTagSize = framesSize + paddingSize;
  const id3Header = new Uint8Array(10);
  id3Header[0] = 0x49; // I
  id3Header[1] = 0x44; // D
  id3Header[2] = 0x33; // 3
  id3Header[3] = 3; // v2.3
  id3Header[4] = 0;
  id3Header[5] = 0;
  writeSynchsafeInt(id3Header, 6, totalTagSize);

  const padding = new Uint8Array(paddingSize);

  // Also check & update trailing ID3v1 TAG if present
  const hasId3v1 =
    source.length - audioStart >= 128 &&
    source[source.length - 128] === 0x54 &&
    source[source.length - 127] === 0x41 &&
    source[source.length - 126] === 0x47;

  const audioBody = hasId3v1
    ? source.subarray(audioStart, source.length - 128)
    : source.subarray(audioStart);

  const chunks: Uint8Array[] = [id3Header, ...allFrames, padding, audioBody];
  if (hasId3v1) {
    chunks.push(buildId3v1Bytes(source.subarray(source.length - 128), tags));
  }

  return {
    bytes: concatUint8Arrays(chunks),
    wroteEmbedded: true,
    formatWritten: 'id3v2',
  };
}

const REPLACED_VORBIS_KEYS = new Set([
  'TITLE',
  'ARTIST',
  'ALBUM',
  'GENRE',
  'DATE',
  'YEAR',
  'COMPOSER',
]);

function rewriteFlacTags(source: Uint8Array, tags: AudioTagUpdate): TagWriteResult {
  if (
    source.length < 8 ||
    source[0] !== 0x66 ||
    source[1] !== 0x4c ||
    source[2] !== 0x61 ||
    source[3] !== 0x43
  ) {
    return { bytes: source, wroteEmbedded: false, formatWritten: 'none' };
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8');

  let pos = 4;
  let isLast = false;
  const keptBlocks: Array<{ blockType: number; data: Uint8Array }> = [];
  let vendorStr = 'reference libFLAC 1.4.3';
  const existingOtherComments: string[] = [];

  while (!isLast && pos + 4 <= source.length) {
    const header = source[pos];
    isLast = (header & 0x80) !== 0;
    const blockType = header & 0x7f;
    const length =
      (source[pos + 1] << 16) | (source[pos + 2] << 8) | source[pos + 3];
    pos += 4;
    if (pos + length > source.length) break;

    const blockData = source.subarray(pos, pos + length);
    if (blockType === 4) {
      // VORBIS_COMMENT
      let cPos = 0;
      if (cPos + 4 <= blockData.length) {
        const vendorLen = readUint32LE(blockData, cPos);
        cPos += 4;
        if (cPos + vendorLen <= blockData.length) {
          vendorStr = decoder.decode(blockData.subarray(cPos, cPos + vendorLen)) || vendorStr;
          cPos += vendorLen;
        }
      }
      if (cPos + 4 <= blockData.length) {
        const commentCount = readUint32LE(blockData, cPos);
        cPos += 4;
        for (let i = 0; i < commentCount && cPos + 4 <= blockData.length; i++) {
          const itemLen = readUint32LE(blockData, cPos);
          cPos += 4;
          if (cPos + itemLen > blockData.length) break;
          const entry = decoder.decode(blockData.subarray(cPos, cPos + itemLen));
          cPos += itemLen;
          const eqIdx = entry.indexOf('=');
          if (eqIdx > 0) {
            const key = entry.slice(0, eqIdx).trim().toUpperCase();
            if (!REPLACED_VORBIS_KEYS.has(key)) {
              existingOtherComments.push(entry);
            }
          }
        }
      }
    } else if (blockType !== 1) {
      // Preserve STREAMINFO(0), APPLICATION(2), SEEKTABLE(3), CUESHEET(5), PICTURE(6), etc.; skip old PADDING(1)
      keptBlocks.push({ blockType, data: blockData });
    }
    pos += length;
  }

  const audioFrames = source.subarray(pos);

  const newComments: string[] = [];
  if (tags.title !== undefined && tags.title.trim()) newComments.push(`TITLE=${tags.title.trim()}`);
  if (tags.artist !== undefined && tags.artist.trim()) newComments.push(`ARTIST=${tags.artist.trim()}`);
  if (tags.album !== undefined && tags.album.trim()) newComments.push(`ALBUM=${tags.album.trim()}`);
  if (tags.genre !== undefined && tags.genre.trim()) newComments.push(`GENRE=${tags.genre.trim()}`);
  if (tags.year !== undefined) {
    const cleanYear = tags.year.match(/\b(19\d{2}|20\d{2})\b/)?.[1] || tags.year.trim();
    if (cleanYear) newComments.push(`DATE=${cleanYear}`);
  }
  if (tags.composer !== undefined && tags.composer.trim()) {
    newComments.push(`COMPOSER=${tags.composer.trim()}`);
  }
  const allComments = [...newComments, ...existingOtherComments];

  const vendorBytes = encoder.encode(vendorStr);
  const encodedCommentEntries = allComments.map((c) => encoder.encode(c));
  let vorbisSize = 4 + vendorBytes.length + 4;
  for (const e of encodedCommentEntries) vorbisSize += 4 + e.length;

  const vorbisData = new Uint8Array(vorbisSize);
  let vPos = 0;
  writeUint32LE(vorbisData, vPos, vendorBytes.length);
  vPos += 4;
  vorbisData.set(vendorBytes, vPos);
  vPos += vendorBytes.length;
  writeUint32LE(vorbisData, vPos, encodedCommentEntries.length);
  vPos += 4;
  for (const e of encodedCommentEntries) {
    writeUint32LE(vorbisData, vPos, e.length);
    vPos += 4;
    vorbisData.set(e, vPos);
    vPos += e.length;
  }

  const paddingSize = 512;
  const paddingData = new Uint8Array(paddingSize);

  const outputBlocks: Array<{ blockType: number; data: Uint8Array }> = [];
  let insertedVorbis = false;
  for (const b of keptBlocks) {
    outputBlocks.push(b);
    if (b.blockType === 0 && !insertedVorbis) {
      outputBlocks.push({ blockType: 4, data: vorbisData });
      insertedVorbis = true;
    }
  }
  if (!insertedVorbis) {
    outputBlocks.push({ blockType: 4, data: vorbisData });
  }
  outputBlocks.push({ blockType: 1, data: paddingData });

  const chunks: Uint8Array[] = [new Uint8Array([0x66, 0x4c, 0x61, 0x43])];
  for (let i = 0; i < outputBlocks.length; i++) {
    const blk = outputBlocks[i];
    const lastFlag = i === outputBlocks.length - 1 ? 0x80 : 0x00;
    const len = blk.data.length;
    const blkHeader = new Uint8Array(4);
    blkHeader[0] = lastFlag | (blk.blockType & 0x7f);
    blkHeader[1] = (len >>> 16) & 0xff;
    blkHeader[2] = (len >>> 8) & 0xff;
    blkHeader[3] = len & 0xff;
    chunks.push(blkHeader, blk.data);
  }
  chunks.push(audioFrames);

  return {
    bytes: concatUint8Arrays(chunks),
    wroteEmbedded: true,
    formatWritten: 'flac',
  };
}

/**
 * Rewrites embedded binary metadata tags inside MP3 (ID3v2.3 + ID3v1) or FLAC (Vorbis Comment)
 * bytes while preserving existing artwork (APIC/PICTURE), track numbers, and audio frames intact.
 */
export async function embedTagsIntoAudioBlob(
  blob: Blob,
  fileNameOrFormat: string,
  tags: AudioTagUpdate
): Promise<{ blob: Blob; wroteEmbedded: boolean; formatWritten: TagWriteResult['formatWritten'] }> {
  const lower = fileNameOrFormat.toLowerCase();
  const ab = await blob.arrayBuffer();
  const bytes = new Uint8Array(ab);

  const isFlac =
    lower.endsWith('.flac') ||
    lower === 'flac' ||
    (bytes.length >= 4 &&
      bytes[0] === 0x66 &&
      bytes[1] === 0x4c &&
      bytes[2] === 0x61 &&
      bytes[3] === 0x43);

  if (isFlac) {
    const res = rewriteFlacTags(bytes, tags);
    if (!res.wroteEmbedded) {
      return { blob, wroteEmbedded: false, formatWritten: 'none' };
    }
    const copy = new Uint8Array(res.bytes.length);
    copy.set(res.bytes);
    return {
      blob: new Blob([copy.buffer], { type: blob.type || 'audio/flac' }),
      wroteEmbedded: true,
      formatWritten: 'flac',
    };
  }

  const isMp3 =
    lower.endsWith('.mp3') ||
    lower === 'mp3' ||
    (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
    (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);

  if (isMp3) {
    const res = rewriteMp3Tags(bytes, tags);
    const copy = new Uint8Array(res.bytes.length);
    copy.set(res.bytes);
    return {
      blob: new Blob([copy.buffer], { type: blob.type || 'audio/mpeg' }),
      wroteEmbedded: true,
      formatWritten: 'id3v2',
    };
  }

  return { blob, wroteEmbedded: false, formatWritten: 'none' };
}
