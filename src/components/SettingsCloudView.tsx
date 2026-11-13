import React, { useState } from 'react';
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
import { AppSettings, StreamingQuality, ThemeAccent } from '../types/music';
import { tactile } from '../services/tactileFeedback';

type SettingsSection = 'all' | 'audio' | 'appearance' | 'storage' | 'cloud';

interface SettingsCloudViewProps {
  user: User | null;
  settings: AppSettings;
  cacheStats: { count: number; totalBytes: number };
  syncBusy: boolean;
  syncMessage: string | null;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onSignInGoogle: () => void;
  onSignOutGoogle: () => void;
  onBackupNow: () => void;
  onRestoreNow: () => void;
  onClearCache: () => void;
  onRepairCyrillicLibrary: () => void;
}

const ACCENTS: Array<{ id: ThemeAccent; label: string; colorClass: string }> = [
  { id: 'amber', label: 'Warm Amber', colorClass: 'bg-amber-600' },
  { id: 'cobalt', label: 'Studio Cobalt', colorClass: 'bg-blue-600' },
  { id: 'emerald', label: 'Reference Emerald', colorClass: 'bg-emerald-600' },
  { id: 'crimson', label: 'Vinyl Crimson', colorClass: 'bg-rose-600' },
  { id: 'slate', label: 'Monochrome Slate', colorClass: 'bg-slate-600' },
];

