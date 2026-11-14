import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  Cast,
  ChevronDown,
  Disc3,
  Heart,
  Library,
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Share2,
  Shuffle,
  SkipBack,
  SkipForward,
  Sliders,
  Star,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { RepeatMode, StreamingQuality, Track } from '../types/music';
import { audioEngine } from '../services/audioEngine';
import { formatDuration } from '../utils/textNormalization';
import { CoverArt } from './CoverArt';
import { PaginationBar } from './PaginationBar';
import { useViewportPageSize } from '../hooks/useViewportPageSize';
import { tactile } from '../services/tactileFeedback';
import { APP_VERSION } from '../version';

export interface NowPlayingSheetHandle {
  peekFromBottom: (dyNegative: number) => void;
  releaseFromBottom: (commitOpen: boolean) => void;
}

interface NowPlayingViewProps {
  open: boolean;
  track: Track | null;
  nextTrack?: Track | null;
  queue?: Track[];
  isPlaying: boolean;
  shuffle: boolean;
  repeatMode: RepeatMode;
  volume: number;
  lowBatteryMode: boolean;
  streamingQuality: StreamingQuality;
  onClose: () => void;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onPlayQueueTrack?: (track: Track) => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onChangeVolume: (vol: number) => void;
  onToggleFavorite: (trackId: string) => void;
  onRateTrack: (trackId: string, rating: number) => void;
  onOpenEqualizer: () => void;
  onOpenCast: () => void;
  onOpenShare: () => void;
  onGoToAlbum: (album: string) => void;
  onGoToArtist: (artist: string) => void;
}

type DeckPage = 'player' | 'queue';

