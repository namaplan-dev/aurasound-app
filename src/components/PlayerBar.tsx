import React, { useEffect, useRef, useState } from 'react';
import {
  Cast,
  ChevronUp,
  Heart,
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
    onOpenEqualizer,
    onOpenCast,
    onOpenShare,
  }) => {
    const [progress, setProgress] = useState({ currentTime: 0, duration: track?.duration || 0 });
    const [dragTime, setDragTime] = useState<number | null>(null);
    const [liftY, setLiftY] = useState(0);
    const touchStartYRef = useRef<number | null>(null);
    const swipedRef = useRef(false);

    useEffect(() => {
      return audioEngine.subscribeProgress((state) => {
        setProgress(state);
      });
    }, []);

    if (!track) return null;

    const dur = progress.duration || track.duration || 1;
    const displayTime = dragTime !== null ? dragTime : progress.currentTime;
    const pct = Math.min(100, Math.max(0, (displayTime / dur) * 100));

    const handleTouchStart = (e: React.TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input[type="range"]') || target.closest('button[data-no-swipe="true"]')) {
        touchStartYRef.current = null;
        return;
      }
      touchStartYRef.current = e.touches[0].clientY;
      swipedRef.current = false;
    };

    const handleTouchMove = (e: React.TouchEvent) => {
      if (touchStartYRef.current === null) return;
      const dy = e.touches[0].clientY - touchStartYRef.current;
      if (dy < 0) {
        setLiftY(Math.max(-44, dy * 0.45));
        if (dy < -36 && !swipedRef.current) {
          swipedRef.current = true;
          touchStartYRef.current = null;
          setLiftY(0);
          onOpenNowPlaying();
        }
      }
    };

    const handleTouchEnd = () => {
      touchStartYRef.current = null;
      setLiftY(0);
    };

    return (
      <footer
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
          transform: liftY !== 0 ? `translate3d(0, ${liftY}px, 0)` : undefined,
        }}
        className="fixed left-2.5 right-2.5 sm:left-4 sm:right-4 z-40 rounded-2xl border border-zinc-200/90 dark:border-zinc-700/80 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl shadow-[0_14px_40px_rgba(0,0,0,0.35)] transition-transform duration-150"
      >
        <div className="max-w-screen-2xl mx-auto px-3.5 sm:px-5 pt-2 pb-3.5 space-y-2.5">
          {/* Slide-Up Drag Handle */}
          <button
            type="button"
            onClick={onOpenNowPlaying}
            aria-label="Slide up or tap to open full screen player"
            className="w-full flex flex-col items-center justify-center py-0.5 group cursor-grab active:cursor-grabbing"
          >
            <span className="w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-600 group-hover:bg-amber-500 transition-colors" />
          </button>

          {/* Top Row: Cover Art, Track Metadata & Quick Expand */}
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onOpenNowPlaying}
              className="flex items-center gap-3 min-w-0 flex-1 text-left group active:scale-[0.99] transition-transform duration-100"
            >
              <CoverArt
                src={track.coverUrl}
                alt={track.title}
                isPlaying={isPlaying}
                className="w-14 h-14 rounded-xl shadow-sm"
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm sm:text-base font-semibold text-zinc-900 dark:text-zinc-100 truncate group-hover:underline">
                  {track.title}
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate flex items-center gap-1.5 mt-0.5">
                  <span className="truncate">{track.artist}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono-tabular shrink-0 text-[11px]">
                    {track.format} {track.bitDepth}b/{Math.round(track.sampleRate / 1000)}kHz
                  </span>
                </div>
              </div>
            </button>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                data-no-swipe="true"
                aria-label={track.favorite ? 'Remove from favorites' : 'Add to favorites'}
                title={track.favorite ? 'Remove from favorites' : 'Favorite'}
                onClick={() => onToggleFavorite(track.id)}
                className="min-w-[42px] min-h-[42px] flex items-center justify-center rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 active:scale-90 transition-transform duration-100"
              >
                <Heart
                  className={`w-5 h-5 transition-colors ${
                    track.favorite ? 'fill-rose-500 text-rose-500' : 'text-zinc-400'
                  }`}
                />
              </button>

              <button
                type="button"
                aria-label="Open Full Player"
                title="Slide up to open full player"
                onClick={onOpenNowPlaying}
                className="min-w-[42px] min-h-[42px] px-2.5 flex items-center justify-center gap-1 rounded-xl bg-zinc-100 dark:bg-zinc-800/90 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 active:scale-90 transition-transform duration-100 text-xs font-medium"
              >
                <ChevronUp className="w-4 h-4" />
                <span className="hidden xs:inline sm:inline">Player</span>
              </button>
            </div>
          </div>

          {/* Interactive Progress Scrubber Row */}
          <div className="flex items-center gap-2.5">
            <span className="text-[11px] font-mono-tabular text-zinc-500 dark:text-zinc-400 w-9 text-left shrink-0">
              {formatDuration(displayTime)}
            </span>
            <div className="relative flex-1 h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-visible flex items-center">
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
                className="absolute inset-0 w-full h-7 -top-2.5 opacity-0 cursor-pointer"
              />
            </div>
            <span className="text-[11px] font-mono-tabular text-zinc-500 dark:text-zinc-400 w-9 text-right shrink-0">
              {formatDuration(dur)}
            </span>
          </div>

          {/* Spacious Transport & Output Controls Row */}
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <div className="flex items-center gap-1">
              <button
                type="button"
                data-no-swipe="true"
                aria-label="Toggle shuffle"
                title={shuffle ? 'Shuffle On' : 'Shuffle Off'}
                onClick={onToggleShuffle}
                className={`min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl active:scale-90 transition-all duration-100 ${
                  shuffle
                    ? 'accent-text bg-zinc-100 dark:bg-zinc-800'
                    : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                <Shuffle className="w-4 h-4" />
              </button>

              <button
                type="button"
                data-no-swipe="true"
                aria-label="Equalizer"
                title="Equalizer"
                onClick={onOpenEqualizer}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 active:scale-90 transition-transform duration-100"
              >
                <Sliders className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <button
                type="button"
                data-no-swipe="true"
                aria-label="Previous track"
                title="Previous"
                onClick={onPrev}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-zinc-800 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 active:scale-90 transition-transform duration-100"
              >
                <SkipBack className="w-5 h-5" />
              </button>

              <button
                type="button"
                data-no-swipe="true"
                aria-label={isPlaying ? 'Pause' : 'Play'}
                title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
                onClick={onTogglePlay}
                className="w-12 h-12 rounded-full accent-bg flex items-center justify-center shadow-md active:scale-90 transition-transform duration-100"
              >
                {isLoading ? (
                  <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : isPlaying ? (
                  <Pause className="w-5 h-5 fill-current" />
                ) : (
                  <Play className="w-5 h-5 fill-current ml-0.5" />
                )}
              </button>

              <button
                type="button"
                data-no-swipe="true"
                aria-label="Next track"
                title="Next"
                onClick={onNext}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-zinc-800 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 active:scale-90 transition-transform duration-100"
              >
                <SkipForward className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                data-no-swipe="true"
                aria-label="Cycle repeat mode"
                title={`Repeat: ${repeatMode}`}
                onClick={onCycleRepeat}
                className={`min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl active:scale-90 transition-all duration-100 ${
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
                data-no-swipe="true"
                aria-label="Cast audio"
                title="Cast & Audio Output"
                onClick={onOpenCast}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 active:scale-90 transition-transform duration-100"
              >
                <Cast className="w-4 h-4" />
              </button>

              <button
                type="button"
                data-no-swipe="true"
                aria-label="Share track"
                title="Share"
                onClick={onOpenShare}
                className="hidden sm:flex min-w-[40px] min-h-[40px] items-center justify-center rounded-xl text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 active:scale-90 transition-transform duration-100"
              >
                <Share2 className="w-4 h-4" />
              </button>

              <div className="hidden lg:flex items-center gap-1.5 ml-1">
                <button
                  type="button"
                  data-no-swipe="true"
                  aria-label={volume === 0 ? 'Unmute' : 'Mute'}
                  title={volume === 0 ? 'Unmute (M)' : 'Mute (M)'}
                  onClick={() => {
                    tactile.tap();
                    onChangeVolume(volume === 0 ? 0.8 : 0);
                  }}
                  className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-zinc-600 dark:text-zinc-300 active:scale-90 transition-transform duration-100"
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
