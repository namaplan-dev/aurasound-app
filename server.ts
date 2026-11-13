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
