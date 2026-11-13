const LITHUANIAN_CHAR_MAP: Record<string, string> = {
  ą: 'a',
  č: 'c',
  ę: 'e',
  ė: 'e',
  į: 'i',
  š: 's',
  ų: 'u',
  ū: 'u',
  ž: 'z',
  Ą: 'a',
  Č: 'c',
  Ę: 'e',
  Ė: 'e',
  Į: 'i',
  Š: 's',
  Ų: 'u',
  Ū: 'u',
  Ž: 'z',
};

/**
 * Bidirectional diacritic-insensitive normalization supporting Lithuanian
 * (ą, č, ę, ė, į, š, ų, ū, ž), Cyrillic, and standard Latin accents.
 */
export function normalizeForSearch(input: string): string {
  if (!input) return '';
  let mapped = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    mapped += LITHUANIAN_CHAR_MAP[ch] ?? ch;
  }
  return mapped
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function matchesNormalizedQuery(
  fields: Array<string | undefined | null>,
  query: string
): boolean {
  const normQuery = normalizeForSearch(query);
  if (!normQuery) return true;
  const tokens = normQuery.split(/\s+/).filter(Boolean);
  const combined = normalizeForSearch(fields.filter(Boolean).join(' '));
  return tokens.every((token) => combined.includes(token));
}

// Windows-1251 byte-to-Unicode lookup for 0x80..0xFF
const CP1251_HIGH_TABLE = [
  0x0402, 0x0403, 0x201a, 0x0453, 0x201e, 0x2026, 0x2020, 0x2021,
  0x20ac, 0x2030, 0x0409, 0x2039, 0x040a, 0x040c, 0x040b, 0x040f,
  0x0452, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x0098, 0x2122, 0x0459, 0x203a, 0x045a, 0x045c, 0x045b, 0x045f,
  0x00a0, 0x040e, 0x045e, 0x0408, 0x00a4, 0x0490, 0x00a6, 0x00a7,
  0x0401, 0x00a9, 0x0404, 0x00ab, 0x00ac, 0x00ad, 0x00ae, 0x0407,
  0x00b0, 0x00b1, 0x0406, 0x0456, 0x0491, 0x00b5, 0x00b6, 0x00b7,
  0x0451, 0x2116, 0x0454, 0x00bb, 0x0458, 0x0405, 0x0455, 0x0457,
  0x0410, 0x0411, 0x0412, 0x0413, 0x0414, 0x0415, 0x0416, 0x0417,
  0x0418, 0x0419, 0x041a, 0x041b, 0x041c, 0x041d, 0x041e, 0x041f,
  0x0420, 0x0421, 0x0422, 0x0423, 0x0424, 0x0425, 0x0426, 0x0427,
  0x0428, 0x0429, 0x042a, 0x042b, 0x042c, 0x042d, 0x042e, 0x042f,
  0x0430, 0x0431, 0x0432, 0x0433, 0x0434, 0x0435, 0x0436, 0x0437,
  0x0438, 0x0439, 0x043a, 0x043b, 0x043c, 0x043d, 0x043e, 0x043f,
  0x0440, 0x0441, 0x0442, 0x0443, 0x0444, 0x0445, 0x0446, 0x0447,
  0x0448, 0x0449, 0x044a, 0x044b, 0x044c, 0x044d, 0x044e, 0x044f,
];

export function decodeWindows1251Bytes(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0) break;
    if (b < 0x80) {
      out += String.fromCharCode(b);
    } else {
      out += String.fromCharCode(CP1251_HIGH_TABLE[b - 0x80]);
    }
  }
  return out.trim();
}

/**
 * Checks whether a string looks like CP1251 Cyrillic mis-decoded as Latin-1
 * (e.g. "Ïðèâåò", "Ðàäèî") or garbled CJK/Halfwidth-Katakana bytes from wrong OEM codepage.
 */
