import React, { useState } from 'react';
import { User } from 'firebase/auth';
import {
  Check,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Shuffle,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import {
  DailyRecommendation,
  SmartPlaylist,
  SmartRule,
  TagCleanupSuggestion,
  Track,
} from '../types/music';
import { evaluateSmartPlaylist } from '../services/smartPlaylistEngine';
import { tactile } from '../services/tactileFeedback';

type StudioSection = 'all' | 'mixes' | 'playlists' | 'tags';

interface SmartStudioViewProps {
  user: User | null;
  tracks: Track[];
  smartPlaylists: SmartPlaylist[];
  dailyRecommendations: DailyRecommendation[];
  onSignInGoogle: () => void;
  onPlayTracks: (tracks: Track[], random?: boolean) => void;
  onAddSmartPlaylist: (pl: SmartPlaylist) => void;
  onDeleteSmartPlaylist: (id: string) => void;
  onUpdateDailyRecommendations: (recs: DailyRecommendation[]) => void;
  onApplyTagCleanups: (suggestions: TagCleanupSuggestion[]) => void;
}

const STUDIO_SECTIONS: Array<{ id: StudioSection; label: string }> = [
  { id: 'all', label: 'All Studio' },
  { id: 'mixes', label: 'Daily Mixes' },
  { id: 'playlists', label: 'Smart Playlists' },
  { id: 'tags', label: 'Tag Cleanup' },
];

export const SmartStudioView: React.FC<SmartStudioViewProps> = ({
  user,
  tracks,
  smartPlaylists,
  dailyRecommendations,
  onSignInGoogle,
  onPlayTracks,
  onAddSmartPlaylist,
  onDeleteSmartPlaylist,
  onUpdateDailyRecommendations,
  onApplyTagCleanups,
}) => {
  const [section, setSection] = useState<StudioSection>('all');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [dailyLoading, setDailyLoading] = useState(false);

  // Manual rule-based smart playlist state (always works without login)
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualGenre, setManualGenre] = useState('');
  const [manualFormat, setManualFormat] = useState('');
  const [manualMinRating, setManualMinRating] = useState(0);
  const [manualFavOnly, setManualFavOnly] = useState(false);

  // AI Tag Cleanup state
  const [tagLoading, setTagLoading] = useState(false);
  const [tagSuggestions, setTagSuggestions] = useState<TagCleanupSuggestion[]>([]);
  const [tagStatus, setTagStatus] = useState<string | null>(null);

  const handleGenerateAiPlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      onSignInGoogle();
      return;
    }
    const clean = aiPrompt.trim();
    if (!clean) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const recent = [...tracks]
        .sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0))
        .slice(0, 15)
        .map((t) => ({ title: t.title, artist: t.artist, genre: t.genre, playCount: t.playCount }));

      const resp = await fetch('/api/ai/smart-playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: clean,
          tracks,
          listeningHistory: recent,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'AI generation failed.');

      const rules: SmartRule[] = Array.isArray(data.rules)
        ? data.rules.map((r: { field: SmartRule['field']; value: string }) => ({
            field: r.field,
            value:
              r.field === 'minRating' || r.field === 'minPlayCount' || r.field === 'minSampleRate'
                ? Number(r.value) || 0
                : r.field === 'favorite'
                ? r.value === 'true'
                : String(r.value),
          }))
        : [];

      const created: SmartPlaylist = {
        id: `smart_ai_${Date.now().toString(36)}`,
        name: data.name || clean.slice(0, 36),
        description: data.description || 'AI-curated smart playlist.',
        mood: data.mood || 'Curated',
        rules,
        pinnedTrackIds: Array.isArray(data.matchedTrackIds) ? data.matchedTrackIds : [],
        isAiGenerated: true,
        dynamicUpdate: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      onAddSmartPlaylist(created);
      tactile.success();
      setAiPrompt('');
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Unable to generate smart playlist.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleRefreshDailyMixes = async () => {
    if (!user) {
      onSignInGoogle();
      return;
    }
    setDailyLoading(true);
    setAiError(null);
    try {
      const genreCounts = new Map<string, number>();
      const artistCounts = new Map<string, number>();
      tracks.forEach((t) => {
        genreCounts.set(t.genre, (genreCounts.get(t.genre) || 0) + t.playCount + 1);
        if (t.favorite || t.rating >= 4) {
          artistCounts.set(t.artist, (artistCounts.get(t.artist) || 0) + 1);
        }
      });
      const topGenres = [...genreCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([g]) => g);
      const favoriteArtists = [...artistCounts.keys()].slice(0, 6);

      const resp = await fetch('/api/ai/daily-mix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks, topGenres, favoriteArtists }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to refresh daily mixes.');

      const mixes: DailyRecommendation[] = (data.mixes || []).map(
        (m: Omit<DailyRecommendation, 'id' | 'generatedAt'>, idx: number) => ({
          ...m,
          id: `daily_${Date.now()}_${idx}`,
          generatedAt: Date.now(),
        })
      );
      if (mixes.length > 0) {
        onUpdateDailyRecommendations(mixes);
        tactile.success();
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Daily mix refresh failed.');
    } finally {
      setDailyLoading(false);
    }
  };

  const handleCreateManualSmartPlaylist = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = manualName.trim();
    if (!cleanName) return;
    const rules: SmartRule[] = [];
    if (manualGenre.trim()) rules.push({ field: 'genre', value: manualGenre.trim() });
    if (manualFormat) rules.push({ field: 'format', value: manualFormat });
    if (manualMinRating > 0) rules.push({ field: 'minRating', value: manualMinRating });
    if (manualFavOnly) rules.push({ field: 'favorite', value: true });

    onAddSmartPlaylist({
      id: `smart_rule_${Date.now().toString(36)}`,
      name: cleanName,
      description: 'Dynamic rule-based smart playlist.',
      mood: manualGenre.trim() || 'Custom Rules',
      rules,
      isAiGenerated: false,
      dynamicUpdate: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    tactile.success();
    setManualName('');
    setManualGenre('');
    setManualFormat('');
    setManualMinRating(0);
    setManualFavOnly(false);
    setShowManualForm(false);
  };

  const handleScanTagsWithAi = async () => {
    if (!user) {
      onSignInGoogle();
      return;
    }
    setTagLoading(true);
    setTagStatus(null);
    setAiError(null);
    try {
      const resp = await fetch('/api/ai/tag-cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Tag scan failed.');

      const trackMap = new Map(tracks.map((t) => [t.id, t]));
      const mapped: TagCleanupSuggestion[] = (data.suggestions || [])
        .map((s: Record<string, string>) => {
          const orig = trackMap.get(s.trackId);
          if (!orig) return null;
          return {
            trackId: s.trackId,
            currentTitle: orig.title,
            currentArtist: orig.artist,
            currentAlbum: orig.album,
            currentGenre: orig.genre,
            suggestedTitle: s.suggestedTitle || orig.title,
            suggestedArtist: s.suggestedArtist || orig.artist,
            suggestedAlbum: s.suggestedAlbum || orig.album,
            suggestedGenre: s.suggestedGenre || orig.genre,
            reason: s.reason || 'Normalized metadata',
            selected: true,
          };
        })
        .filter((item: TagCleanupSuggestion | null): item is TagCleanupSuggestion => item !== null);

      setTagSuggestions(mapped);
      if (mapped.length === 0) {
        setTagStatus('All scanned tracks already have clean metadata tags.');
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Unable to scan library tags.');
    } finally {
      setTagLoading(false);
    }
  };

  const showMixes = section === 'all' || section === 'mixes';
  const showPlaylists = section === 'all' || section === 'playlists';
  const showTags = section === 'all' || section === 'tags';

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header + Segmented Section Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-4">
        <div>
          <h2 className="text-xl font-display font-semibold text-zinc-900 dark:text-zinc-100">
            Smart Studio
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Daily personalized mixes, dynamic smart playlists, and library tag cleanup.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center p-1 rounded-lg bg-zinc-200/70 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-x-auto max-w-full">
            {STUDIO_SECTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  tactile.tap();
                  setSection(item.id);
                }}
                className={`min-h-[34px] px-3 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                  section === item.id
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {!user && (
            <button
              type="button"
              onClick={onSignInGoogle}
              className="min-h-[40px] px-4 rounded-lg accent-bg text-xs font-medium whitespace-nowrap active:scale-95 transition-transform duration-100"
            >
              Sign in with Gmail
            </button>
          )}
        </div>
      </div>

      {aiError && (
        <div className="p-3.5 rounded-xl border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-300">
          {aiError}
        </div>
      )}

      {/* 1. Personalized Daily Recommendations */}
      {showMixes && (
        <section className="space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-display font-semibold text-zinc-900 dark:text-zinc-100">
              Daily Mixes
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={tracks.length === 0}
                onClick={() => onPlayTracks(tracks, false)}
                className="min-h-[38px] px-3 rounded-lg accent-bg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap active:scale-95 transition-transform duration-100 disabled:opacity-40"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Play All</span>
              </button>
              <button
                type="button"
                disabled={tracks.length === 0}
                onClick={() => onPlayTracks(tracks, true)}
                className="min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap active:scale-95 transition-transform duration-100 disabled:opacity-40"
              >
                <Shuffle className="w-3.5 h-3.5" />
                <span>Play All Random</span>
              </button>
              <button
                type="button"
                onClick={handleRefreshDailyMixes}
                disabled={dailyLoading}
                className="min-h-[38px] px-3.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-xs font-medium flex items-center gap-2 whitespace-nowrap active:scale-95 transition-transform duration-100 disabled:opacity-50"
              >
                {dailyLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                <span>{user ? 'Refresh Mixes' : 'Sign in to Refresh'}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {dailyRecommendations.map((rec) => {
              const trackSet = new Set(rec.matchedTrackIds);
              const matched = tracks.filter(
                (t) =>
                  trackSet.has(t.id) ||
                  rec.suggestedSearchTerms.some((term) =>
                    t.genre.toLowerCase().includes(term.toLowerCase())
                  )
              );
              return (
                <div
                  key={rec.id}
                  className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-4 flex flex-col justify-between gap-4"
                >
                  <div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                      {rec.mood} · {rec.genre} ·{' '}
                      <span className="font-mono-tabular">{matched.length} tracks</span>
                    </div>
                    <h4 className="mt-1 text-base font-display font-semibold text-zinc-900 dark:text-zinc-100">
                      {rec.title}
                    </h4>
                    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{rec.subtitle}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={matched.length === 0}
                      onClick={() => onPlayTracks(matched, false)}
                      className="flex-1 min-h-[40px] px-3 rounded-lg accent-bg text-xs font-medium flex items-center justify-center gap-1.5 active:scale-95 transition-transform duration-100 disabled:opacity-40"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Play All</span>
                    </button>
                    <button
                      type="button"
                      disabled={matched.length === 0}
                      onClick={() => onPlayTracks(matched, true)}
                      aria-label={`Shuffle ${rec.title}`}
                      title="Play Random"
                      className="min-w-[40px] min-h-[40px] rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center active:scale-95 transition-transform duration-100 disabled:opacity-40"
                    >
                      <Shuffle className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 2. Smart Playlist Generator + Dynamic Smart Playlists */}
      {showPlaylists && (
        <section className="space-y-4">
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-display font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 accent-text" />
                  <span>Create Smart Playlist</span>
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {user
                    ? `Describe a mood or sound profile for ${user.email}, or define dynamic rules.`
                    : 'Rule-based playlists work offline anytime; sign in with Gmail for AI prompts.'}
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  tactile.tap();
                  setShowManualForm((v) => !v);
                }}
                className="min-h-[40px] px-3.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-xs font-medium flex items-center gap-1.5 active:scale-95 transition-transform duration-100"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{showManualForm ? 'Hide Rule Builder' : 'Rule Builder'}</span>
              </button>
            </div>

            <form onSubmit={handleGenerateAiPlaylist} className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="text"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="e.g. Rainy evening Lithuanian & Nordic ambient in lossless FLAC..."
                className="flex-1 min-h-[44px] px-3.5 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm focus:outline-none"
              />
              <button
                type="submit"
                disabled={aiLoading}
                className="min-h-[44px] px-5 rounded-lg accent-bg text-sm font-medium flex items-center justify-center gap-2 whitespace-nowrap active:scale-95 transition-transform duration-100 disabled:opacity-50"
              >
                {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                <span>{user ? 'Generate Mix' : 'Sign in & Generate'}</span>
              </button>
            </form>

            {showManualForm && (
              <form
                onSubmit={handleCreateManualSmartPlaylist}
                className="pt-4 border-t border-zinc-200 dark:border-zinc-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
              >
                <input
                  type="text"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder="Playlist Name"
                  required
                  className="min-h-[42px] px-3 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
                />
                <input
                  type="text"
                  value={manualGenre}
                  onChange={(e) => setManualGenre(e.target.value)}
                  placeholder="Genre filter (optional)"
                  className="min-h-[42px] px-3 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
                />
                <select
                  value={manualFormat}
                  onChange={(e) => setManualFormat(e.target.value)}
                  className="min-h-[42px] px-3 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
                >
                  <option value="">Any Format</option>
                  <option value="FLAC">FLAC Only</option>
                  <option value="ALAC">ALAC Only</option>
                  <option value="WAV">WAV Only</option>
                  <option value="MP3">MP3 Only</option>
                </select>
                <div className="flex items-center gap-2">
                  <select
                    value={manualMinRating}
                    onChange={(e) => setManualMinRating(Number(e.target.value))}
                    className="flex-1 min-h-[42px] px-3 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
                  >
                    <option value={0}>Any Rating</option>
                    <option value={3}>3★ & up</option>
                    <option value={4}>4★ & up</option>
                    <option value={5}>5★ Only</option>
                  </select>
                  <button
                    type="submit"
                    className="min-h-[42px] px-4 rounded-lg accent-bg text-sm font-medium whitespace-nowrap active:scale-95 transition-transform duration-100"
                  >
                    Create
                  </button>
                </div>
                <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400 sm:col-span-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={manualFavOnly}
                    onChange={(e) => {
                      tactile.toggle(e.target.checked);
                      setManualFavOnly(e.target.checked);
                    }}
                    className="w-4 h-4 accent-amber-500"
                  />
                  <span>Favorites only (updates dynamically)</span>
                </label>
              </form>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-base font-display font-semibold text-zinc-900 dark:text-zinc-100">
              Active Smart Playlists
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {smartPlaylists.map((sp) => {
                const matched = evaluateSmartPlaylist(tracks, sp);
                return (
                  <div
                    key={sp.id}
                    className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-4 flex items-start justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        {sp.isAiGenerated ? 'AI Curated' : 'Rule Engine'} · {sp.mood} ·{' '}
                        <span className="font-mono-tabular">{matched.length} tracks</span>
                      </div>
                      <h4 className="mt-1 text-base font-display font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                        {sp.name}
                      </h4>
                      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2">
                        {sp.description}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={matched.length === 0}
                        onClick={() => onPlayTracks(matched, false)}
                        className="min-w-[40px] min-h-[40px] rounded-lg accent-bg flex items-center justify-center active:scale-95 transition-transform duration-100 disabled:opacity-40"
                        aria-label={`Play all in ${sp.name}`}
                        title="Play All"
                      >
                        <Play className="w-4 h-4 fill-current" />
                      </button>
                      <button
                        type="button"
                        disabled={matched.length === 0}
                        onClick={() => onPlayTracks(matched, true)}
                        className="min-w-[40px] min-h-[40px] rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center active:scale-95 transition-transform duration-100 disabled:opacity-40"
                        aria-label={`Play random in ${sp.name}`}
                        title="Play All Random"
                      >
                        <Shuffle className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          tactile.tap();
                          onDeleteSmartPlaylist(sp.id);
                        }}
                        aria-label={`Delete ${sp.name}`}
                        className="min-w-[40px] min-h-[40px] rounded-lg border border-zinc-200 dark:border-zinc-800 flex items-center justify-center text-zinc-500 hover:text-red-500 active:scale-95 transition-all duration-100"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* 3. AI Tag Cleanup Section — strictly ONE green Apply Changes button */}
      {showTags && (
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-display font-semibold text-zinc-900 dark:text-zinc-100">
                AI Metadata & Tag Cleanup
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Clean messy filenames and normalize artist, album, and genre tags while preserving Lithuanian & Cyrillic scripts.
              </p>
            </div>
            <button
              type="button"
              onClick={handleScanTagsWithAi}
              disabled={tagLoading}
              className="min-h-[42px] px-4 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-sm font-medium flex items-center gap-2 whitespace-nowrap active:scale-95 transition-transform duration-100 disabled:opacity-50"
            >
              {tagLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              <span>{user ? 'Scan Library Tags' : 'Sign in to Scan Tags'}</span>
            </button>
          </div>

          {tagStatus && <p className="text-sm text-zinc-600 dark:text-zinc-400">{tagStatus}</p>}

          {tagSuggestions.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-zinc-200 dark:border-zinc-800">
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {tagSuggestions.map((s) => (
                  <label
                    key={s.trackId}
                    className="flex items-start gap-3 py-3 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/60 rounded-lg px-2"
                  >
                    <input
                      type="checkbox"
                      checked={s.selected}
                      onChange={() => {
                        tactile.toggle(!s.selected);
                        setTagSuggestions((prev) =>
                          prev.map((item) =>
                            item.trackId === s.trackId ? { ...item, selected: !item.selected } : item
                          )
                        );
                      }}
                      className="mt-1 w-4 h-4 accent-amber-500"
                    />
                    <div className="min-w-0 flex-1 text-xs space-y-1">
                      <div className="text-zinc-500 line-through truncate">
                        {s.currentArtist} — {s.currentTitle} ({s.currentAlbum})
                      </div>
                      <div className="text-zinc-900 dark:text-zinc-100 font-medium truncate">
                        {s.suggestedArtist} — {s.suggestedTitle} ({s.suggestedAlbum} · {s.suggestedGenre})
                      </div>
                      <div className="text-zinc-500">{s.reason}</div>
                    </div>
                  </label>
                ))}
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    const chosen = tagSuggestions.filter((s) => s.selected);
                    if (chosen.length > 0) {
                      tactile.success();
                      onApplyTagCleanups(chosen);
                      setTagSuggestions([]);
                      setTagStatus(`Updated ${chosen.length} track(s).`);
                    }
                  }}
                  className="min-h-[44px] px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium flex items-center gap-2 active:scale-95 transition-transform duration-100"
                >
                  <Check className="w-4 h-4" />
                  <span>Apply Changes</span>
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
};
