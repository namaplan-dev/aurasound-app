import React, { useRef, useState } from 'react';
import { User } from 'firebase/auth';
import {
  Check,
  CopyCheck,
  ImagePlus,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Shuffle,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import {
  AppTaskCategory,
  ArtworkSuggestion,
  DailyRecommendation,
  DuplicateGroup,
  SmartPlaylist,
  SmartRule,
  TagCleanupSuggestion,
  Track,
} from '../types/music';
import { evaluateSmartPlaylist } from '../services/smartPlaylistEngine';
import {
  resizeArtworkFileToDataUrl,
  resolveApiUrl,
  runBatchedTagCleanupScan,
  runDuplicateScan,
  runOriginalAlbumArtScan,
} from '../services/aiAssistantService';
import { tactile } from '../services/tactileFeedback';
import { ProgressBar } from './ProgressBar';
import { CoverArt } from './CoverArt';

type StudioSection = 'all' | 'mixes' | 'playlists' | 'tags' | 'duplicates' | 'artwork';

interface InlineProgress {
  label: string;
  detail: string;
  current: number;
  total: number;
  percent: number;
  status: 'running' | 'done' | 'error';
}

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
  onRemoveDuplicateTracks: (trackIds: string[]) => void;
  onApplyArtworkUpdates: (updates: Array<{ trackId: string; coverUrl: string }>) => void;
  onTaskProgress: (
    id: string,
    category: AppTaskCategory,
    title: string,
    detail: string,
    current: number,
    total: number,
    status?: 'running' | 'done' | 'error'
  ) => void;
}

