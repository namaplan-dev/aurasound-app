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
app.use(express.json({ limit: '28mb' }));

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

interface AiQuotaInfo {
  code: 'AI_QUOTA_EXHAUSTED';
  retryAfterSeconds: number;
  resetAtIso: string;
  quotaScope: 'minute' | 'daily';
  message: string;
}

let activeServerQuota: { resetAtMs: number; quotaScope: 'minute' | 'daily'; message: string } | null = null;

function getSecondsUntilPacificMidnight(): number {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(now);
    const num = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
    const h = num('hour') % 24;
    const m = num('minute');
    const s = num('second');
    const secondsElapsed = h * 3600 + m * 60 + s;
    return Math.max(60, 86400 - secondsElapsed);
  } catch {
    return 3600;
  }
}

function parseDurationToSeconds(raw: string): number | null {
  const text = String(raw || '').trim();
  if (!text) return null;

  let total = 0;
  let matched = false;
  const compound = text.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds|ms)/gi);
  for (const hit of compound) {
    matched = true;
    const val = Number(hit[1]);
    const unit = hit[2].toLowerCase();
    if (unit.startsWith('h')) total += val * 3600;
    else if (unit === 'ms') total += val / 1000;
    else if (unit.startsWith('m')) total += val * 60;
    else total += val;
  }
  if (matched && total > 0) return Math.ceil(total);
  return null;
}

function extractRetrySecondsFromError(err: unknown): number | null {
  const seen = new Set<unknown>();
  const scan = (node: unknown, depth = 0): number | null => {
    if (!node || depth > 5) return null;
    if (typeof node === 'string') {
      const retryFieldMatch = node.match(/"retryDelay"\s*:\s*"([^"]+)"/i);
      if (retryFieldMatch) {
        const parsed = parseDurationToSeconds(retryFieldMatch[1]);
        if (parsed) return parsed;
      }
      const phraseMatch = node.match(
        /retry\s*(?:in|after)\s*(\d+(?:\.\d+)?\s*(?:h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?|ms))/i
      );
      if (phraseMatch) {
        const parsed = parseDurationToSeconds(phraseMatch[1]);
        if (parsed) return parsed;
      }
      return null;
    }
    if (typeof node !== 'object' || seen.has(node)) return null;
    seen.add(node);
    const obj = node as Record<string, unknown>;
    if (typeof obj.retryDelay === 'string') {
      const parsed = parseDurationToSeconds(obj.retryDelay);
      if (parsed) return parsed;
    }
    for (const key of Object.keys(obj)) {
      const found = scan(obj[key], depth + 1);
      if (found) return found;
    }
    return null;
  };
  return scan(err);
}

