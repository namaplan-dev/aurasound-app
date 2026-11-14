import {
  AppSettings,
  DailyRecommendation,
  EQPreset,
  Playlist,
  SessionState,
  SmartPlaylist,
  Track,
} from '../types/music';
import {
  BUILT_IN_EQ_PRESETS,
  BUNDLED_COVERS,
  DEFAULT_SETTINGS,
  SEED_DAILY_RECOMMENDATIONS,
  SEED_PLAYLISTS,
  SEED_SMART_PLAYLISTS,
  SEED_TRACKS,
} from '../data/seedLibrary';

const LEGACY_COVER_MAP: Record<string, string> = {
  '/src/assets/images/album_nocturne_vinyl_1794587934959.jpg': BUNDLED_COVERS.vinyl,
  '/src/assets/images/album_baltic_ambient_1794587935576.jpg': BUNDLED_COVERS.baltic,
  '/src/assets/images/album_analog_synth_1794587936966.jpg': BUNDLED_COVERS.tube,
  '/src/assets/images/album_jazz_quartet_1794587935839.jpg': BUNDLED_COVERS.jazz,
  '/src/assets/images/album_acoustic_atrium_1794587935664.jpg': BUNDLED_COVERS.atrium,
};

const KEYS = {
  SETTINGS: 'aurasound_settings_v1',
  TRACKS: 'aurasound_tracks_v1',
  PLAYLISTS: 'aurasound_playlists_v1',
  SMART_PLAYLISTS: 'aurasound_smart_playlists_v1',
  EQ_PRESETS: 'aurasound_eq_presets_v1',
  DAILY_RECS: 'aurasound_daily_recs_v1',
  SESSION: 'aurasound_session_v1',
  RECORDINGS: 'aurasound_recordings_v1',
};

function safeReadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWriteJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`Failed saving ${key} to localStorage:`, err);
  }
}

export function loadSettings(): AppSettings {
  const saved = safeReadJson<Partial<AppSettings>>(KEYS.SETTINGS, {});
  let activeTab = saved.activeTab || DEFAULT_SETTINGS.activeTab;
  if (activeTab === 'studio') activeTab = 'studio-mixes';
  else if (activeTab === 'equalizer') activeTab = 'eq-rack';
  else if (activeTab === 'settings') activeTab = 'settings-audio';
  else if (activeTab === 'settings-appearance') activeTab = 'settings-theme';

  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    activeTab,
    viewModes: {
      ...DEFAULT_SETTINGS.viewModes,
      ...(saved.viewModes || {}),
    },
    sortBy: {
      field: saved.sortBy?.field || DEFAULT_SETTINGS.sortBy?.field || 'title',
      ascending: saved.sortBy?.ascending !== undefined ? saved.sortBy.ascending : true,
    },
    onlyScanSelectedFolders: Boolean(saved.onlyScanSelectedFolders),
    selectedScanFolders: Array.isArray(saved.selectedScanFolders)
      ? saved.selectedScanFolders
      : [],
    recordingsEnabled: Boolean(saved.recordingsEnabled),
    recordingFolders: Array.isArray(saved.recordingFolders)
      ? saved.recordingFolders
      : [],
    showLyrics: saved.showLyrics !== false,
    karaokeOffsetMs:
      typeof saved.karaokeOffsetMs === 'number' && Number.isFinite(saved.karaokeOffsetMs)
        ? saved.karaokeOffsetMs
        : 0,
    aiScanConfig: {
      ...DEFAULT_SETTINGS.aiScanConfig,
      ...(saved.aiScanConfig || {}),
    },
  };
}

export function saveSettings(settings: AppSettings): void {
  safeWriteJson(KEYS.SETTINGS, settings);
}

export function loadTracks(): Track[] {
  const saved = safeReadJson<Track[] | null>(KEYS.TRACKS, null);
  if (!saved || !Array.isArray(saved) || saved.length === 0) {
    return SEED_TRACKS;
  }
  const seedLyricsById = new Map(
    SEED_TRACKS.filter((st) => Boolean(st.lyrics)).map((st) => [st.id, st.lyrics!])
  );
  return saved.map((t) => {
    let next =
      t.coverUrl && LEGACY_COVER_MAP[t.coverUrl]
        ? { ...t, coverUrl: LEGACY_COVER_MAP[t.coverUrl] }
        : t;
    if (next.source === 'builtin' && !next.lyrics && seedLyricsById.has(next.id)) {
      next = { ...next, lyrics: seedLyricsById.get(next.id) };
    }
    return next;
  });
}

