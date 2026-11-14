import 'dotenv/config';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '2mb' }));

// Allow native Capacitor WebView (https://localhost / capacitor://localhost) to call /api/*
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

const PORT = Number(process.env.PORT) || 3000;

interface NativeAuthSession {
  secret: string;
  status: 'pending' | 'ready' | 'error';
  idToken?: string;
  accessToken?: string;
  email?: string;
  error?: string;
  createdAt: number;
}

const nativeAuthSessions = new Map<string, NativeAuthSession>();

function pruneNativeAuthSessions() {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [k, v] of nativeAuthSessions.entries()) {
    if (v.createdAt < cutoff) nativeAuthSessions.delete(k);
  }
}

function loadFirebaseClientConfig(): Record<string, string> {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'firebase-applet-config.json'), 'utf8');
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 25000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function withAiTimeout<T>(promise: Promise<T>, timeoutMs = 25000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error('AI metadata service timed out. Please retry with a smaller batch.');
          (err as Error & { statusCode?: number }).statusCode = 504;
          reject(err);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------- Health ----------
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'aurasound' });
});

// ---------- Native Android Google OAuth Chrome Bridge ----------
app.post('/api/auth/native-session', (_req: Request, res: Response) => {
  pruneNativeAuthSessions();
  const sessionId = crypto.randomBytes(16).toString('hex');
  const secret = crypto.randomBytes(24).toString('hex');
  nativeAuthSessions.set(sessionId, {
    secret,
    status: 'pending',
    createdAt: Date.now(),
  });
  res.json({ sessionId, secret });
});

app.post('/api/auth/native-complete', (req: Request, res: Response) => {
  const { sessionId, secret, idToken, accessToken, email, error } = req.body || {};
  const entry = typeof sessionId === 'string' ? nativeAuthSessions.get(sessionId) : undefined;
  if (!entry || entry.secret !== secret) {
    res.status(404).json({ error: 'Invalid or expired sign-in session.' });
    return;
  }
  if (error) {
    entry.status = 'error';
    entry.error = String(error);
  } else if (idToken || accessToken) {
    entry.status = 'ready';
    entry.idToken = typeof idToken === 'string' ? idToken : undefined;
    entry.accessToken = typeof accessToken === 'string' ? accessToken : undefined;
    entry.email = typeof email === 'string' ? email : undefined;
  } else {
    entry.status = 'error';
    entry.error = 'No Google credential returned.';
  }
  res.json({ ok: true });
});

app.get('/api/auth/native-poll', (req: Request, res: Response) => {
  pruneNativeAuthSessions();
  const sessionId = typeof req.query.session === 'string' ? req.query.session : '';
  const secret = typeof req.query.secret === 'string' ? req.query.secret : '';
  const entry = nativeAuthSessions.get(sessionId);
  if (!entry || entry.secret !== secret) {
    res.status(404).json({ status: 'expired', error: 'Sign-in session expired.' });
    return;
  }
  if (entry.status === 'pending') {
    res.json({ status: 'pending' });
    return;
  }
  const payload = {
    status: entry.status,
    idToken: entry.idToken,
    accessToken: entry.accessToken,
    email: entry.email,
    error: entry.error,
  };
  nativeAuthSessions.delete(sessionId);
  res.json(payload);
});

