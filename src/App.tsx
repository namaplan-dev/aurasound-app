import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  Cloud,
  CopyCheck,
  Disc,
  FolderOpen,
  HardDrive,
  ImagePlus,
  Info,
  ListMusic,
  Mic2,
  Moon,
  Music,
  Palette,
  Sliders,
  Smartphone,
  Sparkles,
  Sun,
  Tag,
  Upload,
  Volume2,
  Wand2,
  WifiOff,
} from 'lucide-react';
import {
  AppSettings,
  AppTaskCategory,
  AppTaskProgress,
  DailyRecommendation,
  EQPreset,
  NavigationTab,
  Playlist,
  ScanFolderEntry,
  SessionState,
  SmartPlaylist,
  TagCleanupSuggestion,
  TaskItemProgress,
  Track,
  ViewMode,
} from './types/music';
import { audioEngine } from './services/audioEngine';
import { auth } from './services/firebaseClient';
import {
  backupToCloud,
  completeRedirectSignInIfAny,
  formatCloudAuthError,
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
  folderMatchesAllowedList,
  loadDailyRecommendations,
  loadEqPresets,
  loadPlaylists,
  loadSession,
  loadSettings,
  loadSmartPlaylists,
  loadTracks,
  normalizeFolderKey,
  saveCustomEqPresets,
  saveDailyRecommendations,
  savePlaylists,
  saveSession,
  saveSettings,
  saveSmartPlaylists,
  saveTracks,
} from './services/storageService';
import { repairMojibakeText } from './utils/textNormalization';
import {
  applyTagSuggestionsToList,
  buildAiQuotaStateFromPayload,
  fetchLyricsForTrack,
  resolveApiUrl,
  setActiveAiQuotaState,
} from './services/aiAssistantService';
import { broadcastKaraokeCastState } from './services/karaokeCastChannel';
import { AiQuotaNotice, useAiQuotaCountdown } from './components/AiQuotaNotice';
import { LibraryBrowser, LibraryTab, TrackMetadataPatch } from './components/LibraryBrowser';
import {
  parseM3uPlaylist,
  exportPlaylistAsM3u8,
} from './services/playlistFileService';
import {
  deleteNativeAudioFiles,
  isNativeAndroidApp,
  listAndroidMusicFolders,
  pickAndroidMusicFolder,
  scanAndroidDeviceLibrary,
  writeNativeAudioTags,
} from './services/nativeScanner';
import {
  deleteScanFolderHandle,
  deleteTracksFromWebFolder,
  ensureDirectoryReadPermission,
  getAllScanFolderHandles,
  saveScanFolderHandle,
  saveTrackFileHandle,
  writeTracksTagsToWebStorage,
} from './services/localFileHandleService';
import { AudioTagUpdate } from './services/audioTagWriter';
import { applyTrackAsRingtone } from './services/ringtoneService';
import { EqualizerPage, EqualizerPanel } from './components/EqualizerPanel';
import { SmartStudioView, StudioPage } from './components/SmartStudioView';
import { SettingsCloudView, SettingsPage } from './components/SettingsCloudView';
import { SlidablePageViewport, SlidableTabStrip } from './components/SlidableTabs';
import { PlayerBar } from './components/PlayerBar';
import { NowPlayingSheetHandle, NowPlayingView } from './components/NowPlayingView';
import { KaraokeReceiverDisplayScreen } from './components/KaraokeLyricsView';
import { HomescreenWidget } from './components/HomescreenWidget';
import { CastModal } from './components/CastModal';
import { ShareModal } from './components/ShareModal';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';
import { TaskProgressDock } from './components/TaskProgressDock';
import { tactile } from './services/tactileFeedback';
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
      { id: 'settings-devices', label: 'Devices & Power', shortLabel: 'Device', icon: Sliders },
      { id: 'settings-theme', label: 'Theme & Touch', shortLabel: 'Theme', icon: Palette },
      { id: 'settings-widgets', label: 'Widgets', shortLabel: 'Widget', icon: Smartphone },
      { id: 'settings-storage', label: 'Folders & Cache', shortLabel: 'Folders', icon: HardDrive },
      { id: 'settings-cloud', label: 'Cloud Sync', shortLabel: 'Cloud', icon: Cloud },
    ],
  },
];

function normalizeTab(tab: NavigationTab): NavigationTab {
  if (tab === 'studio') return 'studio-mixes';
  if (tab === 'equalizer') return 'eq-rack';
  if (tab === 'settings') return 'settings-audio';
  if (tab === 'settings-appearance') return 'settings-theme';
  return tab;
}

function getWorkspaceForTab(tab: NavigationTab): WorkspaceId {
  const clean = normalizeTab(tab);
  if (clean.startsWith('studio-')) return 'studio';
  if (clean.startsWith('eq-')) return 'equalizer';
  if (clean.startsWith('settings-')) return 'settings';
  return 'library';
}

