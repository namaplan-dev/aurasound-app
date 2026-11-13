import {
  signInWithPopup,
  signOut as firebaseSignOut,
  User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { auth, db, googleProvider } from './firebaseClient';
import {
  AppSettings,
  CloudBackupPayload,
  DailyRecommendation,
  EQPreset,
  Playlist,
  SmartPlaylist,
  Track,
} from '../types/music';

export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
} as const;

export type OperationTypeValue = (typeof OperationType)[keyof typeof OperationType];

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationTypeValue;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationTypeValue,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function signInWithGoogleAccount(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  await ensureUserProfile(result.user);
  return result.user;
}

export async function signOutGoogleAccount(): Promise<void> {
  await firebaseSignOut(auth);
}

export async function ensureUserProfile(user: User): Promise<void> {
  const profilePath = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  const displayName = (user.displayName || user.email?.split('@')[0] || 'Listener').slice(0, 120);
  const email = (user.email || '').slice(0, 256);

  try {
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) {
      await updateDoc(ref, {
        email,
        displayName,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        uid: user.uid,
        email,
        displayName,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, profilePath);
  }
}

export interface BackupBuildInput {
  user: User;
  settings: AppSettings;
  eqPresets: EQPreset[];
  playlists: Playlist[];
  smartPlaylists: SmartPlaylist[];
  tracks: Track[];
  dailyRecommendations: DailyRecommendation[];
}

export async function backupToCloud(
  input: BackupBuildInput,
  backupId = 'latest'
): Promise<number> {
  const { user, settings, eqPresets, playlists, smartPlaylists, tracks, dailyRecommendations } = input;
  await ensureUserProfile(user);

  const backupPath = `users/${user.uid}/backups/${backupId}`;
  const backupRef = doc(db, 'users', user.uid, 'backups', backupId);

  // Sanitize & bound payload cleanly to match firebase-blueprint.json & firestore.rules limits
  const safeSettings: Record<string, unknown> = {
    themeMode: settings.themeMode,
    themeAccent: settings.themeAccent,
    streamingQuality: settings.streamingQuality,
    crossfadeSeconds: settings.crossfadeSeconds,
    gaplessPlayback: settings.gaplessPlayback,
    offlineMode: settings.offlineMode,
    lowBatteryMode: settings.lowBatteryMode,
    autoPlayBluetooth: settings.autoPlayBluetooth,
    showHomescreenWidget: settings.showHomescreenWidget,
    masterVolume: settings.masterVolume,
    eqEnabled: settings.eqEnabled,
    activeEqPresetId: settings.activeEqPresetId,
    activeEqBands: settings.activeEqBands.slice(0, 10),
    eqPreampDb: settings.eqPreampDb,
    shuffle: settings.shuffle,
    repeatMode: settings.repeatMode,
    autoCloudBackup: settings.autoCloudBackup,
    viewModes: settings.viewModes,
    activeTab: settings.activeTab,
    lastTrackFingerprint: settings.lastTrackFingerprint || '',
    lastPositionSec: settings.lastPositionSec || 0,
    tactileSounds: settings.tactileSounds !== false,
    hapticFeedback: settings.hapticFeedback !== false,
  };

  const customEqPresets = eqPresets.filter((p) => !p.isBuiltIn).slice(0, 40);
  const safePlaylists = playlists.slice(0, 80).map((pl) => ({
    id: pl.id,
    name: pl.name.slice(0, 100),
    description: pl.description.slice(0, 240),
    trackIds: pl.trackIds.slice(0, 300),
    source: pl.source,
    createdAt: pl.createdAt,
    updatedAt: pl.updatedAt,
  }));
  const safeSmartPlaylists = smartPlaylists.slice(0, 50);
  const safeTrackPrefs = tracks
    .filter((t) => t.favorite || t.rating > 0 || t.playCount > 0 || t.source === 'local')
    .slice(0, 500)
    .map((t) => ({
      fingerprint: t.fingerprint,
      favorite: t.favorite,
      rating: t.rating,
      playCount: t.playCount,
      title: t.title.slice(0, 120),
      artist: t.artist.slice(0, 120),
      album: t.album.slice(0, 120),
      genre: t.genre.slice(0, 80),
    }));
  const safeDaily = dailyRecommendations.slice(0, 12);

  try {
    const snap = await getDoc(backupRef);
    if (snap.exists()) {
      await updateDoc(backupRef, {
        settings: safeSettings,
        eqPresets: customEqPresets,
        playlists: safePlaylists,
        smartPlaylists: safeSmartPlaylists,
        trackPrefs: safeTrackPrefs,
        dailyRecommendations: safeDaily,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(backupRef, {
        ownerId: user.uid,
        settings: safeSettings,
        eqPresets: customEqPresets,
        playlists: safePlaylists,
        smartPlaylists: safeSmartPlaylists,
        trackPrefs: safeTrackPrefs,
        dailyRecommendations: safeDaily,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return Date.now();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, backupPath);
  }
}

export async function restoreFromCloud(
  user: User,
  backupId = 'latest'
): Promise<CloudBackupPayload | null> {
  const backupPath = `users/${user.uid}/backups/${backupId}`;
  const backupRef = doc(db, 'users', user.uid, 'backups', backupId);
  try {
    const snap = await getDoc(backupRef);
    if (!snap.exists()) return null;
    return snap.data() as CloudBackupPayload;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, backupPath);
  }
}