app.get('/api/auth/bridge', (req: Request, res: Response) => {
  const sessionId = typeof req.query.session === 'string' ? req.query.session : '';
  const secret = typeof req.query.secret === 'string' ? req.query.secret : '';
  const fb = loadFirebaseClientConfig();
  const firebaseWebConfig = {
    apiKey: fb.apiKey || '',
    authDomain: fb.authDomain || '',
    projectId: fb.projectId || '',
    appId: fb.appId || '',
  };

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AuraSound — Sign in with Gmail</title>
  <style>
    body { margin:0; font-family: system-ui, -apple-system, sans-serif; background:#09090b; color:#f4f4f5; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
    .card { width:100%; max-width:380px; background:#18181b; border:1px solid #27272a; border-radius:16px; padding:24px; text-align:center; box-shadow:0 20px 50px rgba(0,0,0,0.45); }
    h1 { margin:0 0 8px; font-size:20px; }
    p { margin:0 0 20px; font-size:13px; color:#a1a1aa; line-height:1.45; }
    button { width:100%; min-height:44px; border:none; border-radius:10px; background:#d97706; color:#fff; font-weight:600; font-size:14px; cursor:pointer; }
    button:disabled { opacity:0.55; cursor:default; }
    .err { margin-top:14px; padding:10px 12px; border-radius:10px; background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.35); color:#fca5a5; font-size:12px; display:none; word-break:break-word; }
    .ok { margin-top:14px; padding:10px 12px; border-radius:10px; background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.35); color:#6ee7b7; font-size:12px; display:none; }
    a.back { display:none; margin-top:14px; color:#fbbf24; font-size:13px; font-weight:600; text-decoration:none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>AuraSound Cloud Sync</h1>
    <p id="subtitle">Connect your Gmail account in Chrome and return automatically to AuraSound.</p>
    <button id="btn">Continue with Gmail</button>
    <div id="ok" class="ok"></div>
    <div id="err" class="err"></div>
    <a id="backLink" class="back" href="aurasound://auth?session=${encodeURIComponent(sessionId)}">Return to AuraSound</a>
  </div>
  <script type="module">
    import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
    import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';

    const sessionId = ${JSON.stringify(sessionId)};
    const secret = ${JSON.stringify(secret)};
    const config = ${JSON.stringify(firebaseWebConfig)};
    const btn = document.getElementById('btn');
    const errEl = document.getElementById('err');
    const okEl = document.getElementById('ok');
    const backLink = document.getElementById('backLink');

    const app = initializeApp(config);
    const auth = getAuth(app);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    function showError(msg) {
      errEl.style.display = 'block';
      errEl.textContent = msg;
      btn.disabled = false;
      btn.textContent = 'Try Again with Gmail';
    }

    async function finalizeResult(result) {
      const cred = GoogleAuthProvider.credentialFromResult(result);
      const idToken = cred?.idToken || '';
      const accessToken = cred?.accessToken || '';
      if (!idToken && !accessToken) {
        throw new Error('Google sign-in returned no OAuth token.');
      }
      const resp = await fetch('/api/auth/native-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          secret,
          idToken,
          accessToken,
          email: result.user?.email || '',
        }),
      });
      if (!resp.ok) {
        throw new Error('Unable to hand off session to AuraSound.');
      }
      okEl.style.display = 'block';
      okEl.textContent = 'Signed in as ' + (result.user?.email || 'Gmail user') + '. Returning to AuraSound...';
      btn.style.display = 'none';
      backLink.style.display = 'inline-block';
      const deepUrl = 'aurasound://auth?session=' + encodeURIComponent(sessionId);
      backLink.href = deepUrl;
      window.location.href = deepUrl;
    }

    try {
      const redirectRes = await getRedirectResult(auth);
      if (redirectRes) {
        btn.disabled = true;
        btn.textContent = 'Connecting...';
        await finalizeResult(redirectRes);
      }
    } catch (e) {
      showError(e?.message || 'Redirect sign-in failed.');
    }

    btn.addEventListener('click', async () => {
      errEl.style.display = 'none';
      btn.disabled = true;
      btn.textContent = 'Opening Gmail...';
      try {
        const result = await signInWithPopup(auth, provider);
        await finalizeResult(result);
      } catch (e) {
        const code = e?.code || '';
        if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
          await signInWithRedirect(auth, provider);
          return;
        }
        showError(e?.message || 'Google sign-in failed.');
      }
    });
  </script>
</body>
</html>`);
});

// ---------- Gemini AI Smart Studio Endpoints ----------
app.post('/api/ai/smart-playlist', async (req: Request, res: Response) => {
  try {
    const { prompt, tracks = [], listeningHistory = [] } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      res.status(400).json({ error: 'Prompt is required.' });
      return;
    }

    const ai = getAiClient();
    const compactCatalog = Array.isArray(tracks)
      ? tracks.slice(0, 120).map((t: Record<string, unknown>) => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          album: t.album,
          genre: t.genre,
          format: t.format,
          rating: t.rating,
          playCount: t.playCount,
        }))
      : [];

    const response = await withAiTimeout(
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [
          `User prompt: "${prompt}"`,
          `Recent listening history: ${JSON.stringify(listeningHistory.slice(0, 20))}`,
          `Available library catalog: ${JSON.stringify(compactCatalog)}`,
        ].join('\n\n'),
        config: {
          systemInstruction:
            'You are an audiophile music curator for AuraSound. Create a cohesive smart playlist matching the user mood, genre, or acoustic request. Only reference track IDs that exist in the provided library catalog for matchedTrackIds, and provide clean dynamic rules.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING, description: 'Concise evocative playlist title.' },
              description: { type: Type.STRING, description: '1-2 sentence audiophile curation note.' },
              mood: { type: Type.STRING, description: 'Primary mood label (e.g. Late Night Analog, Focus).' },
              genre: { type: Type.STRING, description: 'Primary genre focus.' },
              matchedTrackIds: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Track IDs from the provided catalog that best fit this playlist.',
              },
              rules: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    field: {
                      type: Type.STRING,
                      description: 'One of: genre, format, minRating, favorite, minPlayCount, moodKeyword',
                    },
                    value: { type: Type.STRING, description: 'Filter value as string.' },
                  },
                },
              },
            },
            required: ['name', 'description', 'mood', 'genre', 'matchedTrackIds', 'rules'],
          },
        },
      })
    );

    const parsed = JSON.parse((response.text ?? '{}').trim());
    res.json(parsed);
  } catch (err) {
    const status = (err as { statusCode?: number })?.statusCode || 500;
    const message = err instanceof Error ? err.message : 'Failed to generate AI smart playlist.';
    res.status(status).json({ error: message });
  }
});

app.post('/api/ai/daily-mix', async (req: Request, res: Response) => {
  try {
    const { tracks = [], topGenres = [], favoriteArtists = [] } = req.body || {};
    const ai = getAiClient();

    const compactCatalog = Array.isArray(tracks)
      ? tracks.slice(0, 120).map((t: Record<string, unknown>) => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          genre: t.genre,
          format: t.format,
          rating: t.rating,
          playCount: t.playCount,
        }))
      : [];

    const response = await withAiTimeout(
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [
          `Favorite artists: ${JSON.stringify(favoriteArtists)}`,
          `Top genres: ${JSON.stringify(topGenres)}`,
          `Library catalog: ${JSON.stringify(compactCatalog)}`,
        ].join('\n\n'),
        config: {
          systemInstruction:
            'Generate 3 distinct personalized daily music mixes tailored to the listener profile and catalog. Use only valid track IDs from the catalog in matchedTrackIds.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              mixes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    subtitle: { type: Type.STRING },
                    mood: { type: Type.STRING },
                    genre: { type: Type.STRING },
                    suggestedSearchTerms: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    matchedTrackIds: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                  },
                  required: ['title', 'subtitle', 'mood', 'genre', 'suggestedSearchTerms', 'matchedTrackIds'],
                },
              },
            },
            required: ['mixes'],
          },
        },
      })
    );

    const parsed = JSON.parse((response.text ?? '{"mixes":[]}').trim());
    res.json(parsed);
  } catch (err) {
    const status = (err as { statusCode?: number })?.statusCode || 500;
    const message = err instanceof Error ? err.message : 'Failed to generate daily recommendations.';
    res.status(status).json({ error: message });
  }
});

const GENERIC_ALBUM_VALUES = new Set([
  '',
  'unknown album',
  'unknown',
  'local collection',
  'local audio',
  'music',
  'downloads',
  'download',
  'audio',
  'various',
  'none',
  'n/a',
]);

const GENERIC_ARTIST_VALUES = new Set([
  '',
  'unknown artist',
  'unknown',
  'various artists',
  'artist',
  'audio',
  'n/a',
]);

function isGenericAlbum(val: unknown): boolean {
  return GENERIC_ALBUM_VALUES.has(String(val || '').trim().toLowerCase());
}

function isGenericArtist(val: unknown): boolean {
  return GENERIC_ARTIST_VALUES.has(String(val || '').trim().toLowerCase());
}

function normalizeToken(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractYear4(raw: unknown): string {
  const m = String(raw || '').match(/\b(19\d{2}|20\d{2})\b/);
  return m ? m[1] : '';
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 3200): Promise<globalThis.Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function lookupCatalogMetadataForTrack(
  artist: string,
  title: string,
  album: string
): Promise<{
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  genre?: string;
} | null> {
  const cleanArtist = isGenericArtist(artist) ? '' : artist.trim();
  const cleanAlbum = isGenericAlbum(album) ? '' : album.trim();
  const cleanTitle = title
    .replace(/^\d{1,3}[\s._-]+/, '')
    .replace(/\.(flac|alac|wav|wave|mp3|m4a|aac|ogg|opus)$/i, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/_/g, ' ')
    .trim();

  const searchTerm = [cleanArtist, cleanTitle, cleanAlbum].filter(Boolean).join(' ').trim();
  if (!searchTerm || searchTerm.length < 3) return null;

  const targetTitleNorm = normalizeToken(cleanTitle);
  const targetArtistNorm = normalizeToken(cleanArtist);

  // 1. Fast iTunes Song Lookup (official release album, year, genre, verified spelling)
  try {
    const itUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&entity=song&limit=4`;
    const resp = await fetchWithTimeout(itUrl, {}, 3000);
    if (resp.ok) {
      const json = (await resp.json()) as {
        results?: Array<{
          trackName?: string;
          artistName?: string;
          collectionName?: string;
          releaseDate?: string;
          primaryGenreName?: string;
        }>;
      };
      for (const r of json.results || []) {
        const rTitle = normalizeToken(r.trackName || '');
        const rArtist = normalizeToken(r.artistName || '');
        const titleMatch =
          Boolean(rTitle && targetTitleNorm) &&
          (rTitle.includes(targetTitleNorm) || targetTitleNorm.includes(rTitle));
        const artistMatch =
          !targetArtistNorm ||
          (Boolean(rArtist) && (rArtist.includes(targetArtistNorm) || targetArtistNorm.includes(rArtist)));
        if (titleMatch && artistMatch && r.collectionName) {
          return {
            title: r.trackName?.trim(),
            artist: r.artistName?.trim(),
            album: r.collectionName.trim(),
            year: extractYear4(r.releaseDate),
            genre: r.primaryGenreName?.trim(),
          };
        }
      }
    }
  } catch {
    // Fall through to MusicBrainz
  }

  // 2. MusicBrainz Recording Lookup fallback (strong for European, Baltic, Cyrillic, & indie albums)
  try {
    const queryParts: string[] = [];
    if (cleanTitle) queryParts.push(`recording:"${cleanTitle.replace(/"/g, '')}"`);
    if (cleanArtist) queryParts.push(`artist:"${cleanArtist.replace(/"/g, '')}"`);
    if (queryParts.length > 0) {
      const mbUrl = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(
        queryParts.join(' AND ')
      )}&fmt=json&limit=3`;
      const mbResp = await fetchWithTimeout(
        mbUrl,
        { headers: { 'User-Agent': 'AuraSoundPlayer/1.5.3 (https://github.com/namaplan-dev/aurasound-app)' } },
        3200
      );
      if (mbResp.ok) {
        const mbJson = (await mbResp.json()) as {
          recordings?: Array<{
            title?: string;
            score?: number;
            'first-release-date'?: string;
            'artist-credit'?: Array<{ name?: string }>;
            releases?: Array<{ title?: string; date?: string }>;
          }>;
        };
        const best = (mbJson.recordings || []).find((rec) => (rec.score || 0) >= 82 && rec.releases?.length);
        if (best) {
          const rel = best.releases?.find((r) => Boolean(r.title)) || best.releases?.[0];
          const relYear = extractYear4(rel?.date || best['first-release-date']);
          const relArtist = best['artist-credit']?.map((a) => a.name).filter(Boolean).join(', ');
          if (rel?.title || relYear) {
            return {
              title: best.title?.trim(),
              artist: relArtist?.trim(),
              album: rel?.title?.trim(),
              year: relYear,
            };
          }
        }
      }
    }
  } catch {
    // Best-effort lookup only
  }

  return null;
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let idx = 0;
  const runners = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    while (idx < items.length) {
      const currentIdx = idx++;
      await worker(items[currentIdx]);
    }
  });
  await Promise.all(runners);
}

app.post('/api/ai/tag-cleanup', async (req: Request, res: Response) => {
  try {
    const { tracks = [] } = req.body || {};
    if (!Array.isArray(tracks) || tracks.length === 0) {
      res.json({ suggestions: [] });
      return;
    }

    const ai = getAiClient();
    const subset = tracks.slice(0, 50).map((t: Record<string, unknown>) => ({
      id: String(t.id || ''),
      title: String(t.title || ''),
      artist: String(t.artist || ''),
      album: String(t.album || ''),
      genre: String(t.genre || ''),
      year: String(t.year || ''),
      fileName: String(t.fileName || ''),
      duration: Number(t.duration || 0),
    }));

    const response = await withAiTimeout(
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Analyze EVERY track below carefully. Fix ALL issues you find across title, artist, album, genre, and release year:
1. Missing/Generic Tags: Treat "Unknown Album", "Local Collection", "Unknown Artist", "Local Audio", "Audio", "Music", or empty year "" as MISSING tags. Identify the real song using title, artist, fileName, and duration, then insert the true official album title, artist name, genre, and 4-digit release year (YYYY).
2. Spelling & Formatting Fixes: Correct genuine misspellings or typos in song titles, artist names, and album names (e.g. "Quen" -> "Queen", "Bohemain Rhapsody" -> "Bohemian Rhapsody", "Biilie Jean" -> "Billie Jean"), repair mojibake, strip leading track numbers ("01 - ", "04."), file extensions (.mp3/.flac), bitrate tags ([FLAC], (320kbps)), underscores, and split swapped/combined "Artist - Title" filenames.
3. Language Integrity: Preserve original Lithuanian (ąčęėįšųūž), Russian Cyrillic, French, Spanish, etc. — fix typos/diacritics/encoding in the original language and NEVER translate non-English song titles into English.
4. Only omit a track if ALL 5 fields (title, artist, album, genre, year) are already accurate, spelled right, and complete.

Tracks:
${JSON.stringify(subset)}`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction:
            'You are a precision music discography & ID3 metadata archivist. Return suggestions with accurate suggestedTitle, suggestedArtist, suggestedAlbum, suggestedGenre, suggestedYear (4 digits YYYY if known, else ""), and concise reason. Never output placeholders like "Unknown Album" or "Local Collection" if you can identify the real album or single release.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              suggestions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    trackId: { type: Type.STRING },
                    suggestedTitle: { type: Type.STRING },
                    suggestedArtist: { type: Type.STRING },
                    suggestedAlbum: { type: Type.STRING },
                    suggestedGenre: { type: Type.STRING },
                    suggestedYear: { type: Type.STRING },
                    reason: { type: Type.STRING },
                  },
                  required: [
                    'trackId',
                    'suggestedTitle',
                    'suggestedArtist',
                    'suggestedAlbum',
                    'suggestedGenre',
                    'suggestedYear',
                    'reason',
                  ],
                },
              },
            },
            required: ['suggestions'],
          },
        },
      })
    );

    const parsed = JSON.parse((response.text ?? '{"suggestions":[]}').trim()) as {
      suggestions?: Array<{
        trackId?: string;
        suggestedTitle?: string;
        suggestedArtist?: string;
        suggestedAlbum?: string;
        suggestedGenre?: string;
        suggestedYear?: string;
        reason?: string;
      }>;
    };

    const trackById = new Map(subset.map((t) => [t.id, t]));
    const byId = new Map<
      string,
      {
        trackId: string;
        suggestedTitle: string;
        suggestedArtist: string;
        suggestedAlbum: string;
        suggestedGenre: string;
        suggestedYear: string;
        reason: string;
      }
    >();

    for (const s of parsed.suggestions || []) {
      const id = String(s.trackId || '').trim();
      const orig = trackById.get(id);
      if (!orig) continue;
      byId.set(id, {
        trackId: id,
        suggestedTitle: String(s.suggestedTitle || orig.title).trim() || orig.title,
        suggestedArtist: String(s.suggestedArtist || orig.artist).trim() || orig.artist,
        suggestedAlbum: String(s.suggestedAlbum || orig.album).trim() || orig.album,
        suggestedGenre: String(s.suggestedGenre || orig.genre).trim() || orig.genre,
        suggestedYear: extractYear4(s.suggestedYear) || extractYear4(orig.year),
        reason: String(s.reason || 'AI metadata & spelling correction').trim(),
      });
    }

    // Pass 2: Official catalog verification (iTunes / MusicBrainz) for any tracks still missing real album or release year
    const tracksNeedingCatalog = subset.filter((t) => {
      const candidate = byId.get(t.id);
      const curAlbum = candidate?.suggestedAlbum ?? t.album;
      const curYear = candidate?.suggestedYear ?? extractYear4(t.year);
      const curArtist = candidate?.suggestedArtist ?? t.artist;
      return isGenericAlbum(curAlbum) || !curYear || isGenericArtist(curArtist);
    });

    await runWithConcurrency(tracksNeedingCatalog, 6, async (orig) => {
      const existing = byId.get(orig.id);
      const queryArtist = existing?.suggestedArtist || orig.artist;
      const queryTitle = existing?.suggestedTitle || orig.title;
      const queryAlbum = existing?.suggestedAlbum || orig.album;
      const catalog = await lookupCatalogMetadataForTrack(queryArtist, queryTitle, queryAlbum);
      if (!catalog) return;

      const reasons: string[] = existing?.reason ? [existing.reason] : [];
      let nextTitle = existing?.suggestedTitle || orig.title;
      let nextArtist = existing?.suggestedArtist || orig.artist;
      let nextAlbum = existing?.suggestedAlbum || orig.album;
      let nextGenre = existing?.suggestedGenre || orig.genre;
      let nextYear = existing?.suggestedYear || extractYear4(orig.year);

      // Only replace title/artist from catalog if original/AI contains Cyrillic/Lithuanian? Never clobber Cyrillic with Latin transliteration
      const hasNonLatin = (v: string) => /[\u0400-\u04FF]/.test(v);
      if (catalog.title && !hasNonLatin(nextTitle) && isGenericAlbum(nextTitle) === false) {
        if (normalizeToken(catalog.title) !== normalizeToken(nextTitle) && nextTitle.length > 0) {
          // Keep AI-verified clean title unless original was messy
        } else if (catalog.title !== nextTitle && !hasNonLatin(catalog.title)) {
          nextTitle = catalog.title;
        }
      }
      if (catalog.artist && (isGenericArtist(nextArtist) || (!hasNonLatin(nextArtist) && normalizeToken(catalog.artist) === normalizeToken(nextArtist)))) {
        nextArtist = catalog.artist;
      }
      if (catalog.album && isGenericAlbum(nextAlbum)) {
        nextAlbum = catalog.album;
        reasons.push('Matched album');
      }
      if (catalog.year && !nextYear) {
        nextYear = catalog.year;
        reasons.push('Added release year');
      }
      if (catalog.genre && (!nextGenre || nextGenre === 'Audio' || nextGenre === 'Unknown')) {
        nextGenre = catalog.genre;
      }

      byId.set(orig.id, {
        trackId: orig.id,
        suggestedTitle: nextTitle,
        suggestedArtist: nextArtist,
        suggestedAlbum: nextAlbum,
        suggestedGenre: nextGenre,
        suggestedYear: nextYear,
        reason: Array.from(new Set(reasons)).join(' · ') || 'Matched official release metadata',
      });
    });

    // Keep only suggestions that genuinely change at least one field
    const finalSuggestions = Array.from(byId.values()).filter((s) => {
      const orig = trackById.get(s.trackId);
      if (!orig) return false;
      const origYear = extractYear4(orig.year);
      return (
        s.suggestedTitle.trim() !== orig.title.trim() ||
        s.suggestedArtist.trim() !== orig.artist.trim() ||
        s.suggestedAlbum.trim() !== orig.album.trim() ||
        s.suggestedGenre.trim() !== orig.genre.trim() ||
        (Boolean(s.suggestedYear) && s.suggestedYear !== origYear)
      );
    });

    res.json({ suggestions: finalSuggestions });
  } catch (err) {
    const status = (err as { statusCode?: number })?.statusCode || 500;
    const message = err instanceof Error ? err.message : 'Failed to analyze track tags.';
    res.status(status).json({ error: message });
  }
});

