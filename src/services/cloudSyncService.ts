import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import {
  getRedirectResult,
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
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
import { resolveApiUrl } from './aiAssistantService';
import {
  AppSettings,
  CloudBackupPayload,
  DailyRecommendation,
  EQPreset,
  Playlist,
  SmartPlaylist,
  Track,
} from '../types/music';

interface NativeAuthPlugin {
  openAuthUrl(options: { url: string }): Promise<void>;
  addListener(
    eventName: 'authCallback',
    listenerFunc: (event: { url: string }) => void
  ): Promise<PluginListenerHandle>;
}

const NativeAuth = registerPlugin<NativeAuthPlugin>('NativeAuth');

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

export function formatCloudAuthError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string } | null)?.code || '';

  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'Gmail sign-in window was closed before finishing.';
  }
  if (code === 'auth/popup-blocked') {
    return 'Sign-in popup was blocked by your browser. Please allow popups for AuraSound and try again.';
  }
  if (code === 'auth/unauthorized-domain') {
    return `This domain (${window.location.hostname}) is not authorized in Firebase Auth.`;
  }
  if (code === 'auth/network-request-failed') {
    return 'Network connection error while contacting Google Sign-In.';
  }
  if (code === 'auth/operation-not-supported-in-this-environment') {
    return 'In-app WebView sign-in requires opening Chrome. Please update AuraSound or allow Chrome.';
  }

  // Unwrap structured FirestoreErrorInfo JSON cleanly if thrown
  if (raw.startsWith('{') && raw.includes('"operationType"')) {
    try {
      const parsed = JSON.parse(raw) as FirestoreErrorInfo;
      return parsed.error || 'Cloud database sync error.';
    } catch {
      return raw;
    }
  }
  return raw || 'Google sign-in failed.';
}

async function signInNativeAndroidViaChromeBridge(): Promise<User> {
  const createResp = await fetch(resolveApiUrl('/api/auth/native-session'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!createResp.ok) {
    throw new Error('Cloud sign-in server is currently unreachable.');
  }
  const { sessionId, secret } = (await createResp.json()) as {
    sessionId: string;
    secret: string;
  };

  const bridgeUrl = resolveApiUrl(
    `/api/auth/bridge?session=${encodeURIComponent(sessionId)}&secret=${encodeURIComponent(secret)}`
  );

  let callbackTriggered = false;
  let listener: PluginListenerHandle | null = null;
  try {
    listener = await NativeAuth.addListener('authCallback', () => {
      callbackTriggered = true;
    });
  } catch {
    listener = null;
  }

  await NativeAuth.openAuthUrl({ url: bridgeUrl });

  const pollUrl = resolveApiUrl(
    `/api/auth/native-poll?session=${encodeURIComponent(sessionId)}&secret=${encodeURIComponent(secret)}`
  );

  const deadline = Date.now() + 90_000;
  try {
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, callbackTriggered ? 250 : 1100));
      callbackTriggered = false;

      const pollResp = await fetch(pollUrl);
      if (pollResp.status === 404) {
        throw new Error('Gmail sign-in session expired. Please try again.');
      }
      if (!pollResp.ok) continue;

      const data = (await pollResp.json()) as {
        status: 'pending' | 'ready' | 'error';
        idToken?: string;
        accessToken?: string;
        error?: string;
      };

      if (data.status === 'error') {
        throw new Error(data.error || 'Gmail sign-in failed in Chrome.');
      }
      if (data.status === 'ready') {
        const credential = GoogleAuthProvider.credential(
          data.idToken || null,
          data.accessToken || null
        );
        const signed = await signInWithCredential(auth, credential);
        return signed.user;
      }
    }
    throw new Error('Gmail sign-in timed out. Please try again.');
  } finally {
    if (listener) {
      void listener.remove();
    }
  }
}

export async function completeRedirectSignInIfAny(): Promise<User | null> {
  try {
    const res = await getRedirectResult(auth);
    if (!res?.user) return null;
    try {
      await ensureUserProfile(res.user);
    } catch (profileErr) {
      console.warn('Profile sync warning after redirect sign-in:', profileErr);
    }
    return res.user;
  } catch {
    return null;
  }
}

export async function signInWithGoogleAccount(): Promise<User> {
  let signedUser: User;
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    signedUser = await signInNativeAndroidViaChromeBridge();
  } else {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      signedUser = result.user;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code || '';
      if (
        (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') &&
        window.self === window.top
      ) {
        await signInWithRedirect(auth, googleProvider);
        throw new Error('Redirecting to Google Sign-In...');
      }
      throw new Error(formatCloudAuthError(err));
    }
  }

  try {
    await ensureUserProfile(signedUser);
  } catch (profileErr) {
    // Do not roll back an active Firebase Auth session if Firestore is temporarily offline
    console.warn('Unable to update Firestore profile right now:', profileErr);
  }
  return signedUser;
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
    sortBy: settings.sortBy || { field: 'title', ascending: true },
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
    .filter(
      (t) =>
        t.favorite ||
        t.rating > 0 ||
        t.playCount > 0 ||
        (t.skipCount || 0) > 0 ||
        Boolean(t.eqPresetId) ||
        t.source === 'local'
    )
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
      ...(t.year ? { year: String(t.year).slice(0, 8) } : {}),
      ...(t.composer ? { composer: t.composer.slice(0, 120) } : {}),
      ...(t.skipCount ? { skipCount: t.skipCount } : {}),
      ...(t.lastSkippedAt ? { lastSkippedAt: t.lastSkippedAt } : {}),
      ...(t.eqPresetId ? { eqPresetId: t.eqPresetId } : {}),
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
