import React from 'react';
import {
  Heart,
  Layers,
  Maximize2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  X,
} from 'lucide-react';
import { Track } from '../types/music';
import { CoverArt } from './CoverArt';
import { tactile } from '../services/tactileFeedback';

interface HomescreenWidgetProps {
  visible: boolean;
  variant?: 'top-bar' | 'studio-deck';
  track: Track | null;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleFavorite: (trackId: string) => void;
  onChangeVariant?: (variant: 'top-bar' | 'studio-deck') => void;
  onExpand: () => void;
  onClose: () => void;
}

export const HomescreenWidget: React.FC<HomescreenWidgetProps> = React.memo(
  ({
    visible,
    variant = 'top-bar',
    track,
    isPlaying,
    onTogglePlay,
    onPrev,
    onNext,
    onToggleFavorite,
    onChangeVariant,
    onExpand,
    onClose,
  }) => {
    if (!visible || !track) return null;

    if (variant === 'top-bar') {
      return (
        <div
          role="region"
          aria-label="Top Bar Compact Widget"
          style={{ top: 'calc(4.35rem + env(safe-area-inset-top, 0px))' }}
          className="fixed left-3 right-3 sm:left-auto sm:right-5 sm:w-[380px] z-35 rounded-2xl border border-zinc-200 dark:border-zinc-700/80 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl shadow-xl px-3 py-2 flex items-center gap-2.5"
        >
          <button
            type="button"
            onClick={onExpand}
            className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
          >
            <CoverArt
              src={track.coverUrl}
              alt={track.title}
              isPlaying={isPlaying}
              className="w-10 h-10 rounded-lg"
            />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                {track.title}
              </div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                {track.artist}
              </div>
            </div>
          </button>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              aria-label="Previous"
              onClick={onPrev}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <SkipBack className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              aria-label={isPlaying ? 'Pause' : 'Play'}
              onClick={onTogglePlay}
              className="w-9 h-9 rounded-full accent-bg flex items-center justify-center shadow-sm"
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 fill-current" />
              ) : (
                <Play className="w-4 h-4 fill-current ml-0.5" />
              )}
            </button>
            <button
              type="button"
              aria-label="Next"
              onClick={onNext}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <SkipForward className="w-3.5 h-3.5" />
            </button>
            {onChangeVariant && (
              <button
                type="button"
                aria-label="Switch to Studio Deck widget view"
                title="Switch widget size"
                onClick={() => {
                  tactile.tap();
                  onChangeVariant('studio-deck');
                }}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
              >
                <Layers className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              aria-label="Hide widget"
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      );
    }

    return (
      <div
        role="region"
        aria-label="Studio Deck Expanded Widget"
        style={{ top: 'calc(4.35rem + env(safe-area-inset-top, 0px))' }}
        className="fixed left-3 right-3 sm:left-auto sm:right-5 sm:w-[380px] z-35 rounded-2xl border border-amber-500/30 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl shadow-2xl p-3.5 space-y-3"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-mono-tabular font-semibold uppercase tracking-wide accent-text">
            Studio Deck · {track.format} {track.bitDepth}b/{Math.round(track.sampleRate / 1000)}kHz
          </span>
          <div className="flex items-center gap-1">
            {onChangeVariant && (
              <button
                type="button"
                aria-label="Switch to Top Bar compact widget view"
                title="Switch to Compact Top Bar"
                onClick={() => {
                  tactile.tap();
                  onChangeVariant('top-bar');
                }}
                className="px-2 h-7 flex items-center gap-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[11px] text-zinc-500 font-medium"
              >
                <Layers className="w-3 h-3" />
                <span>4×1</span>
              </button>
            )}
            <button
              type="button"
              aria-label="Expand Now Playing"
              onClick={onExpand}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              aria-label="Hide widget"
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={onExpand}
          className="w-full flex items-center gap-3 text-left"
        >
          <CoverArt
            src={track.coverUrl}
            alt={track.title}
            isPlaying={isPlaying}
            className="w-16 h-16 rounded-xl shadow-sm"
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
              {track.title}
            </div>
            <div className="text-xs text-zinc-600 dark:text-zinc-300 truncate mt-0.5">
              {track.artist}
            </div>
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
              {track.album}
            </div>
          </div>
        </button>

        <div className="flex items-center justify-between pt-1 border-t border-zinc-200/80 dark:border-zinc-800/80">
          <button
            type="button"
            aria-label="Favorite"
            onClick={() => onToggleFavorite(track.id)}
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <Heart
              className={`w-4 h-4 ${track.favorite ? 'fill-rose-500 text-rose-500' : 'text-zinc-400'}`}
            />
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Previous"
              onClick={onPrev}
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <SkipBack className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label={isPlaying ? 'Pause' : 'Play'}
              onClick={onTogglePlay}
              className="min-w-[44px] min-h-[44px] rounded-full accent-bg flex items-center justify-center shadow-sm"
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 fill-current" />
              ) : (
                <Play className="w-5 h-5 fill-current ml-0.5" />
              )}
            </button>
            <button
              type="button"
              aria-label="Next"
              onClick={onNext}
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <SkipForward className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }
);
