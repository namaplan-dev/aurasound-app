import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  Cloud,
  Disc,
  FolderOpen,
  ListMusic,
  Mic2,
  Moon,
  Music,
  Search,
  Settings,
  Sliders,
  Sparkles,
  Sun,
  Tag,
  Upload,
  WifiOff,
  X,
} from 'lucide-react';
import {
  AppSettings,
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
import { EqualizerPanel } from './components/EqualizerPanel';
import { SmartStudioView } from './components/SmartStudioView';
import { SettingsCloudView } from './components/SettingsCloudView';
import { PlayerBar } from './components/PlayerBar';
import { NowPlayingView } from './components/NowPlayingView';
import { HomescreenWidget } from './components/HomescreenWidget';
import { CastModal } from './components/CastModal';
import { ShareModal } from './components/ShareModal';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';
import { tactile } from './services/tactileFeedback';
import { isNativeAndroidApp, scanAndroidDeviceLibrary } from './services/nativeScanner';

interface NavItem {
  id: NavigationTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_GROUPS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Library',
    items: [
      { id: 'songs', label: 'Songs', icon: Music },
      { id: 'albums', label: 'Albums', icon: Disc },
      { id: 'artists', label: 'Artists', icon: Mic2 },
      { id: 'genres', label: 'Genres', icon: Tag },
      { id: 'playlists', label: 'Playlists', icon: ListMusic },
      { id: 'folders', label: 'Folders', icon: FolderOpen },
    ],
  },
  {
    title: 'Studio & Sound',
    items: [
      { id: 'studio', label: 'Smart Studio', icon: Sparkles },
      { id: 'equalizer', label: 'Equalizer', icon: Sliders },
    ],
  },
  {
    title: 'System',
    items: [{ id: 'settings', label: 'Settings', icon: Settings }],
  },
];

