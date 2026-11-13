import React, { useEffect, useRef, useState } from 'react';
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

export const NowPlayingView: React.FC<NowPlayingViewProps> = React.memo(
  ({
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
  }) => {
    const [progress, setProgress] = useState({ currentTime: 0, duration: track?.duration || 0 });
    const [dragTime, setDragTime] = useState<number | null>(null);
    const [dragOffsetY, setDragOffsetY] = useState(0);
    const [isDraggingSheet, setIsDraggingSheet] = useState(false);

    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const touchStartRef = useRef<{ y: number; time: number } | null>(null);

    useEffect(() => {
      if (!open) return;
      setDragOffsetY(0);
      setIsDraggingSheet(false);
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

    // Real-time audio spectrum analyzer (respects Low Battery Mode)
    useEffect(() => {
      if (!open || !isPlaying || lowBatteryMode) return;
      let rafId = 0;
      const bins = new Uint8Array(64);
      const draw = () => {
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
        rafId = requestAnimationFrame(draw);
      };
      rafId = requestAnimationFrame(draw);
      return () => cancelAnimationFrame(rafId);
    }, [open, isPlaying, lowBatteryMode]);

    if (!track) return null;

    const dur = progress.duration || track.duration || 1;
    const displayTime = dragTime !== null ? dragTime : progress.currentTime;

    const handleTouchStart = (e: React.TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input[type="range"]')) return;
      const scrollTop = scrollRef.current?.scrollTop || 0;
      const onHandleArea = Boolean(target.closest('[data-sheet-handle="true"]'));
      if (scrollTop > 4 && !onHandleArea) return;
      touchStartRef.current = { y: e.touches[0].clientY, time: performance.now() };
      setIsDraggingSheet(true);
    };

    const handleTouchMove = (e: React.TouchEvent) => {
      if (!touchStartRef.current) return;
      const dy = e.touches[0].clientY - touchStartRef.current.y;
      if (dy > 0) {
        setDragOffsetY(dy);
      } else {
        setDragOffsetY(0);
      }
    };

    const handleTouchEnd = () => {
      if (!touchStartRef.current) {
        setIsDraggingSheet(false);
        setDragOffsetY(0);
        return;
      }
      const elapsed = Math.max(16, performance.now() - touchStartRef.current.time);
      const velocity = dragOffsetY / elapsed;
      const shouldClose = dragOffsetY > 90 || (dragOffsetY > 42 && velocity > 0.45);
      touchStartRef.current = null;
      setIsDraggingSheet(false);
      setDragOffsetY(0);
      if (shouldClose) {
        onClose();
      }
    };

    const transformValue = open
      ? `translate3d(0, ${dragOffsetY}px, 0)`
      : 'translate3d(0, 100%, 0)';

    return (
      <div
        ref={scrollRef}
        aria-hidden={!open}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          transform: transformValue,
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))',
        }}
        className={`fixed inset-0 z-50 bg-zinc-50 dark:bg-zinc-950 flex flex-col overflow-y-auto ${
          isDraggingSheet
            ? ''
            : 'transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]'
        } ${open ? 'pointer-events-auto' : 'pointer-events-none'}`}
      >
        {/* Top Drag Handle Pill + Header */}
        <div
          data-sheet-handle="true"
          className="sticky top-0 z-10 bg-zinc-50/95 dark:bg-zinc-950/95 backdrop-blur-md border-b border-zinc-200/80 dark:border-zinc-800/80 shrink-0"
        >
          <div className="pt-2.5 pb-1 flex justify-center">
            <span className="w-12 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
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

        {/* Main Content */}
        <div className="flex-1 max-w-4xl w-full mx-auto px-5 py-6 sm:py-10 flex flex-col lg:flex-row items-center gap-7 lg:gap-12 justify-center">
          <div className="w-full max-w-[320px] sm:max-w-[380px] flex flex-col items-center gap-4">
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
    );
  }
);
