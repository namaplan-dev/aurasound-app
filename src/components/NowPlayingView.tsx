import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Cast,
  ChevronDown,
  Heart,
  Library,
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

export const NowPlayingView = React.memo(
  React.forwardRef<NowPlayingSheetHandle, NowPlayingViewProps>(
    (
      {
        open,
        track,
        nextTrack,
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
    const [progress, setProgress] = useState({ currentTime: 0, duration: track?.duration || 0 });
    const [dragTime, setDragTime] = useState<number | null>(null);

    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const backdropRef = useRef<HTMLDivElement | null>(null);
    const sheetRef = useRef<HTMLDivElement | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const dragStateRef = useRef<{
      startX: number;
      startY: number;
      prevY: number;
      prevTime: number;
      velocityY: number;
      active: boolean;
      aborted: boolean;
      lastOffset: number;
    } | null>(null);

    useImperativeHandle(ref, () => ({
      peekFromBottom: (dyNegative: number) => {
        const clamped = Math.min(0, dyNegative);
        const vh = Math.max(480, window.innerHeight || 720);
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
          backdropRef.current.style.transitionDuration = '360ms';
          backdropRef.current.style.opacity = commitOpen ? '1' : '0';
        }
        if (sheetRef.current) {
          sheetRef.current.style.transitionDuration = '360ms';
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
        backdropRef.current.style.transitionDuration = '';
        backdropRef.current.style.opacity = open ? '1' : '0';
      }
      if (sheetRef.current) {
        sheetRef.current.style.transitionDuration = '';
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
      if (!open || !isPlaying || lowBatteryMode) return;
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
    }, [open, isPlaying, lowBatteryMode]);

    if (!track) return null;

    const dur = progress.duration || track.duration || 1;
    const displayTime = dragTime !== null ? dragTime : progress.currentTime;

    const handleTouchStart = (e: React.TouchEvent) => {
      if (!open || e.touches.length !== 1) return;
      const target = e.target as HTMLElement;
      if (target.closest('input[type="range"]')) return;
      const scrollTop = scrollRef.current?.scrollTop || 0;
      const onHandleArea = Boolean(target.closest('[data-sheet-handle="true"]'));
      if (scrollTop > 2 && !onHandleArea) return;

      const now = performance.now();
      const touch = e.touches[0];
      dragStateRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        prevY: touch.clientY,
        prevTime: now,
        velocityY: 0,
        active: false,
        aborted: false,
        lastOffset: 0,
      };
    };

    const handleTouchMove = (e: React.TouchEvent) => {
      const state = dragStateRef.current;
      if (!state || state.aborted || e.touches.length !== 1) return;

      const touch = e.touches[0];
      const now = performance.now();
      const dx = Math.abs(touch.clientX - state.startX);
      const dy = touch.clientY - state.startY;
      const dt = Math.max(8, now - state.prevTime);
      const instVel = (touch.clientY - state.prevY) / dt;
      state.velocityY = state.velocityY * 0.45 + instVel * 0.55;
      state.prevY = touch.clientY;
      state.prevTime = now;

      if (!state.active) {
        if (dx > 14 && dx > Math.abs(dy)) {
          state.aborted = true;
          return;
        }
        if (Math.abs(dy) < 5) return;
        const target = e.target as HTMLElement;
        const onHandleArea = Boolean(target.closest('[data-sheet-handle="true"]'));
        const scrollTop = scrollRef.current?.scrollTop || 0;
        if (!onHandleArea && (dy < 0 || scrollTop > 2)) {
          state.aborted = true;
          return;
        }
        state.active = true;
        if (backdropRef.current) {
          backdropRef.current.style.transitionDuration = '0ms';
        }
        if (sheetRef.current) {
          sheetRef.current.style.transitionDuration = '0ms';
        }
      }

      // 1:1 follow downward, subtle organic rubber-band when nudging up at top
      const offset = dy >= 0 ? dy : Math.max(-22, dy * 0.16);
      state.lastOffset = offset;
      const vh = Math.max(480, window.innerHeight || 720);
      if (backdropRef.current) {
        const opacity = offset > 0 ? Math.max(0, 1 - offset / vh) : 1;
        backdropRef.current.style.opacity = String(opacity);
      }
      if (sheetRef.current) {
        const radius = offset > 0 ? Math.min(24, offset * 0.25) : 0;
        sheetRef.current.style.borderTopLeftRadius = `${radius}px`;
        sheetRef.current.style.borderTopRightRadius = `${radius}px`;
        sheetRef.current.style.transform = `translate3d(0, ${offset}px, 0)`;
      }
    };

    const finishSheetDrag = () => {
      const state = dragStateRef.current;
      dragStateRef.current = null;
      if (!state || !state.active) {
        if (backdropRef.current) {
          backdropRef.current.style.transitionDuration = '';
          backdropRef.current.style.opacity = open ? '1' : '0';
        }
        if (sheetRef.current) {
          sheetRef.current.style.transitionDuration = '';
          sheetRef.current.style.borderTopLeftRadius = open ? '0px' : '24px';
          sheetRef.current.style.borderTopRightRadius = open ? '0px' : '24px';
          sheetRef.current.style.transform = open
            ? 'translate3d(0, 0, 0)'
            : 'translate3d(0, 100%, 0)';
        }
        return;
      }

      const vh = Math.max(480, window.innerHeight || 720);
      const distanceThreshold = Math.min(190, vh * 0.26);
      const shouldClose =
        state.lastOffset > distanceThreshold ||
        (state.lastOffset > 32 && state.velocityY > 0.42);

      if (backdropRef.current) {
        backdropRef.current.style.transitionDuration = '360ms';
        backdropRef.current.style.opacity = shouldClose ? '0' : '1';
      }
      if (sheetRef.current) {
        sheetRef.current.style.transitionDuration = '360ms';
        sheetRef.current.style.borderTopLeftRadius = shouldClose ? '24px' : '0px';
        sheetRef.current.style.borderTopRightRadius = shouldClose ? '24px' : '0px';
        sheetRef.current.style.transform = shouldClose
          ? 'translate3d(0, 100%, 0)'
          : 'translate3d(0, 0, 0)';
      }

      if (shouldClose) {
        onClose();
      }
    };

    return (
      <>
        <div
          ref={backdropRef}
          aria-hidden="true"
          style={{ opacity: open ? 1 : 0 }}
          className="fixed inset-0 z-[45] bg-black/45 pointer-events-none transition-opacity duration-350"
        />
        <div
          ref={sheetRef}
          aria-hidden={!open}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={finishSheetDrag}
          onTouchCancel={finishSheetDrag}
          style={{
            transform: open ? 'translate3d(0, 0, 0)' : 'translate3d(0, 100%, 0)',
            paddingTop: 'env(safe-area-inset-top, 0px)',
          }}
          className={`fixed inset-0 z-50 bg-zinc-50 dark:bg-zinc-950 flex flex-col overflow-hidden shadow-[0_-16px_48px_rgba(0,0,0,0.4)] will-change-transform transition-[transform,border-radius] duration-350 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            open ? 'pointer-events-auto' : 'pointer-events-none'
          }`}
        >
        {/* Top Drag Handle Pill + Header (touch-none ensures Android WebView never hijacks swipe-down) */}
        <div
          data-sheet-handle="true"
          className="touch-none select-none z-10 bg-zinc-50/95 dark:bg-zinc-950/95 backdrop-blur-md border-b border-zinc-200/80 dark:border-zinc-800/80 shrink-0"
        >
          <div className="pt-3 pb-1.5 flex justify-center">
            <span className="w-12 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-600" />
          </div>
          <div className="flex items-center justify-between px-4 sm:px-8 h-14">
            <button
              type="button"
              onClick={onClose}
              aria-label="Slide down to Library"
              className="min-h-[42px] px-2.5 flex items-center gap-1.5 rounded-xl hover:bg-zinc-200/60 dark:hover:bg-zinc-800 active:scale-95 transition-transform duration-100 text-xs font-medium text-zinc-700 dark:text-zinc-200"
            >
              <ChevronDown className="w-5 h-5" />
              <Library className="w-3.5 h-3.5 opacity-80" />
              <span>Library</span>
            </button>

            <div className="text-center min-w-0 px-2">
              <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Now Playing · <span className="font-mono-tabular">{APP_VERSION}</span>
              </div>
              <div className="text-[11px] font-mono-tabular text-zinc-700 dark:text-zinc-300 truncate">
                {track.format} · {track.bitDepth}-bit / {(track.sampleRate / 1000).toFixed(1)} kHz ·{' '}
                {streamingQuality === 'lossless-hires' ? 'Bit-Perfect' : streamingQuality}
              </div>
            </div>

            <button
              type="button"
              onClick={onOpenShare}
              aria-label="Share current track"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl hover:bg-zinc-200/60 dark:hover:bg-zinc-800 active:scale-90 transition-transform duration-100"
            >
              <Share2 className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Inner Deck Content */}
        <div
          ref={scrollRef}
          style={{
            paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))',
          }}
          className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain"
        >
          <div className="max-w-4xl w-full min-h-full mx-auto px-5 py-6 sm:py-10 flex flex-col lg:flex-row items-center gap-7 lg:gap-12 justify-center">
            <div
              data-sheet-handle="true"
              className="touch-none w-full max-w-[320px] sm:max-w-[380px] flex flex-col items-center gap-4"
            >
              <CoverArt
                src={track.coverUrl}
                alt={track.title}
                className="w-full aspect-square rounded-2xl shadow-xl border border-zinc-200/50 dark:border-zinc-800"
              />
              {!lowBatteryMode && (
                <canvas
                  ref={canvasRef}
                  width={360}
                  height={44}
                  className="w-full h-11 rounded-lg opacity-90"
                />
              )}
            </div>

          <div className="w-full max-w-md flex flex-col gap-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-2xl font-display font-bold text-zinc-900 dark:text-zinc-100 leading-tight">
                  {track.title}
                </h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                  <button
                    type="button"
                    onClick={() => {
                      onGoToArtist(track.artist);
                      onClose();
                    }}
                    className="hover:underline font-medium text-zinc-800 dark:text-zinc-200"
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
                    className="hover:underline"
                  >
                    {track.album}
                  </button>
                </div>
                <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 font-mono-tabular">
                  {track.genre} · {track.bitrateKbps} kbps
                </div>
              </div>

              <button
                type="button"
                aria-label={track.favorite ? 'Remove favorite' : 'Favorite track'}
                onClick={() => onToggleFavorite(track.id)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 active:scale-90 transition-transform duration-100 shrink-0"
              >
                <Heart
                  className={`w-5 h-5 ${
                    track.favorite ? 'fill-rose-500 text-rose-500' : 'text-zinc-400'
                  }`}
                />
              </button>
            </div>

            {/* 1-5 Star Rating */}
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  aria-label={`Rate ${star} stars`}
                  onClick={() => onRateTrack(track.id, track.rating === star ? 0 : star)}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-900 active:scale-90 transition-transform duration-100"
                >
                  <Star
                    className={`w-5 h-5 ${
                      star <= track.rating
                        ? 'fill-amber-400 text-amber-400'
                        : 'text-zinc-300 dark:text-zinc-700'
                    }`}
                  />
                </button>
              ))}
            </div>

            {/* Seek Bar */}
            <div className="space-y-1.5">
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
              <div className="flex justify-between text-xs font-mono-tabular text-zinc-500 dark:text-zinc-400">
                <span>{formatDuration(displayTime)}</span>
                <span>{formatDuration(dur)}</span>
              </div>
            </div>

            {/* Transport */}
            <div className="flex items-center justify-between">
              <button
                type="button"
                aria-label="Shuffle"
                onClick={onToggleShuffle}
                className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl active:scale-90 transition-transform duration-100 ${
                  shuffle ? 'accent-text bg-zinc-200/60 dark:bg-zinc-800' : 'text-zinc-500'
                }`}
              >
                <Shuffle className="w-5 h-5" />
              </button>

              <button
                type="button"
                aria-label="Previous"
                onClick={onPrev}
                className="min-w-[48px] min-h-[48px] flex items-center justify-center rounded-xl hover:bg-zinc-200/60 dark:hover:bg-zinc-800 active:scale-90 transition-transform duration-100"
              >
                <SkipBack className="w-6 h-6" />
              </button>

              <button
                type="button"
                aria-label={isPlaying ? 'Pause' : 'Play'}
                onClick={onTogglePlay}
                className="w-16 h-16 rounded-full accent-bg flex items-center justify-center shadow-lg active:scale-90 transition-transform duration-100"
              >
                {isPlaying ? (
                  <Pause className="w-7 h-7 fill-current" />
                ) : (
                  <Play className="w-7 h-7 fill-current ml-0.5" />
                )}
              </button>

              <button
                type="button"
                aria-label="Next"
                onClick={onNext}
                className="min-w-[48px] min-h-[48px] flex items-center justify-center rounded-xl hover:bg-zinc-200/60 dark:hover:bg-zinc-800 active:scale-90 transition-transform duration-100"
              >
                <SkipForward className="w-6 h-6" />
              </button>

              <button
                type="button"
                aria-label="Repeat"
                onClick={onCycleRepeat}
                className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl active:scale-90 transition-transform duration-100 ${
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

            {nextTrack && nextTrack.id !== track.id && (
              <button
                type="button"
                onClick={onNext}
                className="text-left text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 truncate pt-1 transition-colors"
              >
                Up Next: <span className="font-medium text-zinc-700 dark:text-zinc-300">{nextTrack.title}</span> · {nextTrack.artist}
              </button>
            )}

            {/* Master Volume & Deck Shortcuts */}
            <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 flex items-center gap-3">
              <div className="flex items-center gap-1.5 flex-1">
                <button
                  type="button"
                  aria-label={volume === 0 ? 'Unmute' : 'Mute'}
                  onClick={() => {
                    tactile.tap();
                    onChangeVolume(volume === 0 ? 0.8 : 0);
                  }}
                  className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-200/60 dark:hover:bg-zinc-800"
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
                className="min-h-[42px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium flex items-center gap-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 active:scale-95 transition-transform duration-100 whitespace-nowrap"
              >
                <Sliders className="w-4 h-4" />
                <span>EQ</span>
              </button>

              <button
                type="button"
                onClick={onOpenCast}
                className="min-h-[42px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium flex items-center gap-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 active:scale-95 transition-transform duration-100 whitespace-nowrap"
              >
                <Cast className="w-4 h-4" />
                <span>Output</span>
              </button>
            </div>
          </div>
          </div>
        </div>
      </div>
      </>
    );
  })
);