const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'audio', label: 'Audio' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'storage', label: 'Storage' },
  { id: 'cloud', label: 'Cloud Sync' },
];

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
  user,
  settings,
  cacheStats,
  syncBusy,
  syncMessage,
  onUpdateSettings,
  onSignInGoogle,
  onSignOutGoogle,
  onBackupNow,
  onRestoreNow,
  onClearCache,
  onRepairCyrillicLibrary,
}) => {
  const [section, setSection] = useState<SettingsSection>('all');
  const formatMb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  const showAudio = section === 'all' || section === 'audio';
  const showAppearance = section === 'all' || section === 'appearance';
  const showStorage = section === 'all' || section === 'storage';
  const showCloud = section === 'all' || section === 'cloud';

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header + Segmented Quick Filter */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-4">
        <div>
          <h2 className="text-xl font-display font-semibold text-zinc-900 dark:text-zinc-100">
            Settings & Cloud
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Audio quality, appearance, offline storage, and Gmail cloud sync.
          </p>
        </div>

        <div className="inline-flex items-center p-1 rounded-lg bg-zinc-200/70 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-x-auto max-w-full">
          {SETTINGS_SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                tactile.tap();
                setSection(item.id);
              }}
              className={`min-h-[34px] px-3 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                section === item.id
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* 1. Audio Engine & Playback */}
      {showAudio && (
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5 space-y-5">
          <h3 className="text-base font-display font-semibold">Audio Engine & Playback</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
                Streaming & Output Quality
              </label>
              <select
                value={settings.streamingQuality}
                onChange={(e) =>
                  onUpdateSettings({ streamingQuality: e.target.value as StreamingQuality })
                }
                className="w-full min-h-[44px] px-3 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
              >
                <option value="lossless-hires">Lossless Hi-Res (24-bit / 192 kHz)</option>
                <option value="cd-lossless">CD Lossless (16-bit / 44.1 kHz)</option>
                <option value="high-320">High Quality (320 kbps)</option>
                <option value="data-saver">Data Saver (128 kbps)</option>
              </select>
            </div>

            <div>
              <div className="flex justify-between text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
                <span>Crossfade Duration</span>
                <span className="font-mono-tabular">
                  {settings.crossfadeSeconds === 0
                    ? '0s (Pure Gapless)'
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

          <div className="divide-y divide-zinc-200/70 dark:divide-zinc-800/70 border-t border-zinc-200/70 dark:border-zinc-800/70 pt-1">
            <div className="flex items-center justify-between py-3 gap-4">
              <div>
                <div className="text-sm font-medium">Gapless Playback Preload</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Pre-buffer the upcoming track to eliminate pauses between movements.
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

            <div className="flex items-center justify-between py-3 gap-4">
              <div className="flex items-start gap-2.5">
                <Bluetooth className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                <div>
                  <div className="text-sm font-medium">Auto-Play on Bluetooth Connect</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    Automatically resume playback when headphones or speakers connect.
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
          </div>
        </section>
      )}

      {/* 2. Appearance & Theme Colors */}
      {showAppearance && (
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5 space-y-5">
          <h3 className="text-base font-display font-semibold">Appearance & Homescreen Widget</h3>

          <div className="divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
            <div className="flex items-center justify-between pb-3 gap-4">
              <div className="flex items-center gap-2.5">
                {settings.themeMode === 'dark' ? (
                  <Moon className="w-4 h-4 text-zinc-400" />
                ) : (
                  <Sun className="w-4 h-4 text-amber-500" />
                )}
                <div>
                  <div className="text-sm font-medium">Dark Mode</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    Switch between studio dark and crisp daylight surfaces.
                  </div>
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

            <div className="flex items-center justify-between py-3 gap-4">
              <div className="flex items-center gap-2.5">
                <Smartphone className="w-4 h-4 text-zinc-500" />
                <div>
                  <div className="text-sm font-medium">Floating Homescreen Widget</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    Keep a compact mini-controller floating above your workspace.
                  </div>
                </div>
              </div>
              <ToggleSwitch
                checked={settings.showHomescreenWidget}
                label="Floating Homescreen Widget"
                onChange={() => {
                  tactile.toggle(!settings.showHomescreenWidget);
                  onUpdateSettings({ showHomescreenWidget: !settings.showHomescreenWidget });
                }}
              />
            </div>

            <div className="flex items-center justify-between py-3 gap-4">
              <div className="flex items-center gap-2.5">
                <Volume2 className="w-4 h-4 text-zinc-500" />
                <div>
                  <div className="text-sm font-medium">Acoustic UI Sounds</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    Subtle studio micro-clicks, slider index detents, and warm chimes.
                  </div>
                </div>
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

            <div className="flex items-center justify-between py-3 gap-4">
              <div className="flex items-center gap-2.5">
                <Vibrate className="w-4 h-4 text-zinc-500" />
                <div>
                  <div className="text-sm font-medium">Haptic Touch Feedback</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    Gentle vibration pulses on slider notches, likes, and transport controls.
                  </div>
                </div>
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
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2.5">
              Interface Accent Theme
            </div>
            <div className="flex flex-wrap gap-2">
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
                    className={`min-h-[40px] px-3.5 rounded-lg border text-xs font-medium flex items-center gap-2 active:scale-95 transition-all duration-100 ${
                      active
                        ? 'border-zinc-900 dark:border-white bg-zinc-100 dark:bg-zinc-800'
                        : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                    }`}
                  >
                    <span className={`w-3 h-3 rounded-full ${acc.colorClass}`} />
                    <span>{acc.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* 3. Offline Storage & Battery */}
      {showStorage && (
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-display font-semibold">Offline Storage & Power</h3>
            <span className="text-xs font-mono-tabular text-zinc-500">
              {cacheStats.count} cached tracks · {formatMb(cacheStats.totalBytes)}
            </span>
          </div>

          <div className="divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
            <div className="flex items-center justify-between py-3 gap-4">
              <div className="flex items-center gap-2.5">
                <HardDrive className="w-4 h-4 text-zinc-500 shrink-0" />
                <div>
                  <div className="text-sm font-medium">Offline Mode Only</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    Show only locally stored and offline-cached tracks in your library.
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

            <div className="flex items-center justify-between py-3 gap-4">
              <div className="flex items-center gap-2.5">
                <BatteryCharging className="w-4 h-4 text-emerald-500 shrink-0" />
                <div>
                  <div className="text-sm font-medium">Low Battery Mode</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    Disable real-time spectrum canvas animations to conserve power.
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
          </div>

          <div className="flex flex-wrap gap-2.5 pt-2 border-t border-zinc-200/70 dark:border-zinc-800/70">
            <button
              type="button"
              onClick={() => {
                tactile.tap();
                onClearCache();
              }}
              className="min-h-[42px] px-4 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium flex items-center gap-2 active:scale-95 transition-transform duration-100"
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
              className="min-h-[42px] px-4 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium flex items-center gap-2 active:scale-95 transition-transform duration-100"
            >
              <Wrench className="w-4 h-4" />
              <span>Repair Cyrillic / Mojibake Tags</span>
            </button>
          </div>
        </section>
      )}

      {/* 4. Cloud Sync & Gmail Account Backup / Restore */}
      {showCloud && (
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl accent-soft-bg flex items-center justify-center shrink-0">
                <Cloud className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-display font-semibold">
                  {user ? user.displayName || 'Gmail Connected' : 'Cross-Device Cloud Backup & Sync'}
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {user
                    ? `${user.email} · Settings, EQ presets, playlists, playback point & ratings sync automatically.`
                    : 'Optional: Sign in with Gmail to back up your library state and unlock AI Smart Studio.'}
                </p>
              </div>
            </div>

            {user ? (
              <button
                type="button"
                onClick={onSignOutGoogle}
                className="min-h-[42px] px-4 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium flex items-center gap-2 active:scale-95 transition-transform duration-100"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onSignInGoogle}
                className="min-h-[44px] px-5 rounded-lg accent-bg text-sm font-medium flex items-center gap-2 active:scale-95 transition-transform duration-100"
              >
                <LogIn className="w-4 h-4" />
                <span>Sign in with Gmail</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-zinc-200/70 dark:border-zinc-800/70">
            <button
              type="button"
              disabled={!user || syncBusy}
              onClick={onBackupNow}
              className="min-h-[42px] px-4 rounded-lg accent-bg text-sm font-medium flex items-center gap-2 active:scale-95 transition-transform duration-100 disabled:opacity-40"
            >
              {syncBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudUpload className="w-4 h-4" />}
              <span>Backup Now</span>
            </button>

            <button
              type="button"
              disabled={!user || syncBusy}
              onClick={onRestoreNow}
              className="min-h-[42px] px-4 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm font-medium flex items-center gap-2 active:scale-95 transition-transform duration-100 disabled:opacity-40"
            >
              <CloudDownload className="w-4 h-4" />
              <span>Restore from Cloud</span>
            </button>

            <div className="flex items-center gap-2.5 ml-auto">
              <span className="text-xs text-zinc-600 dark:text-zinc-400">Auto-sync</span>
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

          {syncMessage && (
            <div className="text-xs text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-950 px-3 py-2 rounded-lg">
              {syncMessage}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
