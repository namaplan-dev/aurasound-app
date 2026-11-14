import React, { useEffect, useMemo, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import {
  Check,
  CopyCheck,
  ImagePlus,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
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
  TaskItemProgress,
  Track,
} from '../types/music';
import { evaluateSmartPlaylist } from '../services/smartPlaylistEngine';
import {
  applyTagSuggestionsToList,
  prioritizeTracksForTagScan,
  resizeArtworkFileToDataUrl,
  resolveApiUrl,
  runBatchedTagCleanupScan,
  runDuplicateScan,
  runOriginalAlbumArtScan,
} from '../services/aiAssistantService';
import { tactile } from '../services/tactileFeedback';
import { PaginationBar } from './PaginationBar';
import { useViewportPageSize } from '../hooks/useViewportPageSize';
import { CoverArt } from './CoverArt';

export type StudioPage = 'mixes' | 'playlists' | 'duplicates' | 'tags' | 'artwork';

interface SmartStudioViewProps {
  page: StudioPage;
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
    status?: 'running' | 'done' | 'error',
    item?: TaskItemProgress
  ) => void;
}

const PAGE_TITLES: Record<StudioPage, { title: string; subtitle: string }> = {
  mixes: {
    title: 'Daily Mixes',
    subtitle: 'AI-curated listening decks matched to your favorite genres & artists.',
  },
  playlists: {
    title: 'Smart Playlists',
    subtitle: 'Generate mixes from mood prompts or dynamic rule engines.',
  },
  duplicates: {
    title: 'AI Duplicate Scanner',
    subtitle: 'Detect duplicate songs across folders while keeping the highest bit-depth master.',
  },
  tags: {
    title: 'AI Tag Cleanup',
    subtitle: 'Clean filenames and fix artist, title, album & genre metadata.',
  },
  artwork: {
    title: 'AI Album Art & Uploader',
    subtitle: 'Match official original album covers via AI or upload your own images.',
  },
};

