import React, { useEffect, useState } from 'react';
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

    useEffect(() => {
      return audioEngine.subscribeProgress((state) => {
        setProgress(state);
      });
    }, []);

    if (!track) return null;

    const dur = progress.duration || track.duration || 1;
    const displayTime = dragTime !== null ? dragTime : progress.currentTime;
    const pct = Math.min(100, Math.max(0, (displayTime / dur) * 100));

    return (
      <footer className="fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-md">
        {/* Interactive Top Scrubber Bar */}
        <div className="relative w-full h-2 group cursor-pointer bg-zinc-200 dark:bg-zinc-800">
          <div
            className="h-full accent-bg transition-[width] duration-75"
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
            className="absolute inset-0 w-full h-4 -top-1 opacity-0 cursor-pointer"
          />
        </div>

        <div className="max-w-screen-2xl mx-auto px-3 sm:px-5 h-15 sm:h-[68px] flex items-center justify-between gap-3">
          {/* Track Info */}
          <div className="flex items-center gap-3 min-w-0 flex-1 sm:max-w-[34%]">
            <button
              type="button"
              onClick={onOpenNowPlaying}
              className="flex items-center gap-3 min-w-0 text-left group active:scale-[0.99] transition-transform duration-100"
            >
              <CoverArt
                src={track.coverUrl}
                alt={track.title}
                isPlaying={isPlaying}
                className="w-11 h-11 sm:w-12 sm:h-12 rounded-lg"
              />
              <div className="min-w-0">
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate group-hover:underline">
                  {track.title}
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate flex items-center gap-1.5">
                  <span className="truncate">{track.artist}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono-tabular shrink-0">
                    {track.format} {track.bitDepth}b/{Math.round(track.sampleRate / 1000)}kHz
                  </span>
                </div>
              </div>
            </button>

            <button
              type="button"
              aria-label={track.favorite ? 'Remove from favorites' : 'Add to favorites'}
              title={track.favorite ? 'Remove from favorites' : 'Favorite'}
              onClick={() => onToggleFavorite(track.id)}
              className="hidden sm:flex min-w-[40px] min-h-[40px] items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-900 active:scale-90 transition-transform duration-100"
            >
              <Heart
                className={`w-4 h-4 transition-colors ${
                  track.favorite ? 'fill-rose-500 text-rose-500' : 'text-zinc-400'
                }`}
              />
            </button>
          </div>

          {/* Center Transport */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <button
              type="button"
              aria-label="Toggle shuffle"
              title={shuffle ? 'Shuffle On' : 'Shuffle Off'}
              onClick={onToggleShuffle}
              className={`hidden md:flex min-w-[40px] min-h-[40px] items-center justify-center rounded-lg active:scale-90 transition-all duration-100 ${
                shuffle
                  ? 'accent-text bg-zinc-100 dark:bg-zinc-900'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              <Shuffle className="w-4 h-4" />
            </button>

            <button
              type="button"
              aria-label="Previous track"
              title="Previous"
              onClick={onPrev}
              className="min-w-[42px] min-h-[42px] flex items-center justify-center rounded-lg text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900 active:scale-90 transition-transform duration-100"
            >
              <SkipBack className="w-5 h-5" />
            </button>

            <button
              type="button"
              aria-label={isPlaying ? 'Pause' : 'Play'}
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              onClick={onTogglePlay}
              className="min-w-[44px] min-h-[44px] rounded-full accent-bg flex items-center justify-center shadow-sm active:scale-90 transition-transform duration-100"
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
              className="min-w-[42px] min-h-[42px] flex items-center justify-center rounded-lg text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900 active:scale-90 transition-transform duration-100"
            >
              <SkipForward className="w-5 h-5" />
            </button>

            <button
              type="button"
              aria-label="Cycle repeat mode"
              title={`Repeat: ${repeatMode}`}
              onClick={onCycleRepeat}
              className={`hidden md:flex min-w-[40px] min-h-[40px] items-center justify-center rounded-lg active:scale-90 transition-all duration-100 ${
                repeatMode !== 'off'
                  ? 'accent-text bg-zinc-100 dark:bg-zinc-900'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              {repeatMode === 'one' ? (
                <Repeat1 className="w-4 h-4" />
              ) : (
                <Repeat className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* Right Controls & Time */}
          <div className="hidden sm:flex items-center justify-end gap-1.5 flex-1 max-w-[34%]">
            <span className="text-xs font-mono-tabular text-zinc-500 dark:text-zinc-400 mr-2 hidden lg:inline">
              {formatDuration(displayTime)} / {formatDuration(dur)}
            </span>

            <button
              type="button"
              aria-label="Equalizer"
              title="Equalizer"
              onClick={onOpenEqualizer}
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 active:scale-90 transition-transform duration-100"
            >
              <Sliders className="w-4 h-4" />
            </button>

            <button
              type="button"
              aria-label="Cast audio"
              title="Cast & Audio Output"
              onClick={onOpenCast}
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 active:scale-90 transition-transform duration-100"
            >
              <Cast className="w-4 h-4" />
            </button>

            <button
              type="button"
              aria-label="Share track"
              title="Share"
              onClick={onOpenShare}
              className="hidden md:flex min-w-[40px] min-h-[40px] items-center justify-center rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 active:scale-90 transition-transform duration-100"
            >
              <Share2 className="w-4 h-4" />
            </button>

            <div className="hidden xl:flex items-center gap-1.5 ml-1">
              <button
                type="button"
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

            <button
              type="button"
              aria-label="Expand Now Playing"
              title="Open Now Playing"
              onClick={onOpenNowPlaying}
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 active:scale-90 transition-transform duration-100"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
          </div>
        </div>
      </footer>
    );
  }
);
