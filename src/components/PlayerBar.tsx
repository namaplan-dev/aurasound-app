import React, { useEffect, useRef, useState } from 'react';
import {
  Cast,
  ChevronUp,
  Heart,
  Mic2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Share2,
  Shuffle,
  SkipBack,
  SkipForward,
  Sliders,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { RepeatMode, Track } from '../types/music';
import { audioEngine } from '../services/audioEngine';
import { formatDuration } from '../utils/textNormalization';
import { CoverArt } from './CoverArt';
import { tactile } from '../services/tactileFeedback';

interface PlayerBarProps {
  track: Track | null;
  isPlaying: boolean;
  isLoading: boolean;
  shuffle: boolean;
  repeatMode: RepeatMode;
  volume: number;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onChangeVolume: (vol: number) => void;
  onToggleFavorite: (trackId: string) => void;
  onOpenNowPlaying: () => void;
  onPeekSheet?: (dyNegative: number) => void;
  onReleaseSheetPeek?: (shouldOpen: boolean) => void;
  onOpenEqualizer: () => void;
  onOpenCast: () => void;
  onOpenShare: () => void;
}

export const PlayerBar: React.FC<PlayerBarProps> = React.memo(
  ({
    track,
    isPlaying,
    isLoading,
    shuffle,
    repeatMode,
    volume,
    onTogglePlay,
    onPrev,
    onNext,
    onToggleShuffle,
    onCycleRepeat,
    onChangeVolume,
    onToggleFavorite,
    onOpenNowPlaying,
    onPeekSheet,
    onReleaseSheetPeek,
    onOpenEqualizer,
    onOpenCast,
    onOpenShare,
  }) => {
    const [progress, setProgress] = useState({ currentTime: 0, duration: track?.duration || 0 });
    const [dragTime, setDragTime] = useState<number | null>(null);
    const footerRef = useRef<HTMLElement | null>(null);
    const swipeStateRef = useRef<{
      pointerId: number;
      startX: number;
      startY: number;
      prevY: number;
      prevTime: number;
      velocityUp: number;
      lastDy: number;
      dragging: boolean;
      aborted: boolean;
      captured: boolean;
    } | null>(null);

    useEffect(() => {
      return audioEngine.subscribeProgress((state) => {
        setProgress(state);
      });
    }, []);

    if (!track) return null;

    const dur = progress.duration || track.duration || 1;
    const displayTime = dragTime !== null ? dragTime : progress.currentTime;
    const pct = Math.min(100, Math.max(0, (displayTime / dur) * 100));

    const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const target = e.target as HTMLElement;
      if (target.closest('input[type="range"]')) {
        swipeStateRef.current = null;
        return;
      }
      swipeStateRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        prevY: e.clientY,
        prevTime: performance.now(),
        velocityUp: 0,
        lastDy: 0,
        dragging: false,
        aborted: false,
        captured: false,
      };
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
      const state = swipeStateRef.current;
      if (!state || state.aborted || e.pointerId !== state.pointerId) return;

      const now = performance.now();
      const dx = Math.abs(e.clientX - state.startX);
      const dy = e.clientY - state.startY;
      const dt = Math.max(8, now - state.prevTime);
      const instVelUp = (state.prevY - e.clientY) / dt;
      state.velocityUp = state.velocityUp * 0.45 + instVelUp * 0.55;
      state.prevY = e.clientY;
      state.prevTime = now;

      if (!state.dragging) {
        if (dx > 14 && dx > Math.abs(dy)) {
          state.aborted = true;
          return;
        }
        if (dy > -6) return;
        state.dragging = true;
        if (footerRef.current) {
          footerRef.current.style.transitionDuration = '0ms';
        }
        if (!state.captured) {
          state.captured = true;
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // ignore
          }
        }
      }

      const clampedDy = Math.min(0, dy);
      state.lastDy = clampedDy;

      if (footerRef.current) {
        const follow = Math.max(-28, clampedDy * 0.22);
        footerRef.current.style.transform = `translate3d(0, ${follow}px, 0)`;
      }
      onPeekSheet?.(clampedDy);
    };

    const finishSwipe = (e: React.PointerEvent<HTMLElement>) => {
      const state = swipeStateRef.current;
      if (!state || e.pointerId !== state.pointerId) return;
      swipeStateRef.current = null;

      if (state.captured) {
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      }

      if (footerRef.current) {
        footerRef.current.style.transitionDuration = '260ms';
        footerRef.current.style.transform = 'translate3d(0, 0, 0)';
      }

      if (!state.dragging) {
        if (state.lastDy < 0) onReleaseSheetPeek?.(false);
        return;
      }

      const pulled = Math.abs(state.lastDy);
      const vh = Math.max(460, window.innerHeight || 720);
      const distanceThreshold = Math.min(130, vh * 0.16);
      const shouldOpen =
        pulled > distanceThreshold ||
        (pulled > 20 && state.velocityUp > 0.34);

      onReleaseSheetPeek?.(shouldOpen);
      if (shouldOpen) {
        onOpenNowPlaying();
      }
    };

    return (
      <footer
        ref={footerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishSwipe}
        onPointerCancel={finishSwipe}
        style={{
          marginBottom: 'calc(0.5rem + env(safe-area-inset-bottom, 0px))',
          transform: 'translate3d(0, 0, 0)',
          touchAction: 'none',
        }}
        className="relative shrink-0 mx-2.5 sm:mx-4 z-40 rounded-2xl border border-zinc-200/90 dark:border-zinc-700/80 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl shadow-[0_12px_36px_rgba(0,0,0,0.35)] will-change-transform transition-transform duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] touch-none select-none"
      >
        <div className="max-w-screen-2xl mx-auto px-3 sm:px-5 pt-1 pb-2 sm:py-2.5 space-y-1 [@media(max-height:520px)]:space-y-0.5 [@media(max-height:520px)]:py-1">
          {/* Top Slide-Up Grab Handle */}
          <button
            type="button"
            onClick={onOpenNowPlaying}
            aria-label="Slide up or tap to open full screen player"
            className="w-full flex items-center justify-center py-0.5 group cursor-grab active:cursor-grabbing [@media(max-height:520px)]:hidden"
          >
            <span className="w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-600 group-hover:bg-amber-500 transition-colors" />
          </button>

          {/* Compact Track Row */}
          <div className="flex items-center justify-between gap-2.5">
            <button
              type="button"
              onClick={onOpenNowPlaying}
              className="flex items-center gap-2.5 min-w-0 flex-1 text-left group active:scale-[0.99] transition-transform duration-100"
            >
              <CoverArt
                src={track.coverUrl}
                alt={track.title}
                isPlaying={isPlaying}
                className="w-10 h-10 sm:w-12 sm:h-12 [@media(max-height:520px)]:w-9 [@media(max-height:520px)]:h-9 rounded-xl shadow-sm"
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs sm:text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate group-hover:underline flex items-center gap-1.5">
                  <span className="truncate">{track.title}</span>
                  {Boolean(track.lyrics?.trim()) && (
                    <span
                      title="Has embedded lyrics"
                      aria-label="Has embedded lyrics"
                      className="inline-flex shrink-0"
                    >
                      <Mic2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 accent-text" />
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate flex items-center gap-1.5">
                  <span className="truncate">{track.artist}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono-tabular shrink-0 text-[10px] sm:text-[11px]">
                    {track.format} {track.bitDepth}b/{Math.round(track.sampleRate / 1000)}kHz
                  </span>
                </div>
              </div>
            </button>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                aria-label={track.favorite ? 'Remove from favorites' : 'Add to favorites'}
                title={track.favorite ? 'Remove from favorites' : 'Favorite'}
                onClick={() => onToggleFavorite(track.id)}
                className="min-w-[36px] min-h-[36px] sm:min-w-[40px] sm:min-h-[40px] flex items-center justify-center rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 active:scale-90 transition-transform duration-100"
              >
                <Heart
                  className={`w-4 h-4 sm:w-5 sm:h-5 transition-colors ${
                    track.favorite ? 'fill-rose-500 text-rose-500' : 'text-zinc-400'
                  }`}
                />
              </button>

              <button
                type="button"
                aria-label="Open Full Player"
                title="Slide up to open full player"
                onClick={onOpenNowPlaying}
                className="min-w-[36px] min-h-[36px] sm:min-h-[40px] px-2 flex items-center justify-center gap-1 rounded-xl bg-zinc-100 dark:bg-zinc-800/90 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 active:scale-90 transition-transform duration-100 text-xs font-medium"
              >
                <ChevronUp className="w-4 h-4" />
                <span className="hidden sm:inline">Player</span>
              </button>
            </div>
          </div>

          {/* Slim Scrubber Row */}
          <div className="flex items-center gap-2 [@media(max-height:520px)]:hidden">
            <span className="text-[10px] font-mono-tabular text-zinc-500 dark:text-zinc-400 w-8 text-left shrink-0">
              {formatDuration(displayTime)}
            </span>
            <div className="relative flex-1 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-visible flex items-center">
              <div
                className="h-full rounded-full accent-bg transition-[width] duration-75"
                style={{ width: `${pct}%` }}
              />
              <input
                type="range"
                aria-label="Seek track position"
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
                className="absolute inset-0 w-full h-6 -top-2 opacity-0 cursor-pointer"
              />
            </div>
            <span className="text-[10px] font-mono-tabular text-zinc-500 dark:text-zinc-400 w-8 text-right shrink-0">
              {formatDuration(dur)}
            </span>
          </div>

          {/* Transport Row */}
          <div className="flex items-center justify-between gap-1.5 [@media(max-height:520px)]:hidden">
            <div className="flex items-center gap-0.5 sm:gap-1">
              <button
                type="button"
                aria-label="Toggle shuffle"
                title={shuffle ? 'Shuffle On' : 'Shuffle Off'}
                onClick={onToggleShuffle}
                className={`min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xl active:scale-90 transition-all duration-100 ${
                  shuffle
                    ? 'accent-text bg-zinc-100 dark:bg-zinc-800'
                    : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                <Shuffle className="w-4 h-4" />
              </button>

              <button
                type="button"
                aria-label="Equalizer"
                title="Equalizer"
                onClick={onOpenEqualizer}
                className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xl text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 active:scale-90 transition-transform duration-100"
              >
                <Sliders className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-3">
              <button
                type="button"
                aria-label="Previous track"
                title="Previous"
                onClick={onPrev}
                className="min-w-[40px] min-h-[38px] flex items-center justify-center rounded-xl text-zinc-800 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 active:scale-90 transition-transform duration-100"
              >
                <SkipBack className="w-5 h-5" />
              </button>

              <button
                type="button"
                aria-label={isPlaying ? 'Pause' : 'Play'}
                title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
                onClick={onTogglePlay}
                className="w-10 h-10 sm:w-11 sm:h-11 rounded-full accent-bg flex items-center justify-center shadow-md active:scale-90 transition-transform duration-100"
              >
                {isLoading ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : isPlaying ? (
                  <Pause className="w-5 h-5 fill-current" />
                ) : (
                  <Play className="w-5 h-5 fill-current ml-0.5" />
                )}
              </button>

              <button
                type="button"
                aria-label="Next track"
                title="Next"
                onClick={onNext}
                className="min-w-[40px] min-h-[38px] flex items-center justify-center rounded-xl text-zinc-800 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 active:scale-90 transition-transform duration-100"
              >
                <SkipForward className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-0.5 sm:gap-1">
              <button
                type="button"
                aria-label="Cycle repeat mode"
                title={`Repeat: ${repeatMode}`}
                onClick={onCycleRepeat}
                className={`min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xl active:scale-90 transition-all duration-100 ${
                  repeatMode !== 'off'
                    ? 'accent-text bg-zinc-100 dark:bg-zinc-800'
                    : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                {repeatMode === 'one' ? (
                  <Repeat1 className="w-4 h-4" />
                ) : (
                  <Repeat className="w-4 h-4" />
                )}
              </button>

              <button
                type="button"
                aria-label="Cast audio"
                title="Cast & Audio Output"
                onClick={onOpenCast}
                className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xl text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 active:scale-90 transition-transform duration-100"
              >
                <Cast className="w-4 h-4" />
              </button>

              <button
                type="button"
                aria-label="Share track"
                title="Share"
                onClick={onOpenShare}
                className="hidden sm:flex min-w-[36px] min-h-[36px] items-center justify-center rounded-xl text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 active:scale-90 transition-transform duration-100"
              >
                <Share2 className="w-4 h-4" />
              </button>

              <div className="hidden lg:flex items-center gap-1.5 ml-1">
                <button
                  type="button"
                  aria-label={volume === 0 ? 'Unmute' : 'Mute'}
                  title={volume === 0 ? 'Unmute (M)' : 'Mute (M)'}
                  onClick={() => {
                    tactile.tap();
                    onChangeVolume(volume === 0 ? 0.8 : 0);
                  }}
                  className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-lg text-zinc-600 dark:text-zinc-300 active:scale-90 transition-transform duration-100"
                >
                  {volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <input
                  type="range"
                  aria-label="Master volume"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  onChange={(e) => onChangeVolume(parseFloat(e.target.value))}
                  className="w-20 accent-amber-500 cursor-pointer"
                />
              </div>
            </div>
          </div>
        </div>
      </footer>
    );
  }
);