function collectErrorText(err: unknown): string {
  const chunks: string[] = [];
  const seen = new Set<unknown>();
  const walk = (node: unknown, depth = 0) => {
    if (!node || depth > 4) return;
    if (typeof node === 'string') {
      chunks.push(node);
      return;
    }
    if (typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    const obj = node as Record<string, unknown>;
    for (const key of ['message', 'status', 'code', 'reason', 'error', 'details']) {
      if (obj[key] !== undefined) walk(obj[key], depth + 1);
    }
  };
  walk(err);
  return chunks.join(' ');
}

function formatRetryLabel(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function detectAiQuotaError(err: unknown): AiQuotaInfo | null {
  const errObj = (err && typeof err === 'object' ? err : {}) as {
    status?: number;
    statusCode?: number;
    code?: number | string;
    message?: string;
  };
  const numericStatus = Number(errObj.status ?? errObj.statusCode ?? errObj.code ?? 0);
  const combinedText = collectErrorText(err);

  const isQuotaError =
    numericStatus === 429 ||
    /\b429\b|RESOURCE_EXHAUSTED|quota\s*(exceeded|limit|exhausted)|rate[\s_-]*limit|too\s+many\s+requests|tokens?\s*per\s*(minute|day)|requests?\s*per\s*(minute|day)|out\s+of\s+tokens/i.test(
      combinedText
    );

  if (!isQuotaError) return null;

  const parsedSeconds = extractRetrySecondsFromError(err);
  const looksDaily =
    /per[\s_-]*day|daily|requests_per_day|tokens_per_day|\brpd\b|\btpd\b/i.test(combinedText) ||
    (parsedSeconds !== null && parsedSeconds >= 3600);

  const quotaScope: 'minute' | 'daily' = looksDaily ? 'daily' : 'minute';
  const retryAfterSeconds = Math.max(
    5,
    Math.min(
      86400,
      parsedSeconds ?? (quotaScope === 'daily' ? getSecondsUntilPacificMidnight() : 60)
    )
  );
  const resetAtMs = Date.now() + retryAfterSeconds * 1000;
  const resetAtIso = new Date(resetAtMs).toISOString();
  const waitLabel = formatRetryLabel(retryAfterSeconds);

  const message =
    quotaScope === 'daily'
      ? `AI daily token allowance was reached while processing large track batches. Tokens will restore in ~${waitLabel}.`
      : `AI temporarily ran out of tokens while analyzing these tracks. Tokens automatically refill in ~${waitLabel} — AI will be ready to resume shortly.`;

  activeServerQuota = { resetAtMs, quotaScope, message };

  return {
    code: 'AI_QUOTA_EXHAUSTED',
    retryAfterSeconds,
    resetAtIso,
    quotaScope,
    message,
  };
}

function getActiveServerQuotaInfo(): AiQuotaInfo | null {
  if (!activeServerQuota) return null;
  const remainingMs = activeServerQuota.resetAtMs - Date.now();
  if (remainingMs <= 0) {
    activeServerQuota = null;
    return null;
  }
  const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
  return {
    code: 'AI_QUOTA_EXHAUSTED',
    retryAfterSeconds,
    resetAtIso: new Date(activeServerQuota.resetAtMs).toISOString(),
    quotaScope: activeServerQuota.quotaScope,
    message: activeServerQuota.message,
  };
}

function sendAiEndpointError(res: Response, err: unknown, fallbackMessage: string) {
  const quota = detectAiQuotaError(err);
  if (quota) {
    res.setHeader('Retry-After', String(quota.retryAfterSeconds));
    res.status(429).json({
      error: quota.message,
      code: quota.code,
      retryAfterSeconds: quota.retryAfterSeconds,
      resetAtIso: quota.resetAtIso,
      quotaScope: quota.quotaScope,
    });
    return;
  }
  const status = (err as { statusCode?: number; status?: number })?.statusCode ||
    (err as { status?: number })?.status ||
    500;
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  const message = err instanceof Error ? err.message : fallbackMessage;
  res.status(safeStatus).json({ error: message });
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

app.get('/api/ai/status', (_req: Request, res: Response) => {
  const activeQuota = getActiveServerQuotaInfo();
  if (activeQuota) {
    res.json({ available: false, quota: activeQuota });
    return;
  }
  res.json({ available: true });
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
    const activeQuota = getActiveServerQuotaInfo();
    if (activeQuota) {
      res.setHeader('Retry-After', String(activeQuota.retryAfterSeconds));
      res.status(429).json({
        error: activeQuota.message,
        code: activeQuota.code,
        retryAfterSeconds: activeQuota.retryAfterSeconds,
        resetAtIso: activeQuota.resetAtIso,
        quotaScope: activeQuota.quotaScope,
      });
      return;
    }

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
    sendAiEndpointError(res, err, 'Failed to generate AI smart playlist.');
  }
});

app.post('/api/ai/daily-mix', async (req: Request, res: Response) => {
  try {
    const activeQuota = getActiveServerQuotaInfo();
    if (activeQuota) {
      res.setHeader('Retry-After', String(activeQuota.retryAfterSeconds));
      res.status(429).json({
        error: activeQuota.message,
        code: activeQuota.code,
        retryAfterSeconds: activeQuota.retryAfterSeconds,
        resetAtIso: activeQuota.resetAtIso,
        quotaScope: activeQuota.quotaScope,
      });
      return;
    }

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
    sendAiEndpointError(res, err, 'Failed to generate daily recommendations.');
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

async function lookupLyricsForTrack(
  artist: string,
  title: string,
  album: string,
  durationSec = 0
): Promise<{ lyrics: string; synced: boolean } | null> {
  const cleanArtist = isGenericArtist(artist) ? '' : artist.trim();
  const cleanAlbum = isGenericAlbum(album) ? '' : album.trim();
  const cleanTitle = title
    .replace(/^\d{1,3}[\s._-]+/, '')
    .replace(/\.(flac|alac|wav|wave|mp3|m4a|aac|ogg|opus)$/i, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/_/g, ' ')
    .trim();

  if (!cleanTitle || cleanTitle.length < 2) return null;

  const targetTitleNorm = normalizeToken(cleanTitle);
  const targetArtistNorm = normalizeToken(cleanArtist);

  const pickBest = (
    items: Array<{
      trackName?: string;
      artistName?: string;
      syncedLyrics?: string | null;
      plainLyrics?: string | null;
      instrumental?: boolean;
      duration?: number;
    }>
  ): { lyrics: string; synced: boolean } | null => {
    const scored = items
      .filter((it) => !it.instrumental && Boolean((it.syncedLyrics || it.plainLyrics || '').trim()))
      .map((it) => {
        const itTitle = normalizeToken(it.trackName || '');
        const itArtist = normalizeToken(it.artistName || '');
        const titleOk =
          Boolean(itTitle && targetTitleNorm) &&
          (itTitle === targetTitleNorm ||
            itTitle.includes(targetTitleNorm) ||
            targetTitleNorm.includes(itTitle));
        const artistOk =
          !targetArtistNorm ||
          (Boolean(itArtist) &&
            (itArtist === targetArtistNorm ||
              itArtist.includes(targetArtistNorm) ||
              targetArtistNorm.includes(itArtist)));
        if (!titleOk || !artistOk) return null;
        let score = it.syncedLyrics?.trim() ? 100 : 40;
        if (itTitle === targetTitleNorm) score += 20;
        if (targetArtistNorm && itArtist === targetArtistNorm) score += 20;
        if (durationSec > 0 && it.duration && Math.abs(it.duration - durationSec) <= 8) score += 10;
        return { it, score };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.score - a.score);

    const top = scored[0]?.it;
    if (!top) return null;
    const synced = (top.syncedLyrics || '').trim();
    if (synced) return { lyrics: synced, synced: true };
    const plain = (top.plainLyrics || '').trim();
    return plain ? { lyrics: plain, synced: false } : null;
  };

  try {
    if (cleanArtist) {
      const params = new URLSearchParams({
        artist_name: cleanArtist,
        track_name: cleanTitle,
      });
      if (cleanAlbum) params.set('album_name', cleanAlbum);
      if (durationSec > 5) params.set('duration', String(Math.round(durationSec)));
      const resp = await fetchWithTimeout(
        `https://lrclib.net/api/get?${params.toString()}`,
        { headers: { 'User-Agent': 'AuraSoundPlayer/1.5.3 (https://github.com/namaplan-dev/aurasound-app)' } },
        2800
      );
      if (resp.ok) {
        const data = (await resp.json()) as {
          trackName?: string;
          artistName?: string;
          syncedLyrics?: string | null;
          plainLyrics?: string | null;
          instrumental?: boolean;
          duration?: number;
        };
        const hit = pickBest([data]);
        if (hit) return hit;
      }
    }
  } catch {
    // Fall through to search endpoint
  }

  try {
    const searchParams = new URLSearchParams({ track_name: cleanTitle });
    if (cleanArtist) searchParams.set('artist_name', cleanArtist);
    const resp = await fetchWithTimeout(
      `https://lrclib.net/api/search?${searchParams.toString()}`,
      { headers: { 'User-Agent': 'AuraSoundPlayer/1.5.3 (https://github.com/namaplan-dev/aurasound-app)' } },
      2800
    );
    if (resp.ok) {
      const arr = (await resp.json()) as Array<{
        trackName?: string;
        artistName?: string;
        syncedLyrics?: string | null;
        plainLyrics?: string | null;
        instrumental?: boolean;
        duration?: number;
      }>;
      if (Array.isArray(arr) && arr.length > 0) {
        const hit = pickBest(arr);
        if (hit) return hit;
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
    const activeQuota = getActiveServerQuotaInfo();
    if (activeQuota) {
      res.setHeader('Retry-After', String(activeQuota.retryAfterSeconds));
      res.status(429).json({
        error: activeQuota.message,
        code: activeQuota.code,
        retryAfterSeconds: activeQuota.retryAfterSeconds,
        resetAtIso: activeQuota.resetAtIso,
        quotaScope: activeQuota.quotaScope,
      });
      return;
    }

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
      hasLyrics: Boolean(t.hasLyrics || (typeof t.lyrics === 'string' && t.lyrics.trim())),
    }));

    const aiPromptSubset = subset.map(({ hasLyrics: _hl, ...rest }) => rest);

    const response = await withAiTimeout(
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Analyze EVERY track below carefully. Fix ALL issues you find across title, artist, album, genre, and release year:
1. Missing/Generic Tags: Treat "Unknown Album", "Local Collection", "Unknown Artist", "Local Audio", "Audio", "Music", or empty year "" as MISSING tags. Identify the real song using title, artist, fileName, and duration, then insert the true official album title, artist name, genre, and 4-digit release year (YYYY).
2. Spelling & Formatting Fixes: Correct genuine misspellings or typos in song titles, artist names, and album names (e.g. "Quen" -> "Queen", "Bohemain Rhapsody" -> "Bohemian Rhapsody", "Biilie Jean" -> "Billie Jean"), repair mojibake, strip leading track numbers ("01 - ", "04."), file extensions (.mp3/.flac), bitrate tags ([FLAC], (320kbps)), underscores, and split swapped/combined "Artist - Title" filenames.
3. Language Integrity: Preserve original Lithuanian (ąčęėįšųūž), Russian Cyrillic, French, Spanish, etc. — fix typos/diacritics/encoding in the original language and NEVER translate non-English song titles into English.
4. Only omit a track if ALL 5 fields (title, artist, album, genre, year) are already accurate, spelled right, and complete.

Tracks:
${JSON.stringify(aiPromptSubset)}`,
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
        suggestedLyrics?: string;
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

    // Pass 2: Official catalog verification + Synced Karaoke LRC Lyrics lookup (LRCLIB + iTunes/MusicBrainz)
    await runWithConcurrency(subset, 6, async (orig) => {
      const existing = byId.get(orig.id);
      const queryArtist = existing?.suggestedArtist || orig.artist;
      const queryTitle = existing?.suggestedTitle || orig.title;
      const queryAlbum = existing?.suggestedAlbum || orig.album;

      const needsCatalog =
        isGenericAlbum(queryAlbum) ||
        !extractYear4(existing?.suggestedYear ?? orig.year) ||
        isGenericArtist(queryArtist);

      const [catalog, lyricsHit] = await Promise.all([
        needsCatalog ? lookupCatalogMetadataForTrack(queryArtist, queryTitle, queryAlbum) : Promise.resolve(null),
        !orig.hasLyrics
          ? lookupLyricsForTrack(queryArtist, queryTitle, queryAlbum, orig.duration)
          : Promise.resolve(null),
      ]);

      if (!catalog && !lyricsHit) return;

      const reasons: string[] = existing?.reason ? [existing.reason] : [];
      let nextTitle = existing?.suggestedTitle || orig.title;
      let nextArtist = existing?.suggestedArtist || orig.artist;
      let nextAlbum = existing?.suggestedAlbum || orig.album;
      let nextGenre = existing?.suggestedGenre || orig.genre;
      let nextYear = existing?.suggestedYear || extractYear4(orig.year);
      let nextLyrics = existing?.suggestedLyrics;

      const hasNonLatin = (v: string) => /[\u0400-\u04FF]/.test(v);
      if (catalog) {
        if (catalog.title && !hasNonLatin(nextTitle) && isGenericAlbum(nextTitle) === false) {
          if (normalizeToken(catalog.title) === normalizeToken(nextTitle) && catalog.title !== nextTitle && !hasNonLatin(catalog.title)) {
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
      }

      if (lyricsHit?.lyrics) {
        nextLyrics = lyricsHit.lyrics;
        reasons.push(lyricsHit.synced ? 'Added synced karaoke lyrics' : 'Added embedded lyrics');
      }

      byId.set(orig.id, {
        trackId: orig.id,
        suggestedTitle: nextTitle,
        suggestedArtist: nextArtist,
        suggestedAlbum: nextAlbum,
        suggestedGenre: nextGenre,
        suggestedYear: nextYear,
        ...(nextLyrics ? { suggestedLyrics: nextLyrics } : {}),
        reason: Array.from(new Set(reasons)).join(' · ') || 'Matched official release metadata',
      });
    });

    // Pass 3: For single-item / small batches still missing lyrics after LRCLIB, ask Gemini cleanly if confident
    const stillMissingLyrics = subset.filter(
      (orig) => !orig.hasLyrics && !byId.get(orig.id)?.suggestedLyrics
    );
    if (stillMissingLyrics.length > 0 && subset.length <= 4 && !getActiveServerQuotaInfo()) {
      try {
        const lyricsQuery = stillMissingLyrics.map((orig) => {
          const cur = byId.get(orig.id);
          return {
            trackId: orig.id,
            title: cur?.suggestedTitle || orig.title,
            artist: cur?.suggestedArtist || orig.artist,
            album: cur?.suggestedAlbum || orig.album,
            duration: orig.duration,
          };
        });
        const lyrResp = await withAiTimeout(
          ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: `Provide authentic song lyrics (or LRC [mm:ss.xx] lines if confident of timing) in the song's ORIGINAL language for these tracks if you genuinely know the lyrics. Leave lyrics empty "" for instrumental tracks or if unsure — never invent fake lyrics:\n${JSON.stringify(
              lyricsQuery
            )}`,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              systemInstruction:
                'Return accurate original-language song lyrics formatted line-by-line (or [mm:ss.xx] LRC lines if timing is certain). Return empty string "" if unknown or instrumental.',
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  items: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        trackId: { type: Type.STRING },
                        lyrics: { type: Type.STRING },
                      },
                      required: ['trackId', 'lyrics'],
                    },
                  },
                },
                required: ['items'],
              },
            },
          }),
          15000
        );
        const lyrParsed = JSON.parse((lyrResp.text ?? '{"items":[]}').trim()) as {
          items?: Array<{ trackId?: string; lyrics?: string }>;
        };
        for (const item of lyrParsed.items || []) {
          const id = String(item.trackId || '').trim();
          const cleanLyr = String(item.lyrics || '').trim();
          const orig = trackById.get(id);
          if (!orig || !cleanLyr || cleanLyr.length < 24) continue;
          const existing = byId.get(id);
          const reasons = existing?.reason ? [existing.reason, 'Added lyrics'] : ['Added lyrics'];
          byId.set(id, {
            trackId: id,
            suggestedTitle: existing?.suggestedTitle || orig.title,
            suggestedArtist: existing?.suggestedArtist || orig.artist,
            suggestedAlbum: existing?.suggestedAlbum || orig.album,
            suggestedGenre: existing?.suggestedGenre || orig.genre,
            suggestedYear: existing?.suggestedYear || extractYear4(orig.year),
            suggestedLyrics: cleanLyr,
            reason: Array.from(new Set(reasons)).join(' · '),
          });
        }
      } catch {
        // Optional AI lyrics enrichment must not fail main metadata cleanup response
      }
    }

    // Keep only suggestions that genuinely change at least one field or add missing lyrics
    const finalSuggestions = Array.from(byId.values()).filter((s) => {
      const orig = trackById.get(s.trackId);
      if (!orig) return false;
      const origYear = extractYear4(orig.year);
      const tagsChanged =
        s.suggestedTitle.trim() !== orig.title.trim() ||
        s.suggestedArtist.trim() !== orig.artist.trim() ||
        s.suggestedAlbum.trim() !== orig.album.trim() ||
        s.suggestedGenre.trim() !== orig.genre.trim() ||
        (Boolean(s.suggestedYear) && s.suggestedYear !== origYear);
      const lyricsAdded = !orig.hasLyrics && Boolean(s.suggestedLyrics?.trim());
      return tagsChanged || lyricsAdded;
    });

    res.json({ suggestions: finalSuggestions });
  } catch (err) {
    sendAiEndpointError(res, err, 'Failed to analyze track tags.');
  }
});

app.post('/api/ai/lyrics', async (req: Request, res: Response) => {
  try {
    const { title = '', artist = '', album = '', duration = 0 } = req.body || {};
    const cleanTitle = String(title || '').trim();
    const cleanArtist = String(artist || '').trim();
    const cleanAlbum = String(album || '').trim();
    const dur = Number(duration || 0);

    if (!cleanTitle) {
      res.status(400).json({ error: 'Track title is required.' });
      return;
    }

    // 1. Instant zero-token synced LRC lookup via LRCLIB
    const lrclibHit = await lookupLyricsForTrack(cleanArtist, cleanTitle, cleanAlbum, dur);
    if (lrclibHit?.lyrics) {
      res.json({
        lyrics: lrclibHit.lyrics,
        synced: lrclibHit.synced,
        source: 'Synced Lyrics Catalog',
      });
      return;
    }

    // 2. Fallback to Gemini if LRCLIB had no match
    const activeQuota = getActiveServerQuotaInfo();
    if (activeQuota) {
      res.setHeader('Retry-After', String(activeQuota.retryAfterSeconds));
      res.status(429).json({
        error: activeQuota.message,
        code: activeQuota.code,
        retryAfterSeconds: activeQuota.retryAfterSeconds,
        resetAtIso: activeQuota.resetAtIso,
        quotaScope: activeQuota.quotaScope,
      });
      return;
    }

    const ai = getAiClient();
    const resp = await withAiTimeout(
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Find accurate original-language lyrics for: Title="${cleanTitle}", Artist="${cleanArtist}", Album="${cleanAlbum}", Duration=${dur}s. Use [mm:ss.xx] LRC timestamps if certain of timing, otherwise clean line-by-line verses. Return empty string "" if purely instrumental or unknown.`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction:
            'Return authentic song lyrics in the original language. Never translate or invent fake lyrics; return "" when unknown or instrumental.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              lyrics: { type: Type.STRING },
            },
            required: ['lyrics'],
          },
        },
      })
    );

    const parsed = JSON.parse((resp.text ?? '{"lyrics":""}').trim()) as { lyrics?: string };
    const cleanLyrics = String(parsed.lyrics || '').trim();
    res.json({
      lyrics: cleanLyrics,
      synced: /\[\d{1,2}:\d{2}/.test(cleanLyrics),
      source: 'AI Lyrics Search',
    });
  } catch (err) {
    sendAiEndpointError(res, err, 'Unable to look up lyrics.');
  }
});