function MainApp() {
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

  // Overlays & Modals — restore exact open/closed state and deck page from previous session
  const [nowPlayingOpen, setNowPlayingOpen] = useState<boolean>(
    () => initialSessionRef.current?.nowPlayingOpen ?? true
  );
  const [nowPlayingDeckPage, setNowPlayingDeckPage] = useState<'player' | 'queue'>(
    () => initialSessionRef.current?.nowPlayingDeckPage ?? 'player'
  );
  const [libraryStartIndices, setLibraryStartIndices] = useState<
    Partial<Record<LibraryTab, number>>
  >(() => initialSessionRef.current?.libraryStartIndices || {});
  const [scanningFolders, setScanningFolders] = useState(false);
  const [fetchingLyrics, setFetchingLyrics] = useState(false);
  const [tvStageOpen, setTvStageOpen] = useState(false);
  const [castOpen, setCastOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareMode, setShareMode] = useState<'track' | 'app'>('track');

  // Import, Cloud & Global Task Progress state
  const [importingFiles, setImportingFiles] = useState(false);
  const [cacheStats, setCacheStats] = useState({ count: 0, totalBytes: 0 });
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [activeTasks, setActiveTasks] = useState<AppTaskProgress[]>([]);
  const [noChangesToast, setNoChangesToast] = useState<{ id: number; message: string } | null>(
    null
  );
  const taskCleanupTimersRef = useRef<Map<string, number>>(new Map());
  const nowPlayingSheetRef = useRef<NowPlayingSheetHandle | null>(null);

  const showNoChangesToast = useCallback((message = 'No changes were made') => {
    setNoChangesToast({ id: Date.now(), message });
  }, []);

  useEffect(() => {
    if (!noChangesToast) return;
    const dismissTimer = window.setTimeout(() => {
      setNoChangesToast(null);
    }, 3000);

    const dismissOnInteraction = () => {
      setNoChangesToast(null);
    };

    let listenersAttached = false;
    const attachTimer = window.setTimeout(() => {
      listenersAttached = true;
      document.addEventListener('pointerdown', dismissOnInteraction, true);
      document.addEventListener('keydown', dismissOnInteraction, true);
    }, 120);

    return () => {
      window.clearTimeout(dismissTimer);
      window.clearTimeout(attachTimer);
      if (listenersAttached) {
        document.removeEventListener('pointerdown', dismissOnInteraction, true);
        document.removeEventListener('keydown', dismissOnInteraction, true);
      }
    };
  }, [noChangesToast]);

  const globalAiQuotaCountdown = useAiQuotaCountdown();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const resp = await fetch(resolveApiUrl('/api/ai/status'));
        if (!resp.ok || cancelled) return;
        const data = (await resp.json().catch(() => ({}))) as {
          available?: boolean;
          quota?: Record<string, unknown>;
        };
        if (!cancelled && data.available === false && data.quota) {
          setActiveAiQuotaState(
            buildAiQuotaStateFromPayload({
              error: data.quota.message,
              retryAfterSeconds: data.quota.retryAfterSeconds,
              resetAtIso: data.quota.resetAtIso,
              quotaScope: data.quota.quotaScope,
            })
          );
        }
      } catch {
        // Ignore startup check when offline
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      status: 'running' | 'done' | 'error' = 'running',
      item?: TaskItemProgress
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
        itemLabel: item?.label,
        itemCurrent: item?.current,
        itemTotal: item?.total,
        itemPercent: item?.percent,
        status,
        updatedAt: Date.now(),
      };

      setActiveTasks((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        if (idx === -1) return [...prev.slice(-2), entry];
        const next = [...prev];
        next[idx] = entry;
        return next;
      });

      const oldTimer = taskCleanupTimersRef.current.get(id);
      if (oldTimer) {
        window.clearTimeout(oldTimer);
        taskCleanupTimersRef.current.delete(id);
      }
      if (status !== 'running') {
        const timer = window.setTimeout(() => {
          dismissTask(id);
        }, status === 'done' ? 3500 : 6000);
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

  // Apply theme, accent & tactile preferences synchronously and flush settings reliably
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
    }, 60);

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

  // Subscribe to Firebase Auth state & complete any redirect sign-in on Web
  useEffect(() => {
    void completeRedirectSignInIfAny();
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
    nowPlayingDeckPage,
    libraryStartIndices,
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
    nowPlayingDeckPage,
    libraryStartIndices,
  };

  const persistSessionSnapshot = useCallback((alsoSaveSettingsFingerprint = false) => {
    const snap = latestSnapshotRef.current;
    const engineState = audioEngine.getState();
    const playbackSec = Math.max(
      0,
      Math.round((engineState.currentTime || currentTimeRef.current) * 10) / 10
    );
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
      nowPlayingDeckPage: snap.nowPlayingDeckPage,
      libraryStartIndices: snap.libraryStartIndices,
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

  // Continuously record playback progress (~500ms), sync Cast Karaoke display & flush on lifecycle events
  const emitKaraokeCastSnapshot = useCallback(
    (timeOverrideSec?: number) => {
      const snap = latestSnapshotRef.current;
      const track = snap.currentTrack;
      if (!track) return;
      broadcastKaraokeCastState({
        trackId: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album,
        coverUrl: track.coverUrl,
        lyrics: track.lyrics,
        currentTime: timeOverrideSec ?? currentTimeRef.current,
        duration: track.duration || 180,
        isPlaying: snap.isPlaying,
        updatedAtMs: Date.now(),
        karaokeOffsetMs: snap.settings.karaokeOffsetMs || 0,
        themeAccent: snap.settings.themeAccent,
        themeMode: snap.settings.themeMode,
      });
    },
    []
  );

  useEffect(() => {
    emitKaraokeCastSnapshot();
  }, [
    currentTrack,
    isPlaying,
    settings.karaokeOffsetMs,
    settings.themeAccent,
    settings.themeMode,
    emitKaraokeCastSnapshot,
  ]);

  useEffect(() => {
    const unsubProgress = audioEngine.subscribeProgress(({ currentTime }) => {
      currentTimeRef.current = currentTime;
      emitKaraokeCastSnapshot(currentTime);
      const now = Date.now();
      if (now - lastSessionSaveMsRef.current >= 500) {
        lastSessionSaveMsRef.current = now;
        persistSessionSnapshot(false);
      }
    });

    const handleLifecycleFlush = () => {
      if (settingsSaveTimerRef.current) {
        window.clearTimeout(settingsSaveTimerRef.current);
        settingsSaveTimerRef.current = null;
      }
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
    window.addEventListener('blur', handleLifecycleFlush);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      unsubProgress();
      window.removeEventListener('beforeunload', handleLifecycleFlush);
      window.removeEventListener('pagehide', handleLifecycleFlush);
      window.removeEventListener('blur', handleLifecycleFlush);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [persistSessionSnapshot, emitKaraokeCastSnapshot]);

  // Persist immediately whenever navigation/playback/filter/overlay/page state changes
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
    nowPlayingDeckPage,
    libraryStartIndices,
    persistSessionSnapshot,
  ]);

  // Visible tracks respect Offline Mode and Selected Folders whitelist
  const visibleTracks = useMemo(() => {
    let list = tracks;
    if (settings.offlineMode) {
      list = list.filter((t) => t.offlineCached || t.source === 'local');
    }
    if (settings.onlyScanSelectedFolders && (settings.selectedScanFolders?.length || 0) > 0) {
      const enabledPaths = (settings.selectedScanFolders || [])
        .filter((f) => f.enabled)
        .map((f) => f.path);
      list = list.filter(
        (t) => t.source !== 'local' || folderMatchesAllowedList(t.folderPath, enabledPaths)
      );
    }
    return list;
  }, [
    tracks,
    settings.offlineMode,
    settings.onlyScanSelectedFolders,
    settings.selectedScanFolders,
  ]);

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
      if (track.eqPresetId) {
        const assignedPreset = eqPresets.find((p) => p.id === track.eqPresetId);
        if (assignedPreset) {
          updateSettings({
            activeEqPresetId: assignedPreset.id,
            activeEqBands: [...assignedPreset.bands],
            eqPreampDb: assignedPreset.preampDb,
            eqEnabled: true,
          });
        }
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
    [queue, getNextTrackInQueue, eqPresets, updateSettings]
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

  const advanceToNextTrack = useCallback(
    (isManualSkip: boolean) => {
      if (isManualSkip && currentTrackId) {
        const now = Date.now();
        setTracks((prev) =>
          prev.map((t) =>
            t.id === currentTrackId
              ? { ...t, skipCount: (t.skipCount || 0) + 1, lastSkippedAt: now }
              : t
          )
        );
      }
      const activeQ = queue.length > 0 ? queue : visibleTracks;
      if (activeQ.length === 0) return;
      if (settings.repeatMode === 'one' && currentTrack) {
        void playTrack(currentTrack, activeQ);
        return;
      }
      const next = getNextTrackInQueue(currentTrackId, activeQ);
      if (next) void playTrack(next, activeQ);
    },
    [queue, visibleTracks, settings.repeatMode, currentTrack, currentTrackId, getNextTrackInQueue, playTrack]
  );

  const handleNext = useCallback(() => {
    advanceToNextTrack(true);
  }, [advanceToNextTrack]);

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
      advanceToNextTrack(false);
    });
  }, [handlePrev, handleNext, advanceToNextTrack]);

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

  const handlePlayNext = useCallback(
    (track: Track) => {
      setQueue((prev) => {
        const filtered = prev.filter((t) => t.id !== track.id);
        if (!currentTrackId) return [track, ...filtered];
        const curIdx = filtered.findIndex((t) => t.id === currentTrackId);
        if (curIdx === -1) return [track, ...filtered];
        return [...filtered.slice(0, curIdx + 1), track, ...filtered.slice(curIdx + 1)];
      });
    },
    [currentTrackId]
  );

  const handlePlayNextMany = useCallback(
    (items: Track[]) => {
      if (items.length === 0) return;
      const incomingIds = new Set(items.map((t) => t.id));
      setQueue((prev) => {
        const filtered = prev.filter((t) => !incomingIds.has(t.id));
        if (!currentTrackId) return [...items, ...filtered];
        const curIdx = filtered.findIndex((t) => t.id === currentTrackId);
        if (curIdx === -1) return [...items, ...filtered];
        return [...filtered.slice(0, curIdx + 1), ...items, ...filtered.slice(curIdx + 1)];
      });
    },
    [currentTrackId]
  );

  const handleAddToQueue = useCallback((track: Track) => {
    setQueue((prev) => {
      const filtered = prev.filter((t) => t.id !== track.id);
      return [...filtered, track];
    });
  }, []);

  const handleAddTracksToQueue = useCallback((items: Track[]) => {
    if (items.length === 0) return;
    const incomingIds = new Set(items.map((t) => t.id));
    setQueue((prev) => {
      const filtered = prev.filter((t) => !incomingIds.has(t.id));
      return [...filtered, ...items];
    });
  }, []);

  const handlePlaySingleTrack = useCallback(
    (track: Track) => {
      updateSettings({ shuffle: false });
      void playTrack(track, [track]);
    },
    [playTrack, updateSettings]
  );

  const handleShuffleFromTrack = useCallback(
    (track: Track) => {
      const pool = visibleTracks.filter((t) => t.id !== track.id);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      updateSettings({ shuffle: true });
      void playTrack(track, [track, ...pool]);
    },
    [visibleTracks, playTrack, updateSettings]
  );

  const handleAssignEqPreset = useCallback(
    (trackIds: string[], presetId: string | undefined) => {
      if (trackIds.length === 0) return;
      const targetSet = new Set(trackIds);
      setTracks((prev) =>
        prev.map((t) => (targetSet.has(t.id) ? { ...t, eqPresetId: presetId } : t))
      );
      setQueue((prev) =>
        prev.map((t) => (targetSet.has(t.id) ? { ...t, eqPresetId: presetId } : t))
      );
      if (presetId) {
        const preset = eqPresets.find((p) => p.id === presetId);
        if (preset) {
          updateSettings({
            activeEqPresetId: preset.id,
            activeEqBands: [...preset.bands],
            eqPreampDb: preset.preampDb,
            eqEnabled: true,
          });
        }
      }
      tactile.success();
    },
    [eqPresets, updateSettings]
  );

  const handleSetRingtone = useCallback(
    async (track: Track) => {
      const taskId = `ringtone_${Date.now()}`;
      reportTaskProgress(
        taskId,
        'library-maintenance',
        'Setting Ringtone',
        `Preparing "${track.title}" as ringtone...`,
        1,
        2,
        'running',
        { label: track.title, current: 1, total: 2, percent: 50 }
      );
      try {
        const res = await applyTrackAsRingtone(track);
        if (res.ok) {
          tactile.success();
          reportTaskProgress(
            taskId,
            'library-maintenance',
            'Ringtone Ready',
            res.message,
            2,
            2,
            'done',
            { label: res.message, current: 2, total: 2, percent: 100 }
          );
        } else {
          reportTaskProgress(
            taskId,
            'library-maintenance',
            'Ringtone Notice',
            res.message,
            2,
            2,
            'error',
            { label: res.message, current: 2, total: 2, percent: 100 }
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to set ringtone.';
        reportTaskProgress(
          taskId,
          'library-maintenance',
          'Ringtone Failed',
          msg,
          2,
          2,
          'error',
          { label: msg, current: 2, total: 2, percent: 100 }
        );
      }
    },
    [reportTaskProgress]
  );

  const persistTracksTagsToSource = useCallback(
    async (updatedTracks: Track[]) => {
      if (updatedTracks.length === 0) return;
      const localTargets = updatedTracks.filter((t) => t.source === 'local');
      if (localTargets.length === 0) return;

      const taskId = `tag_write_${Date.now()}`;
      reportTaskProgress(
        taskId,
        'library-maintenance',
        'Writing Tags to Source Files',
        `Updating embedded tags for ${localTargets.length} file(s)...`,
        0,
        localTargets.length,
        'running',
        { label: localTargets[0]?.title || 'Preparing audio files...', current: 0, total: 1, percent: 0 }
      );

      try {
        if (isNativeAndroidApp()) {
          const payload = localTargets
            .filter((t) => t.nativeUri || t.nativePath)
            .map((t) => ({
              contentUri: t.nativeUri,
              filePath: t.nativePath,
              title: t.title,
              artist: t.artist,
              album: t.album,
              genre: t.genre,
              year: t.year || '',
              composer: t.composer || '',
              lyrics: t.lyrics || '',
            }));

          const res = await writeNativeAudioTags(payload, (prog) => {
            reportTaskProgress(
              taskId,
              'library-maintenance',
              'Writing Tags to Source Files',
              `Saving ${prog.current} of ${prog.total} file(s)`,
              prog.current,
              Math.max(1, prog.total),
              'running',
              { label: prog.fileName, current: 1, total: 1, percent: 100 }
            );
          });

          if (res.cancelled) {
            reportTaskProgress(
              taskId,
              'library-maintenance',
              'Source Write Permission Declined',
              'Tags saved inside AuraSound; grant Android write prompt to embed in external files.',
              localTargets.length,
              localTargets.length,
              'error',
              { label: 'Permission declined', current: 1, total: 1, percent: 100 }
            );
            return;
          }

          reportTaskProgress(
            taskId,
            'library-maintenance',
            'Audio Tags Saved to Device Files',
            `Embedded tags in ${res.updatedCount} file(s) & refreshed Android MediaStore`,
            localTargets.length,
            localTargets.length,
            'done',
            { label: `${res.updatedCount} source file(s) updated`, current: 1, total: 1, percent: 100 }
          );
          return;
        }

        const webItems = localTargets.map((t) => ({
          track: t,
          tags: {
            title: t.title,
            artist: t.artist,
            album: t.album,
            genre: t.genre,
            year: t.year,
            composer: t.composer,
            lyrics: t.lyrics || '',
          } satisfies AudioTagUpdate,
        }));

        const summary = await writeTracksTagsToWebStorage(webItems, (curr, tot, label) => {
          reportTaskProgress(
            taskId,
            'library-maintenance',
            'Writing Tags to Source Files',
            `Embedding tags (${curr}/${tot})`,
            curr,
            tot,
            'running',
            { label, current: 1, total: 1, percent: 100 }
          );
        });

        const detailMsg =
          summary.diskWrittenCount > 0
            ? `Embedded tags directly into ${summary.diskWrittenCount} disk file(s)`
            : summary.cacheUpdatedCount > 0
            ? `Updated tags in ${summary.cacheUpdatedCount} cached file(s) (use Scan Music Folder to write directly to disk)`
            : `Updated metadata in library (${summary.unsupportedFormatCount} format(s) read-only on Web)`;

        reportTaskProgress(
          taskId,
          'library-maintenance',
          'Tag Update Complete',
          detailMsg,
          localTargets.length,
          localTargets.length,
          summary.permissionDeniedCount > 0 && summary.diskWrittenCount === 0 ? 'error' : 'done',
          { label: detailMsg, current: 1, total: 1, percent: 100 }
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to write audio tags to source files.';
        reportTaskProgress(
          taskId,
          'library-maintenance',
          'Source Tag Write Error',
          msg,
          localTargets.length,
          localTargets.length,
          'error',
          { label: msg, current: 1, total: 1, percent: 100 }
        );
      }
    },
    [reportTaskProgress]
  );

  const handleEditTracksMetadata = useCallback(
    (trackIds: string[], patch: TrackMetadataPatch) => {
      if (trackIds.length === 0) return;
      const targetSet = new Set(trackIds);
      const changedTracks: Track[] = [];

      const applyPatch = (t: Track): Track => {
        if (!targetSet.has(t.id)) return t;
        const next: Track = {
          ...t,
          title: patch.title !== undefined && patch.title.trim() ? patch.title.trim() : t.title,
          artist: patch.artist !== undefined && patch.artist.trim() ? patch.artist.trim() : t.artist,
          album: patch.album !== undefined && patch.album.trim() ? patch.album.trim() : t.album,
          genre: patch.genre !== undefined && patch.genre.trim() ? patch.genre.trim() : t.genre,
          year: patch.year !== undefined ? patch.year.trim() || undefined : t.year,
          composer: patch.composer !== undefined ? patch.composer.trim() || undefined : t.composer,
          lyrics: patch.lyrics !== undefined ? patch.lyrics.trim() || undefined : t.lyrics,
        };
        changedTracks.push(next);
        return next;
      };

      const nextList = tracksRef.current.map(applyPatch);
      setTracks(nextList);
      setQueue((prev) => prev.map((t) => {
        const updated = changedTracks.find((c) => c.id === t.id);
        return updated || t;
      }));
      tactile.success();

      if (changedTracks.length > 0) {
        void persistTracksTagsToSource(changedTracks);
      }
    },
    [persistTracksTagsToSource]
  );

  const handleApplyTagCleanups = useCallback(
    (suggestions: TagCleanupSuggestion[]) => {
      if (suggestions.length === 0) return;
      const sugIds = new Set(suggestions.map((s) => s.trackId));
      const nextTracks = applyTagSuggestionsToList(tracksRef.current, suggestions);
      setTracks(nextTracks);
      setQueue((prev) => applyTagSuggestionsToList(prev, suggestions));
      const updatedSubset = nextTracks.filter((t) => sugIds.has(t.id));
      if (updatedSubset.length > 0) {
        void persistTracksTagsToSource(updatedSubset);
      }
    },
    [persistTracksTagsToSource]
  );

  const handleFetchTrackLyrics = useCallback(
    async (targetTrack: Track) => {
      if (fetchingLyrics) return;
      setFetchingLyrics(true);
      const taskId = `lyrics_fetch_${targetTrack.id}`;
      reportTaskProgress(
        taskId,
        'ai-tags',
        'Finding Karaoke Lyrics',
        `Searching synced lyrics for "${targetTrack.title}"...`,
        1,
        3,
        'running',
        { label: `${targetTrack.artist} — ${targetTrack.title}`, current: 1, total: 3, percent: 33 }
      );
      try {
        const result = await fetchLyricsForTrack(targetTrack);
        if (!result || !result.lyrics) {
          showNoChangesToast('No lyrics found for this song yet');
          dismissTask(taskId);
          return;
        }
        const updatedTrack: Track = { ...targetTrack, lyrics: result.lyrics };
        setTracks((prev) => prev.map((t) => (t.id === targetTrack.id ? updatedTrack : t)));
        setQueue((prev) => prev.map((t) => (t.id === targetTrack.id ? updatedTrack : t)));
        void persistTracksTagsToSource([updatedTrack]);
        tactile.success();
        reportTaskProgress(
          taskId,
          'ai-tags',
          result.synced ? 'Synced Karaoke Lyrics Added' : 'Lyrics Added to File',
          `Embedded from ${result.source}`,
          3,
          3,
          'done',
          { label: `${targetTrack.title}`, current: 3, total: 3, percent: 100 }
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to fetch lyrics right now.';
        reportTaskProgress(
          taskId,
          'ai-tags',
          'Lyrics Lookup Paused',
          msg,
          3,
          3,
          'error',
          { label: msg, current: 3, total: 3, percent: 100 }
        );
      } finally {
        setFetchingLyrics(false);
      }
    },
    [fetchingLyrics, reportTaskProgress, dismissTask, persistTracksTagsToSource, showNoChangesToast]
  );

  const handleDeleteTracks = useCallback(
    (trackIds: string[]) => {
      if (trackIds.length === 0) return;
      void (async () => {
        const removeSet = new Set(trackIds);
        const targetTracks = tracksRef.current.filter((t) => removeSet.has(t.id));
        if (targetTracks.length === 0) return;

        const taskId = `delete_${Date.now()}`;
        reportTaskProgress(
          taskId,
          'library-maintenance',
          'Deleting Audio Files',
          `Removing ${targetTracks.length} track(s) from source folder & library...`,
          1,
          2,
          'running',
          { label: targetTracks[0]?.title || 'Deleting files...', current: 1, total: 2, percent: 50 }
        );

        let resultSummary = `Deleted ${targetTracks.length} track(s) from library`;

        if (isNativeAndroidApp()) {
          const nativeTargets = targetTracks.filter((t) => t.nativeUri || t.nativePath);
          if (nativeTargets.length > 0) {
            try {
              const res = await deleteNativeAudioFiles(nativeTargets);
              if (res.cancelled) {
                reportTaskProgress(
                  taskId,
                  'library-maintenance',
                  'Delete Cancelled',
                  'Android storage permission was declined — source files were kept.',
                  2,
                  2,
                  'error',
                  { label: 'No files were deleted', current: 2, total: 2, percent: 100 }
                );
                return;
              }
              resultSummary = `Permanently deleted ${res.deletedCount} file(s) from device storage`;
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Unable to delete source files on Android.';
              reportTaskProgress(
                taskId,
                'library-maintenance',
                'Delete Failed',
                msg,
                2,
                2,
                'error',
                { label: msg, current: 2, total: 2, percent: 100 }
              );
              return;
            }
          }
        } else {
          const webSummary = await deleteTracksFromWebFolder(targetTracks);
          if (webSummary.diskDeletedCount > 0) {
            resultSummary = `Deleted ${webSummary.diskDeletedCount} file(s) from source folder`;
          } else if (webSummary.permissionDeniedCount > 0) {
            reportTaskProgress(
              taskId,
              'library-maintenance',
              'Folder Write Permission Declined',
              'Grant disk write permission when deleting to remove files from your source folder.',
              2,
              2,
              'error',
              { label: 'Permission declined', current: 2, total: 2, percent: 100 }
            );
            return;
          }
        }

        const remaining = tracksRef.current.filter((t) => !removeSet.has(t.id));
        trackIds.forEach((id) => {
          void deleteAudioBlobFromCache(id);
        });

        setTracks(remaining);
        setQueue((prev) => prev.filter((t) => !removeSet.has(t.id)));
        setPlaylists((prev) =>
          prev.map((pl) => ({
            ...pl,
            trackIds: pl.trackIds.filter((id) => !removeSet.has(id)),
          }))
        );

        if (selectedAlbumFilter && !remaining.some((t) => t.album === selectedAlbumFilter)) {
          setSelectedAlbumFilter(null);
        }
        if (selectedArtistFilter && !remaining.some((t) => t.artist === selectedArtistFilter)) {
          setSelectedArtistFilter(null);
        }
        if (selectedGenreFilter && !remaining.some((t) => t.genre === selectedGenreFilter)) {
          setSelectedGenreFilter(null);
        }
        if (
          selectedFolderFilter &&
          !remaining.some((t) => (t.folderPath || 'Local Imports') === selectedFolderFilter)
        ) {
          setSelectedFolderFilter(null);
        }

        if (currentTrackId && removeSet.has(currentTrackId)) {
          const nextTrack = remaining[0] || null;
          setCurrentTrackId(nextTrack?.id || null);
          if (!nextTrack && isPlaying) {
            void audioEngine.togglePlayPause();
          }
        }
        void refreshCacheStats();
        tactile.success();
        reportTaskProgress(
          taskId,
          'library-maintenance',
          'Files Deleted',
          resultSummary,
          2,
          2,
          'done',
          { label: resultSummary, current: 2, total: 2, percent: 100 }
        );
      })();
    },
    [
      currentTrackId,
      isPlaying,
      refreshCacheStats,
      reportTaskProgress,
      selectedAlbumFilter,
      selectedArtistFilter,
      selectedFolderFilter,
      selectedGenreFilter,
    ]
  );

  const handleImportM3uFiles = useCallback(
    async (fileList: FileList | File[], baseTracks?: Track[]) => {
      const m3uFiles = Array.from(fileList).filter((f) => /\.(m3u8?|pls)$/i.test(f.name));
      if (m3uFiles.length === 0) return;

      const lookupLibrary = baseTracks && baseTracks.length > 0 ? baseTracks : tracksRef.current;
      const importedPlaylists: Playlist[] = [];
      let totalMatched = 0;

      for (const file of m3uFiles) {
        try {
          const text = await file.text();
          const parsed = parseM3uPlaylist(file.name, text, lookupLibrary);
          if (parsed.matchedTrackIds.length > 0 || parsed.totalEntries > 0) {
            totalMatched += parsed.matchedTrackIds.length;
            importedPlaylists.push({
              id: `pl_m3u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
              name: parsed.playlistName,
              description: `Imported M3U (${parsed.matchedTrackIds.length}/${parsed.totalEntries} matched)`,
              trackIds: parsed.matchedTrackIds,
              source: 'local',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
          }
        } catch {
          // ignore unreadable playlist file
        }
      }

      if (importedPlaylists.length > 0) {
        setPlaylists((prev) => {
          const existingByName = new Map(prev.map((p) => [p.name.toLowerCase(), p]));
          const additions: Playlist[] = [];
          const mergedIds = new Map<string, string[]>();

          for (const imp of importedPlaylists) {
            const existing = existingByName.get(imp.name.toLowerCase());
            if (existing) {
              const combined = Array.from(new Set([...existing.trackIds, ...imp.trackIds]));
              mergedIds.set(existing.id, combined);
            } else {
              additions.push(imp);
            }
          }

          const updatedExisting = prev.map((p) =>
            mergedIds.has(p.id)
              ? { ...p, trackIds: mergedIds.get(p.id) || p.trackIds, updatedAt: Date.now() }
              : p
          );
          return [...additions, ...updatedExisting];
        });
        tactile.success();
        reportTaskProgress(
          `m3u_${Date.now()}`,
          'file-import',
          'M3U Playlists Imported',
          `Loaded ${importedPlaylists.length} playlist(s) · ${totalMatched} matched track(s)`,
          1,
          1,
          'done',
          { label: importedPlaylists[0].name, current: 1, total: 1, percent: 100 }
        );
      }
    },
    [reportTaskProgress]
  );

  const handleImportFiles = useCallback(
    async (
      fileList: FileList | File[] | null,
      existingTaskId?: string,
      webHandlesMap?: Map<File, { fileHandle: FileSystemFileHandle; dirHandle: FileSystemDirectoryHandle; fileName: string }>,
      extraM3uFiles?: File[]
    ) => {
      if (!fileList || fileList.length === 0) {
        if (extraM3uFiles && extraM3uFiles.length > 0) {
          await handleImportM3uFiles(extraM3uFiles);
        }
        return;
      }
      setImportingFiles(true);
      const audioExts = /\.(flac|alac|wav|wave|mp3|m4a|aac|ogg|oga|opus)$/i;
      const m3uExts = /\.(m3u8?|pls)$/i;
      const allFiles = Array.from(fileList);
      const audioFiles = allFiles.filter(
        (file) => file.type.startsWith('audio/') || audioExts.test(file.name)
      );
      const discoveredM3us = [
        ...allFiles.filter((file) => m3uExts.test(file.name)),
        ...(extraM3uFiles || []),
      ];

      if (audioFiles.length === 0) {
        setImportingFiles(false);
        if (discoveredM3us.length > 0) {
          await handleImportM3uFiles(discoveredM3us);
        }
        return;
      }

      const taskId = existingTaskId || `import_${Date.now()}`;
      const totalFiles = audioFiles.length;
      reportTaskProgress(
        taskId,
        'file-import',
        'Importing Audio Files',
        `Reading metadata for ${totalFiles} file(s)...`,
        0,
        totalFiles,
        'running',
        { label: audioFiles[0]?.name || 'Preparing files...', current: 0, total: 1, percent: 0 }
      );

      let totalAdded = 0;
      let processed = 0;
      const batchSize = 6;
      const allNewlyParsed: Track[] = [];

      try {
        for (let i = 0; i < audioFiles.length; i += batchSize) {
          const slice = audioFiles.slice(i, i + batchSize);
          const parsedBatch: Track[] = [];
          for (let j = 0; j < slice.length; j++) {
            const file = slice[j];
            reportTaskProgress(
              taskId,
              'file-import',
              'Importing Audio Files',
              `Track ${processed + j + 1} of ${totalFiles}`,
              processed + j,
              totalFiles,
              'running',
              { label: file.name, current: 1, total: 2, percent: 50 }
            );
            const parsed = await parseLocalAudioFile(file);
            audioEngine.registerLocalUrl(parsed.id, file);
            void saveAudioBlobToCache(parsed.id, file);
            const handleMeta = webHandlesMap?.get(file);
            if (handleMeta) {
              void saveTrackFileHandle(
                parsed.id,
                handleMeta.fileName,
                handleMeta.fileHandle,
                handleMeta.dirHandle
              );
            }
            parsedBatch.push(parsed);
            allNewlyParsed.push(parsed);
            reportTaskProgress(
              taskId,
              'file-import',
              'Importing Audio Files',
              `Cached ${processed + j + 1} of ${totalFiles}`,
              processed + j + 1,
              totalFiles,
              'running',
              { label: parsed.title || file.name, current: 2, total: 2, percent: 100 }
            );
          }

          processed += slice.length;

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

        if (discoveredM3us.length > 0) {
          const combinedLibrary = [...allNewlyParsed, ...tracksRef.current];
          await handleImportM3uFiles(discoveredM3us, combinedLibrary);
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
          'done',
          { label: `${totalAdded} track(s) ready`, current: 1, total: 1, percent: 100 }
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to import selected files.';
        reportTaskProgress(
          taskId,
          'file-import',
          'Import Failed',
          msg,
          processed,
          totalFiles,
          'error',
          { label: msg, current: 1, total: 1, percent: 100 }
        );
      } finally {
        setImportingFiles(false);
      }
    },
    [handleImportM3uFiles, refreshCacheStats, reportTaskProgress]
  );

  const pruneTracksToAllowedFolders = useCallback(
    (allowedPaths: string[]) => {
      const removedIds = new Set<string>();
      const remaining = tracksRef.current.filter((t) => {
        if (t.source !== 'local') return true;
        const ok = folderMatchesAllowedList(t.folderPath, allowedPaths);
        if (!ok) removedIds.add(t.id);
        return ok;
      });
      if (removedIds.size === 0) return 0;

      setTracks(remaining);
      setQueue((prev) => {
        const filtered = prev.filter((t) => !removedIds.has(t.id));
        return filtered.length > 0 ? filtered : remaining;
      });
      if (currentTrackId && removedIds.has(currentTrackId)) {
        const nextTrack = remaining[0] || null;
        setCurrentTrackId(nextTrack?.id || null);
        if (!nextTrack && audioEngine.getState().isPlaying) {
          void audioEngine.togglePlayPause();
        }
      }
      if (
        selectedFolderFilter &&
        !folderMatchesAllowedList(selectedFolderFilter, allowedPaths)
      ) {
        setSelectedFolderFilter(null);
      }
      return removedIds.size;
    },
    [currentTrackId, selectedFolderFilter]
  );

  const handleScanNativeAndroid = useCallback(
    async (silentIfEmpty = false, overrideAllowedFolders?: string[]) => {
      if (!isNativeAndroidApp()) return 0;

      const latestSettings = latestSnapshotRef.current.settings;
      const useWhitelist =
        Array.isArray(overrideAllowedFolders) || Boolean(latestSettings.onlyScanSelectedFolders);
      const allowedFolders = Array.isArray(overrideAllowedFolders)
        ? overrideAllowedFolders
        : latestSettings.onlyScanSelectedFolders
        ? (latestSettings.selectedScanFolders || [])
            .filter((f) => f.enabled)
            .map((f) => f.path)
        : [];

      if (useWhitelist && allowedFolders.length === 0) {
        setAudioError(
          'Select at least one music folder in Settings -> Folders & Cache (or turn off "Only scan selected folders").'
        );
        return 0;
      }

      const taskId = `native_scan_${Date.now()}`;
      setImportingFiles(true);
      setAudioError(null);
      reportTaskProgress(
        taskId,
        'device-scan',
        useWhitelist ? 'Scanning Selected Folders' : 'Scanning Device Music Folders',
        useWhitelist
          ? `Scanning ${allowedFolders.length} selected folder(s)...`
          : 'Reading Android MediaStore index...',
        0,
        100,
        'running',
        { label: 'Preparing Android MediaStore...', current: 0, total: 1, percent: 15 }
      );
      try {
        if (useWhitelist && !overrideAllowedFolders) {
          pruneTracksToAllowedFolders(allowedFolders);
        }

        const scannedTracks = await scanAndroidDeviceLibrary(
          (prog) => {
            const itemTotal = Math.max(1, prog.total);
            reportTaskProgress(
              taskId,
              'device-scan',
              useWhitelist ? 'Scanning Selected Folders' : 'Scanning Device Music Folders',
              `${prog.current} / ${itemTotal} audio files`,
              prog.current,
              itemTotal,
              'running',
              {
                label: prog.fileName || 'Scanning audio files...',
                current: 1,
                total: 1,
                percent: 100,
              }
            );
          },
          useWhitelist ? allowedFolders : undefined
        );

        if (scannedTracks.length > 0) {
          setTracks((prev) => {
            const basePrev =
              useWhitelist && !overrideAllowedFolders
                ? prev.filter(
                    (t) =>
                      t.source !== 'local' || folderMatchesAllowedList(t.folderPath, allowedFolders)
                  )
                : prev;
            const scannedByFp = new Map(scannedTracks.map((t) => [t.fingerprint, t]));
            const updatedPrev = basePrev.map((existing) => {
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
            `Loaded ${scannedTracks.length} track(s) from ${
              useWhitelist ? `${allowedFolders.length} selected folder(s)` : 'device storage'
            }`,
            scannedTracks.length,
            scannedTracks.length,
            'done',
            { label: `${scannedTracks.length} track(s) indexed`, current: 1, total: 1, percent: 100 }
          );
        } else {
          if (!silentIfEmpty) {
            setAudioError(
              useWhitelist
                ? 'No audio files were found in the selected folders.'
                : 'No audio files were found in device storage yet.'
            );
          }
          reportTaskProgress(
            taskId,
            'device-scan',
            'Device Scan Finished',
            'No music tracks found (clips shorter than 10s skipped)',
            1,
            1,
            'done',
            { label: 'Scan finished', current: 1, total: 1, percent: 100 }
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
        reportTaskProgress(taskId, 'device-scan', 'Device Scan Error', msg, 0, 1, 'error', {
          label: msg,
          current: 1,
          total: 1,
          percent: 100,
        });
        return 0;
      } finally {
        setImportingFiles(false);
      }
    },
    [pruneTracksToAllowedFolders, reportTaskProgress]
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
        'Step 1 / 3 · Authorizing account',
        1,
        3,
        'running',
        { label: 'Google OAuth consent', current: 1, total: 2, percent: 50 }
      );
      const signedUser = await signInWithGoogleAccount();
      tactile.success();
      reportTaskProgress(
        taskId,
        'cloud-sync',
        'Signing in with Gmail',
        'Step 2 / 3 · Checking cloud backup',
        2,
        3,
        'running',
        { label: signedUser.email || 'Checking backup...', current: 1, total: 2, percent: 70 }
      );
      let cloud = null;
      try {
        cloud = await restoreFromCloud(signedUser);
      } catch {
        // Non-blocking if user has no cloud backup or offline right now
        cloud = null;
      }
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
        3,
        3,
        'done',
        { label: signedUser.email || 'Connected', current: 1, total: 1, percent: 100 }
      );
    } catch (err) {
      const msg = formatCloudAuthError(err);
      setSyncMessage(msg);
      reportTaskProgress(taskId, 'cloud-sync', 'Gmail Sign-In Failed', msg, 3, 3, 'error', {
        label: msg,
        current: 1,
        total: 1,
        percent: 100,
      });
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
          'Step 1 / 3 · Packaging settings, EQ presets & playlists',
          1,
          3,
          'running',
          { label: `${playlists.length} playlists · ${eqPresets.length} EQ presets`, current: 1, total: 3, percent: 33 }
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
            `Step 2 / 3 · Uploading snapshot for ${user.email}`,
            2,
            3,
            'running',
            { label: `Uploading ${tracks.length} track preferences`, current: 2, total: 3, percent: 75 }
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
          reportTaskProgress(taskId, 'cloud-sync', 'Cloud Backup Complete', msg, 3, 3, 'done', {
            label: 'All cloud collections synced',
            current: 3,
            total: 3,
            percent: 100,
          });
        }
      } catch (err) {
        if (!silent) {
          const msg = formatCloudAuthError(err);
          setSyncMessage(msg);
          reportTaskProgress(taskId, 'cloud-sync', 'Cloud Backup Error', msg, 3, 3, 'error', {
            label: msg,
            current: 3,
            total: 3,
            percent: 100,
          });
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
      `Step 1 / 3 · Fetching backup for ${user.email}`,
      1,
      3,
      'running',
      { label: user.email || 'Fetching cloud snapshot', current: 1, total: 3, percent: 33 }
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
          'done',
          { label: 'No backup found', current: 3, total: 3, percent: 100 }
        );
        return;
      }
      reportTaskProgress(
        taskId,
        'cloud-sync',
        'Restoring from Cloud',
        'Step 2 / 3 · Applying playlists, EQ presets & ratings',
        2,
        3,
        'running',
        { label: `Applying ${data.playlists?.length || 0} playlists & track ratings`, current: 2, total: 3, percent: 75 }
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
              skipCount: Math.max(t.skipCount || 0, p.skipCount || 0),
              lastSkippedAt: p.lastSkippedAt || t.lastSkippedAt,
              title: p.title || t.title,
              artist: p.artist || t.artist,
              album: p.album || t.album,
              genre: p.genre || t.genre,
              year: p.year || t.year,
              composer: p.composer || t.composer,
              eqPresetId: p.eqPresetId || t.eqPresetId,
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
      reportTaskProgress(taskId, 'cloud-sync', 'Cloud Restore Complete', msg, 3, 3, 'done', {
        label: 'Cloud state applied',
        current: 3,
        total: 3,
        percent: 100,
      });
    } catch (err) {
      const msg = formatCloudAuthError(err);
      setSyncMessage(msg);
      reportTaskProgress(taskId, 'cloud-sync', 'Cloud Restore Error', msg, 3, 3, 'error', {
        label: msg,
        current: 3,
        total: 3,
        percent: 100,
      });
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
    if (t === 'settings-devices') return 'devices';
    if (t === 'settings-theme' || t === 'settings-appearance') return 'theme';
    if (t === 'settings-widgets') return 'widgets';
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

  const handleAddTracksToPlaylist = useCallback((trackIds: string[], playlistId: string) => {
    if (trackIds.length === 0) return;
    setPlaylists((prev) =>
      prev.map((pl) => {
        if (pl.id !== playlistId) return pl;
        const existing = new Set(pl.trackIds);
        const additions = trackIds.filter((id) => !existing.has(id));
        if (additions.length === 0) return pl;
        return { ...pl, trackIds: [...pl.trackIds, ...additions], updatedAt: Date.now() };
      })
    );
  }, []);

  const handleCreatePlaylist = useCallback((name: string, initialTrackIds?: string[]) => {
    tactile.success();
    const uniqueInitial = initialTrackIds ? Array.from(new Set(initialTrackIds)) : [];
    setPlaylists((prev) => [
      {
        id: `pl_${Date.now().toString(36)}`,
        name,
        description:
          uniqueInitial.length > 0
            ? `${uniqueInitial.length} track(s)`
            : 'Custom playlist',
        trackIds: uniqueInitial,
        source: 'local',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      ...prev,
    ]);
  }, []);

  const handleExportPlaylistM3u = useCallback((playlistId: string) => {
    const pl = playlists.find((p) => p.id === playlistId);
    if (!pl) return;
    tactile.success();
    exportPlaylistAsM3u8(pl, tracksRef.current);
  }, [playlists]);

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

  const collectWebDirectoryFiles = useCallback(
    async (
      dirHandle: FileSystemDirectoryHandle,
      baseLabel: string,
      taskId: string
    ): Promise<{
      collected: File[];
      collectedM3u: File[];
      webHandlesMap: Map<
        File,
        { fileHandle: FileSystemFileHandle; dirHandle: FileSystemDirectoryHandle; fileName: string }
      >;
    }> => {
      type PickerDir = FileSystemDirectoryHandle & {
        values: () => AsyncIterable<
          | (FileSystemFileHandle & { kind: 'file'; name: string })
          | (FileSystemDirectoryHandle & {
              kind: 'directory';
              name: string;
              values: () => AsyncIterable<unknown>;
            })
        >;
      };

      const audioExts = /\.(flac|alac|wav|wave|mp3|m4a|aac|ogg|oga|opus)$/i;
      const m3uExts = /\.(m3u8?|pls)$/i;
      const collected: File[] = [];
      const collectedM3u: File[] = [];
      const webHandlesMap = new Map<
        File,
        { fileHandle: FileSystemFileHandle; dirHandle: FileSystemDirectoryHandle; fileName: string }
      >();

      const walk = async (handle: PickerDir, prefix: string) => {
        for await (const entry of handle.values()) {
          if (entry.kind === 'file' && typeof entry.getFile === 'function') {
            if (audioExts.test(entry.name)) {
              const f = await entry.getFile();
              Object.defineProperty(f, 'webkitRelativePath', {
                value: `${prefix}/${entry.name}`,
                configurable: true,
              });
              collected.push(f);
              webHandlesMap.set(f, {
                fileHandle: entry,
                dirHandle: handle,
                fileName: entry.name,
              });
              if (collected.length % 5 === 1) {
                reportTaskProgress(
                  taskId,
                  'device-scan',
                  'Scanning Music Folder',
                  `Found ${collected.length} track(s)`,
                  collected.length,
                  collected.length + 5,
                  'running',
                  { label: entry.name, current: 1, total: 1, percent: 100 }
                );
              }
            } else if (m3uExts.test(entry.name)) {
              const mf = await entry.getFile();
              collectedM3u.push(mf);
            }
          } else if (entry.kind === 'directory' && typeof entry.values === 'function') {
            await walk(entry as PickerDir, `${prefix}/${entry.name}`);
          }
        }
      };

      await walk(dirHandle as PickerDir, baseLabel);
      return { collected, collectedM3u, webHandlesMap };
    },
    [reportTaskProgress]
  );

  const registerScanFolderEntries = useCallback((incoming: ScanFolderEntry[], forceEnableNew = true) => {
    setSettings((prev) => {
      const existing = Array.isArray(prev.selectedScanFolders) ? prev.selectedScanFolders : [];
      const byNorm = new Map<string, ScanFolderEntry>(
        existing.map((e) => [normalizeFolderKey(e.path), e])
      );
      for (const item of incoming) {
        const key = normalizeFolderKey(item.path);
        if (!key) continue;
        const cur = byNorm.get(key);
        if (cur) {
          byNorm.set(key, {
            ...cur,
            trackCount: item.trackCount ?? cur.trackCount,
            enabled: forceEnableNew ? true : cur.enabled,
            source: item.source || cur.source,
          });
        } else {
          byNorm.set(key, item);
        }
      }
      return {
        ...prev,
        selectedScanFolders: Array.from(byNorm.values()),
      };
    });
  }, []);

  const handleOpenFolderImport = useCallback(async () => {
    if (isNativeAndroidApp()) {
      await handleScanNativeAndroid(false);
      return;
    }

    const picker = (
      window as Window & {
        showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
      }
    ).showDirectoryPicker;

    if (typeof picker === 'function') {
      try {
        let dirHandle: FileSystemDirectoryHandle;
        try {
          dirHandle = await picker({ mode: 'readwrite' });
        } catch (permErr) {
          if (permErr instanceof DOMException && permErr.name === 'AbortError') {
            return;
          }
          dirHandle = await picker({ mode: 'read' });
        }

        const walkTaskId = `folder_walk_${Date.now()}`;
        reportTaskProgress(
          walkTaskId,
          'device-scan',
          'Scanning Music Folder',
          `Opening "${dirHandle.name}"...`,
          0,
          0,
          'running',
          { label: dirHandle.name, current: 0, total: 1, percent: 10 }
        );

        const { collected, collectedM3u, webHandlesMap } = await collectWebDirectoryFiles(
          dirHandle,
          dirHandle.name,
          walkTaskId
        );

        const folderId = `web_${normalizeFolderKey(dirHandle.name) || Date.now().toString(36)}`;
        await saveScanFolderHandle(folderId, dirHandle.name, dirHandle.name, dirHandle);
        registerScanFolderEntries(
          [
            {
              id: folderId,
              path: dirHandle.name,
              label: dirHandle.name,
              enabled: true,
              trackCount: collected.length,
              source: 'web',
            },
          ],
          true
        );

        if (collected.length > 0 || collectedM3u.length > 0) {
          await handleImportFiles(collected, walkTaskId, webHandlesMap, collectedM3u);
        } else {
          reportTaskProgress(
            walkTaskId,
            'device-scan',
            'Folder Scan Complete',
            'No audio files found in folder',
            1,
            1,
            'done',
            { label: dirHandle.name, current: 1, total: 1, percent: 100 }
          );
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
  }, [
    collectWebDirectoryFiles,
    handleImportFiles,
    handleScanNativeAndroid,
    registerScanFolderEntries,
    reportTaskProgress,
  ]);

  const handleAddScanFolder = useCallback(async () => {
    setScanningFolders(true);
    try {
      if (isNativeAndroidApp()) {
        const picked = await pickAndroidMusicFolder();
        if (!picked.cancelled && picked.path) {
          const entry: ScanFolderEntry = {
            id: `android_${normalizeFolderKey(picked.path)}`,
            path: picked.path,
            label: picked.label || picked.path.split('/').pop() || picked.path,
            enabled: true,
            source: 'android',
          };
          registerScanFolderEntries([entry], true);
          updateSettings({ onlyScanSelectedFolders: true });
          await handleScanNativeAndroid(true, [picked.path]);
        }
        return;
      }
      await handleOpenFolderImport();
      updateSettings({ onlyScanSelectedFolders: true });
    } catch (err) {
      setAudioError(err instanceof Error ? err.message : 'Unable to add music folder.');
    } finally {
      setScanningFolders(false);
    }
  }, [handleOpenFolderImport, handleScanNativeAndroid, registerScanFolderEntries, updateSettings]);

  const handleDiscoverScanFolders = useCallback(async () => {
    setScanningFolders(true);
    try {
      const discovered: ScanFolderEntry[] = [];
      const hadExisting = (latestSnapshotRef.current.settings.selectedScanFolders || []).length > 0;

      if (isNativeAndroidApp()) {
        const androidFolders = await listAndroidMusicFolders();
        for (const f of androidFolders) {
          discovered.push({
            id: `android_${normalizeFolderKey(f.path)}`,
            path: f.path,
            label: f.label || f.path,
            enabled: !hadExisting,
            trackCount: f.trackCount,
            source: 'android',
          });
        }
      } else {
        const webHandles = await getAllScanFolderHandles();
        for (const wh of webHandles) {
          discovered.push({
            id: wh.id,
            path: wh.path,
            label: wh.label,
            enabled: true,
            source: 'web',
          });
        }
      }

      // Also include any distinct local library folders already loaded
      const folderCounts = new Map<string, number>();
      for (const t of tracksRef.current) {
        if (t.source !== 'local') continue;
        const fp = (t.folderPath || '').trim();
        if (!fp || fp === 'Reference Studio') continue;
        folderCounts.set(fp, (folderCounts.get(fp) || 0) + 1);
      }
      for (const [fp, count] of folderCounts.entries()) {
        discovered.push({
          id: `lib_${normalizeFolderKey(fp)}`,
          path: fp,
          label: fp.split('/').pop() || fp,
          enabled: !hadExisting,
          trackCount: count,
          source: isNativeAndroidApp() ? 'android' : 'library',
        });
      }

      if (discovered.length > 0) {
        registerScanFolderEntries(discovered, false);
        setSyncMessage(`Found ${discovered.length} music folder(s). Check the ones you want scanned.`);
        tactile.success();
      } else {
        setSyncMessage('No existing folders discovered yet — tap Add Folder to pick a directory.');
      }
    } catch (err) {
      setAudioError(err instanceof Error ? err.message : 'Unable to discover music folders.');
    } finally {
      setScanningFolders(false);
    }
  }, [registerScanFolderEntries]);

  const handleToggleScanFolder = useCallback((folderId: string) => {
    setSettings((prev) => ({
      ...prev,
      selectedScanFolders: (prev.selectedScanFolders || []).map((f) =>
        f.id === folderId ? { ...f, enabled: !f.enabled } : f
      ),
    }));
  }, []);

  const handleRemoveScanFolder = useCallback((folderId: string) => {
    setSettings((prev) => ({
      ...prev,
      selectedScanFolders: (prev.selectedScanFolders || []).filter((f) => f.id !== folderId),
    }));
    void deleteScanFolderHandle(folderId);
  }, []);

  const handleApplyAndScanSelectedFolders = useCallback(async () => {
    const latest = latestSnapshotRef.current.settings;
    const onlySelected = Boolean(latest.onlyScanSelectedFolders);
    const enabled = (latest.selectedScanFolders || []).filter((f) => f.enabled);
    const allowedPaths = enabled.map((f) => f.path);

    if (onlySelected && allowedPaths.length === 0) {
      setAudioError('Please check at least one folder to scan.');
      return;
    }

    setScanningFolders(true);
    try {
      if (onlySelected) {
        pruneTracksToAllowedFolders(allowedPaths);
      }

      if (isNativeAndroidApp()) {
        await handleScanNativeAndroid(false, onlySelected ? allowedPaths : undefined);
        return;
      }

      const webHandles = await getAllScanFolderHandles();
      const targetHandles = onlySelected
        ? webHandles.filter((wh) => folderMatchesAllowedList(wh.path, allowedPaths))
        : webHandles;

      if (targetHandles.length === 0) {
        if (onlySelected) {
          setSyncMessage(
            `Applied whitelist (${allowedPaths.length} folder${allowedPaths.length === 1 ? '' : 's'}). Excluded folders removed from library.`
          );
          tactile.success();
        } else {
          await handleOpenFolderImport();
        }
        return;
      }

      const taskId = `scan_selected_web_${Date.now()}`;
      for (const wh of targetHandles) {
        const granted = await ensureDirectoryReadPermission(wh.dirHandle);
        if (!granted) continue;
        const { collected, collectedM3u, webHandlesMap } = await collectWebDirectoryFiles(
          wh.dirHandle,
          wh.path,
          taskId
        );
        if (collected.length > 0 || collectedM3u.length > 0) {
          await handleImportFiles(collected, taskId, webHandlesMap, collectedM3u);
        }
      }
      tactile.success();
    } finally {
      setScanningFolders(false);
    }
  }, [
    collectWebDirectoryFiles,
    handleImportFiles,
    handleOpenFolderImport,
    handleScanNativeAndroid,
    pruneTracksToAllowedFolders,
  ]);

  const handleChangeLibraryStartIndex = useCallback(
    (idx: number) => {
      if (!isLibraryTab(normalizedActiveTab)) return;
      setLibraryStartIndices((prev) =>
        prev[normalizedActiveTab] === idx
          ? prev
          : { ...prev, [normalizedActiveTab]: idx }
      );
    },
    [normalizedActiveTab]
  );

  const handleChangeAiScanConfig = useCallback(
    (cfg: { scanLimitInput: string; batchSize: number; autoApplyTags: boolean }) => {
      updateSettings({ aiScanConfig: cfg });
    },
    [updateSettings]
  );

  const studioPage = getStudioPage(normalizedActiveTab);
  const eqPage = getEqPage(normalizedActiveTab);
  const settingsPage = getSettingsPage(normalizedActiveTab);

  return (
    <div className="h-full w-full overflow-hidden flex flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {/* Hidden File & Folder Pickers */}
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // @ts-expect-error webkitdirectory is supported in Chromium/Safari/Firefox
        webkitdirectory=""
        accept="audio/*,.flac,.alac,.wav,.mp3,.m4a,.aac,.ogg,.opus,.m3u,.m3u8"
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length > 0) {
            const firstRel = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath || '';
            const rootName = firstRel.split('/').filter(Boolean)[0];
            if (rootName) {
              registerScanFolderEntries(
                [
                  {
                    id: `web_${normalizeFolderKey(rootName)}`,
                    path: rootName,
                    label: rootName,
                    enabled: true,
                    trackCount: files.length,
                    source: 'web',
                  },
                ],
                true
              );
            }
          }
          void handleImportFiles(files);
          e.target.value = '';
        }}
        className="hidden"
      />
      <input
        ref={filesInputRef}
        type="file"
        multiple
        accept="audio/*,.flac,.alac,.wav,.mp3,.m4a,.aac,.ogg,.opus,.m3u,.m3u8"
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
        <div className="h-11 sm:h-13 [@media(max-height:520px)]:h-10 flex items-center justify-between gap-2 sm:gap-6">
          <div className="flex items-baseline gap-1.5 whitespace-nowrap shrink-0">
            <span className="text-base sm:text-lg font-display font-bold tracking-tight">
              AuraSound
            </span>
            <span className="text-[11px] font-mono-tabular text-zinc-500 dark:text-zinc-400">
              {APP_VERSION}
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
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
          {/* Mobile Workspace Switcher (4 top-level workspaces) */}
          <div className="md:hidden shrink-0 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1">
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
                    className={`min-h-[28px] px-1 rounded-md text-[11px] font-semibold whitespace-nowrap transition-colors ${
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
          </div>

          {/* Slidable Rocket-Player-Style Top Menu Choices Bar */}
          <SlidableTabStrip
            items={activeWorkspaceMeta.items.map((item) => ({
              id: item.id,
              label: item.label,
            }))}
            activeId={normalizedActiveTab}
            onSelect={(nextId) => updateSettings({ activeTab: nextId as NavigationTab })}
            className="shrink-0"
          />

          {audioError && (
            <div className="shrink-0 mx-3 sm:mx-5 mt-1.5 px-3 py-1.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-2">
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

          {/* Fixed Slidable Active Page Container (100% overflow-hidden) */}
          <SlidablePageViewport
            pageIds={activeWorkspaceMeta.items.map((item) => item.id)}
            activePageId={normalizedActiveTab}
            pageLabels={Object.fromEntries(
              activeWorkspaceMeta.items.map((item) => [item.id, item.label])
            )}
            onChangePage={(nextId) => updateSettings({ activeTab: nextId as NavigationTab })}
            disabled={nowPlayingOpen || castOpen || shareOpen}
            className="flex-1 min-h-0 p-2.5 sm:p-4 flex flex-col"
          >
            {isLibraryTab(normalizedActiveTab) && (
              <LibraryBrowser
                tab={normalizedActiveTab}
                viewMode={settings.viewModes[normalizedActiveTab]}
                themeMode={settings.themeMode}
                sortBy={settings.sortBy || { field: 'title', ascending: true }}
                tracks={visibleTracks}
                playlists={playlists}
                eqPresets={eqPresets}
                searchQuery={searchQuery}
                currentTrackId={currentTrackId}
                isPlaying={isPlaying}
                selectedAlbumFilter={selectedAlbumFilter}
                selectedArtistFilter={selectedArtistFilter}
                selectedGenreFilter={selectedGenreFilter}
                selectedFolderFilter={selectedFolderFilter}
                selectedPlaylistFilter={selectedPlaylistFilter}
                initialStartIndex={libraryStartIndices[normalizedActiveTab] || 0}
                onChangeStartIndex={handleChangeLibraryStartIndex}
                onChangeSearchQuery={setSearchQuery}
                onChangeViewMode={handleChangeLibraryViewMode}
                onChangeSortBy={(nextSort) => updateSettings({ sortBy: nextSort })}
                onPlayTrack={handlePlayFromLibrary}
                onPlaySingleTrack={handlePlaySingleTrack}
                onShuffleFromTrack={handleShuffleFromTrack}
                onPlayNext={handlePlayNext}
                onPlayNextMany={handlePlayNextMany}
                onAddToQueue={handleAddToQueue}
                onAddTracksToQueue={handleAddTracksToQueue}
                onPlayAll={playCollectionQueue}
                onToggleFavorite={handleToggleFavorite}
                onToggleOfflineCache={handleToggleOfflineCacheCb}
                onAddTrackToPlaylist={handleAddTrackToPlaylist}
                onAddTracksToPlaylist={handleAddTracksToPlaylist}
                onCreatePlaylist={handleCreatePlaylist}
                onEditTracksMetadata={handleEditTracksMetadata}
                onApplyTagCleanups={handleApplyTagCleanups}
                onShowNoChangesToast={showNoChangesToast}
                onAssignEqPreset={handleAssignEqPreset}
                onSetRingtone={(track) => void handleSetRingtone(track)}
                onDeleteTracks={handleDeleteTracks}
                onDeletePlaylist={handleDeletePlaylist}
                onExportPlaylistM3u={handleExportPlaylistM3u}
                onImportM3uFiles={(files) => void handleImportM3uFiles(files)}
                onSelectAlbum={handleSelectAlbum}
                onSelectArtist={handleSelectArtist}
                onSelectGenre={handleSelectGenre}
                onSelectFolder={handleSelectFolder}
                onSelectPlaylist={handleSelectPlaylist}
                onImportLocalFolder={handleOpenFolderImport}
                onOpenSettings={() => {
                  tactile.tap();
                  updateSettings({ activeTab: 'settings-audio' });
                }}
                onOpenEqualizer={() => {
                  tactile.tap();
                  updateSettings({ activeTab: 'eq-rack' });
                }}
                onToggleTheme={() => {
                  const nextMode = settings.themeMode === 'dark' ? 'light' : 'dark';
                  tactile.toggle(nextMode === 'dark');
                  updateSettings({ themeMode: nextMode });
                }}
                onShareApp={() => {
                  tactile.sheet(true);
                  setShareMode('app');
                  setShareOpen(true);
                }}
              />
            )}

            {studioPage && (
              <SmartStudioView
                page={studioPage}
                user={user}
                tracks={tracks}
                smartPlaylists={smartPlaylists}
                dailyRecommendations={dailyRecs}
                initialScanConfig={settings.aiScanConfig}
                onChangeScanConfig={handleChangeAiScanConfig}
                onSignInGoogle={() => void handleSignInGoogle()}
                onPlayTracks={(list, random = false) => playCollectionQueue(list, random)}
                onAddSmartPlaylist={(pl) => setSmartPlaylists((prev) => [pl, ...prev])}
                onDeleteSmartPlaylist={(id) =>
                  setSmartPlaylists((prev) => prev.filter((p) => p.id !== id))
                }
                onUpdateDailyRecommendations={setDailyRecs}
                onApplyTagCleanups={handleApplyTagCleanups}
                onRemoveDuplicateTracks={handleDeleteTracks}
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
                scanningFolders={scanningFolders}
                onUpdateSettings={updateSettings}
                onSignInGoogle={() => void handleSignInGoogle()}
                onSignOutGoogle={() => void signOutGoogleAccount()}
                onBackupNow={() => void handleBackupNow(false)}
                onRestoreNow={() => void handleRestoreNow()}
                onAddScanFolder={() => void handleAddScanFolder()}
                onDiscoverScanFolders={() => void handleDiscoverScanFolders()}
                onToggleScanFolder={handleToggleScanFolder}
                onRemoveScanFolder={handleRemoveScanFolder}
                onApplyAndScanSelectedFolders={() => void handleApplyAndScanSelectedFolders()}
                onClearCache={() => {
                  tactile.tap();
                  const taskId = `clear_cache_${Date.now()}`;
                  reportTaskProgress(
                    taskId,
                    'library-maintenance',
                    'Clearing Offline Cache',
                    'Removing cached audio blobs...',
                    1,
                    2,
                    'running',
                    { label: `${cacheStats.count} cached item(s)`, current: 1, total: 2, percent: 50 }
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
                      'done',
                      { label: '0 cached items remaining', current: 2, total: 2, percent: 100 }
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
                    Math.max(1, total),
                    'running',
                    { label: 'Normalizing Windows-1251 & UTF-8', current: 1, total: 2, percent: 50 }
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
                    'done',
                    { label: `Verified ${total} tracks`, current: 2, total: 2, percent: 100 }
                  );
                }}
              />
            )}
          </SlidablePageViewport>
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
          setShareMode('track');
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
        showLyrics={settings.showLyrics !== false}
        karaokeOffsetMs={settings.karaokeOffsetMs || 0}
        fetchingLyrics={fetchingLyrics}
        tvStageOpen={tvStageOpen}
        initialDeckPage={nowPlayingDeckPage}
        onChangeDeckPage={setNowPlayingDeckPage}
        onSetTvStageOpen={setTvStageOpen}
        onToggleShowLyrics={() =>
          updateSettings({ showLyrics: settings.showLyrics === false })
        }
        onChangeKaraokeOffsetMs={(nextMs) =>
          updateSettings({ karaokeOffsetMs: nextMs })
        }
        onFetchTrackLyrics={(t) => void handleFetchTrackLyrics(t)}
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
          setShareMode('track');
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
        track={currentTrack}
        karaokeOffsetMs={settings.karaokeOffsetMs || 0}
        onLaunchTvStage={() => {
          setNowPlayingOpen(true);
          setNowPlayingDeckPage('player');
          if (settings.showLyrics === false) {
            updateSettings({ showLyrics: true });
          }
          setTvStageOpen(true);
        }}
        onClose={() => {
          tactile.sheet(false);
          setCastOpen(false);
        }}
      />

      <ShareModal
        open={shareOpen}
        track={currentTrack}
        mode={shareMode}
        onClose={() => {
          tactile.sheet(false);
          setShareOpen(false);
        }}
      />

      <TaskProgressDock tasks={activeTasks} onDismiss={dismissTask} />

      {activeWorkspace !== 'studio' &&
        globalAiQuotaCountdown &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed bottom-[126px] sm:bottom-24 left-1/2 -translate-x-1/2 z-[60] w-[min(92vw,460px)] rounded-xl bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md shadow-2xl">
            <AiQuotaNotice compact onDismiss={() => {}} />
          </div>,
          document.body
        )}

      {noChangesToast &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            key={noChangesToast.id}
            role="status"
            aria-live="polite"
            className="fixed bottom-[126px] sm:bottom-24 left-1/2 -translate-x-1/2 z-[80] pointer-events-none px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white/95 dark:bg-zinc-900/95 text-zinc-900 dark:text-zinc-100 shadow-xl backdrop-blur-md flex items-center gap-2 text-xs font-medium whitespace-nowrap"
          >
            <Info className="w-3.5 h-3.5 accent-text shrink-0" />
            <span>{noChangesToast.message}</span>
          </div>,
          document.body
        )}

      <OfflineIndicator />
    </div>
  );
}

export default function App() {
  const isKaraokeReceiver =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('karaoke-display') === '1';
  if (isKaraokeReceiver) {
    return <KaraokeReceiverDisplayScreen />;
  }
  return <MainApp />;
}
