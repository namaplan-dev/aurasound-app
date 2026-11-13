export type NavigationTab =
  | 'songs'
  | 'albums'
  | 'artists'
  | 'genres'
  | 'playlists'
  | 'folders'
  | 'studio-mixes'
  | 'studio-playlists'
  | 'studio-duplicates'
  | 'studio-tags'
  | 'studio-artwork'
  | 'eq-rack'
  | 'eq-presets'
  | 'settings-audio'
  | 'settings-devices'
  | 'settings-theme'
  | 'settings-widgets'
  | 'settings-appearance'
  | 'settings-storage'
  | 'settings-cloud'
  | 'studio'
  | 'equalizer'
  | 'settings';

export type ViewMode = 'list' | 'grid';

export type ThemeMode = 'dark' | 'light';

export type ThemeAccent = 'amber' | 'cobalt' | 'emerald' | 'crimson' | 'slate';

export type StreamingQuality = 'lossless-hires' | 'cd-lossless' | 'high-320' | 'data-saver';

export type RepeatMode = 'off' | 'all' | 'one';

export type AudioSourceType = 'builtin' | 'local';

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  year?: string;
  duration: number; // seconds
  format: 'FLAC' | 'ALAC' | 'WAV' | 'MP3' | 'AAC' | 'OGG';
  sampleRate: number; // e.g. 96000, 48000, 44100
  bitDepth: number; // e.g. 24, 16
  bitrateKbps: number;
  coverUrl: string;
  source: AudioSourceType;
  folderPath?: string;
  fileName?: string;
  fileSize?: number;
  nativeUri?: string;
  nativePath?: string;
  /** Synthesized harmonic profile for built-in reference tracks */
  synthProfile?: {
    rootHz: number;
    chord: number[];
    tempoBpm: number;
    timbre: 'warm-pad' | 'electric-piano' | 'analog-bass' | 'acoustic-pluck' | 'ambient-drone';
  };
  favorite: boolean;
  rating: number; // 0 to 5
  playCount: number;
  lastPlayedAt?: number;
  addedAt: number;
  offlineCached: boolean;
  /** Hashed key for matching cloud metadata across sessions */
  fingerprint: string;
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  trackIds: string[];
  coverUrl?: string;
  source: 'local' | 'ai';
  createdAt: number;
  updatedAt: number;
}

export interface SmartRule {
  field: 'genre' | 'format' | 'minRating' | 'favorite' | 'minPlayCount' | 'moodKeyword' | 'minSampleRate';
  value: string | number | boolean;
}

export interface SmartPlaylist {
  id: string;
  name: string;
  description: string;
  mood: string;
  rules: SmartRule[];
  isAiGenerated: boolean;
  dynamicUpdate: boolean;
  pinnedTrackIds?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface EQPreset {
  id: string;
  name: string;
  preampDb: number;
  bands: number[]; // 10 bands in dB (-12 to +12)
  isBuiltIn?: boolean;
}

export interface DailyRecommendation {
  id: string;
  title: string;
  subtitle: string;
  mood: string;
  genre: string;
  suggestedSearchTerms: string[];
  matchedTrackIds: string[];
  generatedAt: number;
}

export interface AppSettings {
  themeMode: ThemeMode;
  themeAccent: ThemeAccent;
  activeTab: NavigationTab;
  viewModes: Record<'songs' | 'albums' | 'artists' | 'genres' | 'playlists' | 'folders', ViewMode>;
  streamingQuality: StreamingQuality;
  crossfadeSeconds: number; // 0 = gapless
  gaplessPlayback: boolean;
  offlineMode: boolean;
  lowBatteryMode: boolean;
  autoPlayBluetooth: boolean;
  showHomescreenWidget: boolean;
  widgetVariant?: 'top-bar' | 'studio-deck';
  masterVolume: number; // 0 to 1
  eqEnabled: boolean;
  activeEqPresetId: string;
  activeEqBands: number[];
  eqPreampDb: number;
  shuffle: boolean;
  repeatMode: RepeatMode;
  autoCloudBackup: boolean;
  lastCloudSyncAt?: number;
  lastTrackFingerprint?: string;
  lastPositionSec?: number;
  tactileSounds?: boolean;
  hapticFeedback?: boolean;
}

export interface SessionState {
  currentTrackId: string | null;
  currentTimeSeconds: number;
  wasPlaying: boolean;
  queueTrackIds: string[];
  searchQuery: string;
  selectedAlbumFilter: string | null;
  selectedArtistFilter: string | null;
  selectedGenreFilter: string | null;
  selectedFolderFilter: string | null;
  selectedPlaylistFilter: string | null;
  nowPlayingOpen: boolean;
  libraryScrollTop: number;
  mainScrollTop: number;
  updatedAt: number;
}

export interface CloudBackupPayload {
  ownerId: string;
  settings: Partial<AppSettings>;
  eqPresets: EQPreset[];
  playlists: Playlist[];
  smartPlaylists: SmartPlaylist[];
  trackPrefs: Array<{
    fingerprint: string;
    favorite: boolean;
    rating: number;
    playCount: number;
    title?: string;
    artist?: string;
    album?: string;
    genre?: string;
  }>;
  dailyRecommendations: DailyRecommendation[];
  updatedAt?: unknown;
  createdAt?: unknown;
}

export interface TagCleanupSuggestion {
  trackId: string;
  currentTitle: string;
  currentArtist: string;
  currentAlbum: string;
  currentGenre: string;
  suggestedTitle: string;
  suggestedArtist: string;
  suggestedAlbum: string;
  suggestedGenre: string;
  reason: string;
  selected: boolean;
}

export type AppTaskCategory =
  | 'device-scan'
  | 'file-import'
  | 'ai-duplicates'
  | 'ai-tags'
  | 'ai-artwork'
  | 'ai-playlist'
  | 'ai-mixes'
  | 'cloud-sync'
  | 'library-maintenance';

export interface AppTaskProgress {
  id: string;
  category: AppTaskCategory;
  title: string;
  detail: string;
  current: number;
  total: number;
  percent: number;
  status: 'running' | 'done' | 'error';
  updatedAt: number;
}

export interface DuplicateItem {
  trackId: string;
  title: string;
  artist: string;
  album: string;
  format: Track['format'];
  bitDepth: number;
  sampleRate: number;
  bitrateKbps: number;
  fileSize?: number;
  duration: number;
  isRecommendedKeep: boolean;
  selectedForRemoval: boolean;
}

export interface DuplicateGroup {
  groupId: string;
  reason: string;
  similarityScore: number;
  items: DuplicateItem[];
}

export interface ArtworkSuggestion {
  trackId: string;
  title: string;
  artist: string;
  album: string;
  currentCoverUrl: string;
  suggestedCoverUrl: string;
  sourceLabel: string;
  selected: boolean;
}