app.post('/api/ai/transcribe', async (req: Request, res: Response) => {
  try {
    const activeQuota = getActiveServerQuotaInfo();
    if (activeQuota) {
      res.setHeader('Retry-After', String(activeQuota.retryAfterSeconds));
      res.status(429).json({
        error: activeQuota.message,
        code: activeQuota.code,
        retryAfterSeconds: activeQuota.retryAfterSeconds,
        resetAtIso: activeQuota.resetAtIso,
        quotaScope: activeQuota.quotaScope,
      });
      return;
    }

    const {
      audioBase64 = '',
      mimeType = 'audio/mp3',
      fileName = '',
      folderPath = '',
      durationSec = 0,
    } = req.body || {};

    const cleanB64 = String(audioBase64 || '').replace(/^data:[^;]+;base64,/i, '').trim();
    if (!cleanB64) {
      res.status(400).json({ error: 'Audio data is required for transcription.' });
      return;
    }

    const cleanMime = String(mimeType || 'audio/mp3').trim() || 'audio/mp3';
    const cleanFileName = String(fileName || '').trim();
    const cleanFolder = String(folderPath || '').trim();
    const dur = Math.max(0, Number(durationSec || 0));

    const ai = getAiClient();
    const transcribePrompt = [
      'Transcribe all spoken speech accurately in its original language(s).',
      'If this is a phone call or multi-speaker conversation, label speaker turns cleanly on separate lines (e.g., "Speaker 1:", "Speaker 2:").',
      'Include clear paragraph breaks and preserve exact names, phone numbers, dates, and amounts mentioned.',
      'Do not summarize or translate — output the verbatim transcript text only.',
    ].join(' ');

    const transcriptResp = await withAiTimeout(
      ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: cleanMime,
                data: cleanB64,
              },
            },
            {
              text: transcribePrompt,
            },
          ],
        },
      }),
      90000
    );

    const transcript = (transcriptResp.text ?? '').trim();

    let recordingCategory: 'phone-call' | 'voice-memo' | 'cam-audio' | 'meeting' | 'voice-note' =
      'voice-memo';
    let suggestedTitle = '';
    let participants: string[] = [];
    let summary = '';
    let tags: string[] = [];

    // Lightweight metadata classification + tags extraction (graceful fallback if skipped/limited)
    try {
      const classifyResp = await withAiTimeout(
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Analyze this audio recording transcript and file metadata to classify and tag it.
File Name: "${cleanFileName}"
Folder Path: "${cleanFolder}"
Duration: ${dur}s
Transcript excerpt:
"""
${transcript.slice(0, 6000)}
"""`,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            systemInstruction:
              'Classify the recording accurately into one category: "phone-call" (call recording / two-way telephone conversation / ACR / incoming/outgoing), "cam-audio" (camera / video / camcorder audio / DCIM), "meeting" (multi-person discussion/interview), "voice-note" (short reminder/dictation under ~60s), or "voice-memo" (longer personal monologue/voice recording). Extract concise topic tags, spoken participants/caller names if clear, a short descriptive title in the original language, and a 1-2 sentence summary.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                recordingCategory: { type: Type.STRING },
                suggestedTitle: { type: Type.STRING },
                participants: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                summary: { type: Type.STRING },
                tags: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: ['recordingCategory', 'suggestedTitle', 'participants', 'summary', 'tags'],
            },
          },
        }),
        25000
      );

      const parsed = JSON.parse((classifyResp.text ?? '{}').trim()) as {
        recordingCategory?: string;
        suggestedTitle?: string;
        participants?: string[];
        summary?: string;
        tags?: string[];
      };

      const rawCat = String(parsed.recordingCategory || '').toLowerCase().trim();
      if (
        rawCat === 'phone-call' ||
        rawCat === 'voice-memo' ||
        rawCat === 'cam-audio' ||
        rawCat === 'meeting' ||
        rawCat === 'voice-note'
      ) {
        recordingCategory = rawCat;
      }
      suggestedTitle = String(parsed.suggestedTitle || '').trim();
      participants = Array.isArray(parsed.participants)
        ? parsed.participants.map((p) => String(p).trim()).filter(Boolean).slice(0, 6)
        : [];
      summary = String(parsed.summary || '').trim();
      tags = Array.isArray(parsed.tags)
        ? parsed.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8)
        : [];
    } catch {
      // Secondary tag enrichment is optional; return full transcript regardless
    }

    res.json({
      transcript,
      recordingCategory,
      suggestedTitle,
      participants,
      summary,
      tags,
    });
  } catch (err) {
    sendAiEndpointError(res, err, 'Failed to transcribe recording.');
  }
});

app.post('/api/ai/duplicate-scan', async (req: Request, res: Response) => {
  try {
    const activeQuota = getActiveServerQuotaInfo();
    if (activeQuota) {
      res.setHeader('Retry-After', String(activeQuota.retryAfterSeconds));
      res.status(429).json({
        error: activeQuota.message,
        code: activeQuota.code,
        retryAfterSeconds: activeQuota.retryAfterSeconds,
        resetAtIso: activeQuota.resetAtIso,
        quotaScope: activeQuota.quotaScope,
      });
      return;
    }

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
    sendAiEndpointError(res, err, 'Failed to scan duplicates with AI.');
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

    let quotaNotice: AiQuotaInfo | null = getActiveServerQuotaInfo();
    if (!quotaNotice) {
      try {
        const ai = getAiClient();
        const response = await withAiTimeout(
          ai.models.generateContent({
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
          })
        );
        const parsed = JSON.parse((response.text ?? '{"queries":[]}').trim()) as {
          queries?: Array<{ trackId: string; artist: string; album: string; title: string }>;
        };
        if (Array.isArray(parsed.queries) && parsed.queries.length > 0) {
          normalizedQueries = parsed.queries;
        }
      } catch (aiErr) {
        quotaNotice = detectAiQuotaError(aiErr);
        // Proceed with direct metadata catalog lookup even if AI normalization hits quota
      }
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

    res.json({ results, ...(quotaNotice ? { aiQuota: quotaNotice } : {}) });
  } catch (err) {
    sendAiEndpointError(res, err, 'Failed to look up original album art.');
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
