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
  extractAvailableLetters,
  formatDuration,
  getAlphabetBucket,
} from '../utils/textNormalization';
import { AlphabetIndexSlider } from './AlphabetIndexSlider';
import { CoverArt } from './CoverArt';
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
  initialScrollTop?: number;
  onScrollChange?: (scrollTop: number) => void;
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
  isPlaying: boolean;
  playlists: Playlist[];
  bucket: string;
  isFirstInBucket: boolean;
  onPlayTrackItem: (track: Track) => void;
  onToggleFavorite: (trackId: string) => void;
  onRateTrack: (trackId: string, rating: number) => void;
  onToggleOfflineCache: (trackId: string) => void;
  onAddTrackToPlaylist: (trackId: string, playlistId: string) => void;
}>(({
  track,
  isActive,
  isPlaying,
  playlists,
  bucket,
  isFirstInBucket,
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
      data-alpha-bucket={isFirstInBucket ? bucket : undefined}
      className={`group flex items-center gap-2.5 sm:gap-3 px-2.5 sm:px-3 py-2 rounded-xl border transition-colors ${
        isActive
          ? 'border-amber-500/40 bg-amber-500/5 dark:bg-amber-500/10'
          : 'border-transparent hover:bg-zinc-100/80 dark:hover:bg-zinc-900/80'
      }`}
    >
      <button
        type="button"
        onClick={() => onPlayTrackItem(track)}
        className="flex items-center gap-3 min-w-0 flex-1 text-left active:scale-[0.99] transition-transform duration-100 focus-visible:outline-none"
      >
        <CoverArt
          src={track.coverUrl}
          alt={track.title}
          isPlaying={isActive && isPlaying}
          className="w-11 h-11 rounded-lg"
        />
        <div className="min-w-0 flex-1">
          <div
            className={`text-sm font-medium truncate ${
              isActive ? 'accent-text' : 'text-zinc-900 dark:text-zinc-100'
            }`}
          >
            {track.title}
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate flex items-center gap-1.5">
            <span className="truncate">{track.artist}</span>
            <span aria-hidden="true" className="hidden sm:inline">·</span>
            <span className="truncate hidden sm:inline">{track.album}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular shrink-0">
              {track.format} {track.bitDepth}b/{Math.round(track.sampleRate / 1000)}kHz
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
        className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg hover:bg-zinc-200/60 dark:hover:bg-zinc-800 active:scale-90 transition-transform duration-100"
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
          className="min-w-[38px] min-h-[38px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 active:scale-90 transition-transform duration-100"
        >
          <Plus className="w-4 h-4" />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-10 z-30 w-48 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl py-1.5">
            <div className="px-3 py-1 text-[11px] font-medium text-zinc-500">Add to playlist</div>
            {playlists.length === 0 ? (
              <div className="px-3 py-2 text-xs text-zinc-400">No playlists yet</div>
            ) : (
              playlists.map((pl) => (
                <button
                  key={pl.id}
                  type="button"
                  onClick={() => {
                    tactile.success();
                    onAddTrackToPlaylist(track.id, pl.id);
                    setMenuOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 truncate"
                >
                  {pl.name}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <span className="text-xs font-mono-tabular text-zinc-500 w-10 text-right shrink-0">
        {formatDuration(track.duration)}
      </span>
    </div>
  );
});

export const LibraryBrowser: React.FC<LibraryBrowserProps> = React.memo(
  ({
    tab,
    viewMode,
    tracks,
    playlists,
    currentTrackId,
    isPlaying,
    selectedAlbumFilter,
    selectedArtistFilter,
    selectedGenreFilter,
    selectedFolderFilter,
    selectedPlaylistFilter,
    onChangeViewMode,
    onPlayTrack,
    onPlayAll,
    onToggleFavorite,
    onRateTrack,
    onToggleOfflineCache,
    onAddTrackToPlaylist,
    onCreatePlaylist,
    onDeletePlaylist,
    onSelectAlbum,
    onSelectArtist,
    onSelectGenre,
    onSelectFolder,
    onSelectPlaylist,
    onImportLocalFolder,
    initialScrollTop = 0,
    onScrollChange,
  }) => {
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);
    const restoredScrollRef = useRef(false);
    const scrollTimerRef = useRef<number | null>(null);
    const [activeLetter, setActiveLetter] = useState<string | undefined>(undefined);
    const [newPlaylistName, setNewPlaylistName] = useState('');
    const [showNewPlaylist, setShowNewPlaylist] = useState(false);

    // Restore saved library scroll offset once after initial mount
    useEffect(() => {
      if (restoredScrollRef.current) return;
      restoredScrollRef.current = true;
      const el = scrollContainerRef.current;
      if (el && initialScrollTop > 0) {
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = initialScrollTop;
          }
        });
      }
    }, [initialScrollTop]);

    useEffect(() => {
      return () => {
        if (scrollTimerRef.current) {
          window.clearTimeout(scrollTimerRef.current);
        }
      };
    }, []);

    const handleLibraryScroll = useCallback(() => {
      const container = scrollContainerRef.current;
      if (!container) return;

      // Sync visible slider handle silently as user scrolls
      const containerTop = container.getBoundingClientRect().top + 16;
      const nodes = container.querySelectorAll('[data-alpha-bucket]');
      let currentBucket: string | undefined;
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i] as HTMLElement;
        if (el.getBoundingClientRect().top <= containerTop) {
          currentBucket = el.dataset.alphaBucket;
        } else {
          break;
        }
      }
      if (!currentBucket && nodes.length > 0) {
        currentBucket = (nodes[0] as HTMLElement).dataset.alphaBucket;
      }
      if (currentBucket) {
        setActiveLetter((prev) => (prev === currentBucket ? prev : currentBucket));
      }

      if (!onScrollChange) return;
      if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = window.setTimeout(() => {
        if (scrollContainerRef.current) {
          onScrollChange(Math.round(scrollContainerRef.current.scrollTop));
        }
      }, 120);
    }, [onScrollChange]);

    // Filtered tracks for Songs tab
    const filteredSongs = useMemo(() => {
      let list = tracks;
      if (selectedAlbumFilter) {
        list = list.filter((t) => t.album === selectedAlbumFilter);
      }
      if (selectedArtistFilter) {
        list = list.filter((t) => t.artist === selectedArtistFilter);
      }
      if (selectedGenreFilter) {
        list = list.filter((t) => t.genre === selectedGenreFilter);
      }
      if (selectedFolderFilter) {
        list = list.filter((t) => (t.folderPath || 'Local Imports') === selectedFolderFilter);
      }
      if (selectedPlaylistFilter) {
        const pl = playlists.find((p) => p.id === selectedPlaylistFilter);
        if (pl) {
          const set = new Set(pl.trackIds);
          list = list.filter((t) => set.has(t.id));
        }
      }
      return [...list].sort((a, b) => a.title.localeCompare(b.title));
    }, [
      tracks,
      playlists,
      selectedAlbumFilter,
      selectedArtistFilter,
      selectedGenreFilter,
      selectedFolderFilter,
      selectedPlaylistFilter,
    ]);

    const handlePlayTrackItem = useCallback(
      (track: Track) => {
        onPlayTrack(track, filteredSongs);
      },
      [onPlayTrack, filteredSongs]
    );

    // Grouped collections for Albums / Artists / Genres / Playlists / Folders
    const collectionItems = useMemo<GroupedCollectionItem[]>(() => {
      if (tab === 'songs') return [];

      if (tab === 'playlists') {
        const trackMap = new Map(tracks.map((t) => [t.id, t]));
        return [...playlists]
          .map((pl) => {
            const plTracks = pl.trackIds
              .map((id) => trackMap.get(id))
              .filter((t): t is Track => Boolean(t));
            return {
              id: pl.id,
              label: pl.name,
              subtitle: `${pl.source === 'ai' ? 'AI Mix' : 'Playlist'} · ${plTracks.length} tracks`,
              coverUrl:
                pl.coverUrl ||
                plTracks[0]?.coverUrl ||
                '/src/assets/images/album_nocturne_vinyl_1794587934959.jpg',
              trackCount: plTracks.length,
              isDeletable: pl.source === 'local' && !pl.id.startsWith('pl_seed_'),
              tracks: plTracks,
            };
          })
          .sort((a, b) => a.label.localeCompare(b.label));
      }

      const map = new Map<string, Track[]>();
      tracks.forEach((t) => {
        const key =
          tab === 'albums'
            ? t.album
            : tab === 'artists'
            ? t.artist
            : tab === 'genres'
            ? t.genre
            : t.folderPath || 'Reference Studio';
        const arr = map.get(key) || [];
        arr.push(t);
        map.set(key, arr);
      });

      return [...map.entries()]
        .map(([label, grpTracks]) => ({
          id: label,
          label,
          subtitle:
            tab === 'albums'
              ? `${grpTracks[0]?.artist || 'Various'} · ${grpTracks.length} tracks`
              : `${grpTracks.length} track${grpTracks.length === 1 ? '' : 's'}`,
          coverUrl:
            grpTracks[0]?.coverUrl || '/src/assets/images/album_nocturne_vinyl_1794587934959.jpg',
          trackCount: grpTracks.length,
          tracks: grpTracks,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }, [tab, tracks, playlists]);

    const allTabTracks = useMemo(() => {
      if (tab === 'songs') return filteredSongs;
      const seen = new Set<string>();
      const combined: Track[] = [];
      collectionItems.forEach((item) => {
        item.tracks.forEach((t) => {
          if (!seen.has(t.id)) {
            seen.add(t.id);
            combined.push(t);
          }
        });
      });
      return combined;
    }, [tab, filteredSongs, collectionItems]);

    const sliderLetters = useMemo(() => {
      const labels =
        tab === 'songs'
          ? filteredSongs.map((t) => t.title)
          : collectionItems.map((c) => c.label);
      return extractAvailableLetters(labels);
    }, [tab, filteredSongs, collectionItems]);

    const handleSelectAlphabetLetter = useCallback(
      (letter: string) => {
        setActiveLetter(letter);
        const container = scrollContainerRef.current;
        if (!container) return;
        const target = container.querySelector(`[data-alpha-bucket="${letter}"]`) as HTMLElement | null;
        if (target) {
          target.scrollIntoView({ behavior: 'auto', block: 'start' });
        } else {
          const idx = sliderLetters.indexOf(letter);
          for (let i = idx + 1; i < sliderLetters.length; i++) {
            const nextEl = container.querySelector(
              `[data-alpha-bucket="${sliderLetters[i]}"]`
            ) as HTMLElement | null;
            if (nextEl) {
              nextEl.scrollIntoView({ behavior: 'auto', block: 'start' });
              break;
            }
          }
        }
      },
      [sliderLetters]
    );

    const hasActiveFilter = Boolean(
      selectedAlbumFilter ||
        selectedArtistFilter ||
        selectedGenreFilter ||
        selectedFolderFilter ||
        selectedPlaylistFilter
    );

    const activeFilterBreadcrumb = selectedAlbumFilter
      ? { group: 'Albums', value: selectedAlbumFilter }
      : selectedArtistFilter
      ? { group: 'Artists', value: selectedArtistFilter }
      : selectedGenreFilter
      ? { group: 'Genres', value: selectedGenreFilter }
      : selectedFolderFilter
      ? { group: 'Folders', value: selectedFolderFilter }
      : selectedPlaylistFilter
      ? {
          group: 'Playlists',
          value: playlists.find((p) => p.id === selectedPlaylistFilter)?.name || 'Selected',
        }
      : null;

    const clearAllFilters = () => {
      onSelectAlbum(null);
      onSelectArtist(null);
      onSelectGenre(null);
      onSelectFolder(null);
      onSelectPlaylist(null);
    };

    const handleCollectionOpen = (item: GroupedCollectionItem) => {
      tactile.tap();
      clearAllFilters();
      if (tab === 'albums') onSelectAlbum(item.label);
      else if (tab === 'artists') onSelectArtist(item.label);
      else if (tab === 'genres') onSelectGenre(item.label);
      else if (tab === 'folders') onSelectFolder(item.label);
      else if (tab === 'playlists') onSelectPlaylist(item.id);
    };

    const seenBuckets = new Set<string>();

    return (
      <div className="flex flex-col h-full min-h-0">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3.5 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <div className="flex items-baseline gap-2.5 min-w-0">
            <h2 className="text-xl font-display font-semibold capitalize text-zinc-900 dark:text-zinc-100">
              {tab}
            </h2>
            <span className="text-xs font-mono-tabular text-zinc-500">
              {tab === 'songs' ? `${filteredSongs.length} tracks` : `${collectionItems.length} items`}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={allTabTracks.length === 0}
              onClick={() => onPlayAll(allTabTracks, false)}
              className="min-h-[40px] px-3.5 rounded-lg accent-bg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap active:scale-95 transition-transform duration-100 disabled:opacity-40"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Play All</span>
            </button>

            <button
              type="button"
              disabled={allTabTracks.length === 0}
              onClick={() => onPlayAll(allTabTracks, true)}
              className="min-h-[40px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap active:scale-95 transition-transform duration-100 disabled:opacity-40"
            >
              <Shuffle className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Play All Random</span>
              <span className="sm:hidden">Shuffle</span>
            </button>

            {tab === 'folders' && (
              <button
                type="button"
                onClick={onImportLocalFolder}
                className="min-h-[40px] px-3.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap active:scale-95 transition-transform duration-100"
              >
                <FolderOpen className="w-4 h-4" />
                <span>Scan Folder</span>
              </button>
            )}

            {tab === 'playlists' && (
              <button
                type="button"
                onClick={() => {
                  tactile.tap();
                  setShowNewPlaylist((v) => !v);
                }}
                className="min-h-[40px] px-3.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap active:scale-95 transition-transform duration-100"
              >
                <Plus className="w-4 h-4" />
                <span>New Playlist</span>
              </button>
            )}

            {/* Persistent List View <-> Square View Toggle */}
            <div className="inline-flex items-center p-1 rounded-lg bg-zinc-200/70 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                aria-label="List view"
                onClick={() => {
                  tactile.tap();
                  onChangeViewMode('list');
                }}
                className={`min-w-[38px] min-h-[34px] px-2.5 rounded-md flex items-center justify-center gap-1.5 text-xs font-medium transition-colors ${
                  viewMode === 'list'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <List className="w-4 h-4" />
                <span className="hidden sm:inline">List</span>
              </button>
              <button
                type="button"
                aria-label="Square grid view"
                onClick={() => {
                  tactile.tap();
                  onChangeViewMode('grid');
                }}
                className={`min-w-[38px] min-h-[34px] px-2.5 rounded-md flex items-center justify-center gap-1.5 text-xs font-medium transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <LayoutGrid className="w-4 h-4" />
                <span className="hidden sm:inline">Grid</span>
              </button>
            </div>
          </div>
        </div>

        {/* New Playlist Inline Form */}
        {tab === 'playlists' && showNewPlaylist && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newPlaylistName.trim()) {
                onCreatePlaylist(newPlaylistName.trim());
                setNewPlaylistName('');
                setShowNewPlaylist(false);
              }
            }}
            className="mt-3 flex items-center gap-2 shrink-0"
          >
            <input
              type="text"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              placeholder="Enter playlist name..."
              autoFocus
              className="flex-1 min-h-[42px] px-3 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm"
            />
            <button
              type="submit"
              className="min-h-[42px] px-4 rounded-lg accent-bg text-sm font-medium whitespace-nowrap active:scale-95 transition-transform duration-100"
            >
              Create
            </button>
          </form>
        )}

        {/* Active Filter Breadcrumb in Songs */}
        {tab === 'songs' && hasActiveFilter && activeFilterBreadcrumb && (
          <div className="mt-2.5 flex items-center justify-between gap-3 py-1.5 border-b border-zinc-200/70 dark:border-zinc-800/70 shrink-0">
            <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 min-w-0">
              <span>{activeFilterBreadcrumb.group}</span>
              <span aria-hidden="true">/</span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                {activeFilterBreadcrumb.value}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                tactile.tap();
                clearAllFilters();
              }}
              className="min-h-[32px] px-2 text-xs font-medium accent-text flex items-center gap-1 shrink-0 hover:underline"
            >
              <X className="w-3.5 h-3.5" />
              <span>Show All</span>
            </button>
          </div>
        )}

        {/* Scrollable Content + Right-Side Alphabetical Slider */}
        <div className="flex-1 min-h-0 flex gap-2 mt-3 relative">
          <div
            ref={scrollContainerRef}
            onScroll={handleLibraryScroll}
            className="flex-1 overflow-y-auto pr-1 pb-6 space-y-2"
          >
            {tab === 'songs' ? (
              filteredSongs.length === 0 ? (
                <div className="py-16 text-center space-y-3">
                  <Music className="w-10 h-10 mx-auto text-zinc-400 opacity-60" />
                  <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    No tracks match this filter or offline mode.
                  </div>
                  <button
                    type="button"
                    onClick={hasActiveFilter ? clearAllFilters : onImportLocalFolder}
                    className="min-h-[42px] px-4 py-2 rounded-lg accent-bg text-xs font-medium inline-flex items-center gap-2 active:scale-95 transition-transform duration-100"
                  >
                    <FolderOpen className="w-4 h-4" />
                    <span>{hasActiveFilter ? 'Show All Tracks' : 'Add Local Music Folder'}</span>
                  </button>
                </div>
              ) : viewMode === 'list' ? (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
                  {filteredSongs.map((track) => {
                    const bucket = getAlphabetBucket(track.title);
                    const isFirst = !seenBuckets.has(bucket);
                    if (isFirst) seenBuckets.add(bucket);
                    return (
                      <TrackRow
                        key={track.id}
                        track={track}
                        isActive={track.id === currentTrackId}
                        isPlaying={isPlaying}
                        playlists={playlists}
                        bucket={bucket}
                        isFirstInBucket={isFirst}
                        onPlayTrackItem={handlePlayTrackItem}
                        onToggleFavorite={onToggleFavorite}
                        onRateTrack={onRateTrack}
                        onToggleOfflineCache={onToggleOfflineCache}
                        onAddTrackToPlaylist={onAddTrackToPlaylist}
                      />
                    );
                  })}
                </div>
              ) : (
                /* Compact Square Grid View for Songs */
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
                  {filteredSongs.map((track) => {
                    const bucket = getAlphabetBucket(track.title);
                    const isFirst = !seenBuckets.has(bucket);
                    if (isFirst) seenBuckets.add(bucket);
                    const active = track.id === currentTrackId;
                    return (
                      <button
                        key={track.id}
                        type="button"
                        data-alpha-bucket={isFirst ? bucket : undefined}
                        onClick={() => handlePlayTrackItem(track)}
                        className={`group rounded-xl border p-2.5 text-left transition-all duration-100 active:scale-[0.98] focus-visible:outline-none ${
                          active
                            ? 'border-amber-500/60 bg-amber-500/10'
                            : 'border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-900/50 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                        }`}
                      >
                        <div className="relative aspect-square w-full mb-2">
                          <CoverArt
                            src={track.coverUrl}
                            alt={track.title}
                            isPlaying={active && isPlaying}
                            className="w-full h-full rounded-lg"
                          />
                        </div>
                        <div
                          className={`text-xs font-medium truncate ${
                            active ? 'accent-text' : 'text-zinc-900 dark:text-zinc-100'
                          }`}
                        >
                          {track.title}
                        </div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                          {track.artist} · {track.format}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )
            ) : collectionItems.length === 0 ? (
              <div className="py-16 text-center text-sm text-zinc-500">
                No items found in {tab}.
              </div>
            ) : viewMode === 'list' ? (
              /* List View with small album artwork across Albums, Artists, Genres, Playlists, Folders */
              <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {collectionItems.map((item) => {
                  const bucket = getAlphabetBucket(item.label);
                  const isFirst = !seenBuckets.has(bucket);
                  if (isFirst) seenBuckets.add(bucket);
                  return (
                    <div
                      key={item.id}
                      data-alpha-bucket={isFirst ? bucket : undefined}
                      className="flex items-center justify-between gap-3 px-2.5 sm:px-3 py-2 rounded-xl hover:bg-zinc-100/80 dark:hover:bg-zinc-900/80 transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => handleCollectionOpen(item)}
                        className="flex items-center gap-3 min-w-0 flex-1 text-left active:scale-[0.99] transition-transform duration-100"
                      >
                        <CoverArt
                          src={item.coverUrl}
                          alt={item.label}
                          className="w-11 h-11 rounded-lg"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                            {item.label}
                          </div>
                          <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                            {item.subtitle}
                          </div>
                        </div>
                      </button>

                      <div className="flex items-center gap-1 shrink-0">
                        {item.tracks.length > 0 && (
                          <>
                            <button
                              type="button"
                              aria-label={`Play all in ${item.label}`}
                              title="Play All"
                              onClick={() => onPlayAll(item.tracks, false)}
                              className="min-w-[38px] min-h-[38px] rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 flex items-center justify-center text-zinc-700 dark:text-zinc-200 active:scale-90 transition-transform duration-100"
                            >
                              <Play className="w-4 h-4 fill-current" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Play random in ${item.label}`}
                              title="Play All Random"
                              onClick={() => onPlayAll(item.tracks, true)}
                              className="min-w-[38px] min-h-[38px] rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 flex items-center justify-center text-zinc-500 dark:text-zinc-400 active:scale-90 transition-transform duration-100"
                            >
                              <Shuffle className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                        {item.isDeletable && onDeletePlaylist && (
                          <button
                            type="button"
                            aria-label={`Delete ${item.label}`}
                            title="Delete playlist"
                            onClick={() => onDeletePlaylist(item.id)}
                            className="min-w-[38px] min-h-[38px] rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-red-500 active:scale-90 transition-all duration-100"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label={`Open ${item.label}`}
                          onClick={() => handleCollectionOpen(item)}
                          className="min-w-[38px] min-h-[38px] rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 flex items-center justify-center text-zinc-400"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Compact Square Grid View across Albums, Artists, Genres, Playlists, Folders */
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
                {collectionItems.map((item) => {
                  const bucket = getAlphabetBucket(item.label);
                  const isFirst = !seenBuckets.has(bucket);
                  if (isFirst) seenBuckets.add(bucket);
                  return (
                    <div
                      key={item.id}
                      data-alpha-bucket={isFirst ? bucket : undefined}
                      className="group rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-900/50 hover:bg-zinc-50 dark:hover:bg-zinc-900 p-2.5 transition-colors flex flex-col justify-between gap-2.5"
                    >
                      <button
                        type="button"
                        onClick={() => handleCollectionOpen(item)}
                        className="w-full text-left focus-visible:outline-none active:scale-[0.98] transition-transform duration-100"
                      >
                        <div className="relative aspect-square w-full mb-2">
                          <CoverArt
                            src={item.coverUrl}
                            alt={item.label}
                            className="w-full h-full rounded-lg"
                          />
                        </div>
                        <div className="text-xs font-medium truncate text-zinc-900 dark:text-zinc-100">
                          {item.label}
                        </div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                          {item.subtitle}
                        </div>
                      </button>
                      {item.tracks.length > 0 && (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onPlayAll(item.tracks, false)}
                            aria-label={`Play all in ${item.label}`}
                            className="flex-1 min-h-[34px] rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[11px] font-medium flex items-center justify-center gap-1 text-zinc-800 dark:text-zinc-200 active:scale-95 transition-transform duration-100"
                          >
                            <Play className="w-3 h-3 fill-current" />
                            <span>Play</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onPlayAll(item.tracks, true)}
                            aria-label={`Play random in ${item.label}`}
                            title="Play Random"
                            className="min-w-[34px] min-h-[34px] rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 flex items-center justify-center text-zinc-600 dark:text-zinc-300 active:scale-95 transition-transform duration-100"
                          >
                            <Shuffle className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right-Side Alphabetical Quick-Scroll Slider */}
          <AlphabetIndexSlider
            letters={sliderLetters}
            activeLetter={activeLetter}
            onSelectLetter={handleSelectAlphabetLetter}
          />
        </div>
      </div>
    );
  }
);