export function hasGarbledMojibake(text: string): boolean {
  if (!text) return false;
  // Classic CP1251-as-Latin1 range: À-ÿ (U+00C0..U+00FF) appearing in dense runs without valid Latin/Lithuanian words
  let latin1HighCount = 0;
  let cjkCount = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x00c0 && code <= 0x00ff) {
      // Exclude valid Lithuanian letters (ąčęėįšųūž)
      const ch = text[i];
      if (!'ąčęėįšųūžĄČĘĖĮŠŲŪŽ'.includes(ch)) {
        latin1HighCount++;
      }
    } else if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xff65 && code <= 0xff9f) ||
      (code >= 0xac00 && code <= 0xd7af)
    ) {
      cjkCount++;
    }
  }
  if (latin1HighCount >= 3 && latin1HighCount / text.length > 0.35) {
    return true;
  }
  // If replacement char  appears or isolated garbled CJK mixed with Latin punctuation
  if (text.includes('\uFFFD')) return true;
  if (cjkCount >= 2 && /[а-яА-Яa-zA-Z]/.test(text)) return true;
  return false;
}

/**
 * Repairs CP1251 Cyrillic text that was misread as ISO-8859-1 / Latin-1,
 * or UTF-8 bytes misread as Latin-1.
 */
export function repairMojibakeText(input: string): string {
  if (!input) return '';
  const trimmed = input.replace(/\0+$/g, '').trim();
  if (!trimmed) return '';

  // Check if all characters fit in 0..255 and there's a high density of Latin-1 supplement chars
  let allByteRange = true;
  let highCount = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code > 0xff) {
      allByteRange = false;
      break;
    }
    if (code >= 0xc0 && code <= 0xff) {
      const ch = trimmed[i];
      if (!'ąčęėįšųūžĄČĘĖĮŠŲŪŽäöüßÄÖÜéèêëáàâíìîóòôúùûñç'.includes(ch)) {
        highCount++;
      }
    }
  }

  if (allByteRange && highCount >= 2) {
    const bytes = new Uint8Array(trimmed.length);
    for (let i = 0; i < trimmed.length; i++) {
      bytes[i] = trimmed.charCodeAt(i) & 0xff;
    }
    // Try UTF-8 first
    try {
      const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (utf8 && !utf8.includes('\uFFFD')) {
        return utf8;
      }
    } catch {
      // Not valid UTF-8, recover as Windows-1251 Cyrillic
    }
    const cp1251 = decodeWindows1251Bytes(bytes);
    if (/[А-Яа-яЁё]/.test(cp1251)) {
      return cp1251;
    }
  }

  return trimmed;
}

const LATIN_LETTERS = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const CYRILLIC_LETTERS = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЭЮЯ'.split('');

export function getAlphabetBucket(label: string): string {
  const clean = (label || '').trim();
  if (!clean) return '#';
  const firstRaw = clean[0];
  const upperRaw = firstRaw.toUpperCase();

  // Check Cyrillic range first
  if (upperRaw >= 'А' && upperRaw <= 'Я') {
    return upperRaw === 'Ё' ? 'Е' : upperRaw;
  }
  if (upperRaw === 'Ё') return 'Е';

  // Normalize Lithuanian / accented Latin letter to base A-Z
  const norm = normalizeForSearch(firstRaw).toUpperCase();
  if (norm && norm[0] >= 'A' && norm[0] <= 'Z') {
    return norm[0];
  }
  return '#';
}

const SCRIPT_INDEX_ORDER: string[] = [...LATIN_LETTERS, ...CYRILLIC_LETTERS];
const BUCKET_RANK_MAP = new Map<string, number>(
  SCRIPT_INDEX_ORDER.map((ch, index) => [ch, index])
);

export function extractAvailableLetters(labels: string[]): string[] {
  const present = new Set<string>();
  for (const label of labels) {
    if (!label) continue;
    present.add(getAlphabetBucket(label));
  }
  return [...present].sort(
    (a, b) => (BUCKET_RANK_MAP.get(a) ?? 999) - (BUCKET_RANK_MAP.get(b) ?? 999)
  );
}

export function compareLibraryLabels(a: string, b: string): number {
  const bucketA = getAlphabetBucket(a);
  const bucketB = getAlphabetBucket(b);
  const rankA = BUCKET_RANK_MAP.get(bucketA) ?? 999;
  const rankB = BUCKET_RANK_MAP.get(bucketB) ?? 999;
  if (rankA !== rankB) return rankA - rankB;

  const normA = normalizeForSearch(a);
  const normB = normalizeForSearch(b);
  if (normA !== normB) return normA.localeCompare(normB, 'en');
  return a.localeCompare(b);
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
