import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUpDown,
  BellRing,
  Check,
  CheckSquare,
  ChevronRight,
  Download,
  FolderOpen,
  Heart,
  Info,
  LayoutGrid,
  List,
  ListMusic,
  ListPlus,
  Mic2,
  Moon,
  MoreVertical,
  Music,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Share2,
  Shuffle,
  Sliders,
  Sun,
  Tag,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import {
  EQPreset,
  LibrarySortConfig,
  LibrarySortField,
  Playlist,
  TagCleanupSuggestion,
  ThemeMode,
  Track,
  ViewMode,
} from '../types/music';
import {
  compareLibraryLabels,
  extractAvailableLetters,
  formatDuration,
  getAlphabetBucket,
  matchesNormalizedQuery,
} from '../utils/textNormalization';
import { cleanFileNameTitle } from '../services/metadataParser';
import { AlphabetIndexSlider } from './AlphabetIndexSlider';
import { CoverArt } from './CoverArt';
import { AiCorrectionTarget, ItemAiCorrectionModal } from './ItemAiCorrectionModal';
import { PaginationBar } from './PaginationBar';
import { useViewportPageSize } from '../hooks/useViewportPageSize';
import { tactile } from '../services/tactileFeedback';
import defaultVinylCover from '../assets/images/album_nocturne_vinyl_1794587934959.jpg';

export type LibraryTab = 'songs' | 'albums' | 'artists' | 'genres' | 'playlists' | 'folders';

export interface TrackMetadataPatch {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  year?: string;
  composer?: string;
  lyrics?: string;
}

interface LibraryBrowserProps {
  tab: LibraryTab;
  viewMode: ViewMode;
  themeMode: ThemeMode;
  sortBy: LibrarySortConfig;
  tracks: Track[];
  playlists: Playlist[];
  eqPresets: EQPreset[];
  searchQuery: string;
  currentTrackId: string | null;
  isPlaying: boolean;
  selectedAlbumFilter: string | null;
  selectedArtistFilter: string | null;
  selectedGenreFilter: string | null;
  selectedFolderFilter: string | null;
  selectedPlaylistFilter: string | null;
  initialStartIndex?: number;
  onChangeStartIndex?: (idx: number) => void;
  onChangeSearchQuery: (q: string) => void;
  onChangeViewMode: (mode: ViewMode) => void;
  onChangeSortBy: (next: LibrarySortConfig) => void;
  onPlayTrack: (track: Track, queue: Track[]) => void;
  onPlaySingleTrack: (track: Track) => void;
  onShuffleFromTrack: (track: Track) => void;
  onPlayNext: (track: Track) => void;
  onPlayNextMany: (tracks: Track[]) => void;
  onAddToQueue: (track: Track) => void;
  onAddTracksToQueue: (tracks: Track[]) => void;
  onPlayAll: (tracks: Track[], random: boolean) => void;
  onToggleFavorite: (trackId: string) => void;
  onToggleOfflineCache: (trackId: string) => void;
  onAddTrackToPlaylist: (trackId: string, playlistId: string) => void;
  onAddTracksToPlaylist: (trackIds: string[], playlistId: string) => void;
  onCreatePlaylist: (name: string, initialTrackIds?: string[]) => void;
  onEditTracksMetadata: (trackIds: string[], patch: TrackMetadataPatch) => void;
  onApplyTagCleanups: (suggestions: TagCleanupSuggestion[]) => void;
  onShowNoChangesToast: (message?: string) => void;
  onAssignEqPreset: (trackIds: string[], presetId: string | undefined) => void;
  onSetRingtone: (track: Track) => void;
  onDeleteTracks: (trackIds: string[]) => void;
  onDeletePlaylist?: (playlistId: string) => void;
  onExportPlaylistM3u?: (playlistId: string) => void;
  onImportM3uFiles?: (files: FileList | File[]) => void;
  onSelectAlbum: (album: string | null) => void;
  onSelectArtist: (artist: string | null) => void;
  onSelectGenre: (genre: string | null) => void;
  onSelectFolder: (folder: string | null) => void;
  onSelectPlaylist: (playlistId: string | null) => void;
  onImportLocalFolder: () => void;
  onOpenSettings: () => void;
  onOpenEqualizer: () => void;
  onToggleTheme: () => void;
  onShareApp: () => void;
}

interface GroupedCollectionItem {
  id: string;
  label: string;
  subtitle: string;
  coverUrl: string;
  trackCount: number;
  tracks: Track[];
  addedAt: number;
  artist: string;
  album: string;
  yearNum: number;
  playCount: number;
  lastPlayedAt: number;
  rating: number;
  skipCount: number;
  lastSkippedAt: number;
  genre: string;
  composer: string;
  folderName: string;
}

const SORT_OPTIONS: Array<{ field: LibrarySortField; label: string }> = [
  { field: 'title', label: 'Title' },
  { field: 'addedAt', label: 'Date Added' },
  { field: 'artist', label: 'Artist' },
  { field: 'album', label: 'Album' },
  { field: 'year', label: 'Year' },
  { field: 'playCount', label: 'Play Count' },
  { field: 'lastPlayedAt', label: 'Last Played' },
  { field: 'rating', label: 'Rating' },
  { field: 'skipCount', label: 'Skip Count' },
  { field: 'lastSkippedAt', label: 'Last Skipped' },
  { field: 'genre', label: 'Genre' },
  { field: 'composer', label: 'Composer' },
  { field: 'folders', label: 'Folders' },
];

function parseYearNumber(raw?: string): number {
  const m = String(raw || '').match(/\b(19\d{2}|20\d{2})\b/);
  return m ? Number.parseInt(m[1], 10) : 0;
}

function compareTextValues(a: string, b: string): number {
  const cleanA = (a || '').trim();
  const cleanB = (b || '').trim();
  if (!cleanA && !cleanB) return 0;
  if (!cleanA) return 1;
  if (!cleanB) return -1;
  return compareLibraryLabels(cleanA, cleanB);
}

function compareTracksBySort(a: Track, b: Track, sort: LibrarySortConfig): number {
  const dir = sort.ascending ? 1 : -1;
  let cmp = 0;
  switch (sort.field) {
    case 'title':
      cmp = compareTextValues(a.title, b.title);
      break;
    case 'addedAt':
      cmp = (a.addedAt || 0) - (b.addedAt || 0);
      break;
    case 'artist':
      cmp = compareTextValues(a.artist, b.artist) || compareTextValues(a.album, b.album);
      break;
    case 'album':
      cmp = compareTextValues(a.album, b.album);
      break;
    case 'year':
      cmp = parseYearNumber(a.year) - parseYearNumber(b.year);
      break;
    case 'playCount':
      cmp = (a.playCount || 0) - (b.playCount || 0);
      break;
    case 'lastPlayedAt':
      cmp = (a.lastPlayedAt || 0) - (b.lastPlayedAt || 0);
      break;
    case 'rating':
      cmp = (a.rating || 0) - (b.rating || 0);
      break;
    case 'skipCount':
      cmp = (a.skipCount || 0) - (b.skipCount || 0);
      break;
    case 'lastSkippedAt':
      cmp = (a.lastSkippedAt || 0) - (b.lastSkippedAt || 0);
      break;
    case 'genre':
      cmp = compareTextValues(a.genre, b.genre);
      break;
    case 'composer':
      cmp = compareTextValues(a.composer || '', b.composer || '');
      break;
    case 'folders':
      cmp = compareTextValues(a.folderPath || 'Local Imports', b.folderPath || 'Local Imports');
      break;
  }
  if (cmp !== 0) return cmp * dir;
  return compareTextValues(a.title, b.title) * dir;
}

function compareCollectionsBySort(
  a: GroupedCollectionItem,
  b: GroupedCollectionItem,
  sort: LibrarySortConfig
): number {
  const dir = sort.ascending ? 1 : -1;
  let cmp = 0;
  switch (sort.field) {
    case 'title':
      cmp = compareTextValues(a.label, b.label);
      break;
    case 'addedAt':
      cmp = a.addedAt - b.addedAt;
      break;
    case 'artist':
      cmp = compareTextValues(a.artist, b.artist);
      break;
    case 'album':
      cmp = compareTextValues(a.album, b.album);
      break;
    case 'year':
      cmp = a.yearNum - b.yearNum;
      break;
    case 'playCount':
      cmp = a.playCount - b.playCount;
      break;
    case 'lastPlayedAt':
      cmp = a.lastPlayedAt - b.lastPlayedAt;
      break;
    case 'rating':
      cmp = a.rating - b.rating;
      break;
    case 'skipCount':
      cmp = a.skipCount - b.skipCount;
      break;
    case 'lastSkippedAt':
      cmp = a.lastSkippedAt - b.lastSkippedAt;
      break;
    case 'genre':
      cmp = compareTextValues(a.genre, b.genre);
      break;
    case 'composer':
      cmp = compareTextValues(a.composer, b.composer);
      break;
    case 'folders':
      cmp = compareTextValues(a.folderName, b.folderName);
      break;
  }
  if (cmp !== 0) return cmp * dir;
  return compareTextValues(a.label, b.label) * dir;
}

function getSongBucketLabel(t: Track, field: LibrarySortField): string {
  switch (field) {
    case 'artist':
      return t.artist || t.title;
    case 'album':
      return t.album || t.title;
    case 'genre':
      return t.genre || t.title;
    case 'composer':
      return t.composer || t.title;
    case 'folders':
      return t.folderPath || t.title;
    default:
      return t.title;
  }
}

function getCollectionBucketLabel(item: GroupedCollectionItem, field: LibrarySortField): string {
  switch (field) {
    case 'artist':
      return item.artist || item.label;
    case 'album':
      return item.album || item.label;
    case 'genre':
      return item.genre || item.label;
    case 'composer':
      return item.composer || item.label;
    case 'folders':
      return item.folderName || item.label;
    default:
      return item.label;
  }
}

const TAB_SEARCH_PLACEHOLDER: Record<LibraryTab, string> = {
  songs: 'Search songs...',
  albums: 'Search albums...',
  artists: 'Search artists...',
  genres: 'Search genres...',
  playlists: 'Search playlists...',
  folders: 'Search folders...',
};

const TAB_SINGULAR_LABEL: Record<LibraryTab, string> = {
  songs: 'Track',
  albums: 'Album',
  artists: 'Artist',
  genres: 'Genre',
  playlists: 'Playlist',
  folders: 'Folder',
};

function computeAnchoredMenuPosition(
  anchorEl: HTMLElement | null,
  menuWidth: number,
  menuHeight: number
): { top: number; right: number } {
  if (!anchorEl) {
    return { top: 64, right: 16 };
  }
  const rect = anchorEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const safeW = Math.min(menuWidth, vw - 16);
  const right = Math.max(8, Math.min(vw - safeW - 8, vw - rect.right));
  const spaceBelow = vh - rect.bottom - 8;
  const spaceAbove = rect.top - 8;

  let top: number;
  if (spaceBelow >= menuHeight) {
    top = rect.bottom + 2;
  } else if (spaceAbove >= menuHeight) {
    top = rect.top - menuHeight - 2;
  } else if (spaceBelow >= spaceAbove) {
    top = Math.max(8, vh - menuHeight - 8);
  } else {
    top = 8;
  }
  top = Math.max(8, Math.min(top, Math.max(8, vh - menuHeight - 8)));
  return { top, right };
}

interface TrackActionMenuProps {
  track: Track;
  onAddToPlaylist: (tracks: Track[]) => void;
  onPlayNext: (track: Track) => void;
  onPlaySingleTrack: (track: Track) => void;
  onSetEq: (tracks: Track[]) => void;
  onShuffleFromTrack: (track: Track) => void;
  onEditTags: (track: Track) => void;
  onAiCorrection: (track: Track) => void;
  onGetInfo: (track: Track) => void;
  onDeleteTrack: (trackId: string) => void;
  onSetRingtone: (track: Track) => void;
}