app.post('/api/ai/duplicate-scan', async (req: Request, res: Response) => {
  try {
    const { tracks = [] } = req.body || {};
    if (!Array.isArray(tracks) || tracks.length < 2) {
      res.json({ groups: [] });
      return;
    }

    const ai = getAiClient();
    const compact = tracks.slice(0, 80).map((t: Record<string, unknown>) => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      album: t.album,
      year: t.year,
      duration: t.duration,
      format: t.format,
      bitDepth: t.bitDepth,
      sampleRate: t.sampleRate,
      bitrateKbps: t.bitrateKbps,
      fileName: t.fileName,
    }));

    const response = await withAiTimeout(
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Find duplicate or near-duplicate songs in this music catalog (including same song in different formats like FLAC vs MP3, remasters, punctuation differences, or artist/title swaps). For each duplicate group, pick keepTrackId as the highest audio quality lossless/highest bitrate track:\n${JSON.stringify(
          compact
        )}`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction:
            'Only group tracks that are genuinely the same musical recording/song. Preserve Lithuanian and Cyrillic scripts. Put ALL track IDs of the duplicate group in trackIds, and specify keepTrackId as the single best copy to retain.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              groups: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    keepTrackId: { type: Type.STRING },
                    trackIds: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    reason: { type: Type.STRING },
                    similarityScore: { type: Type.NUMBER },
                  },
                  required: ['keepTrackId', 'trackIds', 'reason', 'similarityScore'],
                },
              },
            },
            required: ['groups'],
          },
        },
      })
    );

    const parsed = JSON.parse((response.text ?? '{"groups":[]}').trim());
    res.json(parsed);
  } catch (err) {
    const status = (err as { statusCode?: number })?.statusCode || 500;
    const message = err instanceof Error ? err.message : 'Failed to scan duplicates with AI.';
    res.status(status).json({ error: message });
  }
});

async function fetchOriginalCoverForQuery(
  artist: string,
  album: string,
  title: string
): Promise<{ coverUrl: string; sourceLabel: string } | null> {
  const cleanArtist = artist && artist !== 'Unknown Artist' ? artist : '';
  const cleanAlbum =
    album && album !== 'Local Collection' && album !== 'Unknown Album' ? album : '';

  // 1. Try MusicBrainz + Cover Art Archive
  try {
    const parts: string[] = [];
    if (cleanAlbum) parts.push(`release:"${cleanAlbum}"`);
    else if (title) parts.push(`release:"${title}"`);
    if (cleanArtist) parts.push(`artist:"${cleanArtist}"`);

    if (parts.length > 0) {
      const mbUrl = `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(
        parts.join(' AND ')
      )}&fmt=json&limit=3`;
      const mbResp = await fetch(mbUrl, {
        headers: { 'User-Agent': 'AuraSoundPlayer/1.4.0 (https://github.com/namaplan-dev/aurasound-app)' },
      });
      if (mbResp.ok) {
        const mbJson = (await mbResp.json()) as {
          releases?: Array<{ id?: string; title?: string }>;
        };
        for (const rel of mbJson.releases || []) {
          if (!rel.id) continue;
          const caaCheck = await fetch(`https://coverartarchive.org/release/${rel.id}`, {
            headers: { 'User-Agent': 'AuraSoundPlayer/1.4.0' },
          });
          if (caaCheck.ok) {
            const caaData = (await caaCheck.json()) as {
              images?: Array<{ front?: boolean; image?: string; thumbnails?: Record<string, string> }>;
            };
            const front =
              caaData.images?.find((img) => img.front) || caaData.images?.[0];
            const bestUrl =
              front?.thumbnails?.['500'] ||
              front?.thumbnails?.large ||
              front?.image;
            if (bestUrl) {
              return {
                coverUrl: bestUrl.replace(/^http:\/\//, 'https://'),
                sourceLabel: 'Cover Art Archive · Original Release',
              };
            }
          }
        }
      }
    }
  } catch {
    // Fall through to iTunes official artwork lookup
  }

  // 2. Fallback: iTunes Search API (official album art)
  try {
    const term = [cleanArtist, cleanAlbum || title].filter(Boolean).join(' ').trim();
    if (!term) return null;
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(
      term
    )}&entity=album&limit=3`;
    const itResp = await fetch(itunesUrl);
    if (itResp.ok) {
      const itJson = (await itResp.json()) as {
        results?: Array<{ artworkUrl100?: string; collectionName?: string; artistName?: string }>;
      };
      const first = itJson.results?.find((r) => Boolean(r.artworkUrl100));
      if (first?.artworkUrl100) {
        return {
          coverUrl: first.artworkUrl100.replace('100x100bb', '600x600bb'),
          sourceLabel: 'Official Release Catalog',
        };
      }
    }
  } catch {
    // Ignore
  }

  return null;
}

app.post('/api/ai/album-art', async (req: Request, res: Response) => {
  try {
    const { tracks = [] } = req.body || {};
    if (!Array.isArray(tracks) || tracks.length === 0) {
      res.json({ results: [] });
      return;
    }

    const subset = tracks.slice(0, 12).map((t: Record<string, unknown>) => ({
      id: String(t.id || ''),
      title: String(t.title || ''),
      artist: String(t.artist || ''),
      album: String(t.album || ''),
      fileName: String(t.fileName || ''),
    }));

    let normalizedQueries: Array<{
      trackId: string;
      artist: string;
      album: string;
      title: string;
    }> = subset.map((t) => ({
      trackId: t.id,
      artist: t.artist,
      album: t.album,
      title: t.title,
    }));

    try {
      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Normalize these tracks into clean official Artist, Album/Release, and Song Title strings for original album cover art lookup (strip bitrates, track numbers, brackets like [FLAC], (Remastered), file extensions):\n${JSON.stringify(
          subset
        )}`,
        config: {
          systemInstruction:
            'Extract clean canonical artist, album, and song title without translating non-English titles.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              queries: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    trackId: { type: Type.STRING },
                    artist: { type: Type.STRING },
                    album: { type: Type.STRING },
                    title: { type: Type.STRING },
                  },
                  required: ['trackId', 'artist', 'album', 'title'],
                },
              },
            },
            required: ['queries'],
          },
        },
      });
      const parsed = JSON.parse((response.text ?? '{"queries":[]}').trim()) as {
        queries?: Array<{ trackId: string; artist: string; album: string; title: string }>;
      };
      if (Array.isArray(parsed.queries) && parsed.queries.length > 0) {
        normalizedQueries = parsed.queries;
      }
    } catch {
      // Proceed with direct metadata if AI normalization fails
    }

    const results: Array<{
      trackId: string;
      artist: string;
      album: string;
      title: string;
      coverUrl: string;
      sourceLabel: string;
    }> = [];

    for (const q of normalizedQueries) {
      const found = await fetchOriginalCoverForQuery(q.artist, q.album, q.title);
      if (found) {
        results.push({
          trackId: q.trackId,
          artist: q.artist,
          album: q.album,
          title: q.title,
          coverUrl: found.coverUrl,
          sourceLabel: found.sourceLabel,
        });
      }
    }

    res.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to look up original album art.';
    res.status(500).json({ error: message });
  }
});

// ---------- Vite / Static Serving ----------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(
      express.static(distDir, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.webmanifest')) {
            res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
          } else if (filePath.endsWith('sw.js')) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AuraSound server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
