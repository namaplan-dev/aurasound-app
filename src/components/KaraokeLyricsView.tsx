import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Cast,
  Disc3,
  Loader2,
  Maximize2,
  Minimize2,
  Mic2,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import { Track } from '../types/music';
import { audioEngine } from '../services/audioEngine';
import { KaraokeLine, parseLyricsForKaraoke } from '../services/aiAssistantService';
import {
  KaraokeCastPayload,
  readKaraokeCastState,
  subscribeKaraokeCastState,
} from '../services/karaokeCastChannel';
import { CoverArt } from './CoverArt';
import { tactile } from '../services/tactileFeedback';
import { formatDuration } from '../utils/textNormalization';

interface KaraokeLyricsViewProps {
  track: Track;
  isPlaying: boolean;
  offsetMs: number;
  tvStage?: boolean;
  fetchingLyrics?: boolean;
  externalPositionSec?: number;
  externalDurationSec?: number;
  onChangeOffsetMs?: (nextMs: number) => void;
  onSeek?: (seconds: number) => void;
  onFetchLyrics?: (track: Track) => void;
  onOpenCast?: () => void;
  onToggleTvStage?: () => void;
  onShowAlbumCover?: () => void;
}

export const KaraokeLyricsView: React.FC<KaraokeLyricsViewProps> = ({
  track,
  isPlaying,
  offsetMs,
  tvStage = false,
  fetchingLyrics = false,
  externalPositionSec,
  externalDurationSec,
  onChangeOffsetMs,
  onSeek,
  onFetchLyrics,
  onOpenCast,
  onToggleTvStage,
  onShowAlbumCover,
}) => {
  const isExternalFeed = externalPositionSec !== undefined;
  const [liveTime, setLiveTime] = useState<number>(() =>
    isExternalFeed ? externalPositionSec || 0 : audioEngine.getState().currentTime
  );
  const [liveDuration, setLiveDuration] = useState<number>(() =>
    isExternalFeed ? externalDurationSec || track.duration || 180 : track.duration || 180
  );

  const anchorRef = useRef<{ posSec: number; stampMs: number }>({
    posSec: isExternalFeed ? externalPositionSec || 0 : audioEngine.getState().currentTime,
    stampMs: performance.now(),
  });

  // Subscribe to local audioEngine unless driven externally (TV receiver mode)
  useEffect(() => {
    if (isExternalFeed) {
      const nextPos = externalPositionSec || 0;
      const nextDur = externalDurationSec || track.duration || 180;
      anchorRef.current = { posSec: nextPos, stampMs: performance.now() };
      setLiveTime(nextPos);
      setLiveDuration(nextDur);
      return;
    }

    const st = audioEngine.getState();
    anchorRef.current = { posSec: st.currentTime, stampMs: performance.now() };
    setLiveTime(st.currentTime);
    if (st.duration > 0) setLiveDuration(st.duration);

    return audioEngine.subscribeProgress(({ currentTime, duration }) => {
      anchorRef.current = { posSec: currentTime, stampMs: performance.now() };
      setLiveTime(currentTime);
      if (duration > 0) setLiveDuration(duration);
    });
  }, [isExternalFeed, externalPositionSec, externalDurationSec, track.id, track.duration]);

  // Smooth 60fps animation frame interpolation for silky karaoke highlight sweep
  useEffect(() => {
    if (!isPlaying) return;
    let rafId = 0;
    const tick = () => {
      if (!document.hidden) {
        const elapsedSec = (performance.now() - anchorRef.current.stampMs) / 1000;
        const interpolated = Math.min(
          Math.max(1, liveDuration),
          Math.max(0, anchorRef.current.posSec + Math.max(0, elapsedSec))
        );
        setLiveTime(interpolated);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, liveDuration]);

  const lines: KaraokeLine[] = useMemo(
    () => parseLyricsForKaraoke(track.lyrics, liveDuration || track.duration || 180),
    [track.lyrics, liveDuration, track.duration]
  );

  const effectiveTime = Math.max(0, liveTime + offsetMs / 1000);

  const activeIdx = useMemo(() => {
    if (lines.length === 0) return -1;
    let found = -1;
    for (let i = 0; i < lines.length; i++) {
      if (effectiveTime >= lines[i].timeSec) {
        found = i;
      } else {
        break;
      }
    }
    return found;
  }, [lines, effectiveTime]);

  const hasSyncedTimestamps = lines.some((l) => l.isSynced);

  // Sliding window centered on active lyric line (zero scrollable container needed)
  const windowSize = tvStage ? 7 : 5;
  const beforeCount = tvStage ? 2 : 1;
  const visibleSlice = useMemo(() => {
    if (lines.length === 0) return { items: [] as Array<{ line: KaraokeLine; idx: number }>, start: 0 };
    const focusIdx = activeIdx >= 0 ? activeIdx : 0;
    const maxStart = Math.max(0, lines.length - windowSize);
    const start = Math.max(0, Math.min(maxStart, focusIdx - beforeCount));
    const end = Math.min(lines.length, start + windowSize);
    const items: Array<{ line: KaraokeLine; idx: number }> = [];
    for (let i = start; i < end; i++) {
      items.push({ line: lines[i], idx: i });
    }
    return { items, start };
  }, [lines, activeIdx, windowSize, beforeCount]);

  // Intro countdown indicator when before the first lyric line
  const firstLine = lines[0];
  const waitingForIntro =
    Boolean(firstLine) && activeIdx === -1 && effectiveTime < firstLine.timeSec;
  const introRemaining = waitingForIntro ? Math.max(0, firstLine.timeSec - effectiveTime) : 0;
  const introProgressPct =
    waitingForIntro && firstLine.timeSec > 0
      ? Math.min(100, Math.max(0, (effectiveTime / firstLine.timeSec) * 100))
      : 0;

  // Progress sweep inside currently active line (0..100%)
  const activeSweepPct = useMemo(() => {
    if (activeIdx < 0 || activeIdx >= lines.length) return 0;
    const cur = lines[activeIdx];
    const span = Math.max(0.45, cur.endSec - cur.timeSec);
    return Math.min(100, Math.max(0, ((effectiveTime - cur.timeSec) / span) * 100));
  }, [activeIdx, lines, effectiveTime]);

  if (lines.length === 0) {
    return (
      <div
        className={`w-full h-full min-h-0 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/75 p-4 flex flex-col items-center justify-center text-center gap-3 ${
          tvStage ? 'max-w-3xl mx-auto' : ''
        }`}
      >
        <CoverArt
          src={track.coverUrl}
          alt={track.title}
          className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl shadow-lg border border-zinc-200/60 dark:border-zinc-800"
        />
        <div className="space-y-1 max-w-xs">
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center justify-center gap-1.5">
            <Mic2 className="w-4 h-4 accent-text" />
            <span>No Embedded Lyrics Yet</span>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Let AI find synced karaoke lyrics and save them right into this audio file.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          {onFetchLyrics && (
            <button
              type="button"
              disabled={fetchingLyrics}
              onClick={() => {
                tactile.tap();
                onFetchLyrics(track);
              }}
              className="min-h-[36px] px-3.5 rounded-xl accent-bg text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              {fetchingLyrics ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>{fetchingLyrics ? 'Finding Lyrics...' : 'Add Lyrics with AI'}</span>
            </button>
          )}
          {onShowAlbumCover && (
            <button
              type="button"
              onClick={() => {
                tactile.tap();
                onShowAlbumCover();
              }}
              className="min-h-[36px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium inline-flex items-center gap-1.5 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <Disc3 className="w-3.5 h-3.5" />
              <span>Album Cover</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative w-full h-full min-h-0 rounded-2xl overflow-hidden border flex flex-col justify-between ${
        tvStage
          ? 'border-zinc-800 bg-zinc-950 text-white p-4 sm:p-8 shadow-2xl'
          : 'border-zinc-200/80 dark:border-zinc-800 bg-zinc-950 text-white p-3 sm:p-4 shadow-xl'
      }`}
    >
      {/* Subtle Blurred Album Artwork Stage Backdrop */}
      {track.coverUrl && (
        <div
          aria-hidden="true"
          style={{ backgroundImage: `url(${track.coverUrl})` }}
          className="absolute inset-0 bg-cover bg-center opacity-22 blur-2xl scale-110 pointer-events-none"
        />
      )}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-b from-zinc-950/75 via-zinc-950/65 to-zinc-950/90 pointer-events-none"
      />

      {/* Top Karaoke Header Bar */}
      <div className="relative z-10 shrink-0 flex items-center justify-between gap-2 pb-2 border-b border-white/10">
        <div className="flex items-center gap-2 min-w-0">
          <CoverArt
            src={track.coverUrl}
            alt={track.title}
            isPlaying={isPlaying}
            className="w-8 h-8 rounded-lg shrink-0"
          />
          <div className="min-w-0">
            <div className="text-xs sm:text-sm font-semibold text-white truncate flex items-center gap-1.5">
              <Mic2 className="w-3.5 h-3.5 accent-text shrink-0" />
              <span className="truncate">
                {tvStage ? `${track.title} — ${track.artist}` : 'Karaoke Lyrics'}
              </span>
            </div>
            <div className="text-[10px] text-zinc-400 font-mono-tabular flex items-center gap-1.5">
              <span>{hasSyncedTimestamps ? 'LRC Synced' : 'Timed Flow'}</span>
              <span>·</span>
              <span>
                {activeIdx >= 0 ? `${activeIdx + 1}/${lines.length}` : `0/${lines.length}`}
              </span>
              {offsetMs !== 0 && (
                <>
                  <span>·</span>
                  <span className="accent-text">
                    Sync {offsetMs > 0 ? `+${(offsetMs / 1000).toFixed(1)}s` : `${(offsetMs / 1000).toFixed(1)}s`}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {onChangeOffsetMs && (
            <div className="hidden xs:flex sm:flex items-center rounded-lg border border-white/15 bg-white/5 overflow-hidden text-[10px] font-mono-tabular">
              <button
                type="button"
                title="Delay lyrics -0.5s"
                onClick={(e) => {
                  e.stopPropagation();
                  tactile.tap();
                  onChangeOffsetMs(Math.max(-10000, offsetMs - 500));
                }}
                className="px-1.5 py-1 text-zinc-300 hover:bg-white/10"
              >
                -0.5s
              </button>
              <button
                type="button"
                title="Reset lyric sync offset"
                onClick={(e) => {
                  e.stopPropagation();
                  tactile.tap();
                  onChangeOffsetMs(0);
                }}
                className="px-1 py-1 text-zinc-400 hover:text-white border-x border-white/10"
                aria-label="Reset lyric timing offset"
              >
                <RotateCcw className="w-2.5 h-2.5" />
              </button>
              <button
                type="button"
                title="Advance lyrics +0.5s"
                onClick={(e) => {
                  e.stopPropagation();
                  tactile.tap();
                  onChangeOffsetMs(Math.min(10000, offsetMs + 500));
                }}
                className="px-1.5 py-1 text-zinc-300 hover:bg-white/10"
              >
                +0.5s
              </button>
            </div>
          )}

          {onOpenCast && (
            <button
              type="button"
              title="Cast Karaoke TV & Audio"
              onClick={(e) => {
                e.stopPropagation();
                tactile.tap();
                onOpenCast();
              }}
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg border border-white/15 bg-white/5 hover:bg-white/15 flex items-center justify-center text-zinc-200"
              aria-label="Cast Karaoke Display"
            >
              <Cast className="w-3.5 h-3.5" />
            </button>
          )}

          {onToggleTvStage && (
            <button
              type="button"
              title={tvStage ? 'Exit Fullscreen Karaoke' : 'Fullscreen Karaoke Stage'}
              onClick={(e) => {
                e.stopPropagation();
                tactile.tap();
                onToggleTvStage();
              }}
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg border border-white/15 bg-white/5 hover:bg-white/15 flex items-center justify-center text-zinc-200"
              aria-label={tvStage ? 'Exit fullscreen karaoke' : 'Open fullscreen karaoke'}
            >
              {tvStage ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          {onShowAlbumCover && !tvStage && (
            <button
              type="button"
              title="Hide Lyrics & Show Album Cover"
              onClick={(e) => {
                e.stopPropagation();
                tactile.tap();
                onShowAlbumCover();
              }}
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg border border-white/15 bg-white/5 hover:bg-white/15 flex items-center justify-center text-zinc-200"
              aria-label="Switch to Album Cover"
            >
              <Disc3 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Center Live Synchronized Karaoke Lines */}
      <div className="relative z-10 flex-1 min-h-0 flex flex-col justify-center gap-1.5 sm:gap-2.5 py-2 overflow-hidden">
        {waitingForIntro && (
          <div className="flex items-center justify-center gap-2 pb-1">
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full transition-colors ${
                  introProgressPct > 25 ? 'accent-bg' : 'bg-white/30'
                }`}
              />
              <span
                className={`w-2 h-2 rounded-full transition-colors ${
                  introProgressPct > 55 ? 'accent-bg' : 'bg-white/30'
                }`}
              />
              <span
                className={`w-2 h-2 rounded-full transition-colors ${
                  introProgressPct > 82 ? 'accent-bg' : 'bg-white/30'
                }`}
              />
            </div>
            <span className="text-[11px] font-mono-tabular text-zinc-300">
              Vocals in {Math.ceil(introRemaining)}s
            </span>
          </div>
        )}

        {visibleSlice.items.map(({ line, idx }) => {
          const isCurrent = idx === activeIdx;
          const isPast = activeIdx >= 0 && idx < activeIdx;
          const isNext = idx === activeIdx + 1;

          return (
            <button
              key={`${idx}_${line.timeSec}`}
              type="button"
              disabled={!onSeek}
              onClick={(e) => {
                e.stopPropagation();
                if (!onSeek) return;
                tactile.tap();
                onSeek(line.timeSec);
              }}
              className={`w-full text-center px-2 py-0.5 rounded-xl transition-all duration-300 ${
                onSeek ? 'hover:bg-white/5 cursor-pointer' : 'cursor-default'
              } ${
                isCurrent
                  ? 'scale-[1.03] opacity-100'
                  : isNext
                  ? 'opacity-75 scale-[0.98]'
                  : isPast
                  ? 'opacity-35 scale-[0.95]'
                  : 'opacity-45 scale-[0.96]'
              }`}
            >
              {isCurrent ? (
                <div className="inline-flex flex-col items-center max-w-full">
                  <span
                    style={{
                      backgroundImage: `linear-gradient(90deg, var(--accent, #f59e0b) 0%, #fde68a ${Math.min(
                        100,
                        activeSweepPct + 2
                      )}%, rgba(255,255,255,0.45) ${Math.min(100, activeSweepPct + 8)}%, rgba(255,255,255,0.45) 100%)`,
                      WebkitBackgroundClip: 'text',
                      backgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      color: 'transparent',
                      WebkitBoxDecorationBreak: 'clone',
                      boxDecorationBreak: 'clone',
                    }}
                    className={`font-display font-bold leading-snug tracking-tight ${
                      tvStage
                        ? 'text-xl sm:text-3xl lg:text-4xl'
                        : 'text-base sm:text-xl lg:text-2xl'
                    }`}
                  >
                    {line.text}
                  </span>
                  <div className="mt-1 w-28 sm:w-40 h-1 rounded-full bg-white/15 overflow-hidden">
                    <div
                      style={{ width: `${activeSweepPct}%` }}
                      className="h-full rounded-full accent-bg transition-[width] duration-75"
                    />
                  </div>
                </div>
              ) : (
                <span
                  className={`font-display leading-snug block ${
                    tvStage
                      ? 'text-base sm:text-xl lg:text-2xl font-medium text-zinc-200'
                      : 'text-xs sm:text-sm lg:text-base font-medium text-zinc-200'
                  }`}
                >
                  {line.text}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Bottom Timing Hint & Live Line Progress */}
      <div className="relative z-10 shrink-0 pt-1.5 border-t border-white/10 flex items-center justify-between gap-2 text-[10px] font-mono-tabular text-zinc-400">
        <span>{formatDuration(liveTime)}</span>
        <span className="truncate">
          {onSeek ? 'Tap any line to jump · Karaoke Stage' : 'AuraSound Live Karaoke'}
        </span>
        <span>{formatDuration(liveDuration)}</span>
      </div>
    </div>
  );
};

interface KaraokeTvStageOverlayProps {
  open: boolean;
  track: Track;
  isPlaying: boolean;
  offsetMs: number;
  fetchingLyrics?: boolean;
  onChangeOffsetMs: (nextMs: number) => void;
  onSeek: (seconds: number) => void;
  onFetchLyrics?: (track: Track) => void;
  onOpenCast?: () => void;
  onClose: () => void;
}

export const KaraokeTvStageOverlay: React.FC<KaraokeTvStageOverlayProps> = ({
  open,
  track,
  isPlaying,
  offsetMs,
  fetchingLyrics,
  onChangeOffsetMs,
  onSeek,
  onFetchLyrics,
  onOpenCast,
  onClose,
}) => {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Fullscreen Karaoke Stage"
      onClick={(e) => e.stopPropagation()}
      className="fixed inset-0 z-[80] bg-zinc-950 p-3 sm:p-6 flex flex-col gap-3"
    >
      <div className="shrink-0 flex items-center justify-between gap-2 text-white">
        <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
          AuraSound Karaoke TV Stage
        </div>
        <button
          type="button"
          onClick={() => {
            tactile.tap();
            onClose();
          }}
          aria-label="Exit Karaoke Stage"
          className="min-h-[34px] px-3 rounded-xl border border-white/15 bg-white/10 hover:bg-white/20 text-xs font-medium inline-flex items-center gap-1.5"
        >
          <X className="w-4 h-4" />
          <span>Exit Stage</span>
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <KaraokeLyricsView
          track={track}
          isPlaying={isPlaying}
          offsetMs={offsetMs}
          tvStage
          fetchingLyrics={fetchingLyrics}
          onChangeOffsetMs={onChangeOffsetMs}
          onSeek={onSeek}
          onFetchLyrics={onFetchLyrics}
          onOpenCast={onOpenCast}
          onToggleTvStage={onClose}
        />
      </div>
    </div>
  );
};

export const KaraokeReceiverDisplayScreen: React.FC = () => {
  const [payload, setPayload] = useState<KaraokeCastPayload | null>(() => readKaraokeCastState());

  useEffect(() => {
    return subscribeKaraokeCastState((next) => {
      setPayload(next);
    });
  }, []);

  useEffect(() => {
    if (!payload) return;
    document.documentElement.classList.add('dark');
    document.documentElement.setAttribute('data-accent', payload.themeAccent || 'amber');
  }, [payload]);

  const synthTrack: Track = useMemo(
    () =>
      payload
        ? {
            id: payload.trackId,
            fingerprint: payload.trackId,
            title: payload.title,
            artist: payload.artist,
            album: payload.album,
            genre: '',
            duration: payload.duration || 180,
            format: 'FLAC',
            bitDepth: 24,
            sampleRate: 96000,
            bitrateKbps: 1411,
            coverUrl: payload.coverUrl,
            audioUrl: '',
            source: 'local',
            favorite: false,
            rating: 0,
            playCount: 0,
            addedAt: 0,
            offlineCached: false,
            lyrics: payload.lyrics,
          }
        : {
            id: 'idle',
            fingerprint: 'idle',
            title: 'Waiting for AuraSound Playback',
            artist: 'Start playing a track on your controller',
            album: 'Karaoke TV Receiver',
            genre: '',
            duration: 180,
            format: 'FLAC',
            bitDepth: 24,
            sampleRate: 96000,
            bitrateKbps: 1411,
            coverUrl: '',
            audioUrl: '',
            source: 'local',
            favorite: false,
            rating: 0,
            playCount: 0,
            addedAt: 0,
            offlineCached: false,
          },
    [payload]
  );

  const elapsedSinceUpdate =
    payload && payload.isPlaying ? Math.max(0, (Date.now() - payload.updatedAtMs) / 1000) : 0;

  return (
    <div className="fixed inset-0 bg-zinc-950 text-white p-4 sm:p-8 flex flex-col">
      <KaraokeLyricsView
        track={synthTrack}
        isPlaying={Boolean(payload?.isPlaying)}
        offsetMs={payload?.karaokeOffsetMs || 0}
        tvStage
        externalPositionSec={
          payload ? Math.min(payload.duration || 180, payload.currentTime + elapsedSinceUpdate) : 0
        }
        externalDurationSec={payload?.duration || 180}
      />
    </div>
  );
};
