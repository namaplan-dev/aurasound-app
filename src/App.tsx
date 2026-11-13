import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  Cloud,
  CopyCheck,
  Disc,
  FolderOpen,
  HardDrive,
  ImagePlus,
  ListMusic,
  Mic2,
  Moon,
  Music,
  Palette,
  Search,
  Settings,
  Sliders,
  Sparkles,
  Sun,
  Tag,
  Upload,
  Volume2,
  Wand2,
  WifiOff,
  X,
} from 'lucide-react';
import {
  AppSettings,
  AppTaskCategory,
  AppTaskProgress,
  DailyRecommendation,
  EQPreset,
  NavigationTab,
  Playlist,
  SessionState,
  SmartPlaylist,
  TagCleanupSuggestion,
  Track,
  ViewMode,
} from './types/music';
import { audioEngine } from './services/audioEngine';
import { auth } from './services/firebaseClient';
import {
  backupToCloud,
  restoreFromCloud,
  signInWithGoogleAccount,
  signOutGoogleAccount,
} from './services/cloudSyncService';
import { parseLocalAudioFile } from './services/metadataParser';
import {
  clearAudioCache,
  deleteAudioBlobFromCache,
  getCachedAudioStats,
  saveAudioBlobToCache,
} from './services/offlineCacheService';
import {
  loadDailyRecommendations,
  loadEqPresets,
  loadPlaylists,
  loadSession,
  loadSettings,
  loadSmartPlaylists,
  loadTracks,
  saveCustomEqPresets,
  saveDailyRecommendations,
  savePlaylists,
  saveSession,
  saveSettings,
  saveSmartPlaylists,
  saveTracks,
} from './services/storageService';
import { matchesNormalizedQuery, repairMojibakeText } from './utils/textNormalization';
import { LibraryBrowser, LibraryTab } from './components/LibraryBrowser';
import { EqualizerPage, EqualizerPanel } from './components/EqualizerPanel';
import { SmartStudioView, StudioPage } from './components/SmartStudioView';
import { SettingsCloudView, SettingsPage } from './components/SettingsCloudView';
import { PlayerBar } from './components/PlayerBar';
import { NowPlayingSheetHandle, NowPlayingView } from './components/NowPlayingView';
import { HomescreenWidget } from './components/HomescreenWidget';
import { CastModal } from './components/CastModal';
import { ShareModal } from './components/ShareModal';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';
import { TaskProgressDock } from './components/TaskProgressDock';
import { tactile } from './services/tactileFeedback';
import { isNativeAndroidApp, scanAndroidDeviceLibrary } from './services/nativeScanner';
import {
  subscribeNativeWidgetActions,
  syncNativeWidgets,
} from './services/nativeWidget';
import { APP_VERSION } from './version';

type WorkspaceId = 'library' | 'studio' | 'equalizer' | 'settings';

interface NavItem {
  id: NavigationTab;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}

const WORKSPACES: Array<{
  id: WorkspaceId;
  title: string;
  mobileTitle: string;
  items: NavItem[];
}> = [
  {
    id: 'library',
    title: 'Library',
    mobileTitle: 'Library',
    items: [
      { id: 'songs', label: 'Songs', shortLabel: 'Songs', icon: Music },
      { id: 'albums', label: 'Albums', shortLabel: 'Albums', icon: Disc },
      { id: 'artists', label: 'Artists', shortLabel: 'Artists', icon: Mic2 },
      { id: 'genres', label: 'Genres', shortLabel: 'Genres', icon: Tag },
      { id: 'playlists', label: 'Playlists', shortLabel: 'Lists', icon: ListMusic },
      { id: 'folders', label: 'Folders', shortLabel: 'Folders', icon: FolderOpen },
    ],
  },
  {
    id: 'studio',
    title: 'Smart Studio',
    mobileTitle: 'Studio',
    items: [
      { id: 'studio-mixes', label: 'Daily Mixes', shortLabel: 'Mixes', icon: Sparkles },
      { id: 'studio-playlists', label: 'Smart Mixes', shortLabel: 'Smart', icon: Wand2 },
      { id: 'studio-duplicates', label: 'Duplicates', shortLabel: 'Dups', icon: CopyCheck },
      { id: 'studio-tags', label: 'Tag Cleanup', shortLabel: 'Tags', icon: Tag },
      { id: 'studio-artwork', label: 'Album Art', shortLabel: 'Art', icon: ImagePlus },
    ],
  },
  {
    id: 'equalizer',
    title: 'Equalizer',
    mobileTitle: 'EQ',
    items: [
      { id: 'eq-rack', label: '10-Band EQ', shortLabel: '10-Band EQ', icon: Sliders },
      { id: 'eq-presets', label: 'Sound Presets', shortLabel: 'Presets', icon: Music },
    ],
  },
  {
    id: 'settings',
    title: 'Settings',
    mobileTitle: 'Settings',
    items: [
      { id: 'settings-audio', label: 'Audio', shortLabel: 'Audio', icon: Volume2 },
      { id: 'settings-appearance', label: 'Display & Widget', shortLabel: 'Display', icon: Palette },
      { id: 'settings-storage', label: 'Storage', shortLabel: 'Storage', icon: HardDrive },
      { id: 'settings-cloud', label: 'Cloud Sync', shortLabel: 'Cloud', icon: Cloud },
    ],
  },
];

function normalizeTab(tab: NavigationTab): NavigationTab {
  if (tab === 'studio') return 'studio-mixes';
  if (tab === 'equalizer') return 'eq-rack';
  if (tab === 'settings') return 'settings-audio';
  return tab;
}

function getWorkspaceForTab(tab: NavigationTab): WorkspaceId {
  const clean = normalizeTab(tab);
  if (clean.startsWith('studio-')) return 'studio';
  if (clean.startsWith('eq-')) return 'equalizer';
  if (clean.startsWith('settings-')) return 'settings';
  return 'library';
}