export function saveTracks(tracks: Track[]): void {
  // Strip huge inline data URL covers if storage quota is tight, keeping normal URLs/small covers intact
  const compact = tracks.map((t) => {
    if (t.coverUrl && t.coverUrl.startsWith('data:') && t.coverUrl.length > 180000) {
      return {
        ...t,
        coverUrl: BUNDLED_COVERS.vinyl,
      };
    }
    return t;
  });
  safeWriteJson(KEYS.TRACKS, compact);
}

export function loadPlaylists(): Playlist[] {
  const saved = safeReadJson<Playlist[] | null>(KEYS.PLAYLISTS, null);
  if (!saved || !Array.isArray(saved)) return SEED_PLAYLISTS;
  return saved;
}

export function savePlaylists(playlists: Playlist[]): void {
  safeWriteJson(KEYS.PLAYLISTS, playlists);
}

export function loadSmartPlaylists(): SmartPlaylist[] {
  const saved = safeReadJson<SmartPlaylist[] | null>(KEYS.SMART_PLAYLISTS, null);
  if (!saved || !Array.isArray(saved)) return SEED_SMART_PLAYLISTS;
  return saved;
}

export function saveSmartPlaylists(list: SmartPlaylist[]): void {
  safeWriteJson(KEYS.SMART_PLAYLISTS, list);
}

export function loadEqPresets(): EQPreset[] {
  const custom = safeReadJson<EQPreset[]>(KEYS.EQ_PRESETS, []);
  const customOnly = Array.isArray(custom) ? custom.filter((p) => !p.isBuiltIn) : [];
  return [...BUILT_IN_EQ_PRESETS, ...customOnly];
}

export function saveCustomEqPresets(allPresets: EQPreset[]): void {
  safeWriteJson(
    KEYS.EQ_PRESETS,
    allPresets.filter((p) => !p.isBuiltIn)
  );
}

export function loadDailyRecommendations(): DailyRecommendation[] {
  const saved = safeReadJson<DailyRecommendation[] | null>(KEYS.DAILY_RECS, null);
  if (!saved || !Array.isArray(saved) || saved.length === 0) {
    return SEED_DAILY_RECOMMENDATIONS;
  }
  return saved;
}

export function saveDailyRecommendations(recs: DailyRecommendation[]): void {
  safeWriteJson(KEYS.DAILY_RECS, recs);
}

export function loadRecordings(): Track[] {
  const saved = safeReadJson<Track[] | null>(KEYS.RECORDINGS, null);
  if (!saved || !Array.isArray(saved)) return [];
  return saved.map((r) => ({ ...r, isRecording: true }));
}

export function saveRecordings(recordings: Track[]): void {
  const normalized = recordings.map((r) => ({ ...r, isRecording: true }));
  safeWriteJson(KEYS.RECORDINGS, normalized);
}

const DEFAULT_SESSION: SessionState = {
  currentTrackId: null,
  currentTimeSeconds: 0,
  wasPlaying: false,
  queueTrackIds: [],
  searchQuery: '',
  selectedAlbumFilter: null,
  selectedArtistFilter: null,
  selectedGenreFilter: null,
  selectedFolderFilter: null,
  selectedPlaylistFilter: null,
  nowPlayingOpen: true,
  nowPlayingDeckPage: 'player',
  libraryStartIndices: {},
  libraryScrollTop: 0,
  mainScrollTop: 0,
  updatedAt: 0,
};

export function loadSession(): SessionState {
  const saved = safeReadJson<Partial<SessionState>>(KEYS.SESSION, {});
  return {
    ...DEFAULT_SESSION,
    ...saved,
    queueTrackIds: Array.isArray(saved.queueTrackIds) ? saved.queueTrackIds : [],
    libraryStartIndices:
      saved.libraryStartIndices && typeof saved.libraryStartIndices === 'object'
        ? saved.libraryStartIndices
        : {},
  };
}

export function saveSession(session: SessionState): void {
  safeWriteJson(KEYS.SESSION, session);
}

export function normalizeFolderKey(raw: string): string {
  return String(raw || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/')
    .trim()
    .toLowerCase();
}

export function folderMatchesAllowedList(
  trackFolderPath: string | undefined,
  allowedFolderPaths: string[]
): boolean {
  if (allowedFolderPaths.length === 0) return true;
  const candidate = normalizeFolderKey(trackFolderPath || '');
  if (!candidate) return false;
  return allowedFolderPaths.some((allowed) => {
    const normAllowed = normalizeFolderKey(allowed);
    if (!normAllowed) return false;
    return candidate === normAllowed || candidate.startsWith(`${normAllowed}/`);
  });
}