const TrackActionMenu: React.FC<TrackActionMenuProps> = ({
  track,
  onAddToPlaylist,
  onPlayNext,
  onPlaySingleTrack,
  onSetEq,
  onShuffleFromTrack,
  onEditTags,
  onAiCorrection,
  onGetInfo,
  onDeleteTrack,
  onSetRingtone,
}) => {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({ top: 64, right: 16 });
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      setConfirmDelete(false);
      return;
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !menuRef.current) return;
    const w = menuRef.current.offsetWidth || 192;
    const h = menuRef.current.offsetHeight || 314;
    setMenuPos(computeAnchoredMenuPosition(btnRef.current, w, h));
  }, [open, confirmDelete]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    tactile.tap();
    if (!open) {
      setMenuPos(computeAnchoredMenuPosition(btnRef.current, 192, 316));
      setOpen(true);
    } else {
      setOpen(false);
    }
  };

  return (
    <div data-no-drag="true" data-no-swipe="true" className="relative shrink-0">
      <button
        ref={btnRef}
        type="button"
        data-no-drag="true"
        data-no-swipe="true"
        aria-label={`Actions for ${track.title}`}
        aria-expanded={open}
        onClick={handleToggle}
        className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 active:scale-90 transition-transform duration-100"
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            data-no-drag="true"
            data-no-swipe="true"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            className="fixed inset-0 z-[70] bg-black/25"
          >
            <div
              ref={menuRef}
              role="menu"
              aria-label={`Menu for ${track.title}`}
              style={{ top: `${menuPos.top}px`, right: `${menuPos.right}px` }}
              onClick={(e) => e.stopPropagation()}
              className="fixed w-48 [@media(max-height:480px)]:w-72 rounded-xl border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-2xl overflow-hidden text-xs"
            >
              <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/80 text-[12px] font-semibold text-zinc-600 dark:text-zinc-300 truncate">
                {track.title}
              </div>

              <div className="py-0.5 grid grid-cols-1 [@media(max-height:480px)]:grid-cols-2 divide-y divide-zinc-100/80 dark:divide-zinc-800/50">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  tactile.tap();
                  setOpen(false);
                  onAddToPlaylist([track]);
                }}
                className="w-full h-[31px] px-3 text-left flex items-center gap-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <ListMusic className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                <span>Add to Playlist</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  tactile.tap();
                  onPlayNext(track);
                  setOpen(false);
                }}
                className="w-full h-[31px] px-3 text-left flex items-center gap-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <ListPlus className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                <span>Up Next</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  tactile.playAction(true);
                  onPlaySingleTrack(track);
                  setOpen(false);
                }}
                className="w-full h-[31px] px-3 text-left flex items-center gap-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <Play className="w-3.5 h-3.5 text-zinc-500 fill-current shrink-0" />
                <span>Play 1</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  tactile.tap();
                  setOpen(false);
                  onSetEq([track]);
                }}
                className="w-full h-[31px] px-3 text-left flex items-center gap-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <Sliders className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                <span>Set EQ</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  tactile.playAction(true);
                  onShuffleFromTrack(track);
                  setOpen(false);
                }}
                className="w-full h-[31px] px-3 text-left flex items-center gap-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <Shuffle className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                <span>Shuffle</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  tactile.tap();
                  setOpen(false);
                  onEditTags(track);
                }}
                className="w-full h-[31px] px-3 text-left flex items-center gap-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <Tag className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                <span>Edit Tag</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  tactile.tap();
                  setOpen(false);
                  onAiCorrection(track);
                }}
                className="w-full h-[31px] px-3 text-left flex items-center gap-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-medium"
              >
                <Wand2 className="w-3.5 h-3.5 accent-text shrink-0" />
                <span>AI Correction</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  tactile.tap();
                  setOpen(false);
                  onGetInfo(track);
                }}
                className="w-full h-[31px] px-3 text-left flex items-center gap-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <Info className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                <span>Get Info</span>
              </button>

              {!confirmDelete ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    tactile.tap();
                    setConfirmDelete(true);
                  }}
                  className="w-full h-[31px] px-3 text-left flex items-center gap-2.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-medium"
                >
                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Delete</span>
                </button>
              ) : (
                <div className="px-2 py-1 flex items-center justify-between gap-1.5 bg-rose-50/90 dark:bg-rose-950/40">
                  <button
                    type="button"
                    onClick={() => {
                      tactile.tap();
                      onDeleteTrack(track.id);
                      setOpen(false);
                    }}
                    className="flex-1 min-h-[26px] px-2 rounded-md bg-rose-600 hover:bg-rose-700 text-white font-medium"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="min-h-[26px] px-2 rounded-md border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200"
                  >
                    Cancel
                  </button>
                </div>
              )}

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  tactile.tap();
                  setOpen(false);
                  onSetRingtone(track);
                }}
                className="w-full h-[31px] px-3 text-left flex items-center gap-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <BellRing className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                <span>Ringtone</span>
              </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

interface CollectionActionMenuProps {
  item: GroupedCollectionItem;
  singularLabel: string;
  onAddToPlaylist: (tracks: Track[]) => void;
  onUpNext: (tracks: Track[]) => void;
  onPlayAll: (tracks: Track[], random: boolean) => void;
  onSetEq: (tracks: Track[]) => void;
  onEditTags: (tracks: Track[]) => void;
  onAiCorrection: (item: GroupedCollectionItem) => void;
  onGetInfo: (item: GroupedCollectionItem) => void;
  onExportM3u?: (playlistId: string) => void;
  onDelete: (item: GroupedCollectionItem) => void;
  onSetRingtone: (track: Track) => void;
}

const CollectionActionMenu: React.FC<CollectionActionMenuProps> = ({
  item,
  singularLabel,
  onAddToPlaylist,
  onUpNext,
  onPlayAll,
  onSetEq,
  onEditTags,
  onAiCorrection,
  onGetInfo,
  onExportM3u,
  onDelete,
  onSetRingtone,
}) => {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({ top: 64, right: 16 });
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      setConfirmDelete(false);
      return;
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !menuRef.current) return;
    const w = menuRef.current.offsetWidth || 192;
    const h = menuRef.current.offsetHeight || 314;
    setMenuPos(computeAnchoredMenuPosition(btnRef.current, w, h));
  }, [open, confirmDelete]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    tactile.tap();
    if (!open) {
      const rowCount = (item.tracks.length > 0 ? 9 : 2) + (onExportM3u ? 1 : 0);
      setMenuPos(computeAnchoredMenuPosition(btnRef.current, 192, 34 + rowCount * 31));
      setOpen(true);
    } else {
      setOpen(false);
    }
  };

  return (
    <div data-no-drag="true" data-no-swipe="true" className="relative shrink-0">
      <button
        ref={btnRef}
        type="button"
        data-no-drag="true"
        data-no-swipe="true"
        aria-label={`Actions for ${item.label}`}
        aria-expanded={open}
        onClick={handleToggle}
        className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 active:scale-90 transition-transform duration-100"
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            data-no-drag="true"
            data-no-swipe="true"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            className="fixed inset-0 z-[70] bg-black/25"
          >
            <div
              ref={menuRef}
              role="menu"
              aria-label={`Menu for ${item.label}`}
              style={{ top: `${menuPos.top}px`, right: `${menuPos.right}px` }}
              onClick={(e) => e.stopPropagation()}
              className="fixed w-48 [@media(max-height:480px)]:w-72 rounded-xl border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-2xl overflow-hidden text-xs"
            >
              <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/80 text-[12px] font-semibold text-zinc-600 dark:text-zinc-300 truncate">
                {item.label}
              </div>

              <div className="py-0.5 grid grid-cols-1 [@media(max-height:480px)]:grid-cols-2 divide-y divide-zinc-100/80 dark:divide-zinc-800/50">
              {item.tracks.length > 0 && (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      tactile.tap();
                      setOpen(false);
                      onAddToPlaylist(item.tracks);
                    }}
                    className="w-full h-[31px] px-3 text-left flex items-center gap-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <ListMusic className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                    <span>Add to Playlist</span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      tactile.tap();
                      onUpNext(item.tracks);
                      setOpen(false);
                    }}
                    className="w-full h-[31px] px-3 text-left flex items-center gap-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <ListPlus className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                    <span>Up Next</span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      tactile.playAction(true);
                      onPlayAll(item.tracks, false);
                      setOpen(false);
                    }}
                    className="w-full h-[31px] px-3 text-left flex items-center gap-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <Play className="w-3.5 h-3.5 text-zinc-500 fill-current shrink-0" />
                    <span>Play {item.tracks.length}</span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      tactile.tap();
                      setOpen(false);
                      onSetEq(item.tracks);
                    }}
                    className="w-full h-[31px] px-3 text-left flex items-center gap-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <Sliders className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                    <span>Set EQ</span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      tactile.playAction(true);
                      onPlayAll(item.tracks, true);
                      setOpen(false);
                    }}
                    className="w-full h-[31px] px-3 text-left flex items-center gap-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <Shuffle className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                    <span>Shuffle</span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      tactile.tap();
                      setOpen(false);
                      onEditTags(item.tracks);
                    }}
                    className="w-full h-[31px] px-3 text-left flex items-center gap-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <Tag className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                    <span>Edit Tag</span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      tactile.tap();
                      setOpen(false);
                      onAiCorrection(item);
                    }}
                    className="w-full h-[31px] px-3 text-left flex items-center gap-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-medium"
                  >
                    <Wand2 className="w-3.5 h-3.5 accent-text shrink-0" />
                    <span>AI Correction</span>
                  </button>
                </>
              )}

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  tactile.tap();
                  setOpen(false);
                  onGetInfo(item);
                }}
                className="w-full h-[31px] px-3 text-left flex items-center gap-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <Info className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                <span>Get Info ({singularLabel})</span>
              </button>

              {onExportM3u && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    tactile.success();
                    onExportM3u(item.id);
                    setOpen(false);
                  }}
                  className="w-full h-[31px] px-3 text-left flex items-center gap-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <Download className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                  <span>Export .m3u8</span>
                </button>
              )}

              {!confirmDelete ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    tactile.tap();
                    setConfirmDelete(true);
                  }}
                  className="w-full h-[31px] px-3 text-left flex items-center gap-2.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-medium"
                >
                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Delete</span>
                </button>
              ) : (
                <div className="px-2 py-1 flex items-center justify-between gap-1.5 bg-rose-50/90 dark:bg-rose-950/40">
                  <button
                    type="button"
                    onClick={() => {
                      tactile.tap();
                      onDelete(item);
                      setOpen(false);
                    }}
                    className="flex-1 min-h-[26px] px-2 rounded-md bg-rose-600 hover:bg-rose-700 text-white font-medium"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="min-h-[26px] px-2 rounded-md border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {item.tracks.length > 0 && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    tactile.tap();
                    setOpen(false);
                    onSetRingtone(item.tracks[0]);
                  }}
                  className="w-full h-[31px] px-3 text-left flex items-center gap-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <BellRing className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                  <span>Ringtone</span>
                </button>
              )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

