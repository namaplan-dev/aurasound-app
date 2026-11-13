import React from 'react';
import { User } from 'firebase/auth';
import {
  BatteryCharging,
  Bluetooth,
  Cloud,
  CloudDownload,
  CloudUpload,
  HardDrive,
  Loader2,
  LogIn,
  LogOut,
  Moon,
  Smartphone,
  Sun,
  Trash2,
  Vibrate,
  Volume2,
  Wrench,
} from 'lucide-react';
import { AppSettings, AppTaskProgress, StreamingQuality, ThemeAccent } from '../types/music';
import { tactile } from '../services/tactileFeedback';
import { APP_VERSION } from '../version';
import { ProgressBar } from './ProgressBar';

export type SettingsPage = 'audio' | 'devices' | 'theme' | 'widgets' | 'storage' | 'cloud';

interface SettingsCloudViewProps {
  page: SettingsPage;
  user: User | null;
  settings: AppSettings;
  cacheStats: { count: number; totalBytes: number };
  syncBusy: boolean;
  syncMessage: string | null;
  syncProgress?: AppTaskProgress | null;
  storageProgress?: AppTaskProgress | null;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onSignInGoogle: () => void;
  onSignOutGoogle: () => void;
  onBackupNow: () => void;
  onRestoreNow: () => void;
  onClearCache: () => void;
  onRepairCyrillicLibrary: () => void;
}

const ACCENTS: Array<{ id: ThemeAccent; label: string; colorClass: string }> = [
  { id: 'amber', label: 'Amber', colorClass: 'bg-amber-600' },
  { id: 'cobalt', label: 'Cobalt', colorClass: 'bg-blue-600' },
  { id: 'emerald', label: 'Emerald', colorClass: 'bg-emerald-600' },
  { id: 'crimson', label: 'Crimson', colorClass: 'bg-rose-600' },
  { id: 'slate', label: 'Slate', colorClass: 'bg-slate-600' },
];

const PAGE_TITLES: Record<SettingsPage, { title: string; subtitle: string }> = {
  audio: {
    title: 'Audio & Playback',
    subtitle: 'Bit-depth quality, crossfade duration & gapless preload.',
  },
  devices: {
    title: 'Devices & Power',
    subtitle: 'Bluetooth auto-resume, offline library filter & battery saver.',
  },
  theme: {
    title: 'Theme & Touch',
    subtitle: 'Light/dark surfaces, accent palette, UI clicks & haptics.',
  },
  widgets: {
    title: 'Top Widgets',
    subtitle: 'Pin a floating mini-controller or choose Android home widget size.',
  },
  storage: {
    title: 'Storage & Repair',
    subtitle: 'Offline audio cache & Cyrillic / Windows-1251 tag encoding repair.',
  },
  cloud: {
    title: 'Cloud & Account',
    subtitle: 'Sync playlists, EQ presets, ratings & exact playback position via Gmail.',
  },
};

const ToggleSwitch: React.FC<{
  checked: boolean;
  label: string;
  onChange: () => void;
}> = ({ checked, label, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={onChange}
    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-150 ${
      checked ? 'accent-bg' : 'bg-zinc-300 dark:bg-zinc-700'
    }`}
  >
    <span
      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-150 ${
        checked ? 'translate-x-6' : 'translate-x-1'
      }`}
    />
  </button>
);

