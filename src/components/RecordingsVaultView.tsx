import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  FolderOpen,
  Loader2,
  Lock,
  Mic,
  MoreVertical,
  Pause,
  Phone,
  Play,
  RefreshCw,
  Save,
  Search,
  SkipBack,
  SkipForward,
  Sparkles,
  Tag,
  Trash2,
  Users,
  Video,
  X,
} from 'lucide-react';
import {
  AppTaskCategory,
  RecordingCategory,
  ScanFolderEntry,
  TaskItemProgress,
  Track,
} from '../types/music';
import {
  getRecordingCategoryLabel,
  RECORDING_CATEGORIES,
  saveRecordingTranscriptNearSource,
  transcribeRecordingWithAi,
} from '../services/recordingService';
import { readWebAudioBlobForTrack } from '../services/localFileHandleService';
import { isNativeAndroidApp } from '../services/nativeScanner';
import { useViewportPageSize } from '../hooks/useViewportPageSize';
import { PaginationBar } from './PaginationBar';
import { PinPadCore } from './PinPromptModal';
import { tactile } from '../services/tactileFeedback';

interface RecordingsVaultViewProps {
  unlocked: boolean;
  recordings: Track[];
  recordingFolders: ScanFolderEntry[];
  scanningRecordings: boolean;
  onUnlockSuccess: () => void;
  onLock: () => void;
  onScanRecordings: () => void;
  onOpenRecordingFolderSettings: () => void;
  onUpdateRecording: (id: string, patch: Partial<Track>) => void;
  onDeleteRecordings: (items: Track[]) => Promise<void> | void;
  onBeforePlayRecording: () => void;
  onTaskProgress?: (
    taskId: string,
    category: AppTaskCategory,
    title: string,
    detail: string,
    current: number,
    total: number,
    status: 'running' | 'done' | 'error',
    itemProgress?: TaskItemProgress
  ) => void;
}

function formatDuration(sec: number): string {
  const safe = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatShortDate(ms: number): string {
  if (!ms) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ms));
  } catch {
    return '';
  }
}

function CategoryIcon({ category, className }: { category?: RecordingCategory; className?: string }) {
  if (category === 'phone-call') return <Phone className={className} />;
  if (category === 'cam-audio') return <Video className={className} />;
  if (category === 'meeting') return <Users className={className} />;
  return <Mic className={className} />;
}