export const NowPlayingView = React.memo(
  React.forwardRef<NowPlayingSheetHandle, NowPlayingViewProps>(
    (
      {
        open,
        track,
        nextTrack,
        queue = [],
        isPlaying,
        shuffle,
        repeatMode,
        volume,
        lowBatteryMode,
        streamingQuality,
        onClose,
        onTogglePlay,
        onPrev,
        onNext,
        onPlayQueueTrack,
        onToggleShuffle,
        onCycleRepeat,
        onChangeVolume,
        onToggleFavorite,
        onRateTrack,
        onOpenEqualizer,
        onOpenCast,
        onOpenShare,
        onGoToAlbum,
        onGoToArtist,
      },
      ref
    ) => {
      const [deckPage, setDeckPage] = useState<DeckPage>('player');
      const [queuePage, setQueuePage] = useState(0);
      const [progress, setProgress] = useState({ currentTime: 0, duration: track?.duration || 0 });
      const [dragTime, setDragTime] = useState<number | null>(null);

      const canvasRef = useRef<HTMLCanvasElement | null>(null);
      const backdropRef = useRef<HTMLDivElement | null>(null);
      const sheetRef = useRef<HTMLDivElement | null>(null);
      const queueViewportRef = useRef<HTMLDivElement | null>(null);

      const dragStateRef = useRef<{
        pointerId: number;
        startX: number;
        startY: number;
        prevY: number;
        prevTime: number;
        velocityY: number;
        active: boolean;
        aborted: boolean;
        captured: boolean;
        lastOffset: number;
        rafId: number | null;
      } | null>(null);

      const queueLayout = useViewportPageSize(queueViewportRef, {
        mode: 'list',
        listRowHeight: 54,
        verticalPadding: 4,
      });

      const queueTotalPages = Math.max(1, Math.ceil(queue.length / queueLayout.pageSize));
      const safeQueuePage = Math.max(0, Math.min(queueTotalPages - 1, queuePage));
      const pagedQueue = useMemo(() => {
        const start = safeQueuePage * queueLayout.pageSize;
        return queue.slice(start, start + queueLayout.pageSize);
      }, [queue, safeQueuePage, queueLayout.pageSize]);

      useImperativeHandle(ref, () => ({
        peekFromBottom: (dyNegative: number) => {
          const clamped = Math.min(0, dyNegative);
          const vh = Math.max(460, window.innerHeight || 720);
          const progressRatio = Math.min(1, Math.max(0, Math.abs(clamped) / vh));
          if (backdropRef.current) {
            backdropRef.current.style.transitionDuration = '0ms';
            backdropRef.current.style.opacity = String(progressRatio);
          }
          if (sheetRef.current) {
            sheetRef.current.style.transitionDuration = '0ms';
            sheetRef.current.style.borderTopLeftRadius = '24px';
            sheetRef.current.style.borderTopRightRadius = '24px';
            sheetRef.current.style.transform = `translate3d(0, calc(100% + ${clamped}px), 0)`;
          }
        },
        releaseFromBottom: (commitOpen: boolean) => {
          if (backdropRef.current) {
            backdropRef.current.style.transitionDuration = '320ms';
            backdropRef.current.style.opacity = commitOpen ? '1' : '0';
          }
          if (sheetRef.current) {
            sheetRef.current.style.transitionDuration = '320ms';
            sheetRef.current.style.borderTopLeftRadius = commitOpen ? '0px' : '24px';
            sheetRef.current.style.borderTopRightRadius = commitOpen ? '0px' : '24px';
            sheetRef.current.style.transform = commitOpen
              ? 'translate3d(0, 0, 0)'
              : 'translate3d(0, 100%, 0)';
          }
        },
      }));

      useEffect(() => {
        if (backdropRef.current) {
          backdropRef.current.style.transitionDuration = '320ms';
          backdropRef.current.style.opacity = open ? '1' : '0';
        }
        if (sheetRef.current) {
          sheetRef.current.style.transitionDuration = '320ms';
          sheetRef.current.style.borderTopLeftRadius = open ? '0px' : '24px';
          sheetRef.current.style.borderTopRightRadius = open ? '0px' : '24px';
          sheetRef.current.style.transform = open
            ? 'translate3d(0, 0, 0)'
            : 'translate3d(0, 100%, 0)';
        }
        dragStateRef.current = null;
        if (!open) return;
        return audioEngine.subscribeProgress(setProgress);
      }, [open]);

      useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
          if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [open, onClose]);

      // Real-time audio spectrum analyzer (respects Low Battery Mode & hidden tab)
      useEffect(() => {
        if (!open || deckPage !== 'player' || !isPlaying || lowBatteryMode) return;
        let rafId = 0;
        const bins = new Uint8Array(64);
        const draw = () => {
          if (!document.hidden) {
            const canvas = canvasRef.current;
            if (canvas) {
              const ctx = canvas.getContext('2d');
              if (ctx) {
                audioEngine.getFrequencyData(bins);
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                const barCount = 32;
                const barW = canvas.width / barCount;
                const accent =
                  getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() ||
                  '#d97706';
                ctx.fillStyle = accent;
                for (let i = 0; i < barCount; i++) {
                  const val = bins[i] || 0;
                  const h = Math.max(3, (val / 255) * canvas.height);
                  ctx.globalAlpha = 0.35 + (val / 255) * 0.65;
                  ctx.fillRect(i * barW + 2, canvas.height - h, Math.max(2, barW - 4), h);
                }
              }
            }
          }
          rafId = requestAnimationFrame(draw);
        };
        rafId = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(rafId);
      }, [open, deckPage, isPlaying, lowBatteryMode]);

      if (!track) return null;

      const dur = progress.duration || track.duration || 1;
      const displayTime = dragTime !== null ? dragTime : progress.currentTime;

      const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!open) return;
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        const target = e.target as HTMLElement;
        if (target.closest('input[type="range"]')) return;

        dragStateRef.current = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          prevY: e.clientY,
          prevTime: performance.now(),
          velocityY: 0,
          active: false,
          aborted: false,
          captured: false,
          lastOffset: 0,
          rafId: null,
        };
      };

      const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const state = dragStateRef.current;
        if (!state || state.aborted || e.pointerId !== state.pointerId) return;

        const now = performance.now();
        const dx = Math.abs(e.clientX - state.startX);
        const dy = e.clientY - state.startY;
        const dt = Math.max(8, now - state.prevTime);
        const instVel = (e.clientY - state.prevY) / dt;
        state.velocityY = state.velocityY * 0.45 + instVel * 0.55;
        state.prevY = e.clientY;
        state.prevTime = now;

        if (!state.active) {
          if (dx > 14 && dx > Math.abs(dy)) {
            state.aborted = true;
            return;
          }
          if (Math.abs(dy) < 6) return;
          if (dy < 0 && !((e.target as HTMLElement).closest('[data-sheet-handle="true"]'))) {
            state.aborted = true;
            return;
          }
          state.active = true;
          if (backdropRef.current) backdropRef.current.style.transitionDuration = '0ms';
          if (sheetRef.current) sheetRef.current.style.transitionDuration = '0ms';
          if (!state.captured) {
            state.captured = true;
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // ignore
            }
          }
        }

        const offset = dy >= 0 ? dy : Math.max(-22, dy * 0.16);
        state.lastOffset = offset;
        if (state.rafId === null) {
          state.rafId = requestAnimationFrame(() => {
            if (!dragStateRef.current) return;
            dragStateRef.current.rafId = null;
            const curOffset = dragStateRef.current.lastOffset;
            const vh = Math.max(460, window.innerHeight || 720);
            if (backdropRef.current) {
              backdropRef.current.style.opacity = String(
                curOffset > 0 ? Math.max(0, 1 - curOffset / vh) : 1
              );
            }
            if (sheetRef.current) {
              const radius = curOffset > 0 ? Math.min(24, curOffset * 0.25) : 0;
              sheetRef.current.style.borderTopLeftRadius = `${radius}px`;
              sheetRef.current.style.borderTopRightRadius = `${radius}px`;
              sheetRef.current.style.transform = `translate3d(0, ${curOffset}px, 0)`;
            }
          });
        }
      };

      const finishSheetDrag = (e: React.PointerEvent<HTMLDivElement>) => {
        const state = dragStateRef.current;
        if (!state || e.pointerId !== state.pointerId) return;
        dragStateRef.current = null;
        if (state.rafId !== null) cancelAnimationFrame(state.rafId);

        if (state.captured) {
          try {
            e.currentTarget.releasePointerCapture(e.pointerId);
          } catch {
            // ignore
          }
        }

        if (!state.active) {
          if (backdropRef.current) {
            backdropRef.current.style.transitionDuration = '320ms';
            backdropRef.current.style.opacity = open ? '1' : '0';
          }
          if (sheetRef.current) {
            sheetRef.current.style.transitionDuration = '320ms';
            sheetRef.current.style.borderTopLeftRadius = open ? '0px' : '24px';
            sheetRef.current.style.borderTopRightRadius = open ? '0px' : '24px';
            sheetRef.current.style.transform = open
              ? 'translate3d(0, 0, 0)'
              : 'translate3d(0, 100%, 0)';
          }
          return;
        }

        const vh = Math.max(460, window.innerHeight || 720);
        const distanceThreshold = Math.min(160, vh * 0.22);
        const shouldClose =
          state.lastOffset > distanceThreshold ||
          (state.lastOffset > 24 && state.velocityY > 0.35);

        if (backdropRef.current) {
          backdropRef.current.style.transitionDuration = '320ms';
          backdropRef.current.style.opacity = shouldClose ? '0' : '1';
        }
        if (sheetRef.current) {
          sheetRef.current.style.transitionDuration = '320ms';
          sheetRef.current.style.borderTopLeftRadius = shouldClose ? '24px' : '0px';
          sheetRef.current.style.borderTopRightRadius = shouldClose ? '24px' : '0px';
          sheetRef.current.style.transform = shouldClose
            ? 'translate3d(0, 100%, 0)'
            : 'translate3d(0, 0, 0)';
        }

        if (shouldClose) onClose();
      };

      return (
        <>
          <div
            ref={backdropRef}
            aria-hidden="true"
            style={{ opacity: open ? 1 : 0 }}
            className="fixed inset-0 z-[45] bg-black/45 pointer-events-none transition-opacity duration-300"
          />
          <div
            ref={sheetRef}
            aria-hidden={!open}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishSheetDrag}
            onPointerCancel={finishSheetDrag}
            style={{
              transform: open ? 'translate3d(0, 0, 0)' : 'translate3d(0, 100%, 0)',
              paddingTop: 'env(safe-area-inset-top, 0px)',
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
              touchAction: 'none',
            }}
            className={`fixed inset-0 z-50 h-full overflow-hidden bg-zinc-50 dark:bg-zinc-950 flex flex-col shadow-[0_-16px_48px_rgba(0,0,0,0.4)] will-change-transform transition-[transform,border-radius] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] touch-none select-none ${
              open ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
          >
            {/* Top Drag Handle Pill + Compact Header */}
            <div
              data-sheet-handle="true"
              className="z-10 bg-zinc-50/95 dark:bg-zinc-950/95 backdrop-blur-md border-b border-zinc-200/80 dark:border-zinc-800/80 shrink-0"
            >
              <div className="pt-1.5 pb-0.5 flex justify-center">
                <span className="w-12 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-600" />
              </div>
              <div className="flex items-center justify-between gap-2 px-3 sm:px-6 h-11">
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Slide down to Library"
                  className="min-h-[36px] px-2 flex items-center gap-1 rounded-xl hover:bg-zinc-200/60 dark:hover:bg-zinc-800 active:scale-95 transition-transform duration-100 text-xs font-medium text-zinc-700 dark:text-zinc-200 shrink-0"
                >
                  <ChevronDown className="w-4 h-4" />
                  <Library className="w-3.5 h-3.5 opacity-80" />
                  <span className="hidden xs:inline sm:inline">Library</span>
                </button>

                {/* Deck / Queue Page Switcher */}
                <div className="inline-flex items-center p-0.5 rounded-lg bg-zinc-200/75 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => {
                      tactile.tap();
                      setDeckPage('player');
                    }}
                    className={`min-h-[30px] px-2.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${
                      deckPage === 'player'
                        ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    <Disc3 className="w-3.5 h-3.5" />
                    <span>Deck</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      tactile.tap();
                      setDeckPage('queue');
                    }}
                    className={`min-h-[30px] px-2.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${
                      deckPage === 'queue'
                        ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    <ListMusic className="w-3.5 h-3.5" />
                    <span>Queue ({queue.length})</span>
                  </button>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <span className="hidden sm:inline text-[11px] font-mono-tabular text-zinc-500 mr-1">
                    {APP_VERSION}
                  </span>
                  <button
                    type="button"
                    onClick={onOpenShare}
                    aria-label="Share current track"
                    className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xl hover:bg-zinc-200/60 dark:hover:bg-zinc-800 active:scale-90 transition-transform duration-100"
                  >
                    <Share2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Unscrollable Body Area */}
            <div className="flex-1 min-h-0 overflow-hidden px-4 sm:px-8 py-2.5 sm:py-4 flex flex-col">
              {deckPage === 'player' ? (
                <div className="max-w-5xl w-full h-full min-h-0 mx-auto flex flex-col lg:flex-row [@media(max-height:540px)]:flex-row items-center justify-evenly gap-2.5 sm:gap-4 lg:gap-10">
                  {/* Fluid Viewport-Fitted Cover Art + Spectrum */}
                  <div
                    data-sheet-handle="true"
                    className="flex-1 min-h-0 w-full max-w-[320px] lg:max-w-[400px] [@media(max-height:540px)]:max-w-[200px] flex flex-col items-center justify-center gap-2"
                  >
                    <div className="h-[min(27dvh,220px)] sm:h-[min(36dvh,310px)] lg:h-[min(50dvh,380px)] [@media(max-height:540px)]:h-[min(56dvh,185px)] aspect-square max-w-full">
                      <CoverArt
                        src={track.coverUrl}
                        alt={track.title}
                        className="w-full h-full rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800"
                      />
                    </div>
                    {!lowBatteryMode && (
                      <canvas
                        ref={canvasRef}
                        width={360}
                        height={32}
                        className="w-full max-w-[300px] h-6 sm:h-8 [@media(max-height:540px)]:hidden rounded-lg opacity-90 shrink-0"
                      />
                    )}
                  </div>

                  {/* Right / Bottom Track Info & Transport Controls */}
                  <div className="w-full max-w-md shrink-0 flex flex-col gap-2.5 sm:gap-3.5 [@media(max-height:540px)]:gap-1.5">
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="min-w-0">
                        <h2 className="text-base sm:text-2xl font-display font-bold text-zinc-900 dark:text-zinc-100 leading-tight truncate">
                          {track.title}
                        </h2>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 truncate">
                          <button
                            type="button"
                            onClick={() => {
                              onGoToArtist(track.artist);
                              onClose();
                            }}
                            className="hover:underline font-medium text-zinc-800 dark:text-zinc-200 truncate"
                          >
                            {track.artist}
                          </button>
                          <span aria-hidden="true">·</span>
                          <button
                            type="button"
                            onClick={() => {
                              onGoToAlbum(track.album);
                              onClose();
                            }}
                            className="hover:underline truncate"
                          >
                            {track.album}
                            {track.year ? ` (${track.year})` : ''}
                          </button>
                        </div>
                        <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400 font-mono-tabular truncate">
                          {track.format} · {track.bitDepth}b/{(track.sampleRate / 1000).toFixed(1)}kHz ·{' '}
                          {streamingQuality === 'lossless-hires' ? 'Bit-Perfect' : streamingQuality}
                        </div>
                      </div>

                      <button
                        type="button"
                        aria-label={track.favorite ? 'Remove favorite' : 'Favorite track'}
                        onClick={() => onToggleFavorite(track.id)}
                        className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 active:scale-90 transition-transform duration-100 shrink-0"
                      >
                        <Heart
                          className={`w-5 h-5 ${
                            track.favorite ? 'fill-rose-500 text-rose-500' : 'text-zinc-400'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Seek Bar */}
                    <div className="space-y-0.5">
                      <input
                        type="range"
                        aria-label="Seek timeline"
                        min={0}
                        max={dur}
                        step={0.5}
                        value={Math.min(displayTime, dur)}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setDragTime(val);
                          audioEngine.seek(val);
                        }}
                        onPointerUp={() => setDragTime(null)}
                        onKeyUp={() => setDragTime(null)}
                        className="w-full accent-amber-500 cursor-pointer"
                      />
                      <div className="flex justify-between text-[11px] font-mono-tabular text-zinc-500 dark:text-zinc-400">
                        <span>{formatDuration(displayTime)}</span>
                        <span>{formatDuration(dur)}</span>
                      </div>
                    </div>

                    {/* Primary Transport */}
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        aria-label="Shuffle"
                        onClick={onToggleShuffle}
                        className={`min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl active:scale-90 transition-transform duration-100 ${
                          shuffle ? 'accent-text bg-zinc-200/60 dark:bg-zinc-800' : 'text-zinc-500'
                        }`}
                      >
                        <Shuffle className="w-5 h-5" />
                      </button>

                      <button
                        type="button"
                        aria-label="Previous"
                        onClick={onPrev}
                        className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl hover:bg-zinc-200/60 dark:hover:bg-zinc-800 active:scale-90 transition-transform duration-100"
                      >
                        <SkipBack className="w-6 h-6" />
                      </button>

                      <button
                        type="button"
                        aria-label={isPlaying ? 'Pause' : 'Play'}
                        onClick={onTogglePlay}
                        className="w-12 h-12 sm:w-16 sm:h-16 rounded-full accent-bg flex items-center justify-center shadow-lg active:scale-90 transition-transform duration-100"
                      >
                        {isPlaying ? (
                          <Pause className="w-6 h-6 sm:w-7 sm:h-7 fill-current" />
                        ) : (
                          <Play className="w-6 h-6 sm:w-7 sm:h-7 fill-current ml-0.5" />
                        )}
                      </button>

                      <button
                        type="button"
                        aria-label="Next"
                        onClick={onNext}
                        className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl hover:bg-zinc-200/60 dark:hover:bg-zinc-800 active:scale-90 transition-transform duration-100"
                      >
                        <SkipForward className="w-6 h-6" />
                      </button>

                      <button
                        type="button"
                        aria-label="Repeat"
                        onClick={onCycleRepeat}
                        className={`min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl active:scale-90 transition-transform duration-100 ${
                          repeatMode !== 'off' ? 'accent-text bg-zinc-200/60 dark:bg-zinc-800' : 'text-zinc-500'
                        }`}
                      >
                        {repeatMode === 'one' ? (
                          <Repeat1 className="w-5 h-5" />
                        ) : (
                          <Repeat className="w-5 h-5" />
                        )}
                      </button>
                    </div>

                    {/* Volume & Quick Tools Bar */}
                    <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <button
                          type="button"
                          aria-label={volume === 0 ? 'Unmute' : 'Mute'}
                          onClick={() => {
                            tactile.tap();
                            onChangeVolume(volume === 0 ? 0.8 : 0);
                          }}
                          className="min-w-[32px] min-h-[32px] flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 shrink-0"
                        >
                          {volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                        </button>
                        <input
                          type="range"
                          aria-label="Master Volume"
                          min={0}
                          max={1}
                          step={0.01}
                          value={volume}
                          onChange={(e) => onChangeVolume(parseFloat(e.target.value))}
                          className="w-full accent-amber-500 cursor-pointer"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenEqualizer();
                        }}
                        className="min-h-[34px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium flex items-center gap-1 hover:bg-zinc-100 dark:hover:bg-zinc-900 active:scale-95 transition-transform duration-100 whitespace-nowrap"
                      >
                        <Sliders className="w-3.5 h-3.5" />
                        <span>EQ</span>
                      </button>

                      <button
                        type="button"
                        onClick={onOpenCast}
                        className="min-h-[34px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium flex items-center gap-1 hover:bg-zinc-100 dark:hover:bg-zinc-900 active:scale-95 transition-transform duration-100 whitespace-nowrap"
                      >
                        <Cast className="w-3.5 h-3.5" />
                        <span className="hidden xs:inline sm:inline">Output</span>
                      </button>
                    </div>

                    {nextTrack && nextTrack.id !== track.id && (
                      <button
                        type="button"
                        onClick={() => setDeckPage('queue')}
                        className="[@media(max-height:540px)]:hidden text-left text-[11px] text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 truncate transition-colors"
                      >
                        Up Next: <span className="font-medium text-zinc-700 dark:text-zinc-300">{nextTrack.title}</span> · {nextTrack.artist}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                /* Page 2: Rating, Specs & Fixed Paginated Queue */
                <div className="max-w-3xl w-full h-full min-h-0 mx-auto flex flex-col gap-2.5 overflow-hidden">
                  <div className="shrink-0 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 p-2.5 sm:p-3.5 flex flex-wrap items-center justify-between gap-2.5">
                    <div>
                      <div className="text-[11px] sm:text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        Rating · {track.genre} · {track.bitrateKbps} kbps
                      </div>
                      <div className="flex items-center gap-0.5 mt-0.5">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            type="button"
                            aria-label={`Rate ${star} stars`}
                            onClick={() => onRateTrack(track.id, track.rating === star ? 0 : star)}
                            className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 active:scale-90 transition-transform duration-100"
                          >
                            <Star
                              className={`w-4 h-4 ${
                                star <= track.rating
                                  ? 'fill-amber-400 text-amber-400'
                                  : 'text-zinc-300 dark:text-zinc-700'
                              }`}
                            />
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={onPrev}
                        className="min-w-[36px] min-h-[36px] rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-center justify-center"
                        aria-label="Previous"
                      >
                        <SkipBack className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={onTogglePlay}
                        className="w-10 h-10 rounded-full accent-bg flex items-center justify-center shadow"
                        aria-label={isPlaying ? 'Pause' : 'Play'}
                      >
                        {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={onNext}
                        className="min-w-[36px] min-h-[36px] rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-center justify-center"
                        aria-label="Next"
                      >
                        <SkipForward className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div ref={queueViewportRef} className="flex-1 min-h-0 overflow-hidden flex flex-col">
                    {pagedQueue.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-sm text-zinc-500">
                        Queue is empty.
                      </div>
                    ) : (
                      <div className="divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
                        {pagedQueue.map((qt) => {
                          const active = qt.id === track.id;
                          return (
                            <button
                              key={qt.id}
                              type="button"
                              onClick={() => onPlayQueueTrack?.(qt)}
                              className={`w-full h-[52px] px-2.5 rounded-xl flex items-center justify-between gap-3 text-left transition-colors ${
                                active
                                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                  : 'hover:bg-zinc-100 dark:hover:bg-zinc-900'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <CoverArt
                                  src={qt.coverUrl}
                                  alt={qt.title}
                                  isPlaying={active && isPlaying}
                                  className="w-9 h-9 rounded-lg"
                                />
                                <div className="min-w-0">
                                  <div className="text-sm font-medium truncate">{qt.title}</div>
                                  <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                                    {qt.artist} · {qt.format}
                                  </div>
                                </div>
                              </div>
                              <span className="text-xs font-mono-tabular text-zinc-500 shrink-0">
                                {formatDuration(qt.duration)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <PaginationBar
                    page={safeQueuePage}
                    totalPages={queueTotalPages}
                    totalItems={queue.length}
                    pageSize={queueLayout.pageSize}
                    onChangePage={setQueuePage}
                    itemLabel="in queue"
                  />
                </div>
              )}
            </div>
          </div>
        </>
      );
    }
  )
);