export const SettingsCloudView: React.FC<SettingsCloudViewProps> = ({
  page,
  user,
  settings,
  cacheStats,
  syncBusy,
  syncMessage,
  syncProgress,
  storageProgress,
  onUpdateSettings,
  onSignInGoogle,
  onSignOutGoogle,
  onBackupNow,
  onRestoreNow,
  onClearCache,
  onRepairCyrillicLibrary,
}) => {
  const formatMb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  const meta = PAGE_TITLES[page];

  return (
    <div className="h-full min-h-0 flex flex-col gap-2.5 max-w-4xl overflow-hidden">
      {/* Compact Header */}
      <div className="shrink-0 pb-2 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base sm:text-xl font-display font-semibold text-zinc-900 dark:text-zinc-100">
            {meta.title}
          </h2>
          <span className="text-[11px] font-mono-tabular text-zinc-500 dark:text-zinc-400">
            {APP_VERSION}
          </span>
        </div>
        <p className="hidden sm:block text-xs text-zinc-500 dark:text-zinc-400 truncate">
          {meta.subtitle}
        </p>
      </div>

      {/* Fixed Body Panel */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col justify-start">
        {page === 'audio' && (
          <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-3 sm:p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
                  Streaming & Output Quality
                </label>
                <select
                  value={settings.streamingQuality}
                  onChange={(e) =>
                    onUpdateSettings({ streamingQuality: e.target.value as StreamingQuality })
                  }
                  className="w-full min-h-[38px] px-3 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs sm:text-sm"
                >
                  <option value="lossless-hires">Lossless Hi-Res (24-bit / 192 kHz)</option>
                  <option value="cd-lossless">CD Lossless (16-bit / 44.1 kHz)</option>
                  <option value="high-320">High Quality (320 kbps)</option>
                  <option value="data-saver">Data Saver (128 kbps)</option>
                </select>
              </div>

              <div>
                <div className="flex justify-between text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
                  <span>Crossfade Duration</span>
                  <span className="font-mono-tabular">
                    {settings.crossfadeSeconds === 0
                      ? '0s (Gapless)'
                      : `${settings.crossfadeSeconds}s`}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={1}
                  value={settings.crossfadeSeconds}
                  onChange={(e) => {
                    const next = parseInt(e.target.value, 10);
                    tactile.sliderDetent(next / 10, next === 0);
                    onUpdateSettings({ crossfadeSeconds: next });
                  }}
                  className="w-full mt-2 accent-amber-500 cursor-pointer"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2.5 border-t border-zinc-200/70 dark:border-zinc-800/70 gap-3">
              <div>
                <div className="text-sm font-medium">Gapless Playback Preload</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Pre-buffer next track to eliminate pauses between movements.
                </div>
              </div>
              <ToggleSwitch
                checked={settings.gaplessPlayback}
                label="Gapless Playback Preload"
                onChange={() => {
                  tactile.toggle(!settings.gaplessPlayback);
                  onUpdateSettings({ gaplessPlayback: !settings.gaplessPlayback });
                }}
              />
            </div>
          </section>
        )}

        {page === 'devices' && (
          <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-3 sm:p-4 divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
            <div className="flex items-center justify-between pb-2.5 gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Bluetooth className="w-4 h-4 text-blue-500 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">Auto-Play on Bluetooth Connect</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                    Resume playback when headphones or speakers pair.
                  </div>
                </div>
              </div>
              <ToggleSwitch
                checked={settings.autoPlayBluetooth}
                label="Auto-Play on Bluetooth Connect"
                onChange={() => {
                  tactile.toggle(!settings.autoPlayBluetooth);
                  onUpdateSettings({ autoPlayBluetooth: !settings.autoPlayBluetooth });
                }}
              />
            </div>

            <div className="flex items-center justify-between py-2.5 gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <HardDrive className="w-4 h-4 text-zinc-500 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">Offline Mode Only</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                    Display only locally stored and cached tracks.
                  </div>
                </div>
              </div>
              <ToggleSwitch
                checked={settings.offlineMode}
                label="Offline Mode Only"
                onChange={() => {
                  tactile.toggle(!settings.offlineMode);
                  onUpdateSettings({ offlineMode: !settings.offlineMode });
                }}
              />
            </div>

            <div className="flex items-center justify-between pt-2.5 gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <BatteryCharging className="w-4 h-4 text-emerald-500 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">Low Battery Mode</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                    Pause live spectrum animation to conserve battery.
                  </div>
                </div>
              </div>
              <ToggleSwitch
                checked={settings.lowBatteryMode}
                label="Low Battery Mode"
                onChange={() => {
                  tactile.toggle(!settings.lowBatteryMode);
                  onUpdateSettings({ lowBatteryMode: !settings.lowBatteryMode });
                }}
              />
            </div>
          </section>
        )}

        {page === 'theme' && (
          <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-3 sm:p-4 space-y-2.5">
            <div className="divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
              <div className="flex items-center justify-between pb-2 gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  {settings.themeMode === 'dark' ? (
                    <Moon className="w-4 h-4 text-zinc-400 shrink-0" />
                  ) : (
                    <Sun className="w-4 h-4 text-amber-500 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-medium">Dark Mode</div>
                  </div>
                </div>
                <ToggleSwitch
                  checked={settings.themeMode === 'dark'}
                  label="Dark Mode"
                  onChange={() => {
                    const nextMode = settings.themeMode === 'dark' ? 'light' : 'dark';
                    tactile.toggle(nextMode === 'dark');
                    onUpdateSettings({ themeMode: nextMode });
                  }}
                />
              </div>

              <div className="flex items-center justify-between py-2 gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Volume2 className="w-4 h-4 text-zinc-500 shrink-0" />
                  <div className="text-sm font-medium truncate">Acoustic UI Sounds</div>
                </div>
                <ToggleSwitch
                  checked={settings.tactileSounds !== false}
                  label="Acoustic UI Sounds"
                  onChange={() => {
                    const next = settings.tactileSounds === false;
                    tactile.configure(next, settings.hapticFeedback !== false);
                    if (next) tactile.toggle(true);
                    onUpdateSettings({ tactileSounds: next });
                  }}
                />
              </div>

              <div className="flex items-center justify-between pt-2 gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Vibrate className="w-4 h-4 text-zinc-500 shrink-0" />
                  <div className="text-sm font-medium truncate">Haptic Touch Feedback</div>
                </div>
                <ToggleSwitch
                  checked={settings.hapticFeedback !== false}
                  label="Haptic Touch Feedback"
                  onChange={() => {
                    const next = settings.hapticFeedback === false;
                    tactile.configure(settings.tactileSounds !== false, next);
                    tactile.toggle(next);
                    onUpdateSettings({ hapticFeedback: next });
                  }}
                />
              </div>
            </div>

            <div className="pt-2 border-t border-zinc-200/70 dark:border-zinc-800/70">
              <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
                Interface Accent Color
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {ACCENTS.map((acc) => {
                  const active = settings.themeAccent === acc.id;
                  return (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() => {
                        tactile.tap();
                        onUpdateSettings({ themeAccent: acc.id });
                      }}
                      className={`min-h-[34px] px-1.5 rounded-lg border text-[11px] font-medium flex items-center justify-center gap-1 active:scale-95 transition-all duration-100 ${
                        active
                          ? 'border-zinc-900 dark:border-white bg-zinc-100 dark:bg-zinc-800'
                          : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${acc.colorClass}`} />
                      <span className="truncate">{acc.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {page === 'widgets' && (
          <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-3 sm:p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Smartphone className="w-4 h-4 text-zinc-500 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">Top Floating Player Widget</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                    Pin mini-controller at top or use Android home widgets (4×1 / 4×2).
                  </div>
                </div>
              </div>
              <ToggleSwitch
                checked={settings.showHomescreenWidget}
                label="Top Floating Player Widget"
                onChange={() => {
                  tactile.toggle(!settings.showHomescreenWidget);
                  onUpdateSettings({ showHomescreenWidget: !settings.showHomescreenWidget });
                }}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-zinc-200/70 dark:border-zinc-800/70">
              <button
                type="button"
                onClick={() => {
                  tactile.tap();
                  onUpdateSettings({ showHomescreenWidget: true, widgetVariant: 'top-bar' });
                }}
                className={`p-3 rounded-xl border text-left transition-colors ${
                  (settings.widgetVariant || 'top-bar') === 'top-bar'
                    ? 'accent-soft-bg border-amber-500/60'
                    : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                }`}
              >
                <div className="text-xs sm:text-sm font-semibold">Compact Top Bar (4×1)</div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Slim bar with cover art, title, Play/Pause & track skip.
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  tactile.tap();
                  onUpdateSettings({ showHomescreenWidget: true, widgetVariant: 'studio-deck' });
                }}
                className={`p-3 rounded-xl border text-left transition-colors ${
                  settings.widgetVariant === 'studio-deck'
                    ? 'accent-soft-bg border-amber-500/60'
                    : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                }`}
              >
                <div className="text-xs sm:text-sm font-semibold">Studio Deck Card (4×2)</div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Large cover art, codec telemetry, favorite & controls.
                </div>
              </button>
            </div>
          </section>
        )}

        {page === 'storage' && (
          <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-3 sm:p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-zinc-200/70 dark:border-zinc-800/70">
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Offline Cache
              </span>
              <span className="text-xs font-mono-tabular text-zinc-700 dark:text-zinc-300">
                {cacheStats.count} cached · {formatMb(cacheStats.totalBytes)}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  tactile.tap();
                  onClearCache();
                }}
                className="min-h-[40px] px-3.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium flex items-center justify-center gap-2 active:scale-95 transition-transform duration-100"
              >
                <Trash2 className="w-4 h-4" />
                <span>Clear Offline Audio Cache</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  tactile.success();
                  onRepairCyrillicLibrary();
                }}
                className="min-h-[40px] px-3.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium flex items-center justify-center gap-2 active:scale-95 transition-transform duration-100"
              >
                <Wrench className="w-4 h-4" />
                <span>Repair Cyrillic / Mojibake Tags</span>
              </button>
            </div>

            {storageProgress && (
              <ProgressBar
                compact
                label={storageProgress.title}
                detail={storageProgress.detail}
                current={storageProgress.current}
                total={storageProgress.total}
                percent={storageProgress.percent}
                status={storageProgress.status}
              />
            )}
          </section>
        )}

        {page === 'cloud' && (
          <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-3 sm:p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl accent-soft-bg flex items-center justify-center shrink-0">
                  <Cloud className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-display font-semibold truncate">
                    {user ? user.displayName || 'Gmail Connected' : 'Cross-Device Gmail Backup'}
                  </h3>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                    {user
                      ? user.email
                      : 'Sign in with Gmail to sync playlists & EQ presets.'}
                  </p>
                </div>
              </div>

              {user ? (
                <button
                  type="button"
                  onClick={onSignOutGoogle}
                  className="min-h-[36px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium flex items-center gap-1.5 active:scale-95 transition-transform duration-100"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onSignInGoogle}
                  className="min-h-[38px] px-3.5 rounded-lg accent-bg text-xs font-medium flex items-center gap-1.5 active:scale-95 transition-transform duration-100"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Sign in with Gmail</span>
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2.5 border-t border-zinc-200/70 dark:border-zinc-800/70">
              <button
                type="button"
                disabled={!user || syncBusy}
                onClick={onBackupNow}
                className="min-h-[36px] px-3 rounded-lg accent-bg text-xs font-medium flex items-center gap-1.5 active:scale-95 transition-transform duration-100 disabled:opacity-40"
              >
                {syncBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudUpload className="w-3.5 h-3.5" />}
                <span>Backup</span>
              </button>

              <button
                type="button"
                disabled={!user || syncBusy}
                onClick={onRestoreNow}
                className="min-h-[36px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium flex items-center gap-1.5 active:scale-95 transition-transform duration-100 disabled:opacity-40"
              >
                <CloudDownload className="w-3.5 h-3.5" />
                <span>Restore</span>
              </button>

              <div className="flex items-center gap-2 ml-auto">
                <span className="text-xs text-zinc-600 dark:text-zinc-400">Auto</span>
                <ToggleSwitch
                  checked={settings.autoCloudBackup}
                  label="Auto-sync changes"
                  onChange={() => {
                    tactile.toggle(!settings.autoCloudBackup);
                    onUpdateSettings({ autoCloudBackup: !settings.autoCloudBackup });
                  }}
                />
              </div>
            </div>

            {syncProgress && (
              <ProgressBar
                compact
                label={syncProgress.title}
                detail={syncProgress.detail}
                current={syncProgress.current}
                total={syncProgress.total}
                percent={syncProgress.percent}
                status={syncProgress.status}
              />
            )}

            {syncMessage && (
              <div className="text-[11px] text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-950 px-2.5 py-1.5 rounded-lg truncate">
                {syncMessage}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
};