const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

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

  // Overlays & Modals
  const [nowPlayingOpen, setNowPlayingOpen] = useState<boolean>(
    () => Boolean(initialSessionRef.current?.nowPlayingOpen)
  );
  const [castOpen, setCastOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  // Import & Cloud status
  const [importingFiles, setImportingFiles] = useState(false);
  const [cacheStats, setCacheStats] = useState({ count: 0, totalBytes: 0 });
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const autoBackupTimerRef = useRef<number | null>(null);
  const mainScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const mainScrollTimerRef = useRef<number | null>(null);
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

  // Persist library state
  useEffect(() => {
    saveTracks(tracks);
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

    if (mainScrollContainerRef.current && mainScrollTopRef.current > 0) {
      requestAnimationFrame(() => {
        if (mainScrollContainerRef.current) {
          mainScrollContainerRef.current.scrollTop = mainScrollTopRef.current;
        }
      });
    }

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
    audioEngine.prewarmTracks(tracks);
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
      persistSessionSnapshot(true);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        persistSessionSnapshot(true);
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
      if (mainScrollTimerRef.current) {
        window.clearTimeout(mainScrollTimerRef.current);
      }
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

      let totalAdded = 0;
      const batchSize = 8;

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
      } finally {
        setImportingFiles(false);
      }
    },
    [refreshCacheStats]
  );

  const handleScanNativeAndroid = useCallback(
    async (silentIfEmpty = false) => {
      if (!isNativeAndroidApp()) return 0;
      setImportingFiles(true);
      setAudioError(null);
      try {
        const scannedTracks = await scanAndroidDeviceLibrary();
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
        } else if (!silentIfEmpty) {
          setAudioError('No audio files were found in device storage yet.');
        }
        return scannedTracks.length;
      } catch (err) {
        if (!silentIfEmpty) {
          setAudioError(
            err instanceof Error
              ? err.message
              : 'Audio permission is required to scan local music folders.'
          );
        }
        return 0;
      } finally {
        setImportingFiles(false);
      }
    },
    []
  );

  const autoScannedAndroidRef = useRef(false);
  useEffect(() => {
    if (!isNativeAndroidApp() || autoScannedAndroidRef.current) return;
    autoScannedAndroidRef.current = true;
    const hasNativeTracks = tracksRef.current.some((t) => t.source === 'local' && Boolean(t.nativeUri));
    if (!hasNativeTracks) {
      void handleScanNativeAndroid(true);
    }
  }, [handleScanNativeAndroid]);

  // Cloud Sync Actions
  const handleSignInGoogle = async () => {
    try {
      setSyncBusy(true);
      setSyncMessage(null);
      const signedUser = await signInWithGoogleAccount();
      tactile.success();
      // Auto-check if cloud backup exists on sign-in
      const cloud = await restoreFromCloud(signedUser);
      if (cloud) {
        setSyncMessage(`Signed in as ${signedUser.email}. Cloud backup ready to restore or sync.`);
      } else {
        setSyncMessage(`Signed in as ${signedUser.email}.`);
      }
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : 'Google sign-in cancelled or failed.');
    } finally {
      setSyncBusy(false);
    }
  };

  const handleBackupNow = useCallback(
    async (silent = false) => {
      if (!user) return;
      if (!silent) setSyncBusy(true);
      try {
        const snapshotSettings: AppSettings = {
          ...settings,
          lastTrackFingerprint: currentTrack?.fingerprint || settings.lastTrackFingerprint,
          lastPositionSec: Math.round((audioEngine.getState().currentTime || currentTimeRef.current) * 10) / 10,
        };
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
          setSyncMessage(`Backed up to ${user.email} at ${new Date(ts).toLocaleTimeString()}.`);
        }
      } catch (err) {
        if (!silent) {
          setSyncMessage(err instanceof Error ? err.message : 'Cloud backup failed.');
        }
      } finally {
        if (!silent) setSyncBusy(false);
      }
    },
    [user, settings, currentTrack, eqPresets, playlists, smartPlaylists, tracks, dailyRecs, updateSettings]
  );

  const handleRestoreNow = async () => {
    if (!user) return;
    setSyncBusy(true);
    setSyncMessage(null);
    try {
      const data = await restoreFromCloud(user);
      if (!data) {
        setSyncMessage('No cloud backup found for this Gmail account yet.');
        return;
      }
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
      setSyncMessage(`Restored settings, playlists, EQ presets, and playback point from ${user.email}.`);
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : 'Restore failed.');
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

  const isLibraryTab = (t: NavigationTab): t is LibraryTab =>
    ['songs', 'albums', 'artists', 'genres', 'playlists', 'folders'].includes(t);

  const upcomingTrack = useMemo(() => {
    if (!currentTrackId || queue.length === 0) return null;
    const idx = queue.findIndex((t) => t.id === currentTrackId);
    if (idx === -1) return queue[0] || null;
    if (idx + 1 < queue.length) return queue[idx + 1];
    return settings.repeatMode === 'all' ? queue[0] : null;
  }, [currentTrackId, queue, settings.repeatMode]);

  const handleLibraryScrollChange = useCallback(
    (scrollTop: number) => {
      libraryScrollTopRef.current = scrollTop;
      persistSessionSnapshot(false);
    },
    [persistSessionSnapshot]
  );

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
            } else if (entry.kind === 'directory' && entry.values) {
              await walk(
                entry as typeof handle,
                `${prefix}/${entry.name}`
              );
            }
          }
        };

        await walk(dirHandle, dirHandle.name);
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
  }, [handleImportFiles, handleScanNativeAndroid]);

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
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

      {/* Top Bar (Clean 3-Zone Contract: Brand — Search — Primary Action) */}
      <header className="sticky top-0 z-30 h-14 sm:h-16 border-b border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between gap-4 sm:gap-8">
        <span className="text-lg font-display font-bold tracking-tight whitespace-nowrap shrink-0">
          AuraSound
        </span>

        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search songs, artists, Lithuanian or Cyrillic..."
            aria-label="Search library"
            className="w-full min-h-[40px] pl-9 pr-8 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40"
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

        <div className="flex items-center gap-2 shrink-0">
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
            className="min-h-[40px] px-3.5 sm:px-4 py-2 rounded-lg accent-bg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0"
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
      </header>

      {/* Main Workspace (Sidebar + Viewport) */}
      <div className="flex-1 flex min-h-0 pb-20 sm:pb-24">
        {/* Desktop Sidebar */}
        <aside className="hidden md:flex flex-col justify-between w-60 shrink-0 border-r border-zinc-200 dark:border-zinc-800 p-4 bg-white/50 dark:bg-zinc-950">
          <div className="space-y-5">
            {NAV_GROUPS.map((group) => (
              <div key={group.title} className="space-y-1">
                <div className="px-3 pb-1 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                  {group.title}
                </div>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = settings.activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        tactile.tap();
                        updateSettings({ activeTab: item.id });
                      }}
                      className={`w-full min-h-[40px] px-3 rounded-lg text-sm font-medium flex items-center gap-3 active:scale-[0.98] transition-all duration-100 whitespace-nowrap ${
                        active
                          ? 'accent-soft-bg'
                          : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 hover:text-zinc-900 dark:hover:text-zinc-100'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}

            <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => {
                  tactile.tap();
                  void handleOpenFolderImport();
                }}
                className="w-full min-h-[40px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium flex items-center gap-2.5 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 active:scale-[0.98] transition-transform duration-100"
              >
                <FolderOpen className="w-4 h-4 shrink-0" />
                <span>Scan Music Folder</span>
              </button>
            </div>
          </div>

          {/* Sidebar Bottom Quick Controls */}
          <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const nextMode = settings.themeMode === 'dark' ? 'light' : 'dark';
                  tactile.toggle(nextMode === 'dark');
                  updateSettings({ themeMode: nextMode });
                }}
                aria-label="Toggle dark mode"
                className="flex-1 min-h-[40px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium flex items-center justify-center gap-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 active:scale-95 transition-transform duration-100"
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
                className={`flex-1 min-h-[40px] px-3 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 active:scale-95 transition-all duration-100 ${
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
                if (user) updateSettings({ activeTab: 'settings' });
                else void handleSignInGoogle();
              }}
              className="w-full min-h-[40px] px-3 rounded-lg bg-zinc-100 dark:bg-zinc-900 text-xs font-medium flex items-center gap-2 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 active:scale-[0.98] transition-transform duration-100 truncate"
            >
              <Cloud className="w-3.5 h-3.5 accent-text shrink-0" />
              <span className="truncate">{user ? user.email : 'Sign in with Gmail'}</span>
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 min-w-0 flex flex-col">
          {/* Mobile Horizontal Tab Strip */}
          <nav
            aria-label="Primary navigation"
            className="md:hidden flex items-center gap-1 overflow-x-auto px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shrink-0"
          >
            {NAV_ITEMS.map((item) => {
              const active = settings.activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    tactile.tap();
                    updateSettings({ activeTab: item.id });
                  }}
                  className={`min-h-[36px] px-3 rounded-md text-xs font-medium whitespace-nowrap shrink-0 active:scale-95 transition-all duration-100 ${
                    active
                      ? 'accent-soft-bg'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {audioError && (
            <div className="mx-4 sm:mx-6 mt-3 px-4 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-3">
              <span>{audioError}</span>
              <button
                type="button"
                onClick={() => setAudioError(null)}
                className="text-xs underline shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          <div
            ref={mainScrollContainerRef}
            onScroll={() => {
              if (!mainScrollContainerRef.current) return;
              if (mainScrollTimerRef.current) window.clearTimeout(mainScrollTimerRef.current);
              mainScrollTimerRef.current = window.setTimeout(() => {
                if (mainScrollContainerRef.current) {
                  mainScrollTopRef.current = Math.round(mainScrollContainerRef.current.scrollTop);
                  persistSessionSnapshot(false);
                }
              }, 120);
            }}
            className="flex-1 min-h-0 p-4 sm:p-6 overflow-y-auto"
          >
            {isLibraryTab(settings.activeTab) && (
              <LibraryBrowser
                tab={settings.activeTab}
                viewMode={settings.viewModes[settings.activeTab]}
                tracks={visibleTracks}
                playlists={playlists}
                currentTrackId={currentTrackId}
                isPlaying={isPlaying}
                selectedAlbumFilter={selectedAlbumFilter}
                selectedArtistFilter={selectedArtistFilter}
                selectedGenreFilter={selectedGenreFilter}
                selectedFolderFilter={selectedFolderFilter}
                selectedPlaylistFilter={selectedPlaylistFilter}
                initialScrollTop={libraryScrollTopRef.current}
                onScrollChange={handleLibraryScrollChange}
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

            {settings.activeTab === 'studio' && (
              <SmartStudioView
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
              />
            )}

            {settings.activeTab === 'equalizer' && (
              <EqualizerPanel
                enabled={settings.eqEnabled}
                bands={settings.activeEqBands}
                preampDb={settings.eqPreampDb}
                activePresetId={settings.activeEqPresetId}
                presets={eqPresets}
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

            {settings.activeTab === 'settings' && (
              <SettingsCloudView
                user={user}
                settings={settings}
                cacheStats={cacheStats}
                syncBusy={syncBusy}
                syncMessage={syncMessage}
                onUpdateSettings={updateSettings}
                onSignInGoogle={() => void handleSignInGoogle()}
                onSignOutGoogle={() => void signOutGoogleAccount()}
                onBackupNow={() => void handleBackupNow(false)}
                onRestoreNow={() => void handleRestoreNow()}
                onClearCache={() => {
                  tactile.tap();
                  void clearAudioCache().then(() => {
                    setTracks((prev) =>
                      prev.map((t) =>
                        t.source === 'local' ? { ...t, offlineCached: false } : t
                      )
                    );
                    void refreshCacheStats();
                  });
                }}
                onRepairCyrillicLibrary={() => {
                  tactile.success();
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
                }}
              />
            )}
          </div>
        </main>
      </div>

      {/* Floating Homescreen Widget */}
      <HomescreenWidget
        visible={settings.showHomescreenWidget}
        track={currentTrack}
        isPlaying={isPlaying}
        onTogglePlay={() => void handleTogglePlayPause()}
        onPrev={handlePrev}
        onNext={handleNext}
        onToggleFavorite={handleToggleFavorite}
        onExpand={() => {
          tactile.sheet(true);
          setNowPlayingOpen(true);
        }}
        onClose={() => {
          tactile.toggle(false);
          updateSettings({ showHomescreenWidget: false });
        }}
      />

      {/* Persistent Bottom Hi-Fi Player Bar */}
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
        onOpenEqualizer={() => {
          tactile.tap();
          updateSettings({ activeTab: 'equalizer' });
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
        open={nowPlayingOpen}
        track={currentTrack}
        nextTrack={upcomingTrack}
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
          updateSettings({ activeTab: 'equalizer' });
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

      <OfflineIndicator />
    </div>
  );
}