const STUDIO_SECTIONS: Array<{ id: StudioSection; label: string }> = [
  { id: 'all', label: 'All Studio' },
  { id: 'mixes', label: 'Daily Mixes' },
  { id: 'playlists', label: 'Smart Playlists' },
  { id: 'tags', label: 'Tag Cleanup' },
  { id: 'duplicates', label: 'Duplicates' },
  { id: 'artwork', label: 'Album Art' },
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
  onRemoveDuplicateTracks,
  onApplyArtworkUpdates,
  onTaskProgress,
}) => {
  const [section, setSection] = useState<StudioSection>('all');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [playlistProgress, setPlaylistProgress] = useState<InlineProgress | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyProgress, setDailyProgress] = useState<InlineProgress | null>(null);

  // Manual rule-based smart playlist state
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualGenre, setManualGenre] = useState('');
  const [manualFormat, setManualFormat] = useState('');
  const [manualMinRating, setManualMinRating] = useState(0);
  const [manualFavOnly, setManualFavOnly] = useState(false);

  // AI Tag Cleanup state
  const [tagLoading, setTagLoading] = useState(false);
  const [tagProgress, setTagProgress] = useState<InlineProgress | null>(null);
  const [tagSuggestions, setTagSuggestions] = useState<TagCleanupSuggestion[]>([]);
  const [tagStatus, setTagStatus] = useState<string | null>(null);

  // AI Duplicate Scanner state
  const [dupLoading, setDupLoading] = useState(false);
  const [dupProgress, setDupProgress] = useState<InlineProgress | null>(null);
  const [dupGroups, setDupGroups] = useState<DuplicateGroup[]>([]);
  const [dupStatus, setDupStatus] = useState<string | null>(null);

  // AI Original Album Art Finder & Manual Uploader state
  const [artLoading, setArtLoading] = useState(false);
  const [artProgress, setArtProgress] = useState<InlineProgress | null>(null);
  const [artSuggestions, setArtSuggestions] = useState<ArtworkSuggestion[]>([]);
  const [artStatus, setArtStatus] = useState<string | null>(null);
  const [uploadTargetTrackId, setUploadTargetTrackId] = useState<string | null>(null);
  const artFileInputRef = useRef<HTMLInputElement | null>(null);

  const report = (
    setter: React.Dispatch<React.SetStateAction<InlineProgress | null>>,
    taskId: string,
    category: AppTaskCategory,
    label: string,
    detail: string,
    current: number,
    total: number,
    status: 'running' | 'done' | 'error' = 'running'
  ) => {
    const pct = total > 0 ? Math.round((current / total) * 100) : status === 'done' ? 100 : 0;
    setter({ label, detail, current, total, percent: pct, status });
    onTaskProgress(taskId, category, label, detail, current, total, status);
  };

  const handleGenerateAiPlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = aiPrompt.trim();
    if (!clean) return;
    const taskId = `ai_pl_${Date.now()}`;
    setAiLoading(true);
    setAiError(null);
    report(
      setPlaylistProgress,
      taskId,
      'ai-playlist',
      'AI Smart Playlist',
      'Collecting listening history & library profile...',
      1,
      3
    );

    try {
      const recent = [...tracks]
        .sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0))
        .slice(0, 15)
        .map((t) => ({ title: t.title, artist: t.artist, genre: t.genre, playCount: t.playCount }));

      report(
        setPlaylistProgress,
        taskId,
        'ai-playlist',
        'AI Smart Playlist',
        `Curating playlist for "${clean.slice(0, 32)}"...`,
        2,
        3
      );

      const resp = await fetch(resolveApiUrl('/api/ai/smart-playlist'), {
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
      report(
        setPlaylistProgress,
        taskId,
        'ai-playlist',
        'AI Smart Playlist Ready',
        `Created "${created.name}"`,
        3,
        3,
        'done'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to generate smart playlist.';
      setAiError(msg);
      report(setPlaylistProgress, taskId, 'ai-playlist', 'AI Playlist Error', msg, 3, 3, 'error');
    } finally {
      setAiLoading(false);
    }
  };

  const handleRefreshDailyMixes = async () => {
    const taskId = `ai_mix_${Date.now()}`;
    setDailyLoading(true);
    setAiError(null);
    report(
      setDailyProgress,
      taskId,
      'ai-mixes',
      'Refreshing Daily Mixes',
      'Analyzing top genres and favorite artists...',
      1,
      3
    );

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

      report(
        setDailyProgress,
        taskId,
        'ai-mixes',
        'Refreshing Daily Mixes',
        'Composing 3 personalized mixes with AI...',
        2,
        3
      );

      const resp = await fetch(resolveApiUrl('/api/ai/daily-mix'), {
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
      report(
        setDailyProgress,
        taskId,
        'ai-mixes',
        'Daily Mixes Updated',
        `Generated ${mixes.length} tailored mixes`,
        3,
        3,
        'done'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Daily mix refresh failed.';
      setAiError(msg);
      report(setDailyProgress, taskId, 'ai-mixes', 'Daily Mixes Error', msg, 3, 3, 'error');
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
    if (tracks.length === 0) return;
    const taskId = `ai_tags_${Date.now()}`;
    setTagLoading(true);
    setTagStatus(null);
    setAiError(null);
    report(
      setTagProgress,
      taskId,
      'ai-tags',
      'AI Song Tag Cleanup',
      `Preparing ${tracks.length} tracks...`,
      0,
      tracks.length
    );

    try {
      const mapped = await runBatchedTagCleanupScan(tracks, (current, total, detail) => {
        report(setTagProgress, taskId, 'ai-tags', 'AI Song Tag Cleanup', detail, current, total);
      });
      setTagSuggestions(mapped);
      if (mapped.length === 0) {
        setTagStatus('All scanned tracks already have clean metadata tags.');
      } else {
        tactile.success();
      }
      report(
        setTagProgress,
        taskId,
        'ai-tags',
        'Tag Cleanup Scan Complete',
        `Found ${mapped.length} track(s) with suggested tag fixes`,
        tracks.length,
        tracks.length,
        'done'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to scan library tags.';
      setAiError(msg);
      report(setTagProgress, taskId, 'ai-tags', 'Tag Scan Error', msg, 0, tracks.length, 'error');
    } finally {
      setTagLoading(false);
    }
  };

  const handleScanDuplicatesWithAi = async () => {
    if (tracks.length === 0) return;
    const taskId = `ai_dups_${Date.now()}`;
    setDupLoading(true);
    setDupStatus(null);
    setAiError(null);
    report(
      setDupProgress,
      taskId,
      'ai-duplicates',
      'AI Duplicate Scanner',
      `Inspecting ${tracks.length} tracks...`,
      0,
      tracks.length
    );

    try {
      const foundGroups = await runDuplicateScan(tracks, (current, total, detail) => {
        report(
          setDupProgress,
          taskId,
          'ai-duplicates',
          'AI Duplicate Scanner',
          detail,
          current,
          total
        );
      });
      setDupGroups(foundGroups);
      if (foundGroups.length === 0) {
        setDupStatus('No duplicate tracks detected across your library.');
      } else {
        tactile.success();
      }
      report(
        setDupProgress,
        taskId,
        'ai-duplicates',
        'Duplicate Scan Complete',
        `Found ${foundGroups.length} duplicate group(s)`,
        tracks.length,
        tracks.length,
        'done'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Duplicate scan failed.';
      setAiError(msg);
      report(setDupProgress, taskId, 'ai-duplicates', 'Duplicate Scan Error', msg, 0, tracks.length, 'error');
    } finally {
      setDupLoading(false);
    }
  };

  const handleFindOriginalAlbumArt = async () => {
    if (tracks.length === 0) return;
    const taskId = `ai_art_${Date.now()}`;
    setArtLoading(true);
    setArtStatus(null);
    setAiError(null);
    report(
      setArtProgress,
      taskId,
      'ai-artwork',
      'AI Original Album Art Finder',
      `Preparing ${tracks.length} tracks for artwork matching...`,
      0,
      tracks.length
    );

    try {
      const found = await runOriginalAlbumArtScan(tracks, (current, total, detail) => {
        report(
          setArtProgress,
          taskId,
          'ai-artwork',
          'AI Original Album Art Finder',
          detail,
          current,
          total
        );
      });
      setArtSuggestions(found);
      if (found.length === 0) {
        setArtStatus('No new official album covers matched automatically. You can upload custom cover images below.');
      } else {
        tactile.success();
      }
      report(
        setArtProgress,
        taskId,
        'ai-artwork',
        'Album Art Lookup Complete',
        `Found ${found.length} original album cover(s)`,
        tracks.length,
        tracks.length,
        'done'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to search original album art.';
      setAiError(msg);
      report(setArtProgress, taskId, 'ai-artwork', 'Album Art Lookup Error', msg, 0, tracks.length, 'error');
    } finally {
      setArtLoading(false);
    }
  };

  const handleManualArtworkFileSelected = async (file: File | null) => {
    if (!file || !uploadTargetTrackId) return;
    const targetTrack = tracks.find((t) => t.id === uploadTargetTrackId);
    const taskId = `art_upload_${Date.now()}`;
    try {
      const optimizedUrl = await resizeArtworkFileToDataUrl(file, (current, total, detail) => {
        report(
          setArtProgress,
          taskId,
          'ai-artwork',
          `Uploading Cover Art${targetTrack ? `: ${targetTrack.title}` : ''}`,
          detail,
          current,
          total,
          current === total ? 'done' : 'running'
        );
      });

      onApplyArtworkUpdates([{ trackId: uploadTargetTrackId, coverUrl: optimizedUrl }]);
      tactile.success();
      setArtStatus(`Uploaded & applied original cover art to "${targetTrack?.title || 'track'}".`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Artwork upload failed.';
      setAiError(msg);
      report(setArtProgress, taskId, 'ai-artwork', 'Artwork Upload Failed', msg, 0, 4, 'error');
    } finally {
      setUploadTargetTrackId(null);
    }
  };

  const showMixes = section === 'all' || section === 'mixes';
  const showPlaylists = section === 'all' || section === 'playlists';
  const showTags = section === 'all' || section === 'tags';
  const showDuplicates = section === 'all' || section === 'duplicates';
  const showArtwork = section === 'all' || section === 'artwork';

  return (
    <div className="space-y-6 max-w-5xl">
      <input
        ref={artFileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0] || null;
          e.target.value = '';
          void handleManualArtworkFileSelected(file);
        }}
      />

      {/* Header + Segmented Section Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-4">
        <div>
          <h2 className="text-xl font-display font-semibold text-zinc-900 dark:text-zinc-100">
            Smart Studio
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            AI duplicate scanner, tag cleanup, original album art lookup/upload, daily mixes, and smart playlists.
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

      {/* 1. AI Duplicate Scanner */}
      {showDuplicates && (
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-display font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <CopyCheck className="w-4 h-4 accent-text" />
                <span>AI Duplicate Track Scanner</span>
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Detects duplicate songs across folders and formats, keeping the highest lossless bit-depth copy.
              </p>
            </div>
            <button
              type="button"
              onClick={handleScanDuplicatesWithAi}
              disabled={dupLoading || tracks.length < 2}
              className="min-h-[42px] px-4 rounded-lg accent-bg text-sm font-medium flex items-center gap-2 whitespace-nowrap active:scale-95 transition-transform duration-100 disabled:opacity-50"
            >
              {dupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CopyCheck className="w-4 h-4" />}
              <span>{dupLoading ? 'Scanning...' : 'Scan for Duplicates'}</span>
            </button>
          </div>

          {dupProgress && (
            <ProgressBar
              label={dupProgress.label}
              detail={dupProgress.detail}
              current={dupProgress.current}
              total={dupProgress.total}
              percent={dupProgress.percent}
              status={dupProgress.status}
            />
          )}

          {dupStatus && <p className="text-sm text-zinc-600 dark:text-zinc-400">{dupStatus}</p>}

          {dupGroups.length > 0 && (
            <div className="space-y-4 pt-2 border-t border-zinc-200 dark:border-zinc-800">
              {dupGroups.map((group) => (
                <div
                  key={group.groupId}
                  className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3.5 space-y-2"
                >
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono-tabular">
                    {group.reason} · {group.similarityScore}% match
                  </div>
                  <div className="divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
                    {group.items.map((item) => (
                      <label
                        key={item.trackId}
                        className="flex items-center justify-between gap-3 py-2 cursor-pointer"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <input
                            type="checkbox"
                            checked={item.selectedForRemoval}
                            onChange={() => {
                              tactile.toggle(!item.selectedForRemoval);
                              setDupGroups((prev) =>
                                prev.map((g) =>
                                  g.groupId !== group.groupId
                                    ? g
                                    : {
                                        ...g,
                                        items: g.items.map((x) =>
                                          x.trackId === item.trackId
                                            ? { ...x, selectedForRemoval: !x.selectedForRemoval }
                                            : x
                                        ),
                                      }
                                )
                              );
                            }}
                            className="w-4 h-4 accent-amber-500 shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                              {item.title}
                            </div>
                            <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate font-mono-tabular">
                              {item.artist} · {item.format} {item.bitDepth}b/{Math.round(item.sampleRate / 1000)}kHz · {item.bitrateKbps} kbps
                            </div>
                          </div>
                        </div>
                        <span
                          className={`text-xs font-medium shrink-0 ${
                            item.isRecommendedKeep && !item.selectedForRemoval
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : item.selectedForRemoval
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-zinc-500'
                          }`}
                        >
                          {item.selectedForRemoval
                            ? 'Remove Copy'
                            : item.isRecommendedKeep
                            ? 'Keep Master'
                            : 'Keep'}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    const idsToRemove = dupGroups.flatMap((g) =>
                      g.items.filter((i) => i.selectedForRemoval).map((i) => i.trackId)
                    );
                    if (idsToRemove.length > 0) {
                      tactile.success();
                      onRemoveDuplicateTracks(idsToRemove);
                      setDupGroups([]);
                      setDupStatus(`Removed ${idsToRemove.length} duplicate track(s) while keeping master copies.`);
                    }
                  }}
                  className="min-h-[44px] px-5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium flex items-center gap-2 active:scale-95 transition-transform duration-100"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Remove Selected Duplicates</span>
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* 2. AI Metadata & Tag Cleanup */}
      {showTags && (
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-display font-semibold text-zinc-900 dark:text-zinc-100">
                AI Metadata & Tag Cleanup
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Clean messy filenames and fix artist, title, album, and genre tags while preserving Lithuanian & Cyrillic scripts.
              </p>
            </div>
            <button
              type="button"
              onClick={handleScanTagsWithAi}
              disabled={tagLoading || tracks.length === 0}
              className="min-h-[42px] px-4 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-sm font-medium flex items-center gap-2 whitespace-nowrap active:scale-95 transition-transform duration-100 disabled:opacity-50"
            >
              {tagLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              <span>{tagLoading ? 'Scanning Tags...' : 'Scan & Fix Tags'}</span>
            </button>
          </div>

          {tagProgress && (
            <ProgressBar
              label={tagProgress.label}
              detail={tagProgress.detail}
              current={tagProgress.current}
              total={tagProgress.total}
              percent={tagProgress.percent}
              status={tagProgress.status}
            />
          )}

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

      {/* 3. AI Original Album Art Finder & Manual Cover Uploader */}
      {showArtwork && (
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-display font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <ImagePlus className="w-4 h-4 accent-text" />
                <span>AI Original Album Art Finder & Uploader</span>
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Matches songs to original album releases via AI & Cover Art Archive, or lets you upload custom covers from your device.
              </p>
            </div>
            <button
              type="button"
              onClick={handleFindOriginalAlbumArt}
              disabled={artLoading || tracks.length === 0}
              className="min-h-[42px] px-4 rounded-lg accent-bg text-sm font-medium flex items-center gap-2 whitespace-nowrap active:scale-95 transition-transform duration-100 disabled:opacity-50"
            >
              {artLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
              <span>{artLoading ? 'Searching Art...' : 'Find Original Album Art'}</span>
            </button>
          </div>

          {artProgress && (
            <ProgressBar
              label={artProgress.label}
              detail={artProgress.detail}
              current={artProgress.current}
              total={artProgress.total}
              percent={artProgress.percent}
              status={artProgress.status}
            />
          )}

          {artStatus && <p className="text-sm text-zinc-600 dark:text-zinc-400">{artStatus}</p>}

          {artSuggestions.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-zinc-200 dark:border-zinc-800">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {artSuggestions.map((item) => (
                  <label
                    key={item.trackId}
                    className="flex items-center gap-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                  >
                    <input
                      type="checkbox"
                      checked={item.selected}
                      onChange={() => {
                        tactile.toggle(!item.selected);
                        setArtSuggestions((prev) =>
                          prev.map((x) =>
                            x.trackId === item.trackId ? { ...x, selected: !x.selected } : x
                          )
                        );
                      }}
                      className="w-4 h-4 accent-amber-500 shrink-0"
                    />
                    <img
                      src={item.suggestedCoverUrl}
                      alt={`${item.album} cover`}
                      referrerPolicy="no-referrer"
                      className="w-14 h-14 rounded-lg object-cover border border-zinc-200 dark:border-zinc-800 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                        {item.title}
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                        {item.artist} · {item.album}
                      </div>
                      <div className="text-[11px] text-emerald-600 dark:text-emerald-400 truncate mt-0.5">
                        {item.sourceLabel}
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    const chosen = artSuggestions.filter((s) => s.selected);
                    if (chosen.length > 0) {
                      tactile.success();
                      onApplyArtworkUpdates(
                        chosen.map((c) => ({ trackId: c.trackId, coverUrl: c.suggestedCoverUrl }))
                      );
                      setArtSuggestions([]);
                      setArtStatus(`Applied original album art to ${chosen.length} track(s).`);
                    }
                  }}
                  className="min-h-[44px] px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium flex items-center gap-2 active:scale-95 transition-transform duration-100"
                >
                  <Check className="w-4 h-4" />
                  <span>Apply Selected Artworks</span>
                </button>
              </div>
            </div>
          )}

          {/* Direct Manual Upload List (First 12 tracks or tracks in library) */}
          <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 space-y-2.5">
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Upload Custom Album Cover from Device
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-72 overflow-y-auto pr-1">
              {tracks.slice(0, 30).map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-2.5 p-2.5 rounded-lg border border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/70 dark:bg-zinc-950/50"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <CoverArt src={t.coverUrl} alt={t.title} className="w-10 h-10 rounded-md" />
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">
                        {t.title}
                      </div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                        {t.artist}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      tactile.tap();
                      setUploadTargetTrackId(t.id);
                      artFileInputRef.current?.click();
                    }}
                    className="min-h-[36px] px-2.5 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium flex items-center gap-1 shrink-0"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 4. Personalized Daily Recommendations */}
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
                <span>Refresh Mixes</span>
              </button>
            </div>
          </div>

          {dailyProgress && (
            <ProgressBar
              label={dailyProgress.label}
              detail={dailyProgress.detail}
              current={dailyProgress.current}
              total={dailyProgress.total}
              percent={dailyProgress.percent}
              status={dailyProgress.status}
            />
          )}

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

      {/* 5. Smart Playlist Generator + Dynamic Smart Playlists */}
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
                  Describe a mood or sound profile for AI curation, or define dynamic rules.
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
                <span>Generate Mix</span>
              </button>
            </form>

            {playlistProgress && (
              <ProgressBar
                label={playlistProgress.label}
                detail={playlistProgress.detail}
                current={playlistProgress.current}
                total={playlistProgress.total}
                percent={playlistProgress.percent}
                status={playlistProgress.status}
              />
            )}

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
    </div>
  );
};
