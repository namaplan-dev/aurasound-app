import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = Number(process.env.PORT) || 3000;

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// ---------- Health ----------
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'aurasound' });
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

    const response = await ai.models.generateContent({
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
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    res.json(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate AI smart playlist.';
    res.status(500).json({ error: message });
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

    const response = await ai.models.generateContent({
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
    });

    const parsed = JSON.parse((response.text ?? '{"mixes":[]}').trim());
    res.json(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate daily recommendations.';
    res.status(500).json({ error: message });
  }
});

app.post('/api/ai/tag-cleanup', async (req: Request, res: Response) => {
  try {
    const { tracks = [] } = req.body || {};
    if (!Array.isArray(tracks) || tracks.length === 0) {
      res.json({ suggestions: [] });
      return;
    }

    const ai = getAiClient();
    const subset = tracks.slice(0, 40).map((t: Record<string, unknown>) => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      album: t.album,
      genre: t.genre,
      fileName: t.fileName,
    }));

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Inspect these audio track tags and filenames. Clean up track numbers, underscores, file extensions, missing artist/title splits, or misencoded characters while preserving original Lithuanian or Cyrillic titles accurately:\n${JSON.stringify(
        subset
      )}`,
      config: {
        systemInstruction:
          'Return only tracks where metadata can be meaningfully improved. Keep original language (Lithuanian, Russian Cyrillic, English, etc.) intact without translating.',
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
                  reason: { type: Type.STRING },
                },
                required: [
                  'trackId',
                  'suggestedTitle',
                  'suggestedArtist',
                  'suggestedAlbum',
                  'suggestedGenre',
                  'reason',
                ],
              },
            },
          },
          required: ['suggestions'],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{"suggestions":[]}').trim());
    res.json(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to analyze track tags.';
    res.status(500).json({ error: message });
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
      duration: t.duration,
      format: t.format,
      bitDepth: t.bitDepth,
      sampleRate: t.sampleRate,
      bitrateKbps: t.bitrateKbps,
      fileName: t.fileName,
    }));

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Find duplicate or near-duplicate songs in this music catalog (including same song in different formats like FLAC vs MP3, remasters, punctuation differences, or artist/title swaps). For each duplicate group, pick keepTrackId as the highest audio quality lossless/highest bitrate track:\n${JSON.stringify(
        compact
      )}`,
      config: {
        systemInstruction:
          'Only group tracks that are genuinely the same musical recording/song. Preserve Lithuanian and Cyrillic scripts. Always set keepTrackId to one of the IDs in duplicateTrackIds or exclude it cleanly: put ALL track IDs of the duplicate group in trackIds, and specify keepTrackId as the single best copy to retain.',
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
    });

    const parsed = JSON.parse((response.text ?? '{"groups":[]}').trim());
    res.json(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to scan duplicates with AI.';
    res.status(500).json({ error: message });
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