const TrackRow = React.memo<{
  track: Track;
  isActive: boolean;
  isHighlighted: boolean;
  isPlaying: boolean;
  selectionMode: boolean;
  isSelected: boolean;
  onPlayTrackItem: (track: Track) => void;
  onToggleSelect: (id: string) => void;
  onLongPressStart: (id: string, clientX: number, clientY: number) => void;
  onLongPressMove: (clientX: number, clientY: number) => void;
  onLongPressCancel: () => void;
  onAddToPlaylist: (tracks: Track[]) => void;
  onPlayNext: (track: Track) => void;
  onPlaySingleTrack: (track: Track) => void;
  onSetEq: (tracks: Track[]) => void;
  onShuffleFromTrack: (track: Track) => void;
  onToggleFavorite: (trackId: string) => void;
  onEditTags: (track: Track) => void;
  onAiCorrection: (track: Track) => void;
  onGetInfo: (track: Track) => void;
  onDeleteTrack: (trackId: string) => void;
  onSetRingtone: (track: Track) => void;
}>(({
  track,
  isActive,
  isHighlighted,
  isPlaying,
  selectionMode,
  isSelected,
  onPlayTrackItem,
  onToggleSelect,
  onLongPressStart,
  onLongPressMove,
  onLongPressCancel,
  onAddToPlaylist,
  onPlayNext,
  onPlaySingleTrack,
  onSetEq,
  onShuffleFromTrack,
  onToggleFavorite,
  onEditTags,
  onAiCorrection,
  onGetInfo,
  onDeleteTrack,
  onSetRingtone,
}) => {
  return (
    <div
      onPointerDown={(e) => {
        if ((e.target as HTMLElement | null)?.closest('[data-no-drag="true"]')) return;
        onLongPressStart(track.id, e.clientX, e.clientY);
      }}
      onPointerMove={(e) => onLongPressMove(e.clientX, e.clientY)}
      onPointerUp={onLongPressCancel}
      onPointerCancel={onLongPressCancel}
      className={`group flex items-center gap-1.5 sm:gap-2.5 px-2 sm:px-3 py-1 rounded-xl border transition-colors h-[54px] ${
        isSelected
          ? 'border-amber-500/60 bg-amber-500/12'
          : isActive
          ? 'border-amber-500/45 bg-amber-500/10'
          : isHighlighted
          ? 'border-amber-500 bg-amber-500/15'
          : 'border-transparent hover:bg-zinc-100/80 dark:hover:bg-zinc-900/80'
      }`}
    >
      {selectionMode && (
        <button
          type="button"
          data-no-drag="true"
          aria-label={isSelected ? `Deselect ${track.title}` : `Select ${track.title}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(track.id);
          }}
          className="w-7 h-7 flex items-center justify-center shrink-0"
        >
          <span
            className={`w-[18px] h-[18px] rounded border flex items-center justify-center transition-colors ${
              isSelected
                ? 'accent-bg border-transparent text-white'
                : 'border-zinc-400 dark:border-zinc-500 bg-transparent'
            }`}
          >
            {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
          </span>
        </button>
      )}

      <button
        type="button"
        onClick={() => {
          if (selectionMode) onToggleSelect(track.id);
          else onPlayTrackItem(track);
        }}
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
            className={`text-sm font-medium truncate flex items-center gap-1.5 ${
              isActive || isHighlighted ? 'accent-text' : 'text-zinc-900 dark:text-zinc-100'
            }`}
          >
            <span className="truncate">{track.title}</span>
            {Boolean(track.lyrics?.trim()) && (
              <span
                title="Has embedded lyrics"
                aria-label="Has embedded lyrics"
                className="inline-flex shrink-0"
              >
                <Mic2 className="w-3.5 h-3.5 accent-text" />
              </span>
            )}
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate flex items-center gap-1.5">
            <span className="truncate">{track.artist}</span>
            <span aria-hidden="true" className="hidden sm:inline">·</span>
            <span className="truncate hidden sm:inline">
              {track.album}
              {track.year ? ` (${track.year})` : ''}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular shrink-0 text-[11px]">
              {track.format} {track.bitDepth}b/{Math.round(track.sampleRate / 1000)}k
            </span>
          </div>
        </div>
      </button>

      {!selectionMode && (
        <>
          <button
            type="button"
            data-no-drag="true"
            aria-label={track.favorite ? 'Remove favorite' : 'Add favorite'}
            title={track.favorite ? 'Remove favorite' : 'Favorite'}
            onClick={() => onToggleFavorite(track.id)}
            className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-lg hover:bg-zinc-200/60 dark:hover:bg-zinc-800 active:scale-90 transition-transform duration-100"
          >
            <Heart
              className={`w-4 h-4 ${
                track.favorite ? 'fill-rose-500 text-rose-500' : 'text-zinc-400'
              }`}
            />
          </button>

          <span className="text-xs font-mono-tabular text-zinc-500 w-9 text-right shrink-0">
            {formatDuration(track.duration)}
          </span>

          <TrackActionMenu
            track={track}
            onAddToPlaylist={onAddToPlaylist}
            onPlayNext={onPlayNext}
            onPlaySingleTrack={onPlaySingleTrack}
            onSetEq={onSetEq}
            onShuffleFromTrack={onShuffleFromTrack}
            onEditTags={onEditTags}
            onAiCorrection={onAiCorrection}
            onGetInfo={onGetInfo}
            onDeleteTrack={onDeleteTrack}
            onSetRingtone={onSetRingtone}
          />
        </>
      )}
    </div>
  );
});

export const LibraryBrowser: React.FC<LibraryBrowserProps> = React.memo(
  ({
    tab,
    viewMode,
    themeMode,
    sortBy,
    tracks,
    playlists,
    eqPresets,
    searchQuery,
    currentTrackId,
    isPlaying,
    selectedAlbumFilter,
    selectedArtistFilter,
    selectedGenreFilter,
    selectedFolderFilter,
    selectedPlaylistFilter,
    initialStartIndex = 0,
    onChangeStartIndex,
    onChangeSearchQuery,
    onChangeViewMode,
    onChangeSortBy,
    onPlayTrack,
    onPlaySingleTrack,
    onShuffleFromTrack,
    onPlayNext,
    onPlayNextMany,
    onAddToQueue,
    onAddTracksToQueue,
    onPlayAll,
    onToggleFavorite,
    onToggleOfflineCache,
    onAddTrackToPlaylist,
    onAddTracksToPlaylist,
    onCreatePlaylist,
    onEditTracksMetadata,
    onApplyTagCleanups,
    onShowNoChangesToast,
    onAssignEqPreset,
    onSetRingtone,
    onDeleteTracks,
    onDeletePlaylist,
    onExportPlaylistM3u,
    onImportM3uFiles,
    onSelectAlbum,
    onSelectArtist,
    onSelectGenre,
    onSelectFolder,
    onSelectPlaylist,
    onImportLocalFolder,
    onOpenSettings,
    onOpenEqualizer,
    onToggleTheme,
    onShareApp,
  }) => {
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const m3uInputRef = useRef<HTMLInputElement | null>(null);
    const overflowMenuRef = useRef<HTMLDivElement | null>(null);
    const queueActionMenuRef = useRef<HTMLDivElement | null>(null);
    const highlightTimerRef = useRef<number | null>(null);
    const transientPopTimerRef = useRef<number | null>(null);
    const longPressTimerRef = useRef<number | null>(null);
    const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);

    const [startIndex, setStartIndex] = useState(initialStartIndex);
    const [highlightedId, setHighlightedId] = useState<string | null>(null);
    const [transientPopLetter, setTransientPopLetter] = useState<string | null>(null);
    const [newPlaylistName, setNewPlaylistName] = useState('');
    const [showNewPlaylist, setShowNewPlaylist] = useState(false);
    const [sortModalOpen, setSortModalOpen] = useState(false);
    const [overflowOpen, setOverflowOpen] = useState(false);

    // Multi-select contextual mode (Rocket Player style)
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
    const [queueMenuOpen, setQueueMenuOpen] = useState(false);
    const [playlistPickerTracks, setPlaylistPickerTracks] = useState<Track[] | null>(null);
    const [pickerNewPlaylistName, setPickerNewPlaylistName] = useState('');
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

    // Set EQ modal + Get Info modal + AI Correction modal
    const [eqModalTracks, setEqModalTracks] = useState<Track[] | null>(null);
    const [aiCorrectionTarget, setAiCorrectionTarget] = useState<AiCorrectionTarget | null>(null);
    const [infoTarget, setInfoTarget] = useState<
      | { kind: 'track'; track: Track }
      | { kind: 'collection'; item: GroupedCollectionItem; label: string }
      | null
    >(null);

    // Manual single/batch Tag Editor modal
    const [editingTrackIds, setEditingTrackIds] = useState<string[] | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [editArtist, setEditArtist] = useState('');
    const [editAlbum, setEditAlbum] = useState('');
    const [editGenre, setEditGenre] = useState('');
    const [editYear, setEditYear] = useState('');
    const [editComposer, setEditComposer] = useState('');
    const [editLyrics, setEditLyrics] = useState('');

    // Touch-drag vertical scrolling refs (deferred threshold so item taps stay crisp & horizontal swipes bubble to page pager)
    const touchStartXRef = useRef<number | null>(null);
    const touchStartYRef = useRef<number | null>(null);
    const touchStartIndexRef = useRef<number>(0);
    const gestureAxisRef = useRef<'none' | 'vertical' | 'horizontal'>('none');
    const hasDraggedRef = useRef<boolean>(false);
    const suppressNextClickRef = useRef<boolean>(false);
    const lastScrollBucketRef = useRef<string | null>(null);

    // Filtered & consistently sorted tracks for Songs tab (type-scoped search on Songs)
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
      const q = searchQuery.trim();
      if (tab === 'songs' && q) {
        list = list.filter((t) => matchesNormalizedQuery([t.title, t.fileName], q));
      }
      return [...list].sort((a, b) => compareTracksBySort(a, b, sortBy));
    }, [
      tab,
      tracks,
      playlists,
      searchQuery,
      sortBy,
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

    const handleDeleteSingleTrack = useCallback(
      (trackId: string) => {
        onDeleteTracks([trackId]);
      },
      [onDeleteTracks]
    );

    // Grouped collections for Albums / Artists / Genres / Playlists / Folders (type-scoped search + 13-mode sort)
    const collectionItems = useMemo<GroupedCollectionItem[]>(() => {
      if (tab === 'songs') return [];

      const q = searchQuery.trim();
      const buildGroupItem = (
        id: string,
        label: string,
        subtitle: string,
        coverUrl: string,
        grpTracks: Track[],
        addedFallback = 0
      ): GroupedCollectionItem => {
        let maxAdded = addedFallback;
        let maxYear = 0;
        let totalPlays = 0;
        let maxLastPlayed = 0;
        let ratingSum = 0;
        let ratedCount = 0;
        let totalSkips = 0;
        let maxLastSkipped = 0;
        for (const t of grpTracks) {
          if ((t.addedAt || 0) > maxAdded) maxAdded = t.addedAt || 0;
          const y = parseYearNumber(t.year);
          if (y > maxYear) maxYear = y;
          totalPlays += t.playCount || 0;
          if ((t.lastPlayedAt || 0) > maxLastPlayed) maxLastPlayed = t.lastPlayedAt || 0;
          if ((t.rating || 0) > 0) {
            ratingSum += t.rating;
            ratedCount++;
          }
          totalSkips += t.skipCount || 0;
          if ((t.lastSkippedAt || 0) > maxLastSkipped) maxLastSkipped = t.lastSkippedAt || 0;
        }
        const first = grpTracks[0];
        const firstComposer = grpTracks.find((t) => Boolean(t.composer?.trim()))?.composer || '';
        return {
          id,
          label,
          subtitle,
          coverUrl,
          trackCount: grpTracks.length,
          tracks: grpTracks,
          addedAt: maxAdded,
          artist: tab === 'artists' ? label : first?.artist || '',
          album: tab === 'albums' ? label : first?.album || '',
          yearNum: maxYear,
          playCount: totalPlays,
          lastPlayedAt: maxLastPlayed,
          rating: ratedCount > 0 ? ratingSum / ratedCount : 0,
          skipCount: totalSkips,
          lastSkippedAt: maxLastSkipped,
          genre: tab === 'genres' ? label : first?.genre || '',
          composer: firstComposer,
          folderName: tab === 'folders' ? label : first?.folderPath || 'Local Imports',
        };
      };

      let items: GroupedCollectionItem[];

      if (tab === 'playlists') {
        const trackMap = new Map(tracks.map((t) => [t.id, t]));
        items = [...playlists].map((pl) => {
          const plTracks = pl.trackIds
            .map((id) => trackMap.get(id))
            .filter((t): t is Track => Boolean(t));
          return buildGroupItem(
            pl.id,
            pl.name,
            `${pl.source === 'ai' ? 'AI Mix' : 'Playlist'} · ${plTracks.length} tracks`,
            pl.coverUrl || plTracks[0]?.coverUrl || defaultVinylCover,
            plTracks,
            pl.createdAt || 0
          );
        });
      } else {
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

        items = [...map.entries()].map(([label, grpTracks]) =>
          buildGroupItem(
            label,
            label,
            tab === 'albums'
              ? `${grpTracks[0]?.artist || 'Various'} · ${grpTracks.length} tracks`
              : `${grpTracks.length} track${grpTracks.length === 1 ? '' : 's'}`,
            grpTracks[0]?.coverUrl || defaultVinylCover,
            grpTracks
          )
        );
      }

      if (q) {
        items = items.filter((item) => matchesNormalizedQuery([item.label], q));
      }
      return items.sort((a, b) => compareCollectionsBySort(a, b, sortBy));
    }, [tab, tracks, playlists, searchQuery, sortBy]);

    const layout = useViewportPageSize(viewportRef, {
      mode: viewMode,
      listRowHeight: 55,
      gridMinCardWidth: 140,
      gridGap: 10,
      gridCardExtraHeight: tab === 'songs' ? 60 : 96,
      maxColumns: 6,
      verticalPadding: 4,
    });

    const totalItems = tab === 'songs' ? filteredSongs.length : collectionItems.length;
    const clampedStartIndex =
      totalItems === 0 ? 0 : Math.max(0, Math.min(totalItems - 1, startIndex));
    const totalPages = Math.max(1, Math.ceil(totalItems / layout.pageSize));
    const virtualPage =
      totalItems === 0
        ? 0
        : clampedStartIndex + layout.pageSize >= totalItems && totalPages > 1
        ? totalPages - 1
        : Math.min(totalPages - 1, Math.floor(clampedStartIndex / layout.pageSize));

    const subFilterKey = [
      searchQuery,
      sortBy.field,
      sortBy.ascending ? '1' : '0',
      selectedAlbumFilter || '',
      selectedArtistFilter || '',
      selectedGenreFilter || '',
      selectedFolderFilter || '',
      selectedPlaylistFilter || '',
    ].join('|');
    const prevTabRef = useRef<LibraryTab>(tab);
    const prevSubFilterRef = useRef<string>(subFilterKey);

    useEffect(() => {
      if (prevTabRef.current !== tab) {
        prevTabRef.current = tab;
        prevSubFilterRef.current = subFilterKey;
        setStartIndex(initialStartIndex);
        return;
      }
      if (prevSubFilterRef.current !== subFilterKey) {
        prevSubFilterRef.current = subFilterKey;
        setStartIndex(0);
      }
    }, [tab, subFilterKey, initialStartIndex]);

    const onChangeStartIndexRef = useRef(onChangeStartIndex);
    onChangeStartIndexRef.current = onChangeStartIndex;

    useEffect(() => {
      onChangeStartIndexRef.current?.(clampedStartIndex);
    }, [clampedStartIndex]);

    useEffect(() => {
      setSelectionMode(false);
      setSelectedIds(new Set());
      setQueueMenuOpen(false);
      setPlaylistPickerTracks(null);
      setEqModalTracks(null);
      setAiCorrectionTarget(null);
      setInfoTarget(null);
      setDeleteConfirmOpen(false);
      setOverflowOpen(false);
    }, [
      tab,
      selectedAlbumFilter,
      selectedArtistFilter,
      selectedGenreFilter,
      selectedFolderFilter,
      selectedPlaylistFilter,
    ]);

    useEffect(() => {
      if (
        !sortModalOpen &&
        !editingTrackIds &&
        !playlistPickerTracks &&
        !eqModalTracks &&
        !infoTarget &&
        !deleteConfirmOpen
      ) {
        return;
      }
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          setSortModalOpen(false);
          setEditingTrackIds(null);
          setPlaylistPickerTracks(null);
          setEqModalTracks(null);
          setInfoTarget(null);
          setDeleteConfirmOpen(false);
        }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [sortModalOpen, editingTrackIds, playlistPickerTracks, eqModalTracks, infoTarget, deleteConfirmOpen]);

    useEffect(() => {
      if (!overflowOpen && !queueMenuOpen) return;
      const handleOutside = (e: PointerEvent | MouseEvent) => {
        if (
          overflowOpen &&
          overflowMenuRef.current &&
          !overflowMenuRef.current.contains(e.target as Node)
        ) {
          setOverflowOpen(false);
        }
        if (
          queueMenuOpen &&
          queueActionMenuRef.current &&
          !queueActionMenuRef.current.contains(e.target as Node)
        ) {
          setQueueMenuOpen(false);
        }
      };
      const handleEsc = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          setOverflowOpen(false);
          setQueueMenuOpen(false);
        }
      };
      document.addEventListener('pointerdown', handleOutside);
      window.addEventListener('keydown', handleEsc);
      return () => {
        document.removeEventListener('pointerdown', handleOutside);
        window.removeEventListener('keydown', handleEsc);
      };
    }, [overflowOpen, queueMenuOpen]);

    useEffect(() => {
      if (totalItems > 0 && startIndex >= totalItems) {
        setStartIndex(Math.max(0, totalItems - layout.pageSize));
      }
    }, [startIndex, totalItems, layout.pageSize]);

    useEffect(() => {
      return () => {
        if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
        if (transientPopTimerRef.current) window.clearTimeout(transientPopTimerRef.current);
        if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
      };
    }, []);

    const pagedSongs = useMemo(() => {
      if (tab !== 'songs') return [];
      return filteredSongs.slice(clampedStartIndex, clampedStartIndex + layout.pageSize);
    }, [tab, filteredSongs, clampedStartIndex, layout.pageSize]);

    const pagedCollections = useMemo(() => {
      if (tab === 'songs') return [];
      return collectionItems.slice(clampedStartIndex, clampedStartIndex + layout.pageSize);
    }, [tab, collectionItems, clampedStartIndex, layout.pageSize]);

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

    const { sliderLetters, populatedLetters } = useMemo(() => {
      const labels =
        tab === 'songs'
          ? filteredSongs.map((t) => getSongBucketLabel(t, sortBy.field))
          : collectionItems.map((c) => getCollectionBucketLabel(c, sortBy.field));
      const pop = new Set<string>();
      labels.forEach((lbl) => pop.add(getAlphabetBucket(lbl)));
      return {
        sliderLetters: extractAvailableLetters(labels),
        populatedLetters: pop,
      };
    }, [tab, filteredSongs, collectionItems, sortBy.field]);

    const currentPageFirstBucket = useMemo(() => {
      if (tab === 'songs') {
        return pagedSongs[0]
          ? getAlphabetBucket(getSongBucketLabel(pagedSongs[0], sortBy.field))
          : sliderLetters[0];
      }
      return pagedCollections[0]
        ? getAlphabetBucket(getCollectionBucketLabel(pagedCollections[0], sortBy.field))
        : sliderLetters[0];
    }, [tab, pagedSongs, pagedCollections, sliderLetters, sortBy.field]);

    const flashHighlight = useCallback((id: string) => {
      setHighlightedId(id);
      if (highlightTimerRef.current) {
        window.clearTimeout(highlightTimerRef.current);
      }
      highlightTimerRef.current = window.setTimeout(() => setHighlightedId(null), 1100);
    }, []);

    const showTransientPop = useCallback((letter: string) => {
      setTransientPopLetter(letter);
      if (transientPopTimerRef.current) {
        window.clearTimeout(transientPopTimerRef.current);
      }
      transientPopTimerRef.current = window.setTimeout(() => setTransientPopLetter(null), 650);
    }, []);

    const handleSelectAlphabetLetter = useCallback(
      (letter: string) => {
        const list =
          tab === 'songs'
            ? filteredSongs.map((t) => ({ id: t.id, label: getSongBucketLabel(t, sortBy.field) }))
            : collectionItems.map((c) => ({
                id: c.id,
                label: getCollectionBucketLabel(c, sortBy.field),
              }));
        if (list.length === 0) return;

        let matchIdx = list.findIndex((entry) => getAlphabetBucket(entry.label) === letter);
        if (matchIdx === -1) {
          const letterPos = sliderLetters.indexOf(letter);
          for (let i = letterPos + 1; i < sliderLetters.length; i++) {
            matchIdx = list.findIndex(
              (entry) => getAlphabetBucket(entry.label) === sliderLetters[i]
            );
            if (matchIdx !== -1) break;
          }
          if (matchIdx === -1) {
            for (let i = letterPos - 1; i >= 0; i--) {
              matchIdx = list.findIndex(
                (entry) => getAlphabetBucket(entry.label) === sliderLetters[i]
              );
              if (matchIdx !== -1) break;
            }
          }
        }
        if (matchIdx === -1) matchIdx = 0;

        lastScrollBucketRef.current = getAlphabetBucket(list[matchIdx].label);
        setStartIndex(matchIdx);
        flashHighlight(list[matchIdx].id);
      },
      [tab, filteredSongs, collectionItems, sliderLetters, sortBy.field, flashHighlight]
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

    const handleDeleteCollectionItem = (item: GroupedCollectionItem) => {
      if (tab === 'playlists') {
        onDeletePlaylist?.(item.id);
      } else {
        const ids = item.tracks.map((t) => t.id);
        if (ids.length > 0) onDeleteTracks(ids);
      }
    };

    const stepLibraryScroll = useCallback(
      (newIndex: number, emitPopFeedback: boolean) => {
        if (totalItems === 0) return;
        const clamped = Math.max(0, Math.min(totalItems - 1, newIndex));
        if (clamped === startIndex) return;
        setStartIndex(clamped);

        const targetTrack = tab === 'songs' ? filteredSongs[clamped] : undefined;
        const targetCol = tab === 'songs' ? undefined : collectionItems[clamped];
        const targetLabel = targetTrack
          ? getSongBucketLabel(targetTrack, sortBy.field)
          : targetCol
          ? getCollectionBucketLabel(targetCol, sortBy.field)
          : undefined;
        const targetId = targetTrack?.id ?? targetCol?.id;

        if (targetLabel && emitPopFeedback) {
          const bucket = getAlphabetBucket(targetLabel);
          if (bucket !== lastScrollBucketRef.current) {
            lastScrollBucketRef.current = bucket;
            const bucketIdx = sliderLetters.indexOf(bucket);
            const ratio =
              sliderLetters.length > 1 && bucketIdx >= 0
                ? bucketIdx / (sliderLetters.length - 1)
                : 0.5;
            const isBoundary = bucketIdx === 0 || bucketIdx === sliderLetters.length - 1;
            tactile.letterPop(ratio, isBoundary);
            showTransientPop(bucket);
            if (targetId) flashHighlight(targetId);
          }
        }
      },
      [
        totalItems,
        startIndex,
        tab,
        sortBy.field,
        filteredSongs,
        collectionItems,
        sliderLetters,
        showTransientPop,
        flashHighlight,
      ]
    );

    const clearLongPressTimer = useCallback(() => {
      if (longPressTimerRef.current) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      longPressOriginRef.current = null;
    }, []);

    const handleLongPressStart = useCallback(
      (id: string, clientX: number, clientY: number) => {
        clearLongPressTimer();
        longPressOriginRef.current = { x: clientX, y: clientY };
        longPressTimerRef.current = window.setTimeout(() => {
          longPressTimerRef.current = null;
          longPressOriginRef.current = null;
          touchStartYRef.current = null;
          hasDraggedRef.current = false;
          suppressNextClickRef.current = true;
          window.setTimeout(() => {
            suppressNextClickRef.current = false;
          }, 350);
          tactile.toggle(true);
          setSelectionMode(true);
          setSelectedIds((prev) => {
            const next = new Set(prev);
            next.add(id);
            return next;
          });
        }, 420);
      },
      [clearLongPressTimer]
    );

    const handleLongPressMove = useCallback(
      (clientX: number, clientY: number) => {
        const origin = longPressOriginRef.current;
        if (!origin) return;
        if (Math.hypot(clientX - origin.x, clientY - origin.y) > 8) {
          clearLongPressTimer();
        }
      },
      [clearLongPressTimer]
    );

    const toggleSelectItem = useCallback((id: string) => {
      tactile.tap();
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }, []);

    const exitSelectionMode = useCallback(() => {
      tactile.tap();
      setSelectionMode(false);
      setSelectedIds(new Set());
      setQueueMenuOpen(false);
      setPlaylistPickerTracks(null);
      setDeleteConfirmOpen(false);
    }, []);

    const currentItemIds = useMemo(
      () =>
        tab === 'songs'
          ? filteredSongs.map((t) => t.id)
          : collectionItems.map((c) => c.id),
      [tab, filteredSongs, collectionItems]
    );

    const allCurrentSelected =
      currentItemIds.length > 0 && currentItemIds.every((id) => selectedIds.has(id));

    const toggleSelectAllCurrent = useCallback(() => {
      tactile.tap();
      if (allCurrentSelected) {
        setSelectedIds(new Set());
      } else {
        setSelectedIds(new Set(currentItemIds));
      }
    }, [allCurrentSelected, currentItemIds]);

    const selectedResolvedTracks = useMemo<Track[]>(() => {
      if (selectedIds.size === 0) return [];
      if (tab === 'songs') {
        return filteredSongs.filter((t) => selectedIds.has(t.id));
      }
      const seen = new Set<string>();
      const out: Track[] = [];
      collectionItems.forEach((col) => {
        if (!selectedIds.has(col.id)) return;
        col.tracks.forEach((t) => {
          if (!seen.has(t.id)) {
            seen.add(t.id);
            out.push(t);
          }
        });
      });
      return out;
    }, [selectedIds, tab, filteredSongs, collectionItems]);

    const openTagEditorForTracks = useCallback((targetTracks: Track[]) => {
      if (targetTracks.length === 0) return;
      const first = targetTracks[0];
      setEditingTrackIds(targetTracks.map((t) => t.id));
      if (targetTracks.length === 1) {
        setEditTitle(first.title || '');
        setEditArtist(first.artist || '');
        setEditAlbum(first.album || '');
        setEditGenre(first.genre || '');
        setEditYear(first.year || '');
        setEditComposer(first.composer || '');
        setEditLyrics(first.lyrics || '');
      } else {
        const allSame = (pick: (t: Track) => string) => {
          const val = pick(first);
          return targetTracks.every((t) => pick(t) === val) ? val : '';
        };
        setEditTitle('');
        setEditArtist(allSame((t) => t.artist || ''));
        setEditAlbum(allSame((t) => t.album || ''));
        setEditGenre(allSame((t) => t.genre || ''));
        setEditYear(allSame((t) => t.year || ''));
        setEditComposer(allSame((t) => t.composer || ''));
        setEditLyrics('');
      }
    }, []);

    const handleConfirmDeleteSelected = useCallback(() => {
      if (selectedIds.size === 0) return;
      tactile.tap();
      if (tab === 'playlists') {
        selectedIds.forEach((plId) => onDeletePlaylist?.(plId));
      } else {
        const ids = selectedResolvedTracks.map((t) => t.id);
        if (ids.length > 0) onDeleteTracks(ids);
      }
      setDeleteConfirmOpen(false);
      setSelectionMode(false);
      setSelectedIds(new Set());
    }, [selectedIds, tab, onDeletePlaylist, selectedResolvedTracks, onDeleteTracks]);

    const singularLabel = TAB_SINGULAR_LABEL[tab];
    const activeSortLabel = SORT_OPTIONS.find((o) => o.field === sortBy.field)?.label || 'Title';
    const editingSingleTrack =
      editingTrackIds && editingTrackIds.length === 1
        ? tracks.find((t) => t.id === editingTrackIds[0]) || null
        : null;

    return (
      <div className="h-full min-h-0 flex flex-col overflow-hidden">
        <input
          ref={m3uInputRef}
          type="file"
          multiple
          accept=".m3u,.m3u8,.pls,audio/x-mpegurl,application/vnd.apple.mpegurl"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              onImportM3uFiles?.(e.target.files);
            }
            e.target.value = '';
          }}
          className="hidden"
        />

        {/* Compact Single-Row Toolbar OR Rocket Player Contextual Multi-Select Bar */}
        {selectionMode ? (
          <div className="h-[42px] flex items-center justify-between gap-2 pb-1.5 border-b border-amber-500/40 bg-amber-500/5 -mx-1 px-2 rounded-t-lg shrink-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <button
                type="button"
                onClick={exitSelectionMode}
                aria-label="Exit multi-select"
                className="min-w-[34px] min-h-[34px] rounded-lg flex items-center justify-center text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 active:scale-90 transition-transform"
              >
                <X className="w-4 h-4" />
              </button>
              <span className="text-xs sm:text-sm font-semibold font-mono-tabular text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                {selectedIds.size} selected
              </span>
              <button
                type="button"
                onClick={toggleSelectAllCurrent}
                className="min-h-[28px] px-2 rounded-md border border-zinc-300 dark:border-zinc-700 text-[11px] font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap"
              >
                {allCurrentSelected ? 'None' : 'All'}
              </button>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {/* Add to Playlist (≡+) */}
              <button
                type="button"
                disabled={selectedResolvedTracks.length === 0}
                onClick={() => {
                  tactile.tap();
                  setQueueMenuOpen(false);
                  setPlaylistPickerTracks(selectedResolvedTracks);
                }}
                aria-label="Add selected to playlist"
                title="Add to Playlist"
                className="min-w-[36px] min-h-[34px] px-2 rounded-lg hover:bg-zinc-200/70 dark:hover:bg-zinc-800 flex items-center justify-center text-zinc-800 dark:text-zinc-100 disabled:opacity-35 active:scale-90 transition-transform"
              >
                <ListPlus className="w-4 h-4" />
              </button>

              {/* Queue / Play / Edit Tags (Rocket Player Bars+ icon) */}
              <div ref={queueActionMenuRef} className="relative">
                <button
                  type="button"
                  disabled={selectedResolvedTracks.length === 0}
                  onClick={() => {
                    tactile.tap();
                    setQueueMenuOpen((v) => !v);
                  }}
                  aria-label="Queue and batch actions"
                  title="Queue / Play / Edit Tags"
                  className="min-w-[36px] min-h-[34px] px-2 rounded-lg hover:bg-zinc-200/70 dark:hover:bg-zinc-800 flex items-center justify-center text-zinc-800 dark:text-zinc-100 disabled:opacity-35 active:scale-90 transition-transform"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="w-4 h-4 fill-current"
                    aria-hidden="true"
                  >
                    <path d="M5 4h2v3h3v2H7v3H5V9H2V7h3V4zm7 9h3v7h-3v-7zm-5 3h3v4H7v-4zm10-7h3v11h-3V9z" />
                  </svg>
                </button>

                {queueMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl py-1 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        tactile.playAction(true);
                        onPlayAll(selectedResolvedTracks, false);
                        exitSelectionMode();
                      }}
                      className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <Play className="w-3.5 h-3.5 text-zinc-500 fill-current" />
                      <span>Play Selected</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        tactile.success();
                        onPlayNextMany(selectedResolvedTracks);
                        exitSelectionMode();
                      }}
                      className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <ListPlus className="w-3.5 h-3.5 text-zinc-500" />
                      <span>Play Next</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        tactile.success();
                        onAddTracksToQueue(selectedResolvedTracks);
                        exitSelectionMode();
                      }}
                      className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <Plus className="w-3.5 h-3.5 text-zinc-500" />
                      <span>Add to Queue</span>
                    </button>
                    <div className="my-1 border-t border-zinc-200/80 dark:border-zinc-800" />
                    <button
                      type="button"
                      onClick={() => {
                        tactile.tap();
                        setQueueMenuOpen(false);
                        openTagEditorForTracks(selectedResolvedTracks);
                      }}
                      className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <Tag className="w-3.5 h-3.5 text-zinc-500" />
                      <span>Edit Tags</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Delete Selected (🗑) */}
              <button
                type="button"
                disabled={selectedIds.size === 0}
                onClick={() => {
                  tactile.tap();
                  setQueueMenuOpen(false);
                  setDeleteConfirmOpen(true);
                }}
                aria-label="Delete selected"
                title="Delete Selected"
                className="min-w-[36px] min-h-[34px] px-2 rounded-lg hover:bg-rose-500/15 flex items-center justify-center text-rose-600 dark:text-rose-400 disabled:opacity-35 active:scale-90 transition-transform"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-1.5 sm:gap-2 pb-1.5 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
            <div className="flex items-baseline gap-1.5 min-w-0">
              <h2 className="text-base sm:text-xl font-display font-semibold capitalize text-zinc-900 dark:text-zinc-100 truncate">
                {tab}
              </h2>
              <span className="text-[11px] sm:text-xs font-mono-tabular text-zinc-500 whitespace-nowrap">
                {tab === 'songs' ? `${filteredSongs.length}` : `${collectionItems.length}`}
              </span>
            </div>

            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
              <button
                type="button"
                disabled={allTabTracks.length === 0}
                onClick={() => onPlayAll(allTabTracks, false)}
                className="min-h-[32px] sm:min-h-[34px] px-2 sm:px-3 rounded-lg accent-bg text-xs font-medium flex items-center gap-1 whitespace-nowrap active:scale-95 transition-transform duration-100 disabled:opacity-40"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Play</span>
              </button>

              <button
                type="button"
                disabled={allTabTracks.length === 0}
                onClick={() => onPlayAll(allTabTracks, true)}
                aria-label="Shuffle all"
                className="min-w-[30px] min-h-[32px] sm:min-w-[34px] sm:min-h-[34px] px-1.5 sm:px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-xs font-medium flex items-center justify-center gap-1.5 whitespace-nowrap active:scale-95 transition-transform duration-100 disabled:opacity-40"
              >
                <Shuffle className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Shuffle</span>
              </button>

              {tab === 'folders' && (
                <button
                  type="button"
                  onClick={onImportLocalFolder}
                  aria-label="Scan Folder"
                  className="min-w-[30px] min-h-[32px] sm:min-w-[34px] sm:min-h-[34px] px-1.5 sm:px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-xs font-medium flex items-center justify-center gap-1.5 whitespace-nowrap active:scale-95 transition-transform duration-100"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Scan</span>
                </button>
              )}

              {tab === 'playlists' && (
                <button
                  type="button"
                  onClick={() => {
                    tactile.tap();
                    setShowNewPlaylist((v) => !v);
                  }}
                  aria-label="New Playlist"
                  className="min-w-[30px] min-h-[32px] sm:min-w-[34px] sm:min-h-[34px] px-1.5 sm:px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-xs font-medium flex items-center justify-center gap-1 whitespace-nowrap active:scale-95 transition-transform duration-100"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">New</span>
                </button>
              )}

              {/* Multi-Select Toggle Button */}
              <button
                type="button"
                disabled={totalItems === 0}
                onClick={() => {
                  tactile.toggle(true);
                  setSelectionMode(true);
                }}
                aria-label="Multi-select items"
                title="Select Multiple"
                className="min-w-[30px] min-h-[32px] sm:min-w-[34px] sm:min-h-[34px] px-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-xs font-medium flex items-center justify-center whitespace-nowrap active:scale-95 transition-transform duration-100 disabled:opacity-40"
              >
                <CheckSquare className="w-3.5 h-3.5" />
              </button>

              {/* Sort By Button (Rocket Player Style 13-Mode Sort) */}
              <button
                type="button"
                onClick={() => {
                  tactile.tap();
                  setSortModalOpen(true);
                }}
                aria-label={`Sort ${tab} (currently ${activeSortLabel}, ${sortBy.ascending ? 'ascending' : 'descending'})`}
                title={`Sorted by ${activeSortLabel} (${sortBy.ascending ? 'Ascending' : 'Descending'})`}
                className="min-w-[30px] min-h-[32px] sm:min-w-[34px] sm:min-h-[34px] px-1.5 sm:px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-xs font-medium flex items-center justify-center gap-1 whitespace-nowrap active:scale-95 transition-transform duration-100"
              >
                <ArrowUpDown className="w-3.5 h-3.5 accent-text shrink-0" />
                <span className="hidden md:inline">{activeSortLabel}</span>
              </button>

              {/* List / Grid Toggle */}
              <div className="inline-flex items-center p-0.5 rounded-lg bg-zinc-200/70 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                <button
                  type="button"
                  aria-label="List view"
                  onClick={() => {
                    tactile.tap();
                    onChangeViewMode('list');
                  }}
                  className={`min-w-[26px] sm:min-w-[30px] min-h-[26px] sm:min-h-[28px] px-1 sm:px-1.5 rounded-md flex items-center justify-center text-xs transition-colors ${
                    viewMode === 'list'
                      ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  <List className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Square grid view"
                  onClick={() => {
                    tactile.tap();
                    onChangeViewMode('grid');
                  }}
                  className={`min-w-[26px] sm:min-w-[30px] min-h-[26px] sm:min-h-[28px] px-1 sm:px-1.5 rounded-md flex items-center justify-center text-xs transition-colors ${
                    viewMode === 'grid'
                      ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Rocket Player Overflow Quick Menu (⋮) */}
              <div ref={overflowMenuRef} className="relative">
                <button
                  type="button"
                  aria-label="Library quick menu"
                  aria-expanded={overflowOpen}
                  onClick={() => {
                    tactile.tap();
                    setOverflowOpen((v) => !v);
                  }}
                  className="min-w-[30px] min-h-[32px] sm:min-w-[32px] sm:min-h-[34px] rounded-lg flex items-center justify-center text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 active:scale-90 transition-transform"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>

                {overflowOpen && (
                  <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl py-1 text-xs sm:text-sm">
                    <button
                      type="button"
                      onClick={() => {
                        tactile.tap();
                        setOverflowOpen(false);
                        onOpenSettings();
                      }}
                      className="w-full px-3.5 py-2 text-left flex items-center gap-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <Settings className="w-3.5 h-3.5 text-zinc-500" />
                      <span>Settings</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        tactile.tap();
                        setOverflowOpen(false);
                        onOpenEqualizer();
                      }}
                      className="w-full px-3.5 py-2 text-left flex items-center gap-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <Sliders className="w-3.5 h-3.5 text-zinc-500" />
                      <span>Equalizer</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        tactile.tap();
                        setOverflowOpen(false);
                        window.setTimeout(() => searchInputRef.current?.focus(), 40);
                      }}
                      className="w-full px-3.5 py-2 text-left flex items-center gap-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <Search className="w-3.5 h-3.5 text-zinc-500" />
                      <span>Search</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOverflowOpen(false);
                        onToggleTheme();
                      }}
                      className="w-full px-3.5 py-2 text-left flex items-center gap-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      {themeMode === 'dark' ? (
                        <Sun className="w-3.5 h-3.5 text-zinc-500" />
                      ) : (
                        <Moon className="w-3.5 h-3.5 text-zinc-500" />
                      )}
                      <span>Switch Theme</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        tactile.tap();
                        setOverflowOpen(false);
                        onImportLocalFolder();
                      }}
                      className="w-full px-3.5 py-2 text-left flex items-center gap-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-zinc-500" />
                      <span>Rescan Device</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        tactile.tap();
                        setOverflowOpen(false);
                        onShareApp();
                      }}
                      className="w-full px-3.5 py-2 text-left flex items-center gap-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <Share2 className="w-3.5 h-3.5 text-zinc-500" />
                      <span>Share this App</span>
                    </button>
                    {tab === 'playlists' && onImportM3uFiles && (
                      <>
                        <div className="my-1 border-t border-zinc-200/80 dark:border-zinc-800" />
                        <button
                          type="button"
                          onClick={() => {
                            tactile.tap();
                            setOverflowOpen(false);
                            m3uInputRef.current?.click();
                          }}
                          className="w-full px-3.5 py-2 text-left flex items-center gap-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          <Upload className="w-3.5 h-3.5 text-zinc-500" />
                          <span>Import .m3u Playlist</span>
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Type-Scoped Library Search Field */}
        <div className="mt-1.5 shrink-0 relative">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(e) => onChangeSearchQuery(e.target.value)}
            placeholder={TAB_SEARCH_PLACEHOLDER[tab]}
            aria-label={TAB_SEARCH_PLACEHOLDER[tab]}
            className="w-full h-9 pl-8 pr-8 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40"
          />
          {searchQuery && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                tactile.tap();
                onChangeSearchQuery('');
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
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
            className="mt-1.5 flex items-center gap-2 shrink-0"
          >
            <input
              type="text"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              placeholder="Enter playlist name..."
              autoFocus
              className="flex-1 min-h-[36px] px-3 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm"
            />
            <button
              type="submit"
              className="min-h-[36px] px-4 rounded-lg accent-bg text-xs font-medium whitespace-nowrap active:scale-95 transition-transform duration-100"
            >
              Create
            </button>
          </form>
        )}

        {/* Active Filter Breadcrumb in Songs */}
        {tab === 'songs' && hasActiveFilter && activeFilterBreadcrumb && (
          <div className="mt-1 flex items-center justify-between gap-3 py-1 border-b border-zinc-200/70 dark:border-zinc-800/70 shrink-0">
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
              className="min-h-[26px] px-2 text-xs font-medium accent-text flex items-center gap-1 shrink-0 hover:underline"
            >
              <X className="w-3.5 h-3.5" />
              <span>Show All</span>
            </button>
          </div>
        )}

        {/* Fixed Touch-Drag Viewport + Row-Aligned Alphabet Quick-Jump Slider */}
        <div
          style={{ touchAction: 'none' }}
          onPointerDown={(e) => {
            const target = e.target as HTMLElement | null;
            if (target?.closest('[data-no-drag="true"]')) return;
            tactile.unlock();
            touchStartXRef.current = e.clientX;
            touchStartYRef.current = e.clientY;
            touchStartIndexRef.current = clampedStartIndex;
            gestureAxisRef.current = 'none';
            hasDraggedRef.current = false;
            lastScrollBucketRef.current = currentPageFirstBucket || null;
          }}
          onPointerMove={(e) => {
            handleLongPressMove(e.clientX, e.clientY);
            if (touchStartYRef.current === null || touchStartXRef.current === null) return;
            const dx = e.clientX - touchStartXRef.current;
            const dy = e.clientY - touchStartYRef.current;
            if (gestureAxisRef.current === 'horizontal') return;
            if (gestureAxisRef.current === 'none') {
              if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.25) {
                gestureAxisRef.current = 'horizontal';
                clearLongPressTimer();
                return;
              }
              if (Math.abs(dy) < 8) return;
              gestureAxisRef.current = 'vertical';
            }
            if (totalItems <= 1) return;
            hasDraggedRef.current = true;
            clearLongPressTimer();
            const stepPx = viewMode === 'list' ? 38 : 64;
            const itemShift = Math.round(-dy / stepPx);
            stepLibraryScroll(touchStartIndexRef.current + itemShift, true);
          }}
          onPointerUp={() => {
            clearLongPressTimer();
            if (hasDraggedRef.current) {
              suppressNextClickRef.current = true;
              window.setTimeout(() => {
                suppressNextClickRef.current = false;
              }, 80);
            }
            touchStartXRef.current = null;
            touchStartYRef.current = null;
            gestureAxisRef.current = 'none';
            hasDraggedRef.current = false;
          }}
          onPointerCancel={() => {
            clearLongPressTimer();
            touchStartXRef.current = null;
            touchStartYRef.current = null;
            gestureAxisRef.current = 'none';
            hasDraggedRef.current = false;
          }}
          onClickCapture={(e) => {
            if (suppressNextClickRef.current) {
              e.preventDefault();
              e.stopPropagation();
              suppressNextClickRef.current = false;
            }
          }}
          onWheel={(e) => {
            if (totalItems <= 1) return;
            const dir = e.deltaY > 0 ? 1 : -1;
            stepLibraryScroll(clampedStartIndex + dir, true);
          }}
          className="flex-1 min-h-0 flex gap-2 mt-1.5 overflow-hidden relative select-none"
        >
          <div
            ref={viewportRef}
            className="flex-1 min-w-0 h-full overflow-hidden flex flex-col justify-start"
          >
            {tab === 'songs' ? (
              pagedSongs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-2.5 px-4">
                  <Music className="w-9 h-9 text-zinc-400 opacity-60" />
                  <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    {searchQuery
                      ? `No songs match "${searchQuery}".`
                      : 'No tracks match this filter or offline mode.'}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (searchQuery) onChangeSearchQuery('');
                      else if (hasActiveFilter) clearAllFilters();
                      else onImportLocalFolder();
                    }}
                    className="min-h-[38px] px-4 py-2 rounded-lg accent-bg text-xs font-medium inline-flex items-center gap-2 active:scale-95 transition-transform duration-100"
                  >
                    <FolderOpen className="w-4 h-4" />
                    <span>
                      {searchQuery
                        ? 'Clear Search'
                        : hasActiveFilter
                        ? 'Show All Tracks'
                        : 'Add Local Music Folder'}
                    </span>
                  </button>
                </div>
              ) : viewMode === 'list' ? (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
                  {pagedSongs.map((track) => (
                    <TrackRow
                      key={track.id}
                      track={track}
                      isActive={track.id === currentTrackId}
                      isHighlighted={track.id === highlightedId}
                      isPlaying={isPlaying}
                      selectionMode={selectionMode}
                      isSelected={selectedIds.has(track.id)}
                      onPlayTrackItem={handlePlayTrackItem}
                      onToggleSelect={toggleSelectItem}
                      onLongPressStart={handleLongPressStart}
                      onLongPressMove={handleLongPressMove}
                      onLongPressCancel={clearLongPressTimer}
                      onAddToPlaylist={(list) => setPlaylistPickerTracks(list)}
                      onPlayNext={onPlayNext}
                      onPlaySingleTrack={onPlaySingleTrack}
                      onSetEq={(list) => setEqModalTracks(list)}
                      onShuffleFromTrack={onShuffleFromTrack}
                      onToggleFavorite={onToggleFavorite}
                      onEditTags={(target) => openTagEditorForTracks([target])}
                      onAiCorrection={(target) =>
                        setAiCorrectionTarget({
                          label: target.title,
                          kindLabel: 'Track',
                          tracks: [target],
                        })
                      }
                      onGetInfo={(target) => setInfoTarget({ kind: 'track', track: target })}
                      onDeleteTrack={handleDeleteSingleTrack}
                      onSetRingtone={onSetRingtone}
                    />
                  ))}
                </div>
              ) : (
                <div
                  style={{
                    gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
                  }}
                  className="grid gap-2.5"
                >
                  {pagedSongs.map((track) => {
                    const active = track.id === currentTrackId;
                    const highlighted = track.id === highlightedId;
                    const isSelected = selectedIds.has(track.id);
                    return (
                      <div
                        key={track.id}
                        role="group"
                        onPointerDown={(e) => {
                          if ((e.target as HTMLElement | null)?.closest('[data-no-drag="true"]')) return;
                          handleLongPressStart(track.id, e.clientX, e.clientY);
                        }}
                        onPointerMove={(e) => handleLongPressMove(e.clientX, e.clientY)}
                        onPointerUp={clearLongPressTimer}
                        onPointerCancel={clearLongPressTimer}
                        className={`relative group rounded-xl border p-2 transition-all duration-100 ${
                          isSelected
                            ? 'border-amber-500 bg-amber-500/15'
                            : active
                            ? 'border-amber-500/60 bg-amber-500/10'
                            : highlighted
                            ? 'border-amber-500 bg-amber-500/15'
                            : 'border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-900/50 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                        }`}
                      >
                        {selectionMode && (
                          <button
                            type="button"
                            data-no-drag="true"
                            aria-label={isSelected ? `Deselect ${track.title}` : `Select ${track.title}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelectItem(track.id);
                            }}
                            className={`absolute top-2.5 left-2.5 z-10 w-5 h-5 rounded border flex items-center justify-center shadow-sm ${
                              isSelected
                                ? 'accent-bg border-transparent text-white'
                                : 'bg-white/90 dark:bg-zinc-900/90 border-zinc-400 dark:border-zinc-500'
                            }`}
                          >
                            {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (selectionMode) toggleSelectItem(track.id);
                            else handlePlayTrackItem(track);
                          }}
                          className="w-full text-left active:scale-[0.98] transition-transform duration-100 focus-visible:outline-none"
                        >
                          <div
                            style={{ height: `${layout.maxCoverSize}px` }}
                            className="relative w-full mb-1.5 flex items-center justify-center"
                          >
                            <CoverArt
                              src={track.coverUrl}
                              alt={track.title}
                              isPlaying={active && isPlaying}
                              className="h-full aspect-square rounded-lg"
                            />
                          </div>
                          <div className="flex items-start justify-between gap-1">
                            <div className="min-w-0 flex-1">
                              <div
                                className={`text-xs font-medium truncate flex items-center gap-1 ${
                                  active || highlighted
                                    ? 'accent-text'
                                    : 'text-zinc-900 dark:text-zinc-100'
                                }`}
                              >
                                <span className="truncate">{track.title}</span>
                                {Boolean(track.lyrics?.trim()) && (
                                  <span
                                    title="Has embedded lyrics"
                                    aria-label="Has embedded lyrics"
                                    className="inline-flex shrink-0"
                                  >
                                    <Mic2 className="w-3 h-3 accent-text" />
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                                {track.artist} · {track.format}
                              </div>
                            </div>
                          </div>
                        </button>
                        {!selectionMode && (
                          <div className="absolute right-1 bottom-1">
                            <TrackActionMenu
                              track={track}
                              onAddToPlaylist={(list) => setPlaylistPickerTracks(list)}
                              onPlayNext={onPlayNext}
                              onPlaySingleTrack={onPlaySingleTrack}
                              onSetEq={(list) => setEqModalTracks(list)}
                              onShuffleFromTrack={onShuffleFromTrack}
                              onEditTags={(target) => openTagEditorForTracks([target])}
                              onAiCorrection={(target) =>
                                setAiCorrectionTarget({
                                  label: target.title,
                                  kindLabel: 'Track',
                                  tracks: [target],
                                })
                              }
                              onGetInfo={(target) => setInfoTarget({ kind: 'track', track: target })}
                              onDeleteTrack={handleDeleteSingleTrack}
                              onSetRingtone={onSetRingtone}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            ) : pagedCollections.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-sm text-zinc-500 gap-2">
                <span>
                  {searchQuery
                    ? `No ${tab} match "${searchQuery}".`
                    : `No items found in ${tab}.`}
                </span>
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => onChangeSearchQuery('')}
                    className="text-xs accent-text underline"
                  >
                    Clear search
                  </button>
                )}
              </div>
            ) : viewMode === 'list' ? (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {pagedCollections.map((item) => {
                  const isSelected = selectedIds.has(item.id);
                  return (
                    <div
                      key={item.id}
                      onPointerDown={(e) => {
                        if ((e.target as HTMLElement | null)?.closest('[data-no-drag="true"]')) return;
                        handleLongPressStart(item.id, e.clientX, e.clientY);
                      }}
                      onPointerMove={(e) => handleLongPressMove(e.clientX, e.clientY)}
                      onPointerUp={clearLongPressTimer}
                      onPointerCancel={clearLongPressTimer}
                      className={`flex items-center justify-between gap-1.5 px-2 sm:px-3 py-1 rounded-xl border transition-colors h-[54px] ${
                        isSelected
                          ? 'border-amber-500/60 bg-amber-500/12'
                          : highlightedId === item.id
                          ? 'bg-amber-500/15 border-amber-500'
                          : 'border-transparent hover:bg-zinc-100/80 dark:hover:bg-zinc-900/80'
                      }`}
                    >
                      {selectionMode && (
                        <button
                          type="button"
                          data-no-drag="true"
                          aria-label={isSelected ? `Deselect ${item.label}` : `Select ${item.label}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelectItem(item.id);
                          }}
                          className="w-7 h-7 flex items-center justify-center shrink-0"
                        >
                          <span
                            className={`w-[18px] h-[18px] rounded border flex items-center justify-center transition-colors ${
                              isSelected
                                ? 'accent-bg border-transparent text-white'
                                : 'border-zinc-400 dark:border-zinc-500 bg-transparent'
                            }`}
                          >
                            {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                          </span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          if (selectionMode) toggleSelectItem(item.id);
                          else handleCollectionOpen(item);
                        }}
                        className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1 text-left active:scale-[0.99] transition-transform duration-100"
                      >
                        <CoverArt
                          src={item.coverUrl}
                          alt={item.label}
                          className="w-10 h-10 rounded-lg"
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

                      {!selectionMode && (
                        <div className="flex items-center gap-0.5 shrink-0">
                          {item.tracks.length > 0 && (
                            <button
                              type="button"
                              data-no-drag="true"
                              aria-label={`Play all in ${item.label}`}
                              title="Play All"
                              onClick={() => onPlayAll(item.tracks, false)}
                              className="min-w-[34px] min-h-[34px] rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 flex items-center justify-center text-zinc-700 dark:text-zinc-200 active:scale-90 transition-transform duration-100"
                            >
                              <Play className="w-4 h-4 fill-current" />
                            </button>
                          )}
                          <CollectionActionMenu
                            item={item}
                            singularLabel={singularLabel}
                            onAddToPlaylist={(list) => setPlaylistPickerTracks(list)}
                            onUpNext={onPlayNextMany}
                            onPlayAll={onPlayAll}
                            onSetEq={(list) => setEqModalTracks(list)}
                            onEditTags={(list) => openTagEditorForTracks(list)}
                            onAiCorrection={(col) =>
                              setAiCorrectionTarget({
                                label: col.label,
                                kindLabel: singularLabel,
                                tracks: col.tracks,
                              })
                            }
                            onGetInfo={(col) =>
                              setInfoTarget({ kind: 'collection', item: col, label: singularLabel })
                            }
                            onExportM3u={tab === 'playlists' ? onExportPlaylistM3u : undefined}
                            onDelete={handleDeleteCollectionItem}
                            onSetRingtone={onSetRingtone}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                style={{
                  gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
                }}
                className="grid gap-2.5"
              >
                {pagedCollections.map((item) => {
                  const isSelected = selectedIds.has(item.id);
                  return (
                    <div
                      key={item.id}
                      onPointerDown={(e) => {
                        if ((e.target as HTMLElement | null)?.closest('[data-no-drag="true"]')) return;
                        handleLongPressStart(item.id, e.clientX, e.clientY);
                      }}
                      onPointerMove={(e) => handleLongPressMove(e.clientX, e.clientY)}
                      onPointerUp={clearLongPressTimer}
                      onPointerCancel={clearLongPressTimer}
                      className={`relative group rounded-xl border p-2 transition-colors flex flex-col justify-between gap-1.5 ${
                        isSelected
                          ? 'border-amber-500 bg-amber-500/15'
                          : highlightedId === item.id
                          ? 'border-amber-500 bg-amber-500/15'
                          : 'border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-900/50 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                      }`}
                    >
                      {selectionMode && (
                        <button
                          type="button"
                          data-no-drag="true"
                          aria-label={isSelected ? `Deselect ${item.label}` : `Select ${item.label}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelectItem(item.id);
                          }}
                          className={`absolute top-2.5 left-2.5 z-10 w-5 h-5 rounded border flex items-center justify-center shadow-sm ${
                            isSelected
                              ? 'accent-bg border-transparent text-white'
                              : 'bg-white/90 dark:bg-zinc-900/90 border-zinc-400 dark:border-zinc-500'
                          }`}
                        >
                          {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (selectionMode) toggleSelectItem(item.id);
                          else handleCollectionOpen(item);
                        }}
                        className="w-full text-left focus-visible:outline-none active:scale-[0.98] transition-transform duration-100"
                      >
                        <div
                          style={{ height: `${layout.maxCoverSize}px` }}
                          className="relative w-full mb-1 flex items-center justify-center"
                        >
                          <CoverArt
                            src={item.coverUrl}
                            alt={item.label}
                            className="h-full aspect-square rounded-lg"
                          />
                        </div>
                        <div className="text-xs font-medium truncate text-zinc-900 dark:text-zinc-100">
                          {item.label}
                        </div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                          {item.subtitle}
                        </div>
                      </button>
                      {!selectionMode && (
                        <div className="flex items-center gap-1">
                          {item.tracks.length > 0 && (
                            <>
                              <button
                                type="button"
                                data-no-drag="true"
                                onClick={() => onPlayAll(item.tracks, false)}
                                aria-label={`Play all in ${item.label}`}
                                className="flex-1 min-h-[30px] rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[11px] font-medium flex items-center justify-center gap-1 text-zinc-800 dark:text-zinc-200 active:scale-95 transition-transform duration-100"
                              >
                                <Play className="w-3 h-3 fill-current" />
                                <span>Play</span>
                              </button>
                              <button
                                type="button"
                                data-no-drag="true"
                                onClick={() => onPlayAll(item.tracks, true)}
                                aria-label={`Play random in ${item.label}`}
                                title="Play Random"
                                className="min-w-[30px] min-h-[30px] rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 flex items-center justify-center text-zinc-600 dark:text-zinc-300 active:scale-95 transition-transform duration-100"
                              >
                                <Shuffle className="w-3 h-3" />
                              </button>
                            </>
                          )}
                          <CollectionActionMenu
                            item={item}
                            singularLabel={singularLabel}
                            onAddToPlaylist={(list) => setPlaylistPickerTracks(list)}
                            onUpNext={onPlayNextMany}
                            onPlayAll={onPlayAll}
                            onSetEq={(list) => setEqModalTracks(list)}
                            onEditTags={(list) => openTagEditorForTracks(list)}
                            onAiCorrection={(col) =>
                              setAiCorrectionTarget({
                                label: col.label,
                                kindLabel: singularLabel,
                                tracks: col.tracks,
                              })
                            }
                            onGetInfo={(col) =>
                              setInfoTarget({ kind: 'collection', item: col, label: singularLabel })
                            }
                            onExportM3u={tab === 'playlists' ? onExportPlaylistM3u : undefined}
                            onDelete={handleDeleteCollectionItem}
                            onSetRingtone={onSetRingtone}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right-Side Row-1-Aligned Alphabetical Quick-Jump Slider */}
          <AlphabetIndexSlider
            letters={sliderLetters}
            populatedLetters={populatedLetters}
            activeLetter={currentPageFirstBucket}
            externalPopupLetter={transientPopLetter}
            alignedTopPx={2}
            onSelectLetter={handleSelectAlphabetLetter}
          />
        </div>

        {/* Fixed Bottom Page Controls */}
        <PaginationBar
          page={virtualPage}
          totalPages={totalPages}
          totalItems={totalItems}
          pageSize={layout.pageSize}
          rangeStartIndex={clampedStartIndex}
          onChangePage={(nextPage) => setStartIndex(nextPage * layout.pageSize)}
          onStepPrev={() => setStartIndex(Math.max(0, clampedStartIndex - layout.pageSize))}
          onStepNext={() =>
            setStartIndex(Math.min(Math.max(0, totalItems - 1), clampedStartIndex + layout.pageSize))
          }
          onJumpTop={() => setStartIndex(0)}
          itemLabel={tab === 'songs' ? 'tracks' : tab}
        />

        {/* Portaled Library Modals (Guaranteed above PlayerBar & Header, never clipped) */}
        {typeof document !== 'undefined' &&
          createPortal(
            <>
              {/* Rocket Player-Style Sorted By Modal (All 13 Sort Modes + Ascending Checkbox) */}
              {sortModalOpen && (
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label="Sorted By"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setSortModalOpen(false)}
                  className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-3"
                >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[340px] [@media(max-height:580px)]:max-w-[520px] max-h-[calc(100dvh-1.5rem)] rounded-2xl border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="shrink-0 px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-700/80 bg-zinc-50 dark:bg-zinc-800/80 flex items-center justify-between">
                <h3 className="text-base font-display font-semibold">Sorted By</h3>
                <button
                  type="button"
                  onClick={() => setSortModalOpen(false)}
                  aria-label="Close sort options"
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 [@media(max-height:580px)]:grid-cols-2 divide-y divide-zinc-100 dark:divide-zinc-800/70">
                {SORT_OPTIONS.map((opt) => {
                  const active = sortBy.field === opt.field;
                  return (
                    <button
                      key={opt.field}
                      type="button"
                      onClick={() => {
                        tactile.tap();
                        onChangeSortBy({ ...sortBy, field: opt.field });
                        setSortModalOpen(false);
                      }}
                      className={`w-full h-[35px] px-4 text-left text-sm flex items-center justify-between transition-colors ${
                        active
                          ? 'bg-amber-500/10 accent-text font-semibold'
                          : 'text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/80'
                      }`}
                    >
                      <span>{opt.label}</span>
                      {active && <Check className="w-4 h-4 accent-text shrink-0" />}
                    </button>
                  );
                })}
              </div>

              <label className="shrink-0 px-4 py-2.5 border-t border-zinc-200 dark:border-zinc-700/80 bg-zinc-50 dark:bg-zinc-800/80 flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={sortBy.ascending}
                  onChange={(e) => {
                    tactile.toggle(e.target.checked);
                    onChangeSortBy({ ...sortBy, ascending: e.target.checked });
                  }}
                  className="w-4 h-4 accent-amber-500 rounded shrink-0 cursor-pointer"
                />
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  Ascending
                </span>
              </label>
            </div>
          </div>
        )}

        {/* Add to Playlist Picker Modal (Shared by Triple-Dot Menu & Multi-Select Bar) */}
        {playlistPickerTracks && playlistPickerTracks.length > 0 && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Add to Playlist"
            onClick={() => setPlaylistPickerTracks(null)}
            onPointerDown={(e) => e.stopPropagation()}
            className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-3"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[340px] max-h-[calc(100dvh-1.5rem)] rounded-2xl border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="shrink-0 px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <h3 className="text-sm font-display font-semibold">
                  Add {playlistPickerTracks.length} Track(s) to Playlist
                </h3>
                <button
                  type="button"
                  onClick={() => setPlaylistPickerTracks(null)}
                  aria-label="Close playlist picker"
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = pickerNewPlaylistName.trim();
                  if (!name || playlistPickerTracks.length === 0) return;
                  tactile.success();
                  onCreatePlaylist(
                    name,
                    playlistPickerTracks.map((t) => t.id)
                  );
                  setPickerNewPlaylistName('');
                  setPlaylistPickerTracks(null);
                  if (selectionMode) exitSelectionMode();
                }}
                className="p-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-1.5 shrink-0"
              >
                <input
                  type="text"
                  value={pickerNewPlaylistName}
                  onChange={(e) => setPickerNewPlaylistName(e.target.value)}
                  placeholder="Create new playlist..."
                  className="flex-1 h-8 px-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs"
                />
                <button
                  type="submit"
                  className="h-8 px-3 rounded-lg accent-bg text-xs font-medium whitespace-nowrap"
                >
                  Create & Add
                </button>
              </form>

              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {playlists.length === 0 ? (
                  <div className="px-4 py-4 text-xs text-zinc-500 text-center">
                    No playlists yet. Create one above.
                  </div>
                ) : (
                  playlists.slice(0, 7).map((pl) => (
                    <button
                      key={pl.id}
                      type="button"
                      onClick={() => {
                        tactile.success();
                        if (playlistPickerTracks.length === 1) {
                          onAddTrackToPlaylist(playlistPickerTracks[0].id, pl.id);
                        } else {
                          onAddTracksToPlaylist(
                            playlistPickerTracks.map((t) => t.id),
                            pl.id
                          );
                        }
                        setPlaylistPickerTracks(null);
                        if (selectionMode) exitSelectionMode();
                      }}
                      className="w-full px-4 py-2.5 text-left text-xs sm:text-sm flex items-center justify-between hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <span className="truncate font-medium">{pl.name}</span>
                      <span className="text-[11px] font-mono-tabular text-zinc-500 shrink-0">
                        {pl.trackIds.length} tracks
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Multi-Select Delete Confirm Modal */}
        {deleteConfirmOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirm deletion"
            onClick={() => setDeleteConfirmOpen(false)}
            onPointerDown={(e) => e.stopPropagation()}
            className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-3"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[320px] rounded-2xl border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 p-4 shadow-2xl space-y-3"
            >
              <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
                <Trash2 className="w-4 h-4 shrink-0" />
                <h3 className="text-sm font-display font-semibold">
                  Delete Selected {tab === 'playlists' ? 'Playlists' : 'Tracks'}?
                </h3>
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                {tab === 'playlists'
                  ? `Remove ${selectedIds.size} selected playlist(s) from AuraSound.`
                  : `Remove ${selectedResolvedTracks.length} selected track(s) from library & offline cache.`}
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteConfirmOpen(false)}
                  className="min-h-[34px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDeleteSelected}
                  className="min-h-[34px] px-3.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Manual Track Tag Editor Modal (Single or Batch) */}
        {editingTrackIds && editingTrackIds.length > 0 && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Edit Tags"
            onClick={() => setEditingTrackIds(null)}
            onPointerDown={(e) => e.stopPropagation()}
            className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-3"
          >
            <form
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                const isSingle = editingTrackIds.length === 1;
                const patch: TrackMetadataPatch = {};
                if (isSingle && editTitle.trim()) patch.title = editTitle.trim();
                if (editArtist.trim() || isSingle) patch.artist = editArtist.trim() || 'Unknown Artist';
                if (editAlbum.trim() || isSingle) patch.album = editAlbum.trim() || 'Local Collection';
                if (editGenre.trim() || isSingle) patch.genre = editGenre.trim() || 'Hi-Res Local';
                if (editYear.trim() || isSingle) patch.year = editYear.trim();
                if (editComposer.trim() || isSingle) patch.composer = editComposer.trim();
                if (isSingle) patch.lyrics = editLyrics.trim();

                tactile.success();
                onEditTracksMetadata(editingTrackIds, patch);
                setEditingTrackIds(null);
                if (selectionMode) exitSelectionMode();
              }}
              className="w-full max-w-[360px] max-h-[calc(100dvh-1.5rem)] rounded-2xl border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="shrink-0 px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <Tag className="w-4 h-4 accent-text shrink-0" />
                  <h3 className="text-sm font-display font-semibold truncate">
                    {editingTrackIds.length === 1
                      ? 'Edit Track Tags'
                      : `Batch Edit (${editingTrackIds.length} tracks)`}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingTrackIds(null)}
                  aria-label="Close tag editor"
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-3.5 space-y-2.5 text-xs">
                {editingTrackIds.length === 1 && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="font-medium text-zinc-500 dark:text-zinc-400">Title</label>
                      {editingSingleTrack?.fileName && (
                        <button
                          type="button"
                          onClick={() => {
                            tactile.tap();
                            const cleaned = cleanFileNameTitle(editingSingleTrack.fileName || '');
                            setEditTitle(cleaned.title);
                            if (cleaned.artist !== 'Unknown Artist') {
                              setEditArtist(cleaned.artist);
                            }
                          }}
                          className="text-[11px] accent-text font-medium flex items-center gap-1 hover:underline"
                        >
                          <Wand2 className="w-3 h-3" />
                          <span>Clean from filename</span>
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full h-8 px-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs"
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-medium text-zinc-500 dark:text-zinc-400 mb-1">
                      Artist
                    </label>
                    <input
                      type="text"
                      value={editArtist}
                      onChange={(e) => setEditArtist(e.target.value)}
                      placeholder={editingTrackIds.length > 1 ? '(Keep unchanged)' : 'Artist'}
                      className="w-full h-8 px-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-zinc-500 dark:text-zinc-400 mb-1">
                      Album
                    </label>
                    <input
                      type="text"
                      value={editAlbum}
                      onChange={(e) => setEditAlbum(e.target.value)}
                      placeholder={editingTrackIds.length > 1 ? '(Keep unchanged)' : 'Album'}
                      className="w-full h-8 px-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-medium text-zinc-500 dark:text-zinc-400 mb-1">
                      Genre
                    </label>
                    <input
                      type="text"
                      value={editGenre}
                      onChange={(e) => setEditGenre(e.target.value)}
                      placeholder={editingTrackIds.length > 1 ? '(Keep unchanged)' : 'Genre'}
                      className="w-full h-8 px-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-zinc-500 dark:text-zinc-400 mb-1">
                      Year
                    </label>
                    <input
                      type="text"
                      maxLength={4}
                      value={editYear}
                      onChange={(e) => setEditYear(e.target.value.replace(/[^\d]/g, ''))}
                      placeholder={editingTrackIds.length > 1 ? '(Keep)' : 'YYYY'}
                      className="w-full h-8 px-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs font-mono-tabular"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-medium text-zinc-500 dark:text-zinc-400 mb-1">
                    Composer
                  </label>
                  <input
                    type="text"
                    value={editComposer}
                    onChange={(e) => setEditComposer(e.target.value)}
                    placeholder={editingTrackIds.length > 1 ? '(Keep unchanged)' : 'Optional composer'}
                    className="w-full h-8 px-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs"
                  />
                </div>

                {editingTrackIds.length === 1 && (
                  <div>
                    <label className="block font-medium text-zinc-500 dark:text-zinc-400 mb-1">
                      Lyrics (LRC timestamps or plain text)
                    </label>
                    <textarea
                      rows={2}
                      value={editLyrics}
                      onChange={(e) => setEditLyrics(e.target.value)}
                      placeholder="[00:12.50] Paste synced LRC or plain lyrics..."
                      className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs font-mono-tabular resize-none"
                    />
                  </div>
                )}
              </div>

              <div className="shrink-0 px-4 py-2.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingTrackIds(null)}
                  className="min-h-[32px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-[32px] px-4 rounded-lg accent-bg text-xs font-medium"
                >
                  Save Tags
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Per-Track / Per-Collection Set EQ Modal */}
        {eqModalTracks && eqModalTracks.length > 0 && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Set Equalizer Preset"
            onClick={() => setEqModalTracks(null)}
            onPointerDown={(e) => e.stopPropagation()}
            className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-3"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[340px] max-h-[calc(100dvh-1.5rem)] rounded-2xl border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="shrink-0 px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <Sliders className="w-4 h-4 accent-text shrink-0" />
                  <h3 className="text-sm font-display font-semibold truncate">
                    Set EQ ({eqModalTracks.length === 1 ? eqModalTracks[0].title : `${eqModalTracks.length} tracks`})
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setEqModalTracks(null)}
                  aria-label="Close EQ selector"
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                <button
                  type="button"
                  onClick={() => {
                    tactile.tap();
                    onAssignEqPreset(
                      eqModalTracks.map((t) => t.id),
                      undefined
                    );
                    setEqModalTracks(null);
                  }}
                  className="w-full px-4 py-2 text-left text-xs flex items-center justify-between hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span className="font-medium text-zinc-600 dark:text-zinc-300">
                    Use Global Equalizer Default
                  </span>
                  {eqModalTracks.every((t) => !t.eqPresetId) && (
                    <Check className="w-3.5 h-3.5 accent-text shrink-0" />
                  )}
                </button>

                {eqPresets.slice(0, 8).map((preset) => {
                  const active = eqModalTracks.every((t) => t.eqPresetId === preset.id);
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => {
                        tactile.success();
                        onAssignEqPreset(
                          eqModalTracks.map((t) => t.id),
                          preset.id
                        );
                        setEqModalTracks(null);
                      }}
                      className={`w-full px-4 py-2 text-left text-xs flex items-center justify-between hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                        active ? 'bg-amber-500/10 accent-text font-semibold' : ''
                      }`}
                    >
                      <span className="truncate">{preset.name}</span>
                      {active ? (
                        <Check className="w-3.5 h-3.5 accent-text shrink-0" />
                      ) : (
                        <span className="text-[11px] font-mono-tabular text-zinc-400 shrink-0">
                          {preset.preampDb >= 0 ? `+${preset.preampDb}` : preset.preampDb} dB
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="shrink-0 px-4 py-2.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEqModalTracks(null);
                    onOpenEqualizer();
                  }}
                  className="text-xs font-medium accent-text hover:underline flex items-center gap-1.5"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Open 10-Band EQ Rack</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEqModalTracks(null)}
                  className="min-h-[30px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Get Info Modal (Track or Collection) */}
        {infoTarget && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Audio Information"
            onClick={() => setInfoTarget(null)}
            onPointerDown={(e) => e.stopPropagation()}
            className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-3"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[380px] max-h-[calc(100dvh-1.5rem)] rounded-2xl border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="shrink-0 px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <Info className="w-4 h-4 accent-text shrink-0" />
                  <h3 className="text-sm font-display font-semibold truncate">
                    {infoTarget.kind === 'track' ? 'Track Info' : `${infoTarget.label} Info`}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setInfoTarget(null)}
                  aria-label="Close info"
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {infoTarget.kind === 'track' ? (() => {
                const liveTrack = tracks.find((t) => t.id === infoTarget.track.id) || infoTarget.track;
                return (
                <div className="p-3.5 space-y-3 text-xs">
                  <div className="flex items-center gap-3">
                    <CoverArt
                      src={liveTrack.coverUrl}
                      alt={liveTrack.title}
                      className="w-14 h-14 rounded-xl shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold truncate">{liveTrack.title}</div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                        {liveTrack.artist}
                      </div>
                      <div className="text-[11px] text-zinc-500 truncate">
                        {liveTrack.album}
                        {liveTrack.year ? ` (${liveTrack.year})` : ''}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 bg-zinc-50 dark:bg-zinc-950/60 p-2.5 rounded-xl border border-zinc-200/70 dark:border-zinc-800">
                    <div>
                      <div className="text-[10px] text-zinc-400">Genre</div>
                      <div className="truncate font-medium">{liveTrack.genre || '—'}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-zinc-400">Composer</div>
                      <div className="truncate font-medium">{liveTrack.composer || '—'}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-zinc-400">Duration & Size</div>
                      <div className="font-mono-tabular font-medium">
                        {formatDuration(liveTrack.duration)}
                        {liveTrack.fileSize
                          ? ` · ${(liveTrack.fileSize / (1024 * 1024)).toFixed(2)} MB`
                          : ''}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-zinc-400">Audio Stream</div>
                      <div className="font-mono-tabular font-medium">
                        {liveTrack.format} · {liveTrack.bitDepth}b/
                        {(liveTrack.sampleRate / 1000).toFixed(1)}kHz ·{' '}
                        {liveTrack.bitrateKbps}kbps
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-zinc-400">Plays / Skips</div>
                      <div className="font-mono-tabular font-medium">
                        {liveTrack.playCount} plays · {liveTrack.skipCount || 0} skips
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-zinc-400">Assigned EQ</div>
                      <div className="truncate font-medium">
                        {liveTrack.eqPresetId
                          ? eqPresets.find((p) => p.id === liveTrack.eqPresetId)?.name ||
                            'Custom'
                          : 'Global Default'}
                      </div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-[10px] text-zinc-400">Embedded Lyrics</div>
                      <div className="truncate font-medium flex items-center gap-1.5">
                        {liveTrack.lyrics?.trim() ? (
                          <>
                            <Mic2 className="w-3 h-3 accent-text shrink-0" />
                            <span>
                              {/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/.test(liveTrack.lyrics)
                                ? 'LRC Synced'
                                : 'Embedded'}{' '}
                              ({liveTrack.lyrics.split(/\r?\n/).filter((l) => l.trim()).length} lines)
                            </span>
                          </>
                        ) : (
                          <span className="text-zinc-500">None — run AI Correction to fetch</span>
                        )}
                      </div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-[10px] text-zinc-400">Source File & Folder</div>
                      <div className="truncate font-mono-tabular text-[11px] text-zinc-600 dark:text-zinc-300">
                        {liveTrack.nativePath ||
                          `${liveTrack.folderPath || 'Local'}/${liveTrack.fileName || liveTrack.title}`}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onToggleFavorite(liveTrack.id)}
                      className={`flex-1 min-h-[32px] px-2.5 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                        liveTrack.favorite
                          ? 'border-rose-500/50 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                          : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      }`}
                    >
                      <Heart className={`w-3.5 h-3.5 ${liveTrack.favorite ? 'fill-current' : ''}`} />
                      <span>{liveTrack.favorite ? 'Favorited' : 'Favorite'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleOfflineCache(liveTrack.id)}
                      className={`flex-1 min-h-[32px] px-2.5 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                        liveTrack.offlineCached
                          ? 'border-amber-500/50 bg-amber-500/10 accent-text'
                          : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      }`}
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>{liveTrack.offlineCached ? 'Saved Offline' : 'Save Offline'}</span>
                    </button>
                  </div>
                </div>
                );
              })() : (
                <div className="p-3.5 space-y-3 text-xs">
                  <div className="flex items-center gap-3">
                    <CoverArt
                      src={infoTarget.item.coverUrl}
                      alt={infoTarget.item.label}
                      className="w-14 h-14 rounded-xl shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold truncate">{infoTarget.item.label}</div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                        {infoTarget.item.subtitle}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 bg-zinc-50 dark:bg-zinc-950/60 p-2.5 rounded-xl border border-zinc-200/70 dark:border-zinc-800">
                    <div>
                      <div className="text-[10px] text-zinc-400">Tracks</div>
                      <div className="font-mono-tabular font-medium">{infoTarget.item.trackCount}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-zinc-400">Total Duration</div>
                      <div className="font-mono-tabular font-medium">
                        {formatDuration(
                          infoTarget.item.tracks.reduce((acc, t) => acc + (t.duration || 0), 0)
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-zinc-400">Total Size</div>
                      <div className="font-mono-tabular font-medium">
                        {(
                          infoTarget.item.tracks.reduce((acc, t) => acc + (t.fileSize || 0), 0) /
                          (1024 * 1024)
                        ).toFixed(2)}{' '}
                        MB
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-zinc-400">Total Plays</div>
                      <div className="font-mono-tabular font-medium">{infoTarget.item.playCount}</div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-[10px] text-zinc-400">Primary Artist / Genre</div>
                      <div className="truncate font-medium">
                        {infoTarget.item.artist} · {infoTarget.item.genre}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="shrink-0 px-4 py-2.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 flex items-center justify-between gap-2">
                {infoTarget.kind === 'track' ? (
                  <button
                    type="button"
                    onClick={() => {
                      const target = infoTarget.track;
                      setInfoTarget(null);
                      openTagEditorForTracks([target]);
                    }}
                    className="text-xs font-medium accent-text hover:underline flex items-center gap-1"
                  >
                    <Tag className="w-3.5 h-3.5" />
                    <span>Edit Tag</span>
                  </button>
                ) : infoTarget.item.tracks.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      const list = infoTarget.item.tracks;
                      setInfoTarget(null);
                      openTagEditorForTracks(list);
                    }}
                    className="text-xs font-medium accent-text hover:underline flex items-center gap-1"
                  >
                    <Tag className="w-3.5 h-3.5" />
                    <span>Batch Edit Tags</span>
                  </button>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  onClick={() => setInfoTarget(null)}
                  className="min-h-[30px] px-4 rounded-lg accent-bg text-xs font-medium"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
            </>,
            document.body
          )}

        <ItemAiCorrectionModal
          target={aiCorrectionTarget}
          onClose={() => setAiCorrectionTarget(null)}
          onApplySuggestions={onApplyTagCleanups}
          onShowNoChangesToast={onShowNoChangesToast}
        />
      </div>
    );
  }
);
