import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  Download,
  FolderOpen,
  Heart,
  LayoutGrid,
  List,
  Music,
  Play,
  Plus,
  Shuffle,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { Playlist, Track, ViewMode } from '../types/music';
import {
  compareLibraryLabels,
  extractAvailableLetters,
  formatDuration,
  getAlphabetBucket,
} from '../utils/textNormalization';
import { AlphabetIndexSlider } from './AlphabetIndexSlider';
import { CoverArt } from './CoverArt';
import { PaginationBar } from './PaginationBar';
import { useViewportPageSize } from '../hooks/useViewportPageSize';
import { tactile } from '../services/tactileFeedback';

export type LibraryTab = 'songs' | 'albums' | 'artists' | 'genres' | 'playlists' | 'folders';

interface LibraryBrowserProps {
  tab: LibraryTab;
  viewMode: ViewMode;
  tracks: Track[];
  playlists: Playlist[];
  currentTrackId: string | null;
  isPlaying: boolean;
  selectedAlbumFilter: string | null;
  selectedArtistFilter: string | null;
  selectedGenreFilter: string | null;
  selectedFolderFilter: string | null;
  selectedPlaylistFilter: string | null;
  onChangeViewMode: (mode: ViewMode) => void;
  onPlayTrack: (track: Track, queue: Track[]) => void;
  onPlayAll: (tracks: Track[], random: boolean) => void;
  onToggleFavorite: (trackId: string) => void;
  onRateTrack: (trackId: string, rating: number) => void;
  onToggleOfflineCache: (trackId: string) => void;
  onAddTrackToPlaylist: (trackId: string, playlistId: string) => void;
  onCreatePlaylist: (name: string) => void;
  onDeletePlaylist?: (playlistId: string) => void;
  onSelectAlbum: (album: string | null) => void;
  onSelectArtist: (artist: string | null) => void;
  onSelectGenre: (genre: string | null) => void;
  onSelectFolder: (folder: string | null) => void;
  onSelectPlaylist: (playlistId: string | null) => void;
  onImportLocalFolder: () => void;
}

interface GroupedCollectionItem {
  id: string;
  label: string;
  subtitle: string;
  coverUrl: string;
  trackCount: number;
  isDeletable?: boolean;
  tracks: Track[];
}

const TrackRow = React.memo<{
  track: Track;
  isActive: boolean;
  isHighlighted: boolean;
  isPlaying: boolean;
  playlists: Playlist[];
  onPlayTrackItem: (track: Track) => void;
  onToggleFavorite: (trackId: string) => void;
  onRateTrack: (trackId: string, rating: number) => void;
  onToggleOfflineCache: (trackId: string) => void;
  onAddTrackToPlaylist: (trackId: string, playlistId: string) => void;
}>(({
  track,
  isActive,
  isHighlighted,
  isPlaying,
  playlists,
  onPlayTrackItem,
  onToggleFavorite,
  onRateTrack,
  onToggleOfflineCache,
  onAddTrackToPlaylist,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [menuOpen]);

  return (
    <div
      className={`group flex items-center gap-2 sm:gap-3 px-2 sm:px-3 py-1 rounded-xl border transition-colors h-[54px] ${
        isActive
          ? 'border-amber-500/45 bg-amber-500/10'
          : isHighlighted
          ? 'border-amber-500 bg-amber-500/15'
          : 'border-transparent hover:bg-zinc-100/80 dark:hover:bg-zinc-900/80'
      }`}
    >
      <button
        type="button"
        onClick={() => onPlayTrackItem(track)}
        className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1 text-left active:scale-[0.99] transition-transform duration-100 focus-visible:outline-none"
      >
        <CoverArt
          src={track.coverUrl}
          alt={track.title}
          isPlaying={isActive && isPlaying}
          className="w-10 h-10 rounded-lg"
        />
        <div className="min-w-0 flex-1">
          <div
            className={`text-sm font-medium truncate ${
              isActive || isHighlighted ? 'accent-text' : 'text-zinc-900 dark:text-zinc-100'
            }`}
          >
            {track.title}
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate flex items-center gap-1.5">
            <span className="truncate">{track.artist}</span>
            <span aria-hidden="true" className="hidden sm:inline">·</span>
            <span className="truncate hidden sm:inline">{track.album}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular shrink-0 text-[11px]">
              {track.format} {track.bitDepth}b/{Math.round(track.sampleRate / 1000)}k
            </span>
          </div>
        </div>
      </button>

      {/* Compact 1-5 Stars (desktop) */}
      <div className="hidden xl:flex items-center gap-0.5 shrink-0">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            aria-label={`Rate ${star} stars`}
            onClick={() => {
              const nextRating = track.rating === star ? 0 : star;
              onRateTrack(track.id, nextRating);
            }}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-zinc-200/70 dark:hover:bg-zinc-800 active:scale-90 transition-transform duration-100"
          >
            <Star
              className={`w-3.5 h-3.5 ${
                star <= track.rating
                  ? 'fill-amber-400 text-amber-400'
                  : 'text-zinc-300 dark:text-zinc-700'
              }`}
            />
          </button>
        ))}
      </div>

      {/* Offline Cache Toggle */}
      <button
        type="button"
        aria-label={track.offlineCached ? 'Cached offline' : 'Cache for offline'}
        title={track.offlineCached ? 'Available Offline' : 'Mark for Offline'}
        onClick={() => onToggleOfflineCache(track.id)}
        className={`hidden sm:flex min-w-[36px] min-h-[36px] items-center justify-center rounded-lg active:scale-90 transition-all duration-100 ${
          track.offlineCached
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
        }`}
      >
        <Download className="w-4 h-4" />
      </button>

      {/* Favorite */}
      <button
        type="button"
        aria-label={track.favorite ? 'Remove favorite' : 'Add favorite'}
        title={track.favorite ? 'Remove favorite' : 'Favorite'}
        onClick={() => onToggleFavorite(track.id)}
        className="min-w-[38px] min-h-[38px] flex items-center justify-center rounded-lg hover:bg-zinc-200/60 dark:hover:bg-zinc-800 active:scale-90 transition-transform duration-100"
      >
        <Heart
          className={`w-4 h-4 ${
            track.favorite ? 'fill-rose-500 text-rose-500' : 'text-zinc-400'
          }`}
        />
      </button>

      {/* Add to Playlist Quick Menu */}
      <div className="relative" ref={menuContainerRef}>
        <button
          type="button"
          aria-label="Add to playlist"
          title="Add to playlist"
          onClick={() => {
            tactile.tap();
            setMenuOpen((o) => !o);
          }}
          className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 active:scale-90 transition-transform duration-100"
        >
          <Plus className="w-4 h-4" />
        </button>
        {menuOpen && (
          <div className="absolute right-0 bottom-10 z-30 w-48 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl py-1.5">
            <div className="px-3 py-1 text-[11px] font-medium text-zinc-500">Add to playlist</div>
            {playlists.length === 0 ? (
              <div className="px-3 py-2 text-xs text-zinc-400">No playlists yet</div>
            ) : (
              playlists.slice(0, 8).map((pl) => (
                <button
                  key={pl.id}