export default function App() {
  const initialSessionRef = useRef<SessionState | null>(null);
  if (!initialSessionRef.current) {
    initialSessionRef.current = loadSession();
  }

  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [tracks, setTracks] = useState<Track[]>(() => loadTracks());
  const [playlists, setPlaylists] = useState<Playlist[]>(() => loadPlaylists());
  const [smartPlaylists, setSmartPlaylists] = useState<SmartPlaylist[]>(() => loadSmartPlaylists());
  const [eqPresets, setEqPresets] = useState<EQPreset[]>(() => loadEqPresets());
  const [dailyRecs, setDailyRecs] = useState<DailyRecommendation[]>(() =>
    loadDailyRecommendations()
  );

  const [user, setUser] = useState<User | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>(
    () => initialSessionRef.current?.searchQuery || ''
  );

  // Filters when drilling from Albums/Artists/Genres/Folders/Playlists into Songs
  const [selectedAlbumFilter, setSelectedAlbumFilter] = useState<string | null>(
    () => initialSessionRef.current?.selectedAlbumFilter ?? null
  );
  const [selectedArtistFilter, setSelectedArtistFilter] = useState<string | null>(
    () => initialSessionRef.current?.selectedArtistFilter ?? null
  );
  const [selectedGenreFilter, setSelectedGenreFilter] = useState<string | null>(
    () => initialSessionRef.current?.selectedGenreFilter ?? null
  );
  const [selectedFolderFilter, setSelectedFolderFilter] = useState<string | null>(
    () => initialSessionRef.current?.selectedFolderFilter ?? null
  );
  const [selectedPlaylistFilter, setSelectedPlaylistFilter] = useState<string | null>(
    () => initialSessionRef.current?.selectedPlaylistFilter ?? null
  );

  // Playback state restored from last session
  const [queue, setQueue] = useState<Track[]>(() => {
    const map = new Map(tracks.map((t) => [t.id, t]));
    const restoredQ = (initialSessionRef.current?.queueTrackIds || [])
      .map((id) => map.get(id))
      .filter((t): t is Track => Boolean(t));
    return restoredQ.length > 0 ? restoredQ : tracks;
  });
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(() => {
    const savedId = initialSessionRef.current?.currentTrackId;
    if (savedId && tracks.some((t) => t.id === savedId)) return savedId;
    if (settings.lastTrackFingerprint) {
      const fpMatch = tracks.find((t) => t.fingerprint === settings.lastTrackFingerprint);
      if (fpMatch) return fpMatch.id;
    }
    return tracks[0]?.id || null;
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  // Overlays & Modals — default to nice full-screen Player View on app open
  const [nowPlayingOpen, setNowPlayingOpen] = useState<boolean>(true);
  const [castOpen, setCastOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  // Import, Cloud & Global Task Progress state
  const [importingFiles, setImportingFiles] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [cacheStats, setCacheStats] = useState({ count: 0, totalBytes: 0 });
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [activeTasks, setActiveTasks] = useState<AppTaskProgress[]>([]);
  const [syncProgress, setSyncProgress] = useState<AppTaskProgress | null>(null);
  const [storageProgress, setStorageProgress] = useState<AppTaskProgress | null>(null);
  const taskCleanupTimersRef = useRef<Map<string, number>>(new Map());
  const nowPlayingSheetRef = useRef<NowPlayingSheetHandle | null>(null);

  const dismissTask = useCallback((taskId: string) => {
    const existingTimer = taskCleanupTimersRef.current.get(taskId);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
      taskCleanupTimersRef.current.delete(taskId);
    }
    setActiveTasks((prev) => prev.filter((t) => t.id !== taskId));
  }, []);

  const reportTaskProgress = useCallback(
    (
      id: string,
      category: AppTaskCategory,
      title: string,
      detail: string,
      current: number,
      total: number,
      status: 'running' | 'done' | 'error' = 'running'
    ) => {
      const percent =
        total > 0
          ? Math.max(0, Math.min(100, Math.round((current / total) * 100)))
          : status === 'done'
          ? 100
          : 0;
      const entry: AppTaskProgress = {
        id,
        category,
        title,
        detail,
        current,
        total,
        percent,
        status,
        updatedAt: Date.now(),
      };

      setActiveTasks((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        if (idx === -1) return [...prev.slice(-3), entry];
        const next = [...prev];
        next[idx] = entry;
        return next;
      });

      if (category === 'cloud-sync') setSyncProgress(entry);
      if (category === 'library-maintenance') setStorageProgress(entry);

      const oldTimer = taskCleanupTimersRef.current.get(id);
      if (oldTimer) {
        window.clearTimeout(oldTimer);
        taskCleanupTimersRef.current.delete(id);
      }
      if (status !== 'running') {
        const timer = window.setTimeout(() => {
          dismissTask(id);
        }, status === 'done' ? 3800 : 6000);
        taskCleanupTimersRef.current.set(id, timer);
      }
    },
    [dismissTask]
  );

  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const autoBackupTimerRef = useRef<number | null>(null);
  const libraryScrollTopRef = useRef<number>(initialSessionRef.current?.libraryScrollTop || 0);
  const mainScrollTopRef = useRef<number>(initialSessionRef.current?.mainScrollTop || 0);
  const currentTimeRef = useRef<number>(initialSessionRef.current?.currentTimeSeconds || 0);
  const lastSessionSaveMsRef = useRef<number>(0);
  const hasRestoredSessionRef = useRef<boolean>(false);

  const settingsSaveTimerRef = useRef<number | null>(null);
  const tracksRef = useRef<Track[]>(tracks);
  tracksRef.current = tracks;

  // Apply theme, accent & tactile preferences synchronously; debounce localStorage write for 60fps slider drags
  useEffect(() => {
    const root = document.documentElement;
    if (settings.themeMode === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    root.setAttribute('data-accent', settings.themeAccent);
    tactile.configure(settings.tactileSounds !== false, settings.hapticFeedback !== false);

    if (settingsSaveTimerRef.current) {
      window.clearTimeout(settingsSaveTimerRef.current);
    }
    settingsSaveTimerRef.current = window.setTimeout(() => {
      saveSettings(settings);
    }, 180);

    return () => {
      if (settingsSaveTimerRef.current) {
        window.clearTimeout(settingsSaveTimerRef.current);
      }
    };
  }, [settings]);

  // Sync audio engine parameters
  useEffect(() => {
    audioEngine.setMasterVolume(settings.masterVolume);
    audioEngine.setEqBands(settings.activeEqBands, settings.eqEnabled, settings.eqPreampDb);
    audioEngine.setCrossfade(settings.crossfadeSeconds, settings.gaplessPlayback);
    audioEngine.setStreamingQuality(settings.streamingQuality);
  }, [
    settings.masterVolume,
    settings.activeEqBands,
    settings.eqEnabled,
    settings.eqPreampDb,
    settings.crossfadeSeconds,
    settings.gaplessPlayback,
    settings.streamingQuality,
  ]);

  const tracksSaveTimerRef = useRef<number | null>(null);

  // Debounce track persistence to avoid synchronous localStorage stalls on mobile UI
  useEffect(() => {
    if (tracksSaveTimerRef.current) {
      window.clearTimeout(tracksSaveTimerRef.current);
    }
    tracksSaveTimerRef.current = window.setTimeout(() => {
      saveTracks(tracks);
    }, 350);
    return () => {
      if (tracksSaveTimerRef.current) {
        window.clearTimeout(tracksSaveTimerRef.current);
      }
    };
  }, [tracks]);
  useEffect(() => {
    savePlaylists(playlists);
  }, [playlists]);
  useEffect(() => {
    saveSmartPlaylists(smartPlaylists);
  }, [smartPlaylists]);
  useEffect(() => {
    saveCustomEqPresets(eqPresets);
  }, [eqPresets]);
  useEffect(() => {
    saveDailyRecommendations(dailyRecs);
  }, [dailyRecs]);

  // Refresh IndexedDB offline cache statistics
  const refreshCacheStats = useCallback(async () => {
    const stats = await getCachedAudioStats();
    setCacheStats(stats);
  }, []);

  useEffect(() => {
    void refreshCacheStats();
  }, [refreshCacheStats]);

  // Subscribe to Firebase Auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (authUser) => {
      setUser(authUser);
    });
    return () => unsub();
  }, []);

  // Subscribe to AudioEngine status
  useEffect(() => {
    return audioEngine.subscribeStatus((st) => {
      setIsPlaying(st.isPlaying);
      setIsLoadingAudio(st.isLoading);
      setAudioError(st.error);
    });
  }, []);

  // Auto-play on Bluetooth / Audio device connection
  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return;
    let prevCount = 0;
    void navigator.mediaDevices.enumerateDevices().then((d) => {
      prevCount = d.filter((x) => x.kind === 'audiooutput').length;
    });

    const onDeviceChange = async () => {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        const outputs = list.filter((x) => x.kind === 'audiooutput');
        if (outputs.length > prevCount && settings.autoPlayBluetooth) {
          void audioEngine.resumeIfPaused();
        }
        prevCount = outputs.length;
      } catch {
        // ignore
      }
    };
    navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
    return () => navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
  }, [settings.autoPlayBluetooth]);

  const currentTrack = useMemo(
    () => tracks.find((t) => t.id === currentTrackId) || null,
    [tracks, currentTrackId]
  );

  // Latest state snapshot ref for lifecycle unload/visibility/throttle persistence
  const latestSnapshotRef = useRef({
    settings,
    currentTrack,
    currentTrackId,
    queue,
    isPlaying,
    searchQuery,
    selectedAlbumFilter,
    selectedArtistFilter,
    selectedGenreFilter,
    selectedFolderFilter,
    selectedPlaylistFilter,
    nowPlayingOpen,
  });
  latestSnapshotRef.current = {
    settings,
    currentTrack,
    currentTrackId,
    queue,
    isPlaying,
    searchQuery,
    selectedAlbumFilter,
    selectedArtistFilter,
    selectedGenreFilter,
    selectedFolderFilter,
    selectedPlaylistFilter,
    nowPlayingOpen,
  };

  const persistSessionSnapshot = useCallback((alsoSaveSettingsFingerprint = false) => {
    const snap = latestSnapshotRef.current;
    const engineState = audioEngine.getState();
    const playbackSec = Math.max(0, Math.round((engineState.currentTime || currentTimeRef.current) * 10) / 10);
    currentTimeRef.current = playbackSec;

    saveSession({
      currentTrackId: snap.currentTrackId,
      currentTimeSeconds: playbackSec,
      wasPlaying: engineState.isPlaying || snap.isPlaying,
      queueTrackIds: snap.queue.map((t) => t.id),
      searchQuery: snap.searchQuery,
      selectedAlbumFilter: snap.selectedAlbumFilter,
      selectedArtistFilter: snap.selectedArtistFilter,
      selectedGenreFilter: snap.selectedGenreFilter,
      selectedFolderFilter: snap.selectedFolderFilter,
      selectedPlaylistFilter: snap.selectedPlaylistFilter,
      nowPlayingOpen: snap.nowPlayingOpen,
      libraryScrollTop: libraryScrollTopRef.current,
      mainScrollTop: mainScrollTopRef.current,
      updatedAt: Date.now(),
    });

    if (alsoSaveSettingsFingerprint) {
      saveSettings({
        ...snap.settings,
        lastTrackFingerprint: snap.currentTrack?.fingerprint || snap.settings.lastTrackFingerprint,
        lastPositionSec: playbackSec,
      });
    }
  }, []);

  // Restore exact audio track, position & scroll offset once on initial launch
  useEffect(() => {
    if (hasRestoredSessionRef.current) return;
    hasRestoredSessionRef.current = true;

    const sess = initialSessionRef.current;
    const trackToRestore = tracks.find((t) => t.id === currentTrackId) || tracks[0] || null;

    if (!trackToRestore) return;
    const restoredSec =
      sess?.currentTrackId === trackToRestore.id
        ? sess.currentTimeSeconds || 0
        : settings.lastPositionSec || 0;
    currentTimeRef.current = restoredSec;

    const idx = queue.findIndex((t) => t.id === trackToRestore.id);
    const upcoming = idx >= 0 && idx + 1 < queue.length ? queue[idx + 1] : queue[0] || null;
    void audioEngine.restoreTrackPosition(
      trackToRestore,
      restoredSec,
      upcoming,
      Boolean(sess?.wasPlaying)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Continuously record playback progress (~1s) & flush immediately on pause/close/tab switch
  useEffect(() => {
    const unsubProgress = audioEngine.subscribeProgress(({ currentTime }) => {
      currentTimeRef.current = currentTime;
      const now = Date.now();
      if (now - lastSessionSaveMsRef.current >= 1000) {
        lastSessionSaveMsRef.current = now;
        persistSessionSnapshot(false);
      }
    });

    const handleLifecycleFlush = () => {
      if (tracksSaveTimerRef.current) {
        window.clearTimeout(tracksSaveTimerRef.current);
        tracksSaveTimerRef.current = null;
      }
      saveTracks(tracksRef.current);
      persistSessionSnapshot(true);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        handleLifecycleFlush();
      }
    };

    window.addEventListener('beforeunload', handleLifecycleFlush);
    window.addEventListener('pagehide', handleLifecycleFlush);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      unsubProgress();
      window.removeEventListener('beforeunload', handleLifecycleFlush);
      window.removeEventListener('pagehide', handleLifecycleFlush);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [persistSessionSnapshot]);

  // Persist immediately whenever navigation/playback/filter/overlay state changes
  useEffect(() => {
    if (!hasRestoredSessionRef.current) return;
    persistSessionSnapshot(false);
  }, [
    currentTrackId,
    queue,
    isPlaying,
    searchQuery,
    selectedAlbumFilter,
    selectedArtistFilter,
    selectedGenreFilter,
    selectedFolderFilter,
    selectedPlaylistFilter,
    nowPlayingOpen,
    persistSessionSnapshot,
  ]);

  const deferredSearchQuery = useDeferredValue(searchQuery);

  // Visible tracks respect Search (Lithuanian diacritic-insensitive + Cyrillic) & Offline Mode
  const visibleTracks = useMemo(() => {
    return tracks.filter((t) => {
      if (settings.offlineMode && !t.offlineCached && t.source !== 'local') {
        return false;
      }
      if (!deferredSearchQuery.trim()) return true;
      return matchesNormalizedQuery(
        [t.title, t.artist, t.album, t.genre, t.folderPath, t.fileName],
        deferredSearchQuery
      );
    });
  }, [tracks, settings.offlineMode, deferredSearchQuery]);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const getNextTrackInQueue = useCallback(
    (curId: string | null, q: Track[]): Track | null => {
      if (q.length === 0) return null;
      if (settings.shuffle) {
        const idx = Math.floor(Math.random() * q.length);
        return q[idx];
      }
      const idx = q.findIndex((t) => t.id === curId);
      if (idx === -1) return q[0];
      if (idx + 1 < q.length) return q[idx + 1];
      return settings.repeatMode === 'all' ? q[0] : null;
    },
    [settings.shuffle, settings.repeatMode]
  );

  const playTrack = useCallback(
    async (track: Track, customQueue?: Track[]) => {
      tactile.playAction(true);
      const nextQueue = customQueue && customQueue.length > 0 ? customQueue : queue;
      if (customQueue && customQueue.length > 0) {
        setQueue(customQueue);
      }
      setCurrentTrackId(track.id);
      audioEngine.resetVirtualTime();
      const upcoming = getNextTrackInQueue(track.id, nextQueue);
      await audioEngine.loadAndPlay(track, upcoming);

      // Record play count & timestamp
      setTracks((prev) =>
        prev.map((t) =>
          t.id === track.id ? { ...t, playCount: t.playCount + 1, lastPlayedAt: Date.now() } : t
        )
      );
    },
    [queue, getNextTrackInQueue]
  );

  const playCollectionQueue = useCallback(
    (list: Track[], random: boolean) => {
      if (list.length === 0) return;
      if (random) {
        const shuffled = [...list];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        updateSettings({ shuffle: true });
        void playTrack(shuffled[0], shuffled);
      } else {
        updateSettings({ shuffle: false });
        void playTrack(list[0], list);
      }
    },
    [playTrack, updateSettings]
  );

  const handleNext = useCallback(() => {
    const activeQ = queue.length > 0 ? queue : visibleTracks;
    if (activeQ.length === 0) return;
    if (settings.repeatMode === 'one' && currentTrack) {
      void playTrack(currentTrack, activeQ);
      return;
    }
    const next = getNextTrackInQueue(currentTrackId, activeQ);
    if (next) void playTrack(next, activeQ);
  }, [queue, visibleTracks, settings.repeatMode, currentTrack, currentTrackId, getNextTrackInQueue, playTrack]);

  const handlePrev = useCallback(() => {
    const activeQ = queue.length > 0 ? queue : visibleTracks;
    if (activeQ.length === 0) return;
    const idx = activeQ.findIndex((t) => t.id === currentTrackId);
    const prevIdx = idx > 0 ? idx - 1 : activeQ.length - 1;
    const prevTrack = activeQ[prevIdx];
    if (prevTrack) void playTrack(prevTrack, activeQ);
  }, [queue, visibleTracks, currentTrackId, playTrack]);

  // Wire Track End & Hardware Media Keys
  useEffect(() => {
    audioEngine.setMediaHandlers(handlePrev, handleNext);
    return audioEngine.subscribeTrackEnd(() => {
      handleNext();
    });
  }, [handlePrev, handleNext]);

  const handleTogglePlayPause = useCallback(async () => {
    if (!currentTrack && visibleTracks.length > 0) {
      await playTrack(visibleTracks[0], visibleTracks);
      return;
    }
    const willPlay = !audioEngine.getState().isPlaying;
    tactile.playAction(willPlay);
    await audioEngine.togglePlayPause();
  }, [currentTrack, visibleTracks, playTrack]);

  // Sync live track & playback state to both Android home screen widgets
  useEffect(() => {
    void syncNativeWidgets(currentTrack, isPlaying);
  }, [currentTrack, isPlaying]);

  // Receive Play/Pause/Prev/Next taps from Android home screen widgets
  useEffect(() => {
    return subscribeNativeWidgetActions((action) => {
      if (action === 'prev') handlePrev();
      else if (action === 'next') handleNext();
      else if (action === 'toggle') void handleTogglePlayPause();
    });
  }, [handlePrev, handleNext, handleTogglePlayPause]);

  // Global keyboard shortcuts (Space = Play/Pause, Arrows = Seek/Skip, M = Mute)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        void handleTogglePlayPause();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        if (e.shiftKey) handleNext();
        else audioEngine.seek(audioEngine.getState().currentTime + 5);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        if (e.shiftKey) handlePrev();
        else audioEngine.seek(Math.max(0, audioEngine.getState().currentTime - 5));
      } else if (e.key === 'm' || e.key === 'M') {
        tactile.tap();
        updateSettings({ masterVolume: settings.masterVolume === 0 ? 0.8 : 0 });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleTogglePlayPause, handleNext, handlePrev, settings.masterVolume, updateSettings]);

  const handleToggleFavorite = useCallback((trackId: string) => {
    const current = tracksRef.current.find((t) => t.id === trackId);
    tactile.favorite(current ? !current.favorite : true);
    setTracks((prev) =>
      prev.map((t) => (t.id === trackId ? { ...t, favorite: !t.favorite } : t))
    );
  }, []);

  const handleRateTrack = useCallback((trackId: string, rating: number) => {
    tactile.star(rating);
    setTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, rating } : t)));
  }, []);

  const handleToggleOfflineCache = useCallback(
    async (trackId: string) => {
      const target = tracks.find((t) => t.id === trackId);
      if (!target) return;
      tactile.toggle(!target.offlineCached);
      if (target.offlineCached && target.source === 'local') {
        await deleteAudioBlobFromCache(trackId);
      }
      setTracks((prev) =>
        prev.map((t) => (t.id === trackId ? { ...t, offlineCached: !t.offlineCached } : t))
      );
      await refreshCacheStats();
    },
    [tracks, refreshCacheStats]
  );

  const handleImportFiles = useCallback(
    async (fileList: FileList | File[] | null) => {
      if (!fileList || fileList.length === 0) return;
      setImportingFiles(true);
      const audioExts = /\.(flac|alac|wav|wave|mp3|m4a|aac|ogg|oga|opus)$/i;
      const audioFiles = Array.from(fileList).filter(
        (file) => file.type.startsWith('audio/') || audioExts.test(file.name)
      );

      if (audioFiles.length === 0) {
        setImportingFiles(false);
        return;
      }

      const taskId = `import_${Date.now()}`;
      const totalFiles = audioFiles.length;
      reportTaskProgress(
        taskId,
        'file-import',
        'Importing Audio Files',
        `Reading metadata for ${totalFiles} file(s)...`,
        0,
        totalFiles
      );

      let totalAdded = 0;
      let processed = 0;
      const batchSize = 6;

      try {
        for (let i = 0; i < audioFiles.length; i += batchSize) {
          const slice = audioFiles.slice(i, i + batchSize);
          const parsedBatch = await Promise.all(
            slice.map(async (file) => {
              const parsed = await parseLocalAudioFile(file);
              audioEngine.registerLocalUrl(parsed.id, file);
              void saveAudioBlobToCache(parsed.id, file);
              return parsed;
            })
          );

          processed += slice.length;
          reportTaskProgress(
            taskId,
            'file-import',
            'Importing Audio Files',
            `Imported ${slice[slice.length - 1]?.name || 'audio'} (${processed}/${totalFiles})`,
            processed,
            totalFiles
          );

          if (parsedBatch.length > 0) {
            totalAdded += parsedBatch.length;
            setTracks((prev) => {
              const existingFps = new Set(prev.map((p) => p.fingerprint));
              const uniqueNew = parsedBatch.filter((n) => !existingFps.has(n.fingerprint));
              if (uniqueNew.length === 0) return prev;
              return [...uniqueNew, ...prev];
            });
          }
        }

        if (totalAdded > 0) {
          tactile.success();
          window.setTimeout(() => {
            void refreshCacheStats();
          }, 400);
        }
        reportTaskProgress(
          taskId,
          'file-import',
          'Import Complete',
          `Added ${totalAdded} audio track(s) to library`,
          totalFiles,
          totalFiles,
          'done'
        );
      } catch (err) {
        reportTaskProgress(
          taskId,
          'file-import',
          'Import Failed',
          err instanceof Error ? err.message : 'Unable to import selected files.',
          processed,
          totalFiles,
          'error'
        );
      } finally {
        setImportingFiles(false);
      }
    },
    [refreshCacheStats, reportTaskProgress]
  );

  const handleScanNativeAndroid = useCallback(
    async (silentIfEmpty = false) => {
      if (!isNativeAndroidApp()) return 0;
      const taskId = `native_scan_${Date.now()}`;
      setImportingFiles(true);
      setAudioError(null);
      reportTaskProgress(
        taskId,
        'device-scan',
        'Scanning Device Music Folders',
        'Reading Android MediaStore index...',
        0,
        100
      );
      try {
        const scannedTracks = await scanAndroidDeviceLibrary((prog) => {
          reportTaskProgress(
            taskId,
            'device-scan',
            'Scanning Device Music Folders',
            prog.fileName || 'Scanning audio files...',
            prog.current,
            Math.max(1, prog.total)
          );
        });
        if (scannedTracks.length > 0) {
          setTracks((prev) => {
            const scannedByFp = new Map(scannedTracks.map((t) => [t.fingerprint, t]));
            const updatedPrev = prev.map((existing) => {
              const matched = scannedByFp.get(existing.fingerprint);
              if (!matched) return existing;
              return {
                ...existing,
                source: 'local' as const,
                nativeUri: matched.nativeUri,
                nativePath: matched.nativePath,
                folderPath: matched.folderPath || existing.folderPath,
                offlineCached: true,
              };
            });
            const existingFps = new Set(updatedPrev.map((t) => t.fingerprint));
            const brandNew = scannedTracks.filter((t) => !existingFps.has(t.fingerprint));
            return brandNew.length > 0 ? [...brandNew, ...updatedPrev] : updatedPrev;
          });
          tactile.success();
          reportTaskProgress(
            taskId,
            'device-scan',
            'Device Folder Scan Complete',
            `Loaded ${scannedTracks.length} track(s) from device storage`,
            scannedTracks.length,
            scannedTracks.length,
            'done'
          );
        } else {
          if (!silentIfEmpty) {
            setAudioError('No audio files were found in device storage yet.');
          }
          reportTaskProgress(
            taskId,
            'device-scan',
            'Device Scan Finished',
            'No music tracks found (clips shorter than 10s skipped)',
            1,
            1,
            'done'
          );
        }
        return scannedTracks.length;
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Audio permission is required to scan local music folders.';
        if (!silentIfEmpty) {
          setAudioError(msg);
        }
        reportTaskProgress(taskId, 'device-scan', 'Device Scan Error', msg, 0, 1, 'error');
        return 0;
      } finally {
        setImportingFiles(false);
      }
    },
    [reportTaskProgress]
  );

  // Cloud Sync Actions
  const handleSignInGoogle = async () => {
    const taskId = `auth_${Date.now()}`;
    try {
      setSyncBusy(true);
      setSyncMessage(null);
      reportTaskProgress(
        taskId,
        'cloud-sync',
        'Signing in with Gmail',
        'Authorizing Google account...',
        1,
        2
      );
      const signedUser = await signInWithGoogleAccount();
      tactile.success();
      const cloud = await restoreFromCloud(signedUser);
      if (cloud) {
        setSyncMessage(`Signed in as ${signedUser.email}. Cloud backup ready to restore or sync.`);
      } else {
        setSyncMessage(`Signed in as ${signedUser.email}.`);
      }
      reportTaskProgress(
        taskId,
        'cloud-sync',
        'Gmail Connected',
        signedUser.email || 'Signed in',
        2,
        2,
        'done'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google sign-in cancelled or failed.';
      setSyncMessage(msg);
      reportTaskProgress(taskId, 'cloud-sync', 'Gmail Sign-In Failed', msg, 2, 2, 'error');
    } finally {
      setSyncBusy(false);
    }
  };

  const handleBackupNow = useCallback(
    async (silent = false) => {
      if (!user) return;
      const taskId = `backup_${Date.now()}`;
      if (!silent) {
        setSyncBusy(true);
        reportTaskProgress(
          taskId,
          'cloud-sync',
          'Backing Up to Cloud',
          'Packaging settings, playlists, EQ presets & ratings...',
          1,
          3
        );
      }
      try {
        const snapshotSettings: AppSettings = {
          ...settings,
          lastTrackFingerprint: currentTrack?.fingerprint || settings.lastTrackFingerprint,
          lastPositionSec: Math.round((audioEngine.getState().currentTime || currentTimeRef.current) * 10) / 10,
        };
        if (!silent) {
          reportTaskProgress(
            taskId,
            'cloud-sync',
            'Backing Up to Cloud',
            `Uploading snapshot for ${user.email}...`,
            2,
            3
          );
        }
        const ts = await backupToCloud({
          user,
          settings: snapshotSettings,
          eqPresets,
          playlists,
          smartPlaylists,
          tracks,
          dailyRecommendations: dailyRecs,
        });
        updateSettings({
          lastCloudSyncAt: ts,
          lastTrackFingerprint: snapshotSettings.lastTrackFingerprint,
          lastPositionSec: snapshotSettings.lastPositionSec,
        });
        if (!silent) {
          tactile.success();
          const msg = `Backed up to ${user.email} at ${new Date(ts).toLocaleTimeString()}.`;
          setSyncMessage(msg);
          reportTaskProgress(taskId, 'cloud-sync', 'Cloud Backup Complete', msg, 3, 3, 'done');
        }
      } catch (err) {
        if (!silent) {
          const msg = err instanceof Error ? err.message : 'Cloud backup failed.';
          setSyncMessage(msg);
          reportTaskProgress(taskId, 'cloud-sync', 'Cloud Backup Error', msg, 3, 3, 'error');
        }
      } finally {
        if (!silent) setSyncBusy(false);
      }
    },
    [user, settings, currentTrack, eqPresets, playlists, smartPlaylists, tracks, dailyRecs, updateSettings, reportTaskProgress]
  );

  const handleRestoreNow = async () => {
    if (!user) return;
    const taskId = `restore_${Date.now()}`;
    setSyncBusy(true);
    setSyncMessage(null);
    reportTaskProgress(
      taskId,
      'cloud-sync',
      'Restoring from Cloud',
      `Fetching backup for ${user.email}...`,
      1,
      3
    );
    try {
      const data = await restoreFromCloud(user);
      if (!data) {
        setSyncMessage('No cloud backup found for this Gmail account yet.');
        reportTaskProgress(
          taskId,
          'cloud-sync',
          'Cloud Restore',
          'No cloud backup found for this account yet.',
          3,
          3,
          'done'
        );
        return;
      }
      reportTaskProgress(
        taskId,
        'cloud-sync',
        'Restoring from Cloud',
        'Applying playlists, EQ presets & track ratings...',
        2,
        3
      );
      if (data.settings) {
        updateSettings(data.settings);
      }
      if (Array.isArray(data.eqPresets)) {
        setEqPresets((prev) => {
          const builtIn = prev.filter((p) => p.isBuiltIn);
          return [...builtIn, ...data.eqPresets];
        });
      }
      if (Array.isArray(data.playlists) && data.playlists.length > 0) {
        setPlaylists(data.playlists);
      }
      if (Array.isArray(data.smartPlaylists) && data.smartPlaylists.length > 0) {
        setSmartPlaylists(data.smartPlaylists);
      }
      if (Array.isArray(data.dailyRecommendations) && data.dailyRecommendations.length > 0) {
        setDailyRecs(data.dailyRecommendations);
      }
      if (Array.isArray(data.trackPrefs)) {
        const prefMap = new Map(data.trackPrefs.map((p) => [p.fingerprint, p]));
        setTracks((prev) =>
          prev.map((t) => {
            const p = prefMap.get(t.fingerprint);
            if (!p) return t;
            return {
              ...t,
              favorite: p.favorite,
              rating: p.rating,
              playCount: Math.max(t.playCount, p.playCount || 0),
              title: p.title || t.title,
              artist: p.artist || t.artist,
              album: p.album || t.album,
              genre: p.genre || t.genre,
            };
          })
        );
      }
      if (data.settings?.lastTrackFingerprint) {
        const matched = tracks.find((t) => t.fingerprint === data.settings.lastTrackFingerprint);
        if (matched) {
          const restoredPos = data.settings.lastPositionSec || 0;
          setCurrentTrackId(matched.id);
          currentTimeRef.current = restoredPos;
          const upcoming = getNextTrackInQueue(matched.id, queue);
          void audioEngine.restoreTrackPosition(matched, restoredPos, upcoming, false);
        }
      }
      tactile.success();
      const msg = `Restored settings, playlists, EQ presets, and playback point from ${user.email}.`;
      setSyncMessage(msg);
      reportTaskProgress(taskId, 'cloud-sync', 'Cloud Restore Complete', msg, 3, 3, 'done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Restore failed.';
      setSyncMessage(msg);
      reportTaskProgress(taskId, 'cloud-sync', 'Cloud Restore Error', msg, 3, 3, 'error');
    } finally {
      setSyncBusy(false);
    }
  };

  // Debounced auto-sync when signed in & autoCloudBackup enabled
  useEffect(() => {
    if (!user || !settings.autoCloudBackup) return;
    if (autoBackupTimerRef.current) window.clearTimeout(autoBackupTimerRef.current);
    autoBackupTimerRef.current = window.setTimeout(() => {
      void handleBackupNow(true);
    }, 6000);
    return () => {
      if (autoBackupTimerRef.current) window.clearTimeout(autoBackupTimerRef.current);
    };
  }, [user, settings.autoCloudBackup, playlists, smartPlaylists, eqPresets, handleBackupNow]);

  const normalizedActiveTab = normalizeTab(settings.activeTab);
  const activeWorkspace = getWorkspaceForTab(normalizedActiveTab);
  const activeWorkspaceMeta =
    WORKSPACES.find((w) => w.id === activeWorkspace) || WORKSPACES[0];

  const isLibraryTab = (t: NavigationTab): t is LibraryTab =>
    ['songs', 'albums', 'artists', 'genres', 'playlists', 'folders'].includes(t);

  const getStudioPage = (t: NavigationTab): StudioPage | null => {
    if (t === 'studio-mixes') return 'mixes';
    if (t === 'studio-playlists') return 'playlists';
    if (t === 'studio-duplicates') return 'duplicates';
    if (t === 'studio-tags') return 'tags';
    if (t === 'studio-artwork') return 'artwork';
    return null;
  };

  const getEqPage = (t: NavigationTab): EqualizerPage | null => {
    if (t === 'eq-rack') return 'rack';
    if (t === 'eq-presets') return 'presets';
    return null;
  };

  const getSettingsPage = (t: NavigationTab): SettingsPage | null => {
    if (t === 'settings-audio') return 'audio';
    if (t === 'settings-appearance') return 'appearance';
    if (t === 'settings-storage') return 'storage';
    if (t === 'settings-cloud') return 'cloud';
    return null;
  };

  const upcomingTrack = useMemo(() => {
    if (!currentTrackId || queue.length === 0) return null;
    const idx = queue.findIndex((t) => t.id === currentTrackId);
    if (idx === -1) return queue[0] || null;
    if (idx + 1 < queue.length) return queue[idx + 1];
    return settings.repeatMode === 'all' ? queue[0] : null;
  }, [currentTrackId, queue, settings.repeatMode]);

  const handleChangeLibraryViewMode = useCallback(
    (mode: ViewMode) => {
      setSettings((prev) => ({
        ...prev,
        viewModes: {
          ...prev.viewModes,
          [prev.activeTab as LibraryTab]: mode,
        },
      }));
    },
    []
  );

  const handlePlayFromLibrary = useCallback(
    (track: Track, q: Track[]) => {
      void playTrack(track, q);
    },
    [playTrack]
  );

  const handleToggleOfflineCacheCb = useCallback(
    (id: string) => {
      void handleToggleOfflineCache(id);
    },
    [handleToggleOfflineCache]
  );

  const handleAddTrackToPlaylist = useCallback((trackId: string, playlistId: string) => {
    setPlaylists((prev) =>
      prev.map((pl) =>
        pl.id === playlistId && !pl.trackIds.includes(trackId)
          ? { ...pl, trackIds: [...pl.trackIds, trackId], updatedAt: Date.now() }
          : pl
      )
    );
  }, []);

  const handleCreatePlaylist = useCallback((name: string) => {
    tactile.success();
    setPlaylists((prev) => [
      {
        id: `pl_${Date.now().toString(36)}`,
        name,
        description: 'Custom playlist',
        trackIds: [],
        source: 'local',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      ...prev,
    ]);
  }, []);

  const handleDeletePlaylist = useCallback((playlistId: string) => {
    tactile.tap();
    setPlaylists((prev) => prev.filter((pl) => pl.id !== playlistId));
    setSelectedPlaylistFilter((prev) => (prev === playlistId ? null : prev));
  }, []);

  const handleSelectAlbum = useCallback(
    (album: string | null) => {
      setSelectedAlbumFilter(album);
      if (album) updateSettings({ activeTab: 'songs' });
    },
    [updateSettings]
  );

  const handleSelectArtist = useCallback(
    (artist: string | null) => {
      setSelectedArtistFilter(artist);
      if (artist) updateSettings({ activeTab: 'songs' });
    },
    [updateSettings]
  );

  const handleSelectGenre = useCallback(
    (genre: string | null) => {
      setSelectedGenreFilter(genre);
      if (genre) updateSettings({ activeTab: 'songs' });
    },
    [updateSettings]
  );

  const handleSelectFolder = useCallback(
    (folder: string | null) => {
      setSelectedFolderFilter(folder);
      if (folder) updateSettings({ activeTab: 'songs' });
    },
    [updateSettings]
  );

  const handleSelectPlaylist = useCallback(
    (plId: string | null) => {
      setSelectedPlaylistFilter(plId);
      if (plId) updateSettings({ activeTab: 'songs' });
    },
    [updateSettings]
  );

  const handleOpenFolderImport = useCallback(async () => {
    if (isNativeAndroidApp()) {
      await handleScanNativeAndroid(false);
      return;
    }

    const picker = (
      window as Window & {
        showDirectoryPicker?: (opts?: { mode?: 'read' }) => Promise<{
          name: string;
          values: () => AsyncIterable<{
            kind: 'file' | 'directory';
            name: string;
            getFile?: () => Promise<File>;
            values?: () => AsyncIterable<unknown>;
          }>;
        }>;
      }
    ).showDirectoryPicker;

    if (typeof picker === 'function') {
      try {
        const dirHandle = await picker({ mode: 'read' });
        const audioExts = /\.(flac|alac|wav|wave|mp3|m4a|aac|ogg|oga|opus)$/i;
        const collected: File[] = [];
        const walkTaskId = `folder_walk_${Date.now()}`;
        reportTaskProgress(
          walkTaskId,
          'device-scan',
          'Scanning Music Folder',
          `Opening "${dirHandle.name}"...`,
          0,
          0
        );

        const walk = async (handle: {
          values: () => AsyncIterable<{
            kind: 'file' | 'directory';
            name: string;
            getFile?: () => Promise<File>;
            values?: () => AsyncIterable<unknown>;
          }>;
        }, prefix: string) => {
          for await (const entry of handle.values()) {
            if (entry.kind === 'file' && entry.getFile && audioExts.test(entry.name)) {
              const f = await entry.getFile();
              Object.defineProperty(f, 'webkitRelativePath', {
                value: `${prefix}/${entry.name}`,
                configurable: true,
              });
              collected.push(f);
              if (collected.length % 5 === 1) {
                reportTaskProgress(
                  walkTaskId,
                  'device-scan',
                  'Scanning Music Folder',
                  `Found ${collected.length} track(s): ${entry.name}`,
                  collected.length,
                  collected.length + 5
                );
              }
            } else if (entry.kind === 'directory' && entry.values) {
              await walk(
                entry as typeof handle,
                `${prefix}/${entry.name}`
              );
            }
          }
        };

        await walk(dirHandle, dirHandle.name);
        reportTaskProgress(
          walkTaskId,
          'device-scan',
          'Folder Scan Complete',
          `Found ${collected.length} audio file(s)`,
          Math.max(1, collected.length),
          Math.max(1, collected.length),
          'done'
        );
        if (collected.length > 0) {
          await handleImportFiles(collected);
        }
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        // Fallback to standard file/directory picker if blocked in iframe or unsupported
      }
    }

    folderInputRef.current?.click();
  }, [handleImportFiles, handleScanNativeAndroid, reportTaskProgress]);

  const studioPage = getStudioPage(normalizedActiveTab);
  const eqPage = getEqPage(normalizedActiveTab);
  const settingsPage = getSettingsPage(normalizedActiveTab);

  return (
    <div className="h-dvh w-full overflow-hidden flex flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {/* Hidden File & Folder Pickers */}
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // @ts-expect-error webkitdirectory is supported in Chromium/Safari/Firefox
        webkitdirectory=""
        accept="audio/*,.flac,.alac,.wav,.mp3,.m4a,.aac,.ogg"
        onChange={(e) => {
          void handleImportFiles(e.target.files);
          e.target.value = '';
        }}
        className="hidden"
      />
      <input
        ref={filesInputRef}
        type="file"
        multiple
        accept="audio/*,.flac,.alac,.wav,.mp3,.m4a,.aac,.ogg"
        onChange={(e) => {
          void handleImportFiles(e.target.files);
          e.target.value = '';
        }}
        className="hidden"
      />

      {/* Compact Fixed Top Header */}
      <header
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        className="shrink-0 z-30 border-b border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-md px-3 sm:px-6"
      >
        <div className="h-12 sm:h-14 flex items-center justify-between gap-2 sm:gap-6">
          <div className="flex items-baseline gap-1.5 whitespace-nowrap shrink-0">
            <span className="text-base sm:text-lg font-display font-bold tracking-tight">
              AuraSound
            </span>
            <span className="text-[11px] font-mono-tabular text-zinc-500 dark:text-zinc-400">
              {APP_VERSION}
            </span>
          </div>

          {/* Desktop/Tablet Inline Search */}
          <div className="hidden sm:block relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search songs, artists, Lithuanian or Cyrillic..."
              aria-label="Search library"
              className="w-full min-h-[38px] pl-9 pr-8 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  tactile.tap();
                  setSearchQuery('');
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-zinc-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              aria-label="Toggle search"
              onClick={() => {
                tactile.tap();
                setMobileSearchOpen((v) => !v);
              }}
              className={`sm:hidden min-w-[38px] min-h-[38px] rounded-lg flex items-center justify-center border transition-colors ${
                mobileSearchOpen || searchQuery
                  ? 'border-amber-500/50 bg-amber-500/10 accent-text'
                  : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300'
              }`}
            >
              <Search className="w-4 h-4" />
            </button>

            <PWAInstallButton />

            <button
              type="button"
              onClick={() => {
                tactile.tap();
                if (isNativeAndroidApp()) {
                  void handleScanNativeAndroid(false);
                } else {
                  filesInputRef.current?.click();
                }
              }}
              disabled={importingFiles}
              className="min-h-[38px] px-3 sm:px-3.5 py-1.5 rounded-lg accent-bg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              {isNativeAndroidApp() ? <FolderOpen className="w-3.5 h-3.5" /> : <Upload className="w-3.5 h-3.5" />}
              <span>
                {importingFiles
                  ? 'Scanning...'
                  : isNativeAndroidApp()
                  ? 'Scan Music'
                  : 'Add Audio'}
              </span>
            </button>
          </div>
        </div>

        {/* Collapsible Mobile Search Row */}
        {(mobileSearchOpen || searchQuery.length > 0) && (
          <div className="sm:hidden pb-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search songs, artists, albums..."
                aria-label="Search library"
                className="w-full min-h-[36px] pl-8 pr-8 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              />
              {(searchQuery || mobileSearchOpen) && (
                <button
                  type="button"
                  aria-label="Close search"
                  onClick={() => {
                    tactile.tap();
                    setSearchQuery('');
                    setMobileSearchOpen(false);
                  }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-zinc-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Middle Unscrollable Workspace (Desktop Sidebar + Page Viewport) */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Desktop Sidebar */}
        <aside className="hidden md:flex flex-col justify-between w-56 shrink-0 border-r border-zinc-200 dark:border-zinc-800 p-3 bg-white/50 dark:bg-zinc-950 overflow-hidden">
          <div className="space-y-3 overflow-hidden">
            {WORKSPACES.map((group) => (
              <div key={group.id} className="space-y-0.5">
                <div className="px-2.5 pb-0.5 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                  {group.title}
                </div>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = normalizedActiveTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        tactile.tap();
                        updateSettings({ activeTab: item.id });
                      }}
                      className={`w-full min-h-[32px] px-2.5 rounded-lg text-xs font-medium flex items-center gap-2.5 active:scale-[0.98] transition-all duration-100 whitespace-nowrap ${
                        active
                          ? 'accent-soft-bg'
                          : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 hover:text-zinc-900 dark:hover:text-zinc-100'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Sidebar Bottom Quick Controls */}
          <div className="pt-2.5 border-t border-zinc-200 dark:border-zinc-800 space-y-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                tactile.tap();
                void handleOpenFolderImport();
              }}
              className="w-full min-h-[34px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium flex items-center gap-2 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 active:scale-[0.98] transition-transform duration-100"
            >
              <FolderOpen className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Scan Music Folder</span>
            </button>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const nextMode = settings.themeMode === 'dark' ? 'light' : 'dark';
                  tactile.toggle(nextMode === 'dark');
                  updateSettings({ themeMode: nextMode });
                }}
                aria-label="Toggle dark mode"
                className="flex-1 min-h-[34px] px-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium flex items-center justify-center gap-1 hover:bg-zinc-100 dark:hover:bg-zinc-900 active:scale-95 transition-transform duration-100"
              >
                {settings.themeMode === 'dark' ? (
                  <Moon className="w-3.5 h-3.5" />
                ) : (
                  <Sun className="w-3.5 h-3.5" />
                )}
                <span>{settings.themeMode === 'dark' ? 'Dark' : 'Light'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  tactile.toggle(!settings.offlineMode);
                  updateSettings({ offlineMode: !settings.offlineMode });
                }}
                aria-label="Toggle offline mode"
                className={`flex-1 min-h-[34px] px-2 rounded-lg border text-xs font-medium flex items-center justify-center gap-1 active:scale-95 transition-all duration-100 ${
                  settings.offlineMode
                    ? 'border-amber-500/60 bg-amber-500/10 accent-text'
                    : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900'
                }`}
              >
                <WifiOff className="w-3.5 h-3.5" />
                <span>Offline</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                tactile.tap();
                if (user) updateSettings({ activeTab: 'settings-cloud' });
                else void handleSignInGoogle();
              }}
              className="w-full min-h-[34px] px-2.5 rounded-lg bg-zinc-100 dark:bg-zinc-900 text-xs font-medium flex items-center gap-2 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 active:scale-[0.98] transition-transform duration-100 truncate"
            >
              <Cloud className="w-3.5 h-3.5 accent-text shrink-0" />
              <span className="truncate">{user ? user.email : 'Sign in with Gmail'}</span>
            </button>
          </div>
        </aside>

        {/* Main Viewport Panel */}
        <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          {/* Mobile 2-Tier Unscrollable Navigation (Zero Horizontal Scroll) */}
          <div className="md:hidden shrink-0 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 py-1.5 space-y-1">
            {/* Tier 1: Workspaces */}
            <div className="grid grid-cols-4 gap-1 p-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-900">
              {WORKSPACES.map((ws) => {
                const active = activeWorkspace === ws.id;
                return (
                  <button
                    key={ws.id}
                    type="button"
                    onClick={() => {
                      tactile.tap();
                      updateSettings({ activeTab: ws.items[0].id });
                    }}
                    className={`min-h-[30px] px-1 rounded-md text-[11px] font-semibold whitespace-nowrap transition-colors ${
                      active
                        ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                        : 'text-zinc-500 dark:text-zinc-400'
                    }`}
                  >
                    {ws.mobileTitle}
                  </button>
                );
              })}
            </div>

            {/* Tier 2: Sub-Pages inside Active Workspace */}
            <nav
              aria-label="Section pages"
              style={{
                gridTemplateColumns: `repeat(${activeWorkspaceMeta.items.length}, minmax(0, 1fr))`,
              }}
              className="grid gap-1"
            >
              {activeWorkspaceMeta.items.map((item) => {
                const active = normalizedActiveTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      tactile.tap();
                      updateSettings({ activeTab: item.id });
                    }}
                    className={`min-h-[30px] px-1 rounded-md text-[11px] font-medium whitespace-nowrap truncate transition-colors ${
                      active
                        ? 'accent-soft-bg'
                        : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    {item.shortLabel}
                  </button>
                );
              })}
            </nav>
          </div>

          {audioError && (
            <div className="shrink-0 mx-3 sm:mx-5 mt-2 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-2">
              <span className="truncate">{audioError}</span>
              <button
                type="button"
                onClick={() => setAudioError(null)}
                className="text-xs underline shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Fixed Active Page Container (100% overflow-hidden) */}
          <div className="flex-1 min-h-0 p-3 sm:p-5 overflow-hidden flex flex-col">
            {isLibraryTab(normalizedActiveTab) && (
              <LibraryBrowser
                tab={normalizedActiveTab}
                viewMode={settings.viewModes[normalizedActiveTab]}
                tracks={visibleTracks}
                playlists={playlists}
                currentTrackId={currentTrackId}
                isPlaying={isPlaying}
                selectedAlbumFilter={selectedAlbumFilter}
                selectedArtistFilter={selectedArtistFilter}
                selectedGenreFilter={selectedGenreFilter}
                selectedFolderFilter={selectedFolderFilter}
                selectedPlaylistFilter={selectedPlaylistFilter}
                onChangeViewMode={handleChangeLibraryViewMode}
                onPlayTrack={handlePlayFromLibrary}
                onPlayAll={playCollectionQueue}
                onToggleFavorite={handleToggleFavorite}
                onRateTrack={handleRateTrack}
                onToggleOfflineCache={handleToggleOfflineCacheCb}
                onAddTrackToPlaylist={handleAddTrackToPlaylist}
                onCreatePlaylist={handleCreatePlaylist}
                onDeletePlaylist={handleDeletePlaylist}
                onSelectAlbum={handleSelectAlbum}
                onSelectArtist={handleSelectArtist}
                onSelectGenre={handleSelectGenre}
                onSelectFolder={handleSelectFolder}
                onSelectPlaylist={handleSelectPlaylist}
                onImportLocalFolder={handleOpenFolderImport}
              />
            )}

            {studioPage && (
              <SmartStudioView
                page={studioPage}
                user={user}
                tracks={tracks}
                smartPlaylists={smartPlaylists}
                dailyRecommendations={dailyRecs}
                onSignInGoogle={() => void handleSignInGoogle()}
                onPlayTracks={(list, random = false) => playCollectionQueue(list, random)}
                onAddSmartPlaylist={(pl) => setSmartPlaylists((prev) => [pl, ...prev])}
                onDeleteSmartPlaylist={(id) =>
                  setSmartPlaylists((prev) => prev.filter((p) => p.id !== id))
                }
                onUpdateDailyRecommendations={setDailyRecs}
                onApplyTagCleanups={(suggestions: TagCleanupSuggestion[]) => {
                  const map = new Map(suggestions.map((s) => [s.trackId, s]));
                  setTracks((prev) =>
                    prev.map((t) => {
                      const s = map.get(t.id);
                      if (!s) return t;
                      return {
                        ...t,
                        title: s.suggestedTitle,
                        artist: s.suggestedArtist,
                        album: s.suggestedAlbum,
                        genre: s.suggestedGenre,
                      };
                    })
                  );
                }}
                onRemoveDuplicateTracks={(trackIds: string[]) => {
                  const removeSet = new Set(trackIds);
                  setTracks((prev) => prev.filter((t) => !removeSet.has(t.id)));
                  setQueue((prev) => prev.filter((t) => !removeSet.has(t.id)));
                  if (currentTrackId && removeSet.has(currentTrackId)) {
                    const remaining = tracksRef.current.filter((t) => !removeSet.has(t.id));
                    setCurrentTrackId(remaining[0]?.id || null);
                  }
                }}
                onApplyArtworkUpdates={(updates) => {
                  const map = new Map(updates.map((u) => [u.trackId, u.coverUrl]));
                  setTracks((prev) =>
                    prev.map((t) => {
                      const nextCover = map.get(t.id);
                      return nextCover ? { ...t, coverUrl: nextCover } : t;
                    })
                  );
                }}
                onTaskProgress={reportTaskProgress}
              />
            )}

            {eqPage && (
              <EqualizerPanel
                page={eqPage}
                enabled={settings.eqEnabled}
                bands={settings.activeEqBands}
                preampDb={settings.eqPreampDb}
                activePresetId={settings.activeEqPresetId}
                presets={eqPresets}
                onChangePage={(p) =>
                  updateSettings({ activeTab: p === 'rack' ? 'eq-rack' : 'eq-presets' })
                }
                onToggleEnabled={() => updateSettings({ eqEnabled: !settings.eqEnabled })}
                onChangeBand={(idx, db) => {
                  const next = [...settings.activeEqBands];
                  next[idx] = db;
                  updateSettings({ activeEqBands: next, activeEqPresetId: 'custom' });
                }}
                onChangePreamp={(db) =>
                  updateSettings({ eqPreampDb: db, activeEqPresetId: 'custom' })
                }
                onSelectPreset={(preset) =>
                  updateSettings({
                    activeEqPresetId: preset.id,
                    activeEqBands: [...preset.bands],
                    eqPreampDb: preset.preampDb,
                  })
                }
                onSaveCustomPreset={(name) => {
                  const id = `eq_${Date.now().toString(36)}`;
                  setEqPresets((prev) => [
                    ...prev,
                    {
                      id,
                      name,
                      preampDb: settings.eqPreampDb,
                      bands: [...settings.activeEqBands],
                    },
                  ]);
                  updateSettings({ activeEqPresetId: id });
                }}
                onDeletePreset={(id) => {
                  setEqPresets((prev) => prev.filter((p) => p.id !== id));
                  if (settings.activeEqPresetId === id) {
                    updateSettings({
                      activeEqPresetId: 'flat',
                      activeEqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                      eqPreampDb: 0,
                    });
                  }
                }}
                onResetFlat={() =>
                  updateSettings({
                    activeEqPresetId: 'flat',
                    activeEqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                    eqPreampDb: 0,
                  })
                }
              />
            )}

            {settingsPage && (
              <SettingsCloudView
                page={settingsPage}
                user={user}
                settings={settings}
                cacheStats={cacheStats}
                syncBusy={syncBusy}
                syncMessage={syncMessage}
                syncProgress={syncProgress}
                storageProgress={storageProgress}
                onUpdateSettings={updateSettings}
                onSignInGoogle={() => void handleSignInGoogle()}
                onSignOutGoogle={() => void signOutGoogleAccount()}
                onBackupNow={() => void handleBackupNow(false)}
                onRestoreNow={() => void handleRestoreNow()}
                onClearCache={() => {
                  tactile.tap();
                  const taskId = `clear_cache_${Date.now()}`;
                  reportTaskProgress(
                    taskId,
                    'library-maintenance',
                    'Clearing Offline Cache',
                    'Removing cached audio blobs...',
                    1,
                    2
                  );
                  void clearAudioCache().then(() => {
                    setTracks((prev) =>
                      prev.map((t) =>
                        t.source === 'local' ? { ...t, offlineCached: false } : t
                      )
                    );
                    void refreshCacheStats();
                    reportTaskProgress(
                      taskId,
                      'library-maintenance',
                      'Offline Cache Cleared',
                      'Freed device offline storage',
                      2,
                      2,
                      'done'
                    );
                  });
                }}
                onRepairCyrillicLibrary={() => {
                  tactile.success();
                  const taskId = `repair_${Date.now()}`;
                  const total = tracksRef.current.length;
                  reportTaskProgress(
                    taskId,
                    'library-maintenance',
                    'Repairing Cyrillic & Mojibake Tags',
                    `Fixing encoding across ${total} tracks...`,
                    total,
                    Math.max(1, total)
                  );
                  setTracks((prev) =>
                    prev.map((t) => ({
                      ...t,
                      title: repairMojibakeText(t.title),
                      artist: repairMojibakeText(t.artist),
                      album: repairMojibakeText(t.album),
                      genre: repairMojibakeText(t.genre),
                    }))
                  );
                  setSyncMessage('Scanned and repaired Cyrillic / Windows-1251 tags across library.');
                  reportTaskProgress(
                    taskId,
                    'library-maintenance',
                    'Tag Encoding Repair Complete',
                    `Checked ${total} track(s)`,
                    Math.max(1, total),
                    Math.max(1, total),
                    'done'
                  );
                }}
              />
            )}
          </div>
        </main>
      </div>

      {/* Floating Homescreen Widget (2 Sizes & Top-of-Screen Views) */}
      <HomescreenWidget
        visible={settings.showHomescreenWidget}
        variant={settings.widgetVariant || 'top-bar'}
        track={currentTrack}
        isPlaying={isPlaying}
        onTogglePlay={() => void handleTogglePlayPause()}
        onPrev={handlePrev}
        onNext={handleNext}
        onToggleFavorite={handleToggleFavorite}
        onChangeVariant={(variant) => updateSettings({ widgetVariant: variant })}
        onExpand={() => {
          tactile.sheet(true);
          setNowPlayingOpen(true);
        }}
        onClose={() => {
          tactile.toggle(false);
          updateSettings({ showHomescreenWidget: false });
        }}
      />

      {/* Persistent Bottom Hi-Fi Player Bar (flex-shrink-0 slot guarantees exact remaining height above) */}
      <PlayerBar
        track={currentTrack}
        isPlaying={isPlaying}
        isLoading={isLoadingAudio}
        shuffle={settings.shuffle}
        repeatMode={settings.repeatMode}
        volume={settings.masterVolume}
        onTogglePlay={() => void handleTogglePlayPause()}
        onPrev={handlePrev}
        onNext={handleNext}
        onToggleShuffle={() => {
          tactile.toggle(!settings.shuffle);
          updateSettings({ shuffle: !settings.shuffle });
        }}
        onCycleRepeat={() => {
          const nextRepeat =
            settings.repeatMode === 'off'
              ? 'all'
              : settings.repeatMode === 'all'
              ? 'one'
              : 'off';
          tactile.toggle(nextRepeat !== 'off');
          updateSettings({ repeatMode: nextRepeat });
        }}
        onChangeVolume={(v) => updateSettings({ masterVolume: v })}
        onToggleFavorite={handleToggleFavorite}
        onOpenNowPlaying={() => {
          tactile.sheet(true);
          setNowPlayingOpen(true);
        }}
        onPeekSheet={(dyNeg) => nowPlayingSheetRef.current?.peekFromBottom(dyNeg)}
        onReleaseSheetPeek={(commitOpen) =>
          nowPlayingSheetRef.current?.releaseFromBottom(commitOpen)
        }
        onOpenEqualizer={() => {
          tactile.tap();
          updateSettings({ activeTab: 'eq-rack' });
        }}
        onOpenCast={() => {
          tactile.sheet(true);
          setCastOpen(true);
        }}
        onOpenShare={() => {
          tactile.sheet(true);
          setShareOpen(true);
        }}
      />

      {/* Fullscreen Now Playing Deck */}
      <NowPlayingView
        ref={nowPlayingSheetRef}
        open={nowPlayingOpen}
        track={currentTrack}
        nextTrack={upcomingTrack}
        queue={queue}
        isPlaying={isPlaying}
        shuffle={settings.shuffle}
        repeatMode={settings.repeatMode}
        volume={settings.masterVolume}
        lowBatteryMode={settings.lowBatteryMode}
        streamingQuality={settings.streamingQuality}
        onClose={() => {
          tactile.sheet(false);
          setNowPlayingOpen(false);
        }}
        onTogglePlay={() => void handleTogglePlayPause()}
        onPrev={handlePrev}
        onNext={handleNext}
        onPlayQueueTrack={(qt) => void playTrack(qt, queue)}
        onToggleShuffle={() => {
          tactile.toggle(!settings.shuffle);
          updateSettings({ shuffle: !settings.shuffle });
        }}
        onCycleRepeat={() => {
          const nextRepeat =
            settings.repeatMode === 'off'
              ? 'all'
              : settings.repeatMode === 'all'
              ? 'one'
              : 'off';
          tactile.toggle(nextRepeat !== 'off');
          updateSettings({ repeatMode: nextRepeat });
        }}
        onChangeVolume={(v) => updateSettings({ masterVolume: v })}
        onToggleFavorite={handleToggleFavorite}
        onRateTrack={handleRateTrack}
        onOpenEqualizer={() => {
          tactile.tap();
          updateSettings({ activeTab: 'eq-rack' });
        }}
        onOpenCast={() => {
          tactile.sheet(true);
          setCastOpen(true);
        }}
        onOpenShare={() => {
          tactile.sheet(true);
          setShareOpen(true);
        }}
        onGoToAlbum={(album) => {
          tactile.tap();
          setSelectedArtistFilter(null);
          setSelectedGenreFilter(null);
          setSelectedFolderFilter(null);
          setSelectedPlaylistFilter(null);
          setSelectedAlbumFilter(album);
          updateSettings({ activeTab: 'songs' });
        }}
        onGoToArtist={(artist) => {
          tactile.tap();
          setSelectedAlbumFilter(null);
          setSelectedGenreFilter(null);
          setSelectedFolderFilter(null);
          setSelectedPlaylistFilter(null);
          setSelectedArtistFilter(artist);
          updateSettings({ activeTab: 'songs' });
        }}
      />

      {/* Modals */}
      <CastModal
        open={castOpen}
        onClose={() => {
          tactile.sheet(false);
          setCastOpen(false);
        }}
      />

      <ShareModal
        open={shareOpen}
        track={currentTrack}
        onClose={() => {
          tactile.sheet(false);
          setShareOpen(false);
        }}
      />

      <TaskProgressDock tasks={activeTasks} onDismiss={dismissTask} />

      <OfflineIndicator />
    </div>
  );
}