export const RecordingsVaultView: React.FC<RecordingsVaultViewProps> = ({
  unlocked,
  recordings,
  recordingFolders,
  scanningRecordings,
  onUnlockSuccess,
  onLock,
  onScanRecordings,
  onOpenRecordingFolderSettings,
  onUpdateRecording,
  onDeleteRecordings,
  onBeforePlayRecording,
  onTaskProgress,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | RecordingCategory>('all');
  const [page, setPage] = useState(0);

  // Isolated private recording playback (strictly separate from Music audioEngine & queue)
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeObjectUrlRef = useRef<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [audioCurrentSec, setAudioCurrentSec] = useState(0);
  const [audioDurationSec, setAudioDurationSec] = useState(0);

  // Transcription & save status
  const [transcribingId, setTranscribingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [vaultBanner, setVaultBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Anchored 3-dots menu
  const [menuTarget, setMenuTarget] = useState<{
    recording: Track;
    top: number;
    left: number;
  } | null>(null);

  // Inspector / Editor modal (transcript + tags + save near source)
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState<RecordingCategory>('voice-memo');
  const [editParticipants, setEditParticipants] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editTranscript, setEditTranscript] = useState('');
  const [editingFields, setEditingFields] = useState(false);
  const [transcriptPage, setTranscriptPage] = useState(0);
  const [confirmDeleteItem, setConfirmDeleteItem] = useState<Track | null>(null);

  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const layout = useViewportPageSize(listContainerRef, {
    mode: 'list',
    listRowHeight: 62,
    verticalPadding: 4,
  });

  const stopVaultAudio = useCallback(() => {
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    if (activeObjectUrlRef.current) {
      URL.revokeObjectURL(activeObjectUrlRef.current);
      activeObjectUrlRef.current = null;
    }
    setPlayingId(null);
    setIsAudioPlaying(false);
    setAudioCurrentSec(0);
    setAudioDurationSec(0);
  }, []);

  // Immediately silence private audio whenever locked or unmounted
  useEffect(() => {
    if (!unlocked) {
      stopVaultAudio();
      setMenuTarget(null);
      setInspectId(null);
      setConfirmDeleteItem(null);
      setSearchQuery('');
    }
  }, [unlocked, stopVaultAudio]);

  useEffect(() => {
    return () => {
      stopVaultAudio();
    };
  }, [stopVaultAudio]);

  const filteredRecordings = useMemo(() => {
    if (!unlocked) return [];
    const q = searchQuery.trim().toLowerCase();
    return recordings
      .filter((r) => {
        if (categoryFilter !== 'all' && (r.recordingCategory || 'voice-memo') !== categoryFilter) {
          return false;
        }
        if (!q) return true;
        const hay = [
          r.title,
          r.fileName,
          r.folderPath,
          getRecordingCategoryLabel(r.recordingCategory),
          ...(r.recordingParticipants || []),
          ...(r.transcriptTags || []),
          r.transcriptSummary || '',
          r.transcript || '',
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  }, [unlocked, recordings, categoryFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredRecordings.length / Math.max(1, layout.pageSize)));
  const safePage = Math.max(0, Math.min(totalPages - 1, page));
  const pageItems = useMemo(() => {
    const start = safePage * layout.pageSize;
    return filteredRecordings.slice(start, start + layout.pageSize);
  }, [filteredRecordings, safePage, layout.pageSize]);

  useEffect(() => {
    setPage(0);
  }, [searchQuery, categoryFilter]);

  const activePlayingRecording = useMemo(
    () => recordings.find((r) => r.id === playingId) || null,
    [recordings, playingId]
  );

  const inspectedRecording = useMemo(
    () => recordings.find((r) => r.id === inspectId) || null,
    [recordings, inspectId]
  );

  const playRecordingItem = useCallback(
    async (rec: Track) => {
      const el = audioRef.current;
      if (!el) return;

      if (playingId === rec.id && el.src) {
        if (el.paused) {
          onBeforePlayRecording();
          await el.play();
          setIsAudioPlaying(true);
        } else {
          el.pause();
          setIsAudioPlaying(false);
        }
        return;
      }

      onBeforePlayRecording();
      if (activeObjectUrlRef.current) {
        URL.revokeObjectURL(activeObjectUrlRef.current);
        activeObjectUrlRef.current = null;
      }

      try {
        let srcUrl = '';
        if (isNativeAndroidApp()) {
          const target = rec.nativeUri || rec.nativePath;
          if (!target) throw new Error('Missing Android audio URI for this recording.');
          srcUrl = Capacitor.convertFileSrc(target);
        } else {
          const blob = await readWebAudioBlobForTrack(rec.id);
          if (!blob) {
            throw new Error('Recording audio bytes unavailable. Re-scan folder in Settings.');
          }
          srcUrl = URL.createObjectURL(blob);
          activeObjectUrlRef.current = srcUrl;
        }

        el.src = srcUrl;
        el.currentTime = 0;
        setPlayingId(rec.id);
        setAudioDurationSec(rec.duration || 0);
        setAudioCurrentSec(0);
        await el.play();
        setIsAudioPlaying(true);
      } catch (err) {
        setVaultBanner({
          type: 'err',
          text: err instanceof Error ? err.message : 'Unable to play this recording.',
        });
        setIsAudioPlaying(false);
      }
    },
    [playingId, onBeforePlayRecording]
  );

  const handleStepVaultAudio = useCallback(
    (delta: -1 | 1) => {
      if (filteredRecordings.length === 0) return;
      const idx = filteredRecordings.findIndex((r) => r.id === playingId);
      const nextIdx =
        idx < 0
          ? 0
          : (idx + delta + filteredRecordings.length) % filteredRecordings.length;
      const target = filteredRecordings[nextIdx];
      if (target) void playRecordingItem(target);
    },
    [filteredRecordings, playingId, playRecordingItem]
  );

  const handleTranscribeRecording = useCallback(
    async (rec: Track) => {
      if (transcribingId) return;
      tactile.tap();
      setTranscribingId(rec.id);
      setVaultBanner(null);
      const taskId = `transcribe_${Date.now()}`;
      onTaskProgress?.(
        taskId,
        'ai-tags',
        'Transcribing Recording',
        `Listening & tagging "${rec.title}"...`,
        1,
        2,
        'running',
        { label: rec.fileName || rec.title, current: 1, total: 2, percent: 45 }
      );

      try {
        const result = await transcribeRecordingWithAi(rec);
        const mergedTags = Array.from(
          new Set([...(result.tags || []), getRecordingCategoryLabel(result.recordingCategory)])
        );

        const patch: Partial<Track> = {
          transcript: result.transcript,
          transcriptSummary: result.summary,
          recordingCategory: result.recordingCategory,
          artist: getRecordingCategoryLabel(result.recordingCategory),
          genre: getRecordingCategoryLabel(result.recordingCategory),
          recordingParticipants: result.participants,
          transcriptTags: mergedTags,
          transcribedAt: Date.now(),
          ...(result.suggestedTitle ? { title: result.suggestedTitle } : {}),
        };

        onUpdateRecording(rec.id, patch);
        tactile.success();
        setVaultBanner({
          type: 'ok',
          text: `Transcribed "${result.suggestedTitle || rec.title}" (${getRecordingCategoryLabel(
            result.recordingCategory
          )}).`,
        });
        onTaskProgress?.(
          taskId,
          'ai-tags',
          'Transcription Complete',
          `Tagged & transcribed "${result.suggestedTitle || rec.title}"`,
          2,
          2,
          'done',
          { label: 'Ready to view or save .txt near source', current: 2, total: 2, percent: 100 }
        );

        // If inspector modal is open on this item, refresh fields
        if (inspectId === rec.id) {
          setEditTitle(result.suggestedTitle || rec.title);
          setEditCategory(result.recordingCategory);
          setEditParticipants((result.participants || []).join(', '));
          setEditTags(mergedTags.join(', '));
          setEditTranscript(result.transcript);
          setTranscriptPage(0);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to transcribe recording.';
        setVaultBanner({ type: 'err', text: msg });
        onTaskProgress?.(
          taskId,
          'ai-tags',
          'Transcription Paused',
          msg,
          2,
          2,
          'error',
          { label: msg, current: 1, total: 1, percent: 100 }
        );
      } finally {
        setTranscribingId(null);
      }
    },
    [transcribingId, onUpdateRecording, onTaskProgress, inspectId]
  );

  const handleSaveTxtNearSource = useCallback(
    async (rec: Track) => {
      if (savingId) return;
      tactile.tap();
      setSavingId(rec.id);
      setVaultBanner(null);
      try {
        const res = await saveRecordingTranscriptNearSource(rec);
        onUpdateRecording(rec.id, { transcriptSavedPath: res.savedPath });
        tactile.success();
        setVaultBanner({
          type: 'ok',
          text: res.savedNearSource
            ? `Saved ${res.fileName} near source (${res.savedPath}).`
            : res.downloadedFallback
            ? `Downloaded ${res.fileName} (grant folder write access to save directly in source folder).`
            : `Saved ${res.fileName} to ${res.savedPath}.`,
        });
      } catch (err) {
        setVaultBanner({
          type: 'err',
          text: err instanceof Error ? err.message : 'Could not save transcript text file.',
        });
      } finally {
        setSavingId(null);
      }
    },
    [savingId, onUpdateRecording]
  );

  const openInspector = useCallback((rec: Track) => {
    setInspectId(rec.id);
    setEditTitle(rec.title);
    setEditCategory(rec.recordingCategory || 'voice-memo');
    setEditParticipants((rec.recordingParticipants || []).join(', '));
    setEditTags((rec.transcriptTags || []).join(', '));
    setEditTranscript(rec.transcript || '');
    setEditingFields(false);
    setTranscriptPage(0);
    setMenuTarget(null);
  }, []);

  const openAnchoredMenu = (e: React.MouseEvent<HTMLButtonElement>, recording: Track) => {
    e.stopPropagation();
    tactile.tap();
    const rect = e.currentTarget.getBoundingClientRect();
    const menuW = 224;
    const menuH = 264;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(vw - menuW - 8, rect.right - menuW));
    const spaceBelow = vh - rect.bottom - 12;
    const top = spaceBelow >= menuH ? rect.bottom + 4 : Math.max(8, rect.top - menuH - 4);
    setMenuTarget({ recording, top, left });
  };

  // Split transcript into fixed viewport-friendly chunks (~380 chars) so modal needs zero scrollbars
  const transcriptChunks = useMemo(() => {
    const text = (inspectedRecording?.transcript || '').trim();
    if (!text) return [];
    const words = text.split(/\s+/);
    const chunks: string[] = [];
    let current = '';
    for (const w of words) {
      if ((current + ' ' + w).length > 360 && current) {
        chunks.push(current.trim());
        current = w;
      } else {
        current = current ? `${current} ${w}` : w;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
  }, [inspectedRecording?.transcript]);

  const safeTranscriptPage = Math.max(
    0,
    Math.min(Math.max(0, transcriptChunks.length - 1), transcriptPage)
  );

  // Locked Gate 2 Screen — reveals ZERO recording titles, counts, or transcripts
  if (!unlocked) {
    return (
      <div className="h-full min-h-0 flex flex-col items-center justify-center p-3 overflow-hidden">
        <div className="w-full max-w-sm rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 p-4 sm:p-5 shadow-lg">
          <PinPadCore
            title="Private Recordings Locked"
            subtitle="Enter PIN 4194 to access voice memos, phone call recordings, cam audio & transcripts."
            onSuccess={onUnlockSuccess}
          />
          <div className="mt-3 pt-2.5 border-t border-zinc-200/70 dark:border-zinc-800/70 text-[11px] text-center text-zinc-500 dark:text-zinc-400">
            Strictly hidden from music search, playlists & Play All
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col gap-2 overflow-hidden">
      {/* Hidden dedicated audio element isolated from music engine */}
      <audio
        ref={audioRef}
        onTimeUpdate={() => {
          if (audioRef.current) setAudioCurrentSec(audioRef.current.currentTime || 0);
        }}
        onLoadedMetadata={() => {
          if (audioRef.current && Number.isFinite(audioRef.current.duration)) {
            setAudioDurationSec(audioRef.current.duration);
          }
        }}
        onEnded={() => {
          setIsAudioPlaying(false);
          setAudioCurrentSec(0);
        }}
      />

      {/* Top Controls Row */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-xl accent-soft-bg flex items-center justify-center shrink-0">
            <Mic className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-display font-bold truncate">
              Recordings Vault ({recordings.length})
            </h2>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
              {recordingFolders.filter((f) => f.enabled).length} selected recording folder(s) · PIN protected
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              tactile.tap();
              onOpenRecordingFolderSettings();
            }}
            className="min-h-[34px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium flex items-center gap-1.5"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span className="hidden xs:inline">Folders</span>
          </button>

          <button
            type="button"
            disabled={scanningRecordings}
            onClick={() => {
              tactile.tap();
              onScanRecordings();
            }}
            className="min-h-[34px] px-2.5 rounded-lg accent-bg text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scanningRecordings ? 'animate-spin' : ''}`} />
            <span>{scanningRecordings ? 'Scanning...' : 'Scan'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              tactile.tap();
              stopVaultAudio();
              onLock();
            }}
            className="min-h-[34px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium flex items-center gap-1.5 text-rose-600 dark:text-rose-400"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Lock</span>
          </button>
        </div>
      </div>

      {/* Vault Search + Category Filter Strip */}
      <div className="shrink-0 flex flex-col sm:flex-row gap-1.5">
        <div className="relative flex-1 min-w-0">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search calls, voice recordings, tags, transcripts..."
            className="w-full min-h-[36px] pl-8 pr-8 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
          />
          {searchQuery && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          <button
            type="button"
            onClick={() => {
              tactile.tap();
              setCategoryFilter('all');
            }}
            className={`min-h-[34px] px-2.5 rounded-lg text-[11px] font-medium transition-colors ${
              categoryFilter === 'all'
                ? 'accent-bg'
                : 'border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            All
          </button>
          {RECORDING_CATEGORIES.map((cat) => {
            const active = categoryFilter === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  tactile.tap();
                  setCategoryFilter(cat.id);
                }}
                className={`min-h-[34px] px-2.5 rounded-lg text-[11px] font-medium transition-colors ${
                  active
                    ? 'accent-bg'
                    : 'border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                {cat.shortLabel}
              </button>
            );
          })}
        </div>
      </div>

      {/* Inline Status Banner */}
      {vaultBanner && (
        <div
          className={`shrink-0 px-3 py-1.5 rounded-xl border text-xs flex items-center justify-between gap-2 ${
            vaultBanner.type === 'err'
              ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300'
              : 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300'
          }`}
        >
          <span className="truncate">{vaultBanner.text}</span>
          <button
            type="button"
            onClick={() => setVaultBanner(null)}
            className="text-[11px] underline shrink-0"
          >
            Close
          </button>
        </div>
      )}

      {/* Isolated Vault Playback Strip (shows when a recording is loaded) */}
      {activePlayingRecording && (
        <div className="shrink-0 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/90 px-3 py-2 flex items-center gap-2.5">
          <button
            type="button"
            aria-label="Previous recording"
            onClick={() => handleStepVaultAudio(-1)}
            className="min-w-[30px] min-h-[30px] rounded-lg flex items-center justify-center hover:bg-zinc-200 dark:hover:bg-zinc-800"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            aria-label={isAudioPlaying ? 'Pause recording' : 'Play recording'}
            onClick={() => void playRecordingItem(activePlayingRecording)}
            className="min-w-[34px] min-h-[34px] rounded-full accent-bg flex items-center justify-center shrink-0"
          >
            {isAudioPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>

          <button
            type="button"
            aria-label="Next recording"
            onClick={() => handleStepVaultAudio(1)}
            className="min-w-[30px] min-h-[30px] rounded-lg flex items-center justify-center hover:bg-zinc-200 dark:hover:bg-zinc-800"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 text-[11px] font-medium truncate">
              <span className="truncate text-zinc-900 dark:text-zinc-100">
                {activePlayingRecording.title}
              </span>
              <span className="font-mono-tabular text-zinc-500 shrink-0">
                {formatDuration(audioCurrentSec)} /{' '}
                {formatDuration(audioDurationSec || activePlayingRecording.duration)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(1, audioDurationSec || activePlayingRecording.duration || 1)}
              step={0.5}
              value={Math.min(
                audioCurrentSec,
                audioDurationSec || activePlayingRecording.duration || 1
              )}
              onChange={(e) => {
                const next = Number(e.target.value);
                setAudioCurrentSec(next);
                if (audioRef.current) audioRef.current.currentTime = next;
              }}
              className="w-full h-1.5 accent-amber-500 cursor-pointer"
            />
          </div>

          <button
            type="button"
            aria-label="Stop vault playback"
            onClick={stopVaultAudio}
            className="min-w-[30px] min-h-[30px] rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Paginated Recordings List */}
      <div
        ref={listContainerRef}
        className="flex-1 min-h-0 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 divide-y divide-zinc-200/70 dark:divide-zinc-800/70"
      >
        {filteredRecordings.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4 gap-2">
            <Mic className="w-8 h-8 text-zinc-400" />
            <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              {recordings.length === 0
                ? 'No recordings scanned yet'
                : 'No recordings match your filter'}
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-sm">
              {recordings.length === 0
                ? 'Add or select your Call Recordings, Voice Memos, or Camera Audio folders, then tap Scan.'
                : 'Try clearing search keywords or choosing All categories.'}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <button
                type="button"
                onClick={onOpenRecordingFolderSettings}
                className="min-h-[36px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium"
              >
                Choose Recording Folders
              </button>
              <button
                type="button"
                onClick={onScanRecordings}
                className="min-h-[36px] px-3 rounded-lg accent-bg text-xs font-medium"
              >
                Scan Now
              </button>
            </div>
          </div>
        ) : (
          pageItems.map((rec) => {
            const isActive = playingId === rec.id;
            const isTranscribingThis = transcribingId === rec.id;
            const hasTranscript = Boolean(rec.transcript && rec.transcript.trim());
            const catLabel = getRecordingCategoryLabel(rec.recordingCategory);

            return (
              <div
                key={rec.id}
                onClick={() => openInspector(rec)}
                className={`h-[62px] px-2.5 sm:px-3 flex items-center gap-2.5 cursor-pointer transition-colors ${
                  isActive
                    ? 'bg-amber-500/10'
                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                }`}
              >
                <button
                  type="button"
                  aria-label={isActive && isAudioPlaying ? 'Pause' : 'Play'}
                  onClick={(e) => {
                    e.stopPropagation();
                    tactile.playAction(!(isActive && isAudioPlaying));
                    void playRecordingItem(rec);
                  }}
                  className={`min-w-[36px] min-h-[36px] rounded-xl flex items-center justify-center shrink-0 ${
                    isActive ? 'accent-bg' : 'accent-soft-bg'
                  }`}
                >
                  {isActive && isAudioPlaying ? (
                    <Pause className="w-4 h-4" />
                  ) : (
                    <CategoryIcon category={rec.recordingCategory} className="w-4 h-4" />
                  )}
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs sm:text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {rec.title}
                    </span>
                    {hasTranscript && (
                      <FileText
                        className="w-3.5 h-3.5 accent-text shrink-0"
                        aria-label="Transcript available"
                      />
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                    {catLabel}
                    {rec.folderPath ? ` · ${rec.folderPath}` : ''}
                    {` · ${formatDuration(rec.duration)}`}
                    {rec.addedAt ? ` · ${formatShortDate(rec.addedAt)}` : ''}
                  </div>
                </div>

                {/* Optional user-triggered Transcribe or Save .txt action */}
                <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {hasTranscript ? (
                    <button
                      type="button"
                      disabled={savingId === rec.id}
                      onClick={() => void handleSaveTxtNearSource(rec)}
                      title="Save transcript & tags as .txt near source"
                      className="min-h-[32px] px-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[11px] font-medium flex items-center gap-1 whitespace-nowrap"
                    >
                      {savingId === rec.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Save className="w-3 h-3" />
                      )}
                      <span className="hidden sm:inline">Save .txt</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={Boolean(transcribingId)}
                      onClick={() => void handleTranscribeRecording(rec)}
                      className="min-h-[32px] px-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[11px] font-medium flex items-center gap-1 whitespace-nowrap disabled:opacity-50"
                    >
                      {isTranscribingThis ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Sparkles className="w-3 h-3 accent-text" />
                      )}
                      <span>{isTranscribingThis ? 'Working...' : 'Transcribe'}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    aria-label={`More options for ${rec.title}`}
                    onClick={(e) => openAnchoredMenu(e, rec)}
                    className="min-w-[34px] min-h-[34px] rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {filteredRecordings.length > 0 && (
        <PaginationBar
          page={safePage}
          totalPages={totalPages}
          totalItems={filteredRecordings.length}
          pageSize={layout.pageSize}
          onChangePage={setPage}
          itemLabel="recordings"
        />
      )}

      {/* Anchored 3-dots Portal Menu */}
      {menuTarget &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 z-[90]" onClick={() => setMenuTarget(null)}>
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ top: menuTarget.top, left: menuTarget.left }}
              className="fixed w-[224px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl p-1.5 text-xs"
            >
              <div className="px-2.5 py-1.5 border-b border-zinc-200/70 dark:border-zinc-800/70 font-medium text-zinc-900 dark:text-zinc-100 truncate">
                {menuTarget.recording.title}
              </div>

              <button
                type="button"
                onClick={() => {
                  const rec = menuTarget.recording;
                  setMenuTarget(null);
                  void playRecordingItem(rec);
                }}
                className="w-full min-h-[36px] px-2.5 rounded-lg flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-left"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Play Recording</span>
              </button>

              <button
                type="button"
                disabled={Boolean(transcribingId)}
                onClick={() => {
                  const rec = menuTarget.recording;
                  setMenuTarget(null);
                  void handleTranscribeRecording(rec);
                }}
                className="w-full min-h-[36px] px-2.5 rounded-lg flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-left disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5 accent-text" />
                <span>
                  {menuTarget.recording.transcript ? 'Re-Transcribe Audio' : 'Transcribe Audio (AI)'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => openInspector(menuTarget.recording)}
                className="w-full min-h-[36px] px-2.5 rounded-lg flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-left"
              >
                <Tag className="w-3.5 h-3.5" />
                <span>View / Edit Tags & Transcript</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const rec = menuTarget.recording;
                  setMenuTarget(null);
                  void handleSaveTxtNearSource(rec);
                }}
                className="w-full min-h-[36px] px-2.5 rounded-lg flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-left"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save .txt Near Source</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const rec = menuTarget.recording;
                  setMenuTarget(null);
                  setConfirmDeleteItem(rec);
                }}
                className="w-full min-h-[36px] px-2.5 rounded-lg flex items-center gap-2 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-left"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Recording</span>
              </button>
            </div>
          </div>,
          document.body
        )}

      {/* Recording Details / Tags / Transcript Modal */}
      {inspectedRecording &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[95] bg-black/65 backdrop-blur-sm flex items-center justify-center p-2.5 sm:p-4"
            onClick={() => setInspectId(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3.5 sm:p-5 shadow-2xl flex flex-col gap-3 max-h-[90dvh] overflow-hidden"
            >
              <div className="flex items-start justify-between gap-2 pb-2 border-b border-zinc-200 dark:border-zinc-800">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-mono-tabular uppercase tracking-wider accent-text">
                    {getRecordingCategoryLabel(inspectedRecording.recordingCategory)}
                  </div>
                  <h3 className="text-sm sm:text-base font-display font-bold text-zinc-900 dark:text-zinc-100 truncate">
                    {inspectedRecording.title}
                  </h3>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                    {inspectedRecording.folderPath} · {inspectedRecording.fileName} ·{' '}
                    {formatDuration(inspectedRecording.duration)}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Close transcript dialog"
                  onClick={() => setInspectId(null)}
                  className="min-w-[34px] min-h-[34px] rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {editingFields ? (
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className="text-[11px] text-zinc-500 dark:text-zinc-400 flex flex-col gap-1">
                      Title
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="min-h-[36px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100"
                      />
                    </label>
                    <label className="text-[11px] text-zinc-500 dark:text-zinc-400 flex flex-col gap-1">
                      Recording Type
                      <select
                        value={editCategory}
                        onChange={(e) => setEditCategory(e.target.value as RecordingCategory)}
                        className="min-h-[36px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100"
                      >
                        {RECORDING_CATEGORIES.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className="text-[11px] text-zinc-500 dark:text-zinc-400 flex flex-col gap-1">
                      Participants / Caller (comma separated)
                      <input
                        type="text"
                        value={editParticipants}
                        onChange={(e) => setEditParticipants(e.target.value)}
                        className="min-h-[36px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100"
                      />
                    </label>
                    <label className="text-[11px] text-zinc-500 dark:text-zinc-400 flex flex-col gap-1">
                      Tags (comma separated)
                      <input
                        type="text"
                        value={editTags}
                        onChange={(e) => setEditTags(e.target.value)}
                        className="min-h-[36px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100"
                      />
                    </label>
                  </div>
                  <label className="text-[11px] text-zinc-500 dark:text-zinc-400 flex flex-col gap-1">
                    Transcript Text
                    <textarea
                      rows={5}
                      value={editTranscript}
                      onChange={(e) => setEditTranscript(e.target.value)}
                      className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 resize-none"
                    />
                  </label>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingFields(false)}
                      className="min-h-[34px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onUpdateRecording(inspectedRecording.id, {
                          title: editTitle.trim() || inspectedRecording.title,
                          recordingCategory: editCategory,
                          artist: getRecordingCategoryLabel(editCategory),
                          genre: getRecordingCategoryLabel(editCategory),
                          recordingParticipants: editParticipants
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean),
                          transcriptTags: editTags
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean),
                          transcript: editTranscript.trim(),
                        });
                        setEditingFields(false);
                        setTranscriptPage(0);
                        tactile.success();
                      }}
                      className="min-h-[34px] px-3 rounded-lg accent-bg text-xs font-medium flex items-center gap-1"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Save Changes</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2.5 min-h-0">
                  <div className="text-[11px] text-zinc-600 dark:text-zinc-300 space-y-1 bg-zinc-50 dark:bg-zinc-900/70 rounded-xl p-2.5 border border-zinc-200/70 dark:border-zinc-800/70">
                    <div>
                      <span className="text-zinc-400">Participants: </span>
                      {(inspectedRecording.recordingParticipants || []).join(', ') || 'Not specified'}
                    </div>
                    <div>
                      <span className="text-zinc-400">Tags: </span>
                      {(inspectedRecording.transcriptTags || []).join(', ') || 'None'}
                    </div>
                    {inspectedRecording.transcriptSummary && (
                      <div>
                        <span className="text-zinc-400">Summary: </span>
                        {inspectedRecording.transcriptSummary}
                      </div>
                    )}
                    {inspectedRecording.transcriptSavedPath && (
                      <div className="text-emerald-600 dark:text-emerald-400 truncate">
                        Saved .txt: {inspectedRecording.transcriptSavedPath}
                      </div>
                    )}
                  </div>

                  {/* Paginated Transcript Body (Zero scrollbars) */}
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 p-3 min-h-[120px] flex flex-col justify-between gap-2">
                    {transcriptChunks.length > 0 ? (
                      <>
                        <p className="text-xs leading-relaxed text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap">
                          {transcriptChunks[safeTranscriptPage]}
                        </p>
                        {transcriptChunks.length > 1 && (
                          <div className="flex items-center justify-between pt-2 border-t border-zinc-200/70 dark:border-zinc-800/70 text-[11px]">
                            <button
                              type="button"
                              disabled={safeTranscriptPage <= 0}
                              onClick={() => setTranscriptPage((p) => Math.max(0, p - 1))}
                              className="min-h-[28px] px-2 rounded-lg border border-zinc-200 dark:border-zinc-800 flex items-center gap-1 disabled:opacity-40"
                            >
                              <ChevronLeft className="w-3.5 h-3.5" />
                              Prev
                            </button>
                            <span className="font-mono-tabular text-zinc-500">
                              Part {safeTranscriptPage + 1} / {transcriptChunks.length}
                            </span>
                            <button
                              type="button"
                              disabled={safeTranscriptPage >= transcriptChunks.length - 1}
                              onClick={() =>
                                setTranscriptPage((p) =>
                                  Math.min(transcriptChunks.length - 1, p + 1)
                                )
                              }
                              className="min-h-[28px] px-2 rounded-lg border border-zinc-200 dark:border-zinc-800 flex items-center gap-1 disabled:opacity-40"
                            >
                              Next
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center text-center py-4 gap-1.5">
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          Not transcribed yet. Transcription is optional and runs only when you choose.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Modal Footer Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setEditingFields(true)}
                      className="min-h-[36px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-xs font-medium"
                    >
                      Edit Tags / Text
                    </button>

                    <div className="flex items-center gap-1.5 ml-auto">
                      <button
                        type="button"
                        disabled={Boolean(transcribingId)}
                        onClick={() => void handleTranscribeRecording(inspectedRecording)}
                        className="min-h-[36px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {transcribingId === inspectedRecording.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="w-3.5 h-3.5 accent-text" />
                        )}
                        <span>
                          {inspectedRecording.transcript ? 'Re-Transcribe' : 'Transcribe AI'}
                        </span>
                      </button>

                      <button
                        type="button"
                        disabled={savingId === inspectedRecording.id}
                        onClick={() => void handleSaveTxtNearSource(inspectedRecording)}
                        className="min-h-[36px] px-3 rounded-lg accent-bg text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {savingId === inspectedRecording.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Save className="w-3.5 h-3.5" />
                        )}
                        <span>Save .txt Near Source</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}

      {/* Delete Recording Confirmation Modal */}
      {confirmDeleteItem &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] bg-black/65 backdrop-blur-sm flex items-center justify-center p-3"
            onClick={() => setConfirmDeleteItem(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 shadow-2xl space-y-3"
            >
              <h3 className="text-sm font-display font-bold text-zinc-900 dark:text-zinc-100">
                Delete recording from device?
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                "{confirmDeleteItem.title}" will be permanently removed from the Recordings Vault and deleted from its source folder.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteItem(null)}
                  className="min-h-[36px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const target = confirmDeleteItem;
                    setConfirmDeleteItem(null);
                    if (playingId === target.id) stopVaultAudio();
                    if (inspectId === target.id) setInspectId(null);
                    void onDeleteRecordings([target]);
                  }}
                  className="min-h-[36px] px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium"
                >
                  Delete File
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
