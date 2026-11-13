import React from 'react';
import { Heart, Maximize2, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react';
import { Track } from '../types/music';
import { CoverArt } from './CoverArt';

interface HomescreenWidgetProps {
  visible: boolean;
  track: Track | null;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleFavorite: (trackId: string) => void;
  onExpand: () => void;
  onClose: () => void;
}

export const HomescreenWidget: React.FC<HomescreenWidgetProps> = React.memo(
  ({
    visible,
    track,
    isPlaying,
    onTogglePlay,
    onPrev,
    onNext,
    onToggleFavorite,
    onExpand,
    onClose,
  }) => {
    if (!visible || !track) return null;

    return (
      <div
        role="region"
        aria-label="Homescreen Mini Player Widget"
        className="fixed bottom-24 right-4 z-30 w-72 sm:w-80 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md shadow-xl p-3"
      >
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
            Homescreen Widget
          </span>
          <div className="flex items-center gap-1">
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

        <div className="flex items-center gap-3">
          <CoverArt
            src={track.coverUrl}
            alt={track.title}
            isPlaying={isPlaying}
            className="w-12 h-12 rounded-xl"
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
              {track.title}
            </div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
              {track.artist}
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between">
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

          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous"
              onClick={onPrev}
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <SkipBack className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label={isPlaying ? 'Pause' : 'Play'}
              onClick={onTogglePlay}
              className="min-w-[40px] min-h-[40px] rounded-full accent-bg flex items-center justify-center"
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
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <SkipForward className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }
);