export const SmartStudioView: React.FC<SmartStudioViewProps> = ({
  page,
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
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [playlistViewTab, setPlaylistViewTab] = useState<'list' | 'create'>('list');
  const [creatorMode, setCreatorMode] = useState<'ai' | 'rules'>('ai');

  const [dailyLoading, setDailyLoading] = useState(false);

  // Manual rule-based smart playlist state
  const [manualName, setManualName] = useState('');
  const [manualGenre, setManualGenre] = useState('');
  const [manualFormat, setManualFormat] = useState('');
  const [manualMinRating, setManualMinRating] = useState(0);
  const [manualFavOnly, setManualFavOnly] = useState(false);

  // Adjustable AI Scan Scope & Batch Controls
  const [scanLimitInput, setScanLimitInput] = useState<string>('15');
  const [batchSize, setBatchSize] = useState<number>(15);
  const [autoApplyTags, setAutoApplyTags] = useState<boolean>(true);

  const effectiveScanCount = useMemo(() => {
    if (tracks.length === 0) return 0;
    const parsed = Number.parseInt(scanLimitInput, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return Math.min(15, tracks.length);
    return Math.min(tracks.length, parsed);
  }, [scanLimitInput, tracks.length]);

  // AI Tag Cleanup state
  const [tagLoading, setTagLoading] = useState(false);
  const [tagSuggestions, setTagSuggestions] = useState<TagCleanupSuggestion[]>([]);
  const [tagStatus, setTagStatus] = useState<string | null>(null);

  // AI Duplicate Scanner state
  const [dupLoading, setDupLoading] = useState(false);
  const [dupGroups, setDupGroups] = useState<DuplicateGroup[]>([]);
  const [dupStatus, setDupStatus] = useState<string | null>(null);

  // AI Original Album Art Finder & Manual Uploader state
  const [artLoading, setArtLoading] = useState(false);
  const [artSuggestions, setArtSuggestions] = useState<ArtworkSuggestion[]>([]);
  const [artStatus, setArtStatus] = useState<string | null>(null);
  const [artSubTab, setArtSubTab] = useState<'ai' | 'upload'>('ai');
  const [uploadTargetTrackId, setUploadTargetTrackId] = useState<string | null>(null);
  const artFileInputRef = useRef<HTMLInputElement | null>(null);

  // Pagination states & viewport refs
  const [mixPage, setMixPage] = useState(0);
  const [spPage, setSpPage] = useState(0);
  const [dupPage, setDupPage] = useState(0);
  const [tagPage, setTagPage] = useState(0);
  const [artAiPage, setArtAiPage] = useState(0);
  const [artUploadPage, setArtUploadPage] = useState(0);

  const mixesRef = useRef<HTMLDivElement | null>(null);
  const spListRef = useRef<HTMLDivElement | null>(null);
  const dupListRef = useRef<HTMLDivElement | null>(null);
  const tagListRef = useRef<HTMLDivElement | null>(null);
  const artAiListRef = useRef<HTMLDivElement | null>(null);
  const artUploadListRef = useRef<HTMLDivElement | null>(null);

  const mixLayout = useViewportPageSize(mixesRef, {
    mode: 'grid',
    gridMinCardWidth: 220,
    fixedGridCardHeight: 162,
    gridGap: 12,
    maxColumns: 3,
  });

  const spLayout = useViewportPageSize(spListRef, {
    mode: 'grid',
    gridMinCardWidth: 230,
    fixedGridCardHeight: 118,
    gridGap: 10,
    maxColumns: 2,
  });

  const dupLayout = useViewportPageSize(dupListRef, {
    mode: 'list',
    listRowHeight: 158,
  });

  const tagLayout = useViewportPageSize(tagListRef, {
    mode: 'list',
    listRowHeight: 74,
  });

  const artAiLayout = useViewportPageSize(artAiListRef, {
    mode: 'grid',
    gridMinCardWidth: 240,
    fixedGridCardHeight: 84,
    gridGap: 10,
    maxColumns: 2,
  });

  const artUploadLayout = useViewportPageSize(artUploadListRef, {
    mode: 'grid',
    gridMinCardWidth: 220,
    fixedGridCardHeight: 62,
    gridGap: 8,
    maxColumns: 3,
  });

  useEffect(() => {
    setMixPage(0);
    setSpPage(0);
    setDupPage(0);
    setTagPage(0);
    setArtAiPage(0);
    setArtUploadPage(0);
  }, [page]);

  const report = (
    taskId: string,
    category: AppTaskCategory,
    label: string,
    detail: string,
    current: number,
    total: number,
    status: 'running' | 'done' | 'error' = 'running',
    item?: TaskItemProgress
  ) => {
    onTaskProgress(taskId, category, label, detail, current, total, status, item);
  };

  const handleGenerateAiPlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = aiPrompt.trim();
    if (!clean) return;
    const taskId = `ai_pl_${Date.now()}`;
    setAiLoading(true);
    setAiError(null);
    report(
      taskId,
      'ai-playlist',
      'AI Smart Playlist',
      'Collecting listening history & library profile...',
      1,
      3,
      'running',
      { label: `Prompt: ${clean.slice(0, 36)}`, current: 1, total: 3, percent: 33 }
    );

    try {
      const recent = [...tracks]
        .sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0))
        .slice(0, 15)
        .map((t) => ({ title: t.title, artist: t.artist, genre: t.genre, playCount: t.playCount }));

      report(
        taskId,
        'ai-playlist',
        'AI Smart Playlist',
        `Curating playlist for "${clean.slice(0, 32)}"...`,
        2,
        3,
        'running',
        { label: `Matching ${tracks.length} tracks`, current: 2, total: 3, percent: 67 }
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
      setPlaylistViewTab('list');
      report(
        taskId,
        'ai-playlist',
        'AI Smart Playlist Ready',
        `Created "${created.name}"`,
        3,
        3,
        'done',
        { label: created.name, current: 3, total: 3, percent: 100 }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to generate smart playlist.';
      setAiError(msg);
      report(taskId, 'ai-playlist', 'AI Playlist Error', msg, 3, 3, 'error', {
        label: msg,
        current: 3,
        total: 3,
        percent: 100,
      });
    } finally {
      setAiLoading(false);
    }
  };

  const handleRefreshDailyMixes = async () => {
    const taskId = `ai_mix_${Date.now()}`;
    setDailyLoading(true);
    setAiError(null);
    report(
      taskId,
      'ai-mixes',
      'Refreshing Daily Mixes',
      'Analyzing top genres and favorite artists...',
      1,
      3,
      'running',
      { label: `Profiling ${tracks.length} tracks`, current: 1, total: 3, percent: 33 }
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
        taskId,
        'ai-mixes',
        'Refreshing Daily Mixes',
        'Composing 3 personalized mixes with AI...',
        2,
        3,
        'running',
        { label: topGenres.join(', ') || 'Personal Mixes', current: 2, total: 3, percent: 67 }
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
        taskId,
        'ai-mixes',
        'Daily Mixes Updated',
        `Generated ${mixes.length} tailored mixes`,
        3,
        3,
        'done',
        { label: `Ready: ${mixes.length} decks`, current: 3, total: 3, percent: 100 }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Daily mix refresh failed.';
      setAiError(msg);
      report(taskId, 'ai-mixes', 'Daily Mixes Error', msg, 3, 3, 'error', {
        label: msg,
        current: 3,
        total: 3,
        percent: 100,
      });
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
    setPlaylistViewTab('list');
  };

  const handleScanTagsWithAi = async () => {
    if (tracks.length === 0 || effectiveScanCount === 0) return;
    const scopedTracks = prioritizeTracksForTagScan(tracks).slice(0, effectiveScanCount);
    const taskId = `ai_tags_${Date.now()}`;
    setTagLoading(true);
    setTagStatus(null);
    setTagSuggestions([]);
    setAiError(null);
    setTagPage(0);

    report(
      taskId,
      'ai-tags',
      'AI Metadata & Spelling Scan',
      `Scanning ${scopedTracks.length} prioritized track(s) in batches of ${batchSize}...`,
      0,
      scopedTracks.length,
      'running',
      { label: scopedTracks[0]?.title || 'Initializing AI scan', current: 0, total: 1, percent: 0 }
    );

    try {
      const mapped = await runBatchedTagCleanupScan(
        scopedTracks,
        (current, total, detail, item) => {
          report(
            taskId,
            'ai-tags',
            autoApplyTags ? 'AI Auto-Fixing Tags & Spelling' : 'AI Metadata & Spelling Scan',
            detail,
            current,
            total,
            'running',
            item
          );
        },
        {
          batchSize,
          onBatchComplete: (batch) => {
            const stamped = batch.map((item) => ({ ...item, applied: autoApplyTags }));
            if (autoApplyTags && stamped.length > 0) {
              onApplyTagCleanups(stamped);
            }
            setTagSuggestions((prev) => {
              const seen = new Set(prev.map((x) => x.trackId));
              return [...prev, ...stamped.filter((x) => !seen.has(x.trackId))];
            });
          },
        }
      );

      if (mapped.length === 0) {
        setTagStatus(`Scanned ${scopedTracks.length} track(s) — metadata is already clean and accurate.`);
      } else {
        tactile.success();
        setTagStatus(
          autoApplyTags
            ? `Scanned ${scopedTracks.length} track(s): automatically corrected ${mapped.length} track(s) across titles, artists, albums, years & spelling.`
            : `Scanned ${scopedTracks.length} track(s): found ${mapped.length} metadata & spelling improvement(s) ready to apply.`
        );
      }
      report(
        taskId,
        'ai-tags',
        autoApplyTags ? 'AI Tag Auto-Fix Complete' : 'AI Tag Scan Complete',
        autoApplyTags
          ? `Applied ${mapped.length} correction(s) across ${scopedTracks.length} track(s)`
          : `Found ${mapped.length} suggested improvement(s)`,
        scopedTracks.length,
        scopedTracks.length,
        'done',
        { label: `${mapped.length} track(s) updated`, current: 1, total: 1, percent: 100 }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to scan library tags with AI.';
      setAiError(msg);
      report(taskId, 'ai-tags', 'AI Tag Scan Error', msg, 0, scopedTracks.length, 'error', {
        label: msg,
        current: 1,
        total: 1,
        percent: 100,
      });
    } finally {
      setTagLoading(false);
    }
  };

  const handleRevertAppliedSuggestion = (s: TagCleanupSuggestion) => {
    tactile.tap();
    onApplyTagCleanups([
      {
        ...s,
        suggestedTitle: s.currentTitle,
        suggestedArtist: s.currentArtist,
        suggestedAlbum: s.currentAlbum,
        suggestedGenre: s.currentGenre,
        suggestedYear: s.currentYear || '',
      },
    ]);
    setTagSuggestions((prev) =>
      prev.map((item) =>
        item.trackId === s.trackId ? { ...item, applied: false, selected: false } : item
      )
    );
  };

  const handleScanDuplicatesWithAi = async () => {
    if (tracks.length < 2) return;
    const scopedTracks = prioritizeTracksForTagScan(tracks).slice(0, effectiveScanCount);
    const taskId = `ai_dups_${Date.now()}`;
    setDupLoading(true);
    setDupStatus(null);
    setAiError(null);
    setDupPage(0);

    report(
      taskId,
      'ai-duplicates',
      'Stage 1/2 · Auto-Fixing Tags Before Duplicate Check',
      `Analyzing ${scopedTracks.length} track(s) in batches of ${batchSize}...`,
      0,
      100,
      'running',
      { label: scopedTracks[0]?.title || 'Preparing AI tag verification', current: 0, total: 1, percent: 0 }
    );

    const appliedFixes = new Map<string, TagCleanupSuggestion>();

    try {
      // Stage 1 (0 -> 60%): Run true AI tag/album/year/spelling correction and apply to library
      if (scopedTracks.length > 0) {
        await runBatchedTagCleanupScan(
          scopedTracks,
          (curr, tot, detail, item) => {
            const overallPercent = Math.min(60, Math.round((curr / Math.max(1, tot)) * 60));
            report(
              taskId,
              'ai-duplicates',
              'Stage 1/2 · Auto-Fixing Tags & Spelling',
              detail,
              overallPercent,
              100,
              'running',
              item
            );
          },
          {
            batchSize,
            onBatchComplete: (batch) => {
              const stamped = batch.map((s) => ({ ...s, applied: true }));
              stamped.forEach((s) => appliedFixes.set(s.trackId, s));
              onApplyTagCleanups(stamped);
            },
          }
        );
      }

      // Build post-correction track snapshot immediately so Stage 2 evaluates cleaned tags (not stale state)
      const fixList = Array.from(appliedFixes.values());
      const correctedTracks = applyTagSuggestionsToList(tracks, fixList);

      report(
        taskId,
        'ai-duplicates',
        'Stage 2/2 · Scanning Duplicates',
        `Comparing ${correctedTracks.length} tracks using corrected metadata...`,
        60,
        100,
        'running',
        { label: `Applied ${fixList.length} tag correction(s)`, current: 1, total: 2, percent: 50 }
      );

      // Stage 2 (60 -> 100%): Duplicate detection on corrected metadata
      const foundGroups = await runDuplicateScan(correctedTracks, (curr, tot, detail, item) => {
        const overallPercent = 60 + Math.min(40, Math.round((curr / Math.max(1, tot)) * 40));
        report(
          taskId,
          'ai-duplicates',
          'Stage 2/2 · Scanning Duplicates',
          detail,
          overallPercent,
          100,
          'running',
          item
        );
      });

      setDupGroups(foundGroups);
      const fixPrefix =
        fixList.length > 0
          ? `Auto-corrected ${fixList.length} track(s) (titles/albums/years/spelling) before comparing. `
          : `Verified ${scopedTracks.length} track(s) before comparing. `;
      if (foundGroups.length === 0) {
        setDupStatus(`${fixPrefix}No duplicate tracks detected.`);
      } else {
        tactile.success();
        setDupStatus(`${fixPrefix}Found ${foundGroups.length} duplicate group(s).`);
      }

      report(
        taskId,
        'ai-duplicates',
        'Smart Tag Fix & Duplicate Scan Complete',
        `${fixList.length} tag fix(es) · ${foundGroups.length} duplicate group(s)`,
        100,
        100,
        'done',
        { label: `Found ${foundGroups.length} duplicate group(s)`, current: 1, total: 1, percent: 100 }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Tag correction or duplicate scan failed.';
      setAiError(msg);
      report(taskId, 'ai-duplicates', 'Duplicate Scan Error', msg, 0, 100, 'error', {
        label: msg,
        current: 1,
        total: 1,
        percent: 100,
      });
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
    setArtAiPage(0);
    setArtSubTab('ai');
    report(
      taskId,
      'ai-artwork',
      'AI Original Album Art Finder',
      `Preparing ${tracks.length} tracks for artwork matching...`,
      0,
      tracks.length,
      'running',
      { label: tracks[0]?.title || 'Initializing', current: 0, total: 1, percent: 0 }
    );

    try {
      const found = await runOriginalAlbumArtScan(tracks, (current, total, detail, item) => {
        report(
          taskId,
          'ai-artwork',
          'AI Original Album Art Finder',
          detail,
          current,
          total,
          'running',
          item
        );
      });
      setArtSuggestions(found);
      if (found.length === 0) {
        setArtStatus('No new official album covers matched automatically. Switch to Device Upload to choose an image manually.');
      } else {
        tactile.success();
      }
      report(
        taskId,
        'ai-artwork',
        'Album Art Lookup Complete',
        `Found ${found.length} original album cover(s)`,
        tracks.length,
        tracks.length,
        'done',
        { label: `Matched ${found.length} cover(s)`, current: 1, total: 1, percent: 100 }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to search original album art.';
      setAiError(msg);
      report(taskId, 'ai-artwork', 'Album Art Lookup Error', msg, 0, tracks.length, 'error', {
        label: msg,
        current: 1,
        total: 1,
        percent: 100,
      });
    } finally {
      setArtLoading(false);
    }
  };

  const handleManualArtworkFileSelected = async (file: File | null) => {
    if (!file || !uploadTargetTrackId) return;
    const targetTrack = tracks.find((t) => t.id === uploadTargetTrackId);
    const taskId = `art_upload_${Date.now()}`;
    try {
      const optimizedUrl = await resizeArtworkFileToDataUrl(file, (current, total, detail, item) => {
        report(
          taskId,
          'ai-artwork',
          `Uploading Cover Art${targetTrack ? `: ${targetTrack.title}` : ''}`,
          detail,
          current,
          total,
          current === total ? 'done' : 'running',
          item
        );
      });

      onApplyArtworkUpdates([{ trackId: uploadTargetTrackId, coverUrl: optimizedUrl }]);
      tactile.success();
      setArtStatus(`Applied custom cover art to "${targetTrack?.title || 'track'}".`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Artwork upload failed.';
      setAiError(msg);
      report(taskId, 'ai-artwork', 'Artwork Upload Failed', msg, 0, 4, 'error', {
        label: file.name,
        current: 1,
        total: 1,
        percent: 100,
      });
    } finally {
      setUploadTargetTrackId(null);
    }
  };

  // Pagination slices
  const mixTotalPages = Math.max(1, Math.ceil(dailyRecommendations.length / mixLayout.pageSize));
  const safeMixPage = Math.max(0, Math.min(mixTotalPages - 1, mixPage));
  const pagedMixes = useMemo(
    () =>
      dailyRecommendations.slice(
        safeMixPage * mixLayout.pageSize,
        safeMixPage * mixLayout.pageSize + mixLayout.pageSize
      ),
    [dailyRecommendations, safeMixPage, mixLayout.pageSize]
  );

  const spTotalPages = Math.max(1, Math.ceil(smartPlaylists.length / spLayout.pageSize));
  const safeSpPage = Math.max(0, Math.min(spTotalPages - 1, spPage));
  const pagedSmartPlaylists = useMemo(
    () =>
      smartPlaylists.slice(
        safeSpPage * spLayout.pageSize,
        safeSpPage * spLayout.pageSize + spLayout.pageSize
      ),
    [smartPlaylists, safeSpPage, spLayout.pageSize]
  );

  const dupTotalPages = Math.max(1, Math.ceil(dupGroups.length / dupLayout.pageSize));
  const safeDupPage = Math.max(0, Math.min(dupTotalPages - 1, dupPage));
  const pagedDupGroups = useMemo(
    () =>
      dupGroups.slice(
        safeDupPage * dupLayout.pageSize,
        safeDupPage * dupLayout.pageSize + dupLayout.pageSize
      ),
    [dupGroups, safeDupPage, dupLayout.pageSize]
  );

  const tagTotalPages = Math.max(1, Math.ceil(tagSuggestions.length / tagLayout.pageSize));
  const safeTagPage = Math.max(0, Math.min(tagTotalPages - 1, tagPage));
  const pagedTagSuggestions = useMemo(
    () =>
      tagSuggestions.slice(
        safeTagPage * tagLayout.pageSize,
        safeTagPage * tagLayout.pageSize + tagLayout.pageSize
      ),
    [tagSuggestions, safeTagPage, tagLayout.pageSize]
  );

  const artAiTotalPages = Math.max(1, Math.ceil(artSuggestions.length / artAiLayout.pageSize));
  const safeArtAiPage = Math.max(0, Math.min(artAiTotalPages - 1, artAiPage));
  const pagedArtSuggestions = useMemo(
    () =>
      artSuggestions.slice(
        safeArtAiPage * artAiLayout.pageSize,
        safeArtAiPage * artAiLayout.pageSize + artAiLayout.pageSize
      ),
    [artSuggestions, safeArtAiPage, artAiLayout.pageSize]
  );

  const artUploadTotalPages = Math.max(1, Math.ceil(tracks.length / artUploadLayout.pageSize));
  const safeArtUploadPage = Math.max(0, Math.min(artUploadTotalPages - 1, artUploadPage));
  const pagedUploadTracks = useMemo(
    () =>
      tracks.slice(
        safeArtUploadPage * artUploadLayout.pageSize,
        safeArtUploadPage * artUploadLayout.pageSize + artUploadLayout.pageSize
      ),
    [tracks, safeArtUploadPage, artUploadLayout.pageSize]
  );

  const meta = PAGE_TITLES[page];

  return (
    <div className="h-full min-h-0 flex flex-col gap-2 max-w-6xl overflow-hidden">
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

      {/* Page Header */}
      <div className="shrink-0 flex items-center justify-between gap-2 pb-2 border-b border-zinc-200 dark:border-zinc-800">
        <div className="min-w-0">
          <h2 className="text-base sm:text-xl font-display font-semibold text-zinc-900 dark:text-zinc-100 truncate">
            {meta.title}
          </h2>
          <p className="hidden sm:block text-xs text-zinc-500 dark:text-zinc-400 truncate">
            {meta.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!user && (
            <button
              type="button"
              onClick={onSignInGoogle}
              className="hidden sm:inline-flex min-h-[34px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-xs font-medium whitespace-nowrap"
            >
              Sign in with Gmail
            </button>
          )}

          {page === 'mixes' && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={tracks.length === 0}
                onClick={() => onPlayTracks(tracks, false)}
                className="min-h-[36px] px-3 rounded-lg accent-bg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap active:scale-95 transition-transform duration-100 disabled:opacity-40"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Play All</span>
              </button>
              <button
                type="button"
                disabled={tracks.length === 0}
                onClick={() => onPlayTracks(tracks, true)}
                className="min-h-[36px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap active:scale-95 transition-transform duration-100 disabled:opacity-40"
              >
                <Shuffle className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Shuffle</span>
              </button>
              <button
                type="button"
                onClick={handleRefreshDailyMixes}
                disabled={dailyLoading}
                className="min-h-[36px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap active:scale-95 transition-transform duration-100 disabled:opacity-50"
              >
                {dailyLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                <span>Refresh</span>
              </button>
            </div>
          )}

          {page === 'playlists' && (
            <div className="lg:hidden inline-flex items-center p-0.5 rounded-lg bg-zinc-200/75 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => {
                  tactile.tap();
                  setPlaylistViewTab('list');
                }}
                className={`min-h-[32px] px-2.5 rounded-md text-xs font-medium transition-colors ${
                  playlistViewTab === 'list'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-500'
                }`}
              >
                Saved ({smartPlaylists.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  tactile.tap();
                  setPlaylistViewTab('create');
                }}
                className={`min-h-[32px] px-2.5 rounded-md text-xs font-medium transition-colors ${
                  playlistViewTab === 'create'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-500'
                }`}
              >
                Create
              </button>
            </div>
          )}

          {page === 'duplicates' && (
            <button
              type="button"
              onClick={handleScanDuplicatesWithAi}
              disabled={dupLoading || tagLoading || tracks.length < 2}
              className="min-h-[36px] px-3.5 rounded-lg accent-bg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap active:scale-95 transition-transform duration-100 disabled:opacity-50"
            >
              {dupLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CopyCheck className="w-3.5 h-3.5" />}
              <span>{dupLoading ? 'Fixing & Scanning...' : `Fix & Scan (${effectiveScanCount})`}</span>
            </button>
          )}

          {page === 'tags' && (
            <button
              type="button"
              onClick={handleScanTagsWithAi}
              disabled={tagLoading || dupLoading || tracks.length === 0}
              className="min-h-[36px] px-3.5 rounded-lg accent-bg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap active:scale-95 transition-transform duration-100 disabled:opacity-50"
            >
              {tagLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              <span>
                {tagLoading
                  ? 'Scanning...'
                  : autoApplyTags
                  ? `Auto-Fix (${effectiveScanCount})`
                  : `Scan (${effectiveScanCount})`}
              </span>
            </button>
          )}

          {page === 'artwork' && (
            <div className="flex items-center gap-1.5">
              <div className="inline-flex items-center p-0.5 rounded-lg bg-zinc-200/75 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => {
                    tactile.tap();
                    setArtSubTab('ai');
                  }}
                  className={`min-h-[32px] px-2.5 rounded-md text-xs font-medium transition-colors ${
                    artSubTab === 'ai'
                      ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                      : 'text-zinc-500'
                  }`}
                >
                  AI Finder
                </button>
                <button
                  type="button"
                  onClick={() => {
                    tactile.tap();
                    setArtSubTab('upload');
                  }}
                  className={`min-h-[32px] px-2.5 rounded-md text-xs font-medium transition-colors ${
                    artSubTab === 'upload'
                      ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                      : 'text-zinc-500'
                  }`}
                >
                  Upload
                </button>
              </div>
              <button
                type="button"
                onClick={handleFindOriginalAlbumArt}
                disabled={artLoading || tracks.length === 0}
                className="min-h-[36px] px-3 rounded-lg accent-bg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap active:scale-95 transition-transform duration-100 disabled:opacity-50"
              >
                {artLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">{artLoading ? 'Searching...' : 'Find Art'}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {aiError && (
        <div className="shrink-0 px-3.5 py-2 rounded-xl border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-2">
          <span className="truncate">{aiError}</span>
          <button type="button" onClick={() => setAiError(null)} className="underline shrink-0">
            Dismiss
          </button>
        </div>
      )}

      {/* PAGE 1: DAILY MIXES */}
      {page === 'mixes' && (
        <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
          <div ref={mixesRef} className="flex-1 min-h-0 overflow-hidden">
            {pagedMixes.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center gap-3">
                <Sparkles className="w-9 h-9 text-zinc-400 opacity-60" />
                <p className="text-sm text-zinc-500">Tap Refresh to generate personalized mixes.</p>
              </div>
            ) : (
              <div
                style={{ gridTemplateColumns: `repeat(${mixLayout.columns}, minmax(0, 1fr))` }}
                className="grid gap-3"
              >
                {pagedMixes.map((rec) => {
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
                      style={{ height: `${Math.max(114, mixLayout.cellHeight - 6)}px` }}
                      className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-3 sm:p-4 flex flex-col justify-between gap-2 overflow-hidden"
                    >
                      <div className="min-w-0">
                        <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                          {rec.mood} · {rec.genre} ·{' '}
                          <span className="font-mono-tabular">{matched.length} tracks</span>
                        </div>
                        <h4 className="mt-1 text-base font-display font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                          {rec.title}
                        </h4>
                        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2">
                          {rec.subtitle}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={matched.length === 0}
                          onClick={() => onPlayTracks(matched, false)}
                          className="flex-1 min-h-[38px] px-3 rounded-lg accent-bg text-xs font-medium flex items-center justify-center gap-1.5 active:scale-95 transition-transform duration-100 disabled:opacity-40"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>Play All</span>
                        </button>
                        <button
                          type="button"
                          disabled={matched.length === 0}
                          onClick={() => onPlayTracks(matched, true)}
                          aria-label={`Shuffle ${rec.title}`}
                          className="min-w-[38px] min-h-[38px] rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center active:scale-95 transition-transform duration-100 disabled:opacity-40"
                        >
                          <Shuffle className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <PaginationBar
            page={safeMixPage}
            totalPages={mixTotalPages}
            totalItems={dailyRecommendations.length}
            pageSize={mixLayout.pageSize}
            onChangePage={setMixPage}
            itemLabel="mixes"
          />
        </div>
      )}

      {/* PAGE 2: SMART PLAYLISTS */}
      {page === 'playlists' && (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4 overflow-hidden">
          {/* Creator Pane (always shown on lg+, toggled on mobile) */}
          <div
            className={`lg:col-span-5 flex-col gap-3 min-h-0 overflow-hidden ${
              playlistViewTab === 'create' ? 'flex' : 'hidden lg:flex'
            }`}
          >
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-3 sm:p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs sm:text-sm font-display font-semibold flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 accent-text" />
                  <span>New Smart Playlist</span>
                </h3>
                <div className="inline-flex items-center p-0.5 rounded-lg bg-zinc-200/75 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => {
                      tactile.tap();
                      setCreatorMode('ai');
                    }}
                    className={`min-h-[26px] px-2 rounded-md text-xs font-medium ${
                      creatorMode === 'ai'
                        ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                        : 'text-zinc-500'
                    }`}
                  >
                    AI Prompt
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      tactile.tap();
                      setCreatorMode('rules');
                    }}
                    className={`min-h-[26px] px-2 rounded-md text-xs font-medium ${
                      creatorMode === 'rules'
                        ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                        : 'text-zinc-500'
                    }`}
                  >
                    Rules
                  </button>
                </div>
              </div>

              {creatorMode === 'ai' ? (
                <form onSubmit={handleGenerateAiPlaylist} className="space-y-2">
                  <input
                    type="text"
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="e.g. Rainy evening ambient in lossless FLAC..."
                    className="w-full min-h-[38px] px-3 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={aiLoading}
                    className="w-full min-h-[38px] px-4 rounded-lg accent-bg text-xs sm:text-sm font-medium flex items-center justify-center gap-2 active:scale-95 transition-transform duration-100 disabled:opacity-50"
                  >
                    {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                    <span>Generate Smart Mix</span>
                  </button>
                </form>
              ) : (
                <form onSubmit={handleCreateManualSmartPlaylist} className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={manualName}
                      onChange={(e) => setManualName(e.target.value)}
                      placeholder="Playlist Name"
                      required
                      className="min-h-[36px] px-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs sm:text-sm"
                    />
                    <input
                      type="text"
                      value={manualGenre}
                      onChange={(e) => setManualGenre(e.target.value)}
                      placeholder="Genre"
                      className="min-h-[36px] px-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs sm:text-sm"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={manualFormat}
                      onChange={(e) => setManualFormat(e.target.value)}
                      className="flex-1 min-h-[36px] px-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs sm:text-sm"
                    >
                      <option value="">Any Format</option>
                      <option value="FLAC">FLAC</option>
                      <option value="ALAC">ALAC</option>
                      <option value="WAV">WAV</option>
                      <option value="MP3">MP3</option>
                    </select>
                    <select
                      value={manualMinRating}
                      onChange={(e) => setManualMinRating(Number(e.target.value))}
                      className="flex-1 min-h-[36px] px-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs sm:text-sm"
                    >
                      <option value={0}>Any Rating</option>
                      <option value={3}>3★+</option>
                      <option value={4}>4★+</option>
                      <option value={5}>5★</option>
                    </select>
                    <label className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-400 cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={manualFavOnly}
                        onChange={(e) => {
                          tactile.toggle(e.target.checked);
                          setManualFavOnly(e.target.checked);
                        }}
                        className="w-4 h-4 accent-amber-500"
                      />
                      <span>Favs</span>
                    </label>
                  </div>
                  <button
                    type="submit"
                    className="w-full min-h-[36px] px-4 rounded-lg accent-bg text-xs sm:text-sm font-medium flex items-center justify-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Create Rule Playlist</span>
                  </button>
                </form>
              )}

            </div>
          </div>

          {/* Saved Smart Playlists Pane */}
          <div
            className={`lg:col-span-7 flex-col gap-2 min-h-0 overflow-hidden ${
              playlistViewTab === 'list' ? 'flex' : 'hidden lg:flex'
            }`}
          >
            <div ref={spListRef} className="flex-1 min-h-0 overflow-hidden">
              {pagedSmartPlaylists.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-zinc-500">
                  No smart playlists yet.
                </div>
              ) : (
                <div
                  style={{ gridTemplateColumns: `repeat(${spLayout.columns}, minmax(0, 1fr))` }}
                  className="grid gap-2.5"
                >
                  {pagedSmartPlaylists.map((sp) => {
                    const matched = evaluateSmartPlaylist(tracks, sp);
                    return (
                      <div
                        key={sp.id}
                        style={{ height: `${Math.max(88, spLayout.cellHeight - 4)}px` }}
                        className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-3 flex items-start justify-between gap-3 overflow-hidden"
                      >
                        <div className="min-w-0">
                          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                            {sp.isAiGenerated ? 'AI Curated' : 'Rules'} · {sp.mood} ·{' '}
                            <span className="font-mono-tabular">{matched.length}</span>
                          </div>
                          <h4 className="mt-0.5 text-sm font-display font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                            {sp.name}
                          </h4>
                          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2">
                            {sp.description}
                          </p>
                        </div>

                        <div className="flex flex-col items-center gap-1 shrink-0">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={matched.length === 0}
                              onClick={() => onPlayTracks(matched, false)}
                              className="min-w-[36px] min-h-[36px] rounded-lg accent-bg flex items-center justify-center active:scale-95 transition-transform duration-100 disabled:opacity-40"
                              aria-label={`Play all in ${sp.name}`}
                            >
                              <Play className="w-3.5 h-3.5 fill-current" />
                            </button>
                            <button
                              type="button"
                              disabled={matched.length === 0}
                              onClick={() => onPlayTracks(matched, true)}
                              className="min-w-[36px] min-h-[36px] rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center active:scale-95 transition-transform duration-100 disabled:opacity-40"
                              aria-label={`Shuffle ${sp.name}`}
                            >
                              <Shuffle className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              tactile.tap();
                              onDeleteSmartPlaylist(sp.id);
                            }}
                            aria-label={`Delete ${sp.name}`}
                            className="w-full min-h-[28px] rounded-md text-zinc-400 hover:text-red-500 flex items-center justify-center"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <PaginationBar
              page={safeSpPage}
              totalPages={spTotalPages}
              totalItems={smartPlaylists.length}
              pageSize={spLayout.pageSize}
              onChangePage={setSpPage}
              itemLabel="smart playlists"
            />
          </div>
        </div>
      )}

      {/* PAGE 3: AI DUPLICATE SCANNER */}
      {page === 'duplicates' && (
        <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">
          <div className="shrink-0 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-2.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[11px] font-medium text-zinc-500 mr-0.5">Auto-fix items:</span>
              {[15, 50, 150].map((preset) => {
                const clamped = Math.min(preset, Math.max(1, tracks.length));
                const active = effectiveScanCount === clamped && scanLimitInput === String(clamped);
                return (
                  <button
                    key={preset}
                    type="button"
                    disabled={dupLoading || tracks.length === 0}
                    onClick={() => {
                      tactile.tap();
                      setScanLimitInput(String(clamped));
                    }}
                    className={`min-h-[28px] px-2 rounded-md text-[11px] font-medium transition-colors ${
                      active
                        ? 'accent-bg'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                    }`}
                  >
                    {preset}
                  </button>
                );
              })}
              <button
                type="button"
                disabled={dupLoading || tracks.length === 0}
                onClick={() => {
                  tactile.tap();
                  setScanLimitInput(String(tracks.length));
                }}
                className={`min-h-[28px] px-2 rounded-md text-[11px] font-medium transition-colors ${
                  effectiveScanCount === tracks.length && tracks.length > 0
                    ? 'accent-bg'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                }`}
              >
                All ({tracks.length})
              </button>
              <input
                type="number"
                min={1}
                max={Math.max(1, tracks.length)}
                value={scanLimitInput}
                disabled={dupLoading || tracks.length === 0}
                onChange={(e) => setScanLimitInput(e.target.value)}
                aria-label="Custom number of items to correct before duplicate scan"
                className="w-16 h-7 px-2 rounded-md bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs font-mono-tabular text-center focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={batchSize}
                disabled={dupLoading}
                onChange={(e) => setBatchSize(Number(e.target.value))}
                aria-label="AI batch size"
                className="h-7 px-2 rounded-md bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-[11px]"
              >
                <option value={10}>10 / batch</option>
                <option value={15}>15 / batch</option>
                <option value={25}>25 / batch</option>
                <option value={40}>40 / batch</option>
              </select>
              <span className="hidden sm:inline text-[11px] text-zinc-500 truncate">
                Auto-fixes tags &amp; spelling first, then scans duplicates
              </span>
            </div>
          </div>

          {dupStatus && (
            <div className="shrink-0 text-xs text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-900 px-3 py-1.5 rounded-lg">
              {dupStatus}
            </div>
          )}

          <div ref={dupListRef} className="flex-1 min-h-0 overflow-hidden flex flex-col gap-2.5">
            {pagedDupGroups.length === 0 ? (
              <div className="h-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 flex flex-col items-center justify-center text-center p-6 gap-2">
                <CopyCheck className="w-9 h-9 text-zinc-400 opacity-60" />
                <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Ready to inspect {tracks.length} tracks for duplicate copies
                </div>
                <p className="text-xs text-zinc-500 max-w-md">
                  Compares titles, artists, durations, and codecs to preserve 24-bit FLAC/ALAC/WAV masters and flag lower-bitrate copies.
                </p>
              </div>
            ) : (
              pagedDupGroups.map((group) => (
                <div
                  key={group.groupId}
                  className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-3 space-y-1.5"
                >
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono-tabular truncate">
                    {group.reason} · {group.similarityScore}% match
                  </div>
                  <div className="divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
                    {group.items.slice(0, 3).map((item) => (
                      <label
                        key={item.trackId}
                        className="flex items-center justify-between gap-2.5 py-1.5 cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
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
                            <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">
                              {item.title}
                            </div>
                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate font-mono-tabular">
                              {item.artist} · {item.format} {item.bitDepth}b/{Math.round(item.sampleRate / 1000)}kHz · {item.bitrateKbps} kbps
                            </div>
                          </div>
                        </div>
                        <span
                          className={`text-[11px] font-medium shrink-0 ${
                            item.isRecommendedKeep && !item.selectedForRemoval
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : item.selectedForRemoval
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-zinc-500'
                          }`}
                        >
                          {item.selectedForRemoval
                            ? 'Remove'
                            : item.isRecommendedKeep
                            ? 'Keep Master'
                            : 'Keep'}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>

          {dupGroups.length > 0 && (
            <div className="shrink-0 flex items-center justify-end">
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
                    setDupStatus(`Removed ${idsToRemove.length} duplicate track(s) while keeping masters.`);
                  }
                }}
                className="min-h-[38px] px-4 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium flex items-center gap-1.5 active:scale-95 transition-transform duration-100"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Remove Selected Duplicates</span>
              </button>
            </div>
          )}

          <PaginationBar
            page={safeDupPage}
            totalPages={dupTotalPages}
            totalItems={dupGroups.length}
            pageSize={dupLayout.pageSize}
            onChangePage={setDupPage}
            itemLabel="groups"
          />
        </div>
      )}

      {/* PAGE 4: AI TAG CLEANUP */}
      {page === 'tags' && (
        <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">
          <div className="shrink-0 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-2.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[11px] font-medium text-zinc-500 mr-0.5">Items:</span>
              {[15, 50, 150].map((preset) => {
                const clamped = Math.min(preset, Math.max(1, tracks.length));
                const active = effectiveScanCount === clamped && scanLimitInput === String(clamped);
                return (
                  <button
                    key={preset}
                    type="button"
                    disabled={tagLoading || tracks.length === 0}
                    onClick={() => {
                      tactile.tap();
                      setScanLimitInput(String(clamped));
                    }}
                    className={`min-h-[28px] px-2 rounded-md text-[11px] font-medium transition-colors ${
                      active
                        ? 'accent-bg'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                    }`}
                  >
                    {preset}
                  </button>
                );
              })}
              <button
                type="button"
                disabled={tagLoading || tracks.length === 0}
                onClick={() => {
                  tactile.tap();
                  setScanLimitInput(String(tracks.length));
                }}
                className={`min-h-[28px] px-2 rounded-md text-[11px] font-medium transition-colors ${
                  effectiveScanCount === tracks.length && tracks.length > 0
                    ? 'accent-bg'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                }`}
              >
                All ({tracks.length})
              </button>
              <input
                type="number"
                min={1}
                max={Math.max(1, tracks.length)}
                value={scanLimitInput}
                disabled={tagLoading || tracks.length === 0}
                onChange={(e) => setScanLimitInput(e.target.value)}
                aria-label="Custom number of items to scan"
                className="w-16 h-7 px-2 rounded-md bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs font-mono-tabular text-center focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2.5">
              <select
                value={batchSize}
                disabled={tagLoading}
                onChange={(e) => setBatchSize(Number(e.target.value))}
                aria-label="AI batch size"
                className="h-7 px-2 rounded-md bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-[11px]"
              >
                <option value={10}>10 / batch</option>
                <option value={15}>15 / batch</option>
                <option value={25}>25 / batch</option>
                <option value={40}>40 / batch</option>
              </select>

              <label className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={autoApplyTags}
                  disabled={tagLoading}
                  onChange={(e) => {
                    tactile.toggle(e.target.checked);
                    setAutoApplyTags(e.target.checked);
                  }}
                  className="w-3.5 h-3.5 accent-amber-500"
                />
                <span>Auto-apply fixes</span>
              </label>
            </div>
          </div>

          {tagStatus && (
            <div className="shrink-0 text-xs text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-900 px-3 py-1.5 rounded-lg">
              {tagStatus}
            </div>
          )}

          <div ref={tagListRef} className="flex-1 min-h-0 overflow-hidden">
            {pagedTagSuggestions.length === 0 ? (
              <div className="h-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 flex flex-col items-center justify-center text-center p-6 gap-2">
                <Wand2 className="w-9 h-9 text-zinc-400 opacity-60" />
                <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  AI Metadata, Album &amp; Spelling Fix ({effectiveScanCount} of {tracks.length})
                </div>
                <p className="text-xs text-zinc-500 max-w-md">
                  Identifies unknown albums, missing release years, wrong artists/genres, and misspelled titles while preserving Lithuanian &amp; Cyrillic scripts.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-2">
                {pagedTagSuggestions.map((s) => (
                  <div
                    key={s.trackId}
                    className="flex items-center gap-2.5 py-1.5 h-[70px]"
                  >
                    {!s.applied ? (
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
                        className="w-4 h-4 accent-amber-500 shrink-0 cursor-pointer"
                      />
                    ) : (
                      <span
                        title="Applied to library"
                        className="w-5 h-5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1 text-xs space-y-0.5">
                      <div className="text-zinc-500 line-through truncate">
                        {s.currentArtist} — {s.currentTitle} ({s.currentAlbum}
                        {s.currentYear ? ` · ${s.currentYear}` : ''})
                      </div>
                      <div className="text-zinc-900 dark:text-zinc-100 font-medium truncate">
                        {s.suggestedArtist} — {s.suggestedTitle} ({s.suggestedAlbum}
                        {s.suggestedYear ? ` · ${s.suggestedYear}` : ''} · {s.suggestedGenre})
                      </div>
                      <div className="text-[11px] text-zinc-500 truncate">{s.reason}</div>
                    </div>
                    {s.applied ? (
                      <button
                        type="button"
                        onClick={() => handleRevertAppliedSuggestion(s)}
                        className="min-h-[28px] px-2 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[11px] text-zinc-600 dark:text-zinc-300 flex items-center gap-1 shrink-0"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Revert</span>
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          {tagSuggestions.some((s) => !s.applied) && (
            <div className="shrink-0 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  const chosen = tagSuggestions.filter((s) => !s.applied && s.selected);
                  if (chosen.length > 0) {
                    tactile.success();
                    onApplyTagCleanups(chosen);
                    const appliedIds = new Set(chosen.map((c) => c.trackId));
                    setTagSuggestions((prev) =>
                      prev.map((item) =>
                        appliedIds.has(item.trackId) ? { ...item, applied: true } : item
                      )
                    );
                    setTagStatus(`Applied corrections to ${chosen.length} track(s).`);
                  }
                }}
                className="min-h-[38px] px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium flex items-center gap-1.5 active:scale-95 transition-transform duration-100"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Apply Selected Changes</span>
              </button>
            </div>
          )}

          <PaginationBar
            page={safeTagPage}
            totalPages={tagTotalPages}
            totalItems={tagSuggestions.length}
            pageSize={tagLayout.pageSize}
            onChangePage={setTagPage}
            itemLabel="suggestions"
          />
        </div>
      )}

      {/* PAGE 5: AI ALBUM ART FINDER & MANUAL DEVICE UPLOAD */}
      {page === 'artwork' && (
        <div className="flex-1 min-h-0 flex flex-col gap-2.5 overflow-hidden">
          {artStatus && (
            <div className="shrink-0 text-xs text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-900 px-3 py-2 rounded-lg">
              {artStatus}
            </div>
          )}

          {artSubTab === 'ai' ? (
            <>
              <div ref={artAiListRef} className="flex-1 min-h-0 overflow-hidden">
                {pagedArtSuggestions.length === 0 ? (
                  <div className="h-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 flex flex-col items-center justify-center text-center p-6 gap-2">
                    <ImagePlus className="w-9 h-9 text-zinc-400 opacity-60" />
                    <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Original Album Art Lookup
                    </div>
                    <p className="text-xs text-zinc-500 max-w-md">
                      Tap Find Art to match missing covers via AI + MusicBrainz / iTunes, or switch to Upload to pick cover photos from your device.
                    </p>
                  </div>
                ) : (
                  <div
                    style={{ gridTemplateColumns: `repeat(${artAiLayout.columns}, minmax(0, 1fr))` }}
                    className="grid gap-2.5"
                  >
                    {pagedArtSuggestions.map((item) => (
                      <label
                        key={item.trackId}
                        className="flex items-center gap-2.5 p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900 h-[80px]"
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
                          className="w-12 h-12 rounded-lg object-cover border border-zinc-200 dark:border-zinc-800 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">
                            {item.title}
                          </div>
                          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                            {item.artist} · {item.album}
                          </div>
                          <div className="text-[10px] text-emerald-600 dark:text-emerald-400 truncate">
                            {item.sourceLabel}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {artSuggestions.length > 0 && (
                <div className="shrink-0 flex justify-end">
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
                    className="min-h-[38px] px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium flex items-center gap-1.5 active:scale-95 transition-transform duration-100"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Apply Selected Artworks</span>
                  </button>
                </div>
              )}

              <PaginationBar
                page={safeArtAiPage}
                totalPages={artAiTotalPages}
                totalItems={artSuggestions.length}
                pageSize={artAiLayout.pageSize}
                onChangePage={setArtAiPage}
                itemLabel="matches"
              />
            </>
          ) : (
            <>
              <div ref={artUploadListRef} className="flex-1 min-h-0 overflow-hidden">
                <div
                  style={{ gridTemplateColumns: `repeat(${artUploadLayout.columns}, minmax(0, 1fr))` }}
                  className="grid gap-2"
                >
                  {pagedUploadTracks.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between gap-2 p-2 rounded-lg border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-900/60 h-[58px]"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <CoverArt src={t.coverUrl} alt={t.title} className="w-9 h-9 rounded-md" />
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
                        className="min-h-[34px] px-2.5 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium flex items-center gap-1 shrink-0"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>Upload</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <PaginationBar
                page={safeArtUploadPage}
                totalPages={artUploadTotalPages}
                totalItems={tracks.length}
                pageSize={artUploadLayout.pageSize}
                onChangePage={setArtUploadPage}
                itemLabel="tracks"
              />
            </>
          )}
        </div>
      )}
    </div>
  );
};
