import React, { useMemo, useState } from 'react';
import { Plus, RotateCcw, Sliders, Trash2 } from 'lucide-react';
import { EQ_FREQUENCIES } from '../data/seedLibrary';
import { EQPreset } from '../types/music';
import { tactile } from '../services/tactileFeedback';

interface EqualizerPanelProps {
  enabled: boolean;
  bands: number[];
  preampDb: number;
  activePresetId: string;
  presets: EQPreset[];
  onToggleEnabled: () => void;
  onChangeBand: (index: number, db: number) => void;
  onChangePreamp: (db: number) => void;
  onSelectPreset: (preset: EQPreset) => void;
  onSaveCustomPreset: (name: string) => void;
  onDeletePreset: (id: string) => void;
  onResetFlat: () => void;
}

function formatFreqLabel(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : `${hz}`;
}

export const EqualizerPanel: React.FC<EqualizerPanelProps> = ({
  enabled,
  bands,
  preampDb,
  activePresetId,
  presets,
  onToggleEnabled,
  onChangeBand,
  onChangePreamp,
  onSelectPreset,
  onSaveCustomPreset,
  onDeletePreset,
  onResetFlat,
}) => {
  const [newPresetName, setNewPresetName] = useState('');
  const [showSaveForm, setShowSaveForm] = useState(false);

  const curvePath = useMemo(() => {
    const width = 600;
    const height = 100;
    const midY = height / 2;
    const pts = bands.map((db, idx) => {
      const x = (idx / (bands.length - 1)) * width;
      const y = midY - ((enabled ? db : 0) / 12) * (height * 0.42);
      return { x, y };
    });
    if (pts.length === 0) return '';
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const xc = (pts[i].x + pts[i + 1].x) / 2;
      const yc = (pts[i].y + pts[i + 1].y) / 2;
      d += ` Q ${pts[i].x} ${pts[i].y}, ${xc} ${yc}`;
    }
    const last = pts[pts.length - 1];
    d += ` T ${last.x} ${last.y}`;
    return d;
  }, [bands, enabled]);

  const handleSaveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newPresetName.trim();
    if (!clean) return;
    tactile.success();
    onSaveCustomPreset(clean);
    setNewPresetName('');
    setShowSaveForm(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-4">
        <div>
          <h2 className="text-xl font-display font-semibold text-zinc-900 dark:text-zinc-100">
            10-Band Parametric Equalizer
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Real-time Web Audio biquad shaping from 31 Hz sub-bass to 16 kHz air.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              tactile.toggle(!enabled);
              onToggleEnabled();
            }}
            className={`min-h-[42px] px-4 py-2 rounded-lg text-sm font-medium active:scale-95 transition-all duration-100 whitespace-nowrap shrink-0 ${
              enabled
                ? 'accent-bg'
                : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
            }`}
          >
            {enabled ? 'EQ Active' : 'Bypassed'}
          </button>
          <button
            type="button"
            onClick={() => {
              tactile.eqDetent();
              onResetFlat();
            }}
            className="min-h-[42px] px-3.5 py-2 rounded-lg text-sm font-medium border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 flex items-center gap-2 active:scale-95 transition-transform duration-100 whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Flat</span>
          </button>
        </div>
      </div>

      {/* Presets Strip */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Sound Profiles
          </span>
          <button
            type="button"
            onClick={() => setShowSaveForm((s) => !s)}
            className="min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 flex items-center gap-1.5 text-zinc-700 dark:text-zinc-200 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Save Custom Preset</span>
          </button>
        </div>

        {showSaveForm && (
          <form onSubmit={handleSaveSubmit} className="flex items-center gap-2">
            <input
              type="text"
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              placeholder="Preset name (e.g. Planar Open-Back)"
              maxLength={40}
              className="flex-1 min-h-[42px] px-3 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40"
            />
            <button
              type="submit"
              className="min-h-[42px] px-4 py-2 rounded-lg accent-bg text-sm font-medium whitespace-nowrap"
            >
              Save
            </button>
          </form>
        )}

        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => {
            const active = preset.id === activePresetId;
            return (
              <div key={preset.id} className="inline-flex items-center">
                <button
                  type="button"
                  onClick={() => {
                    tactile.tap();
                    onSelectPreset(preset);
                  }}
                  className={`min-h-[40px] px-3.5 py-2 text-xs font-medium active:scale-95 transition-all duration-100 whitespace-nowrap ${
                    preset.isBuiltIn ? 'rounded-lg' : 'rounded-l-lg'
                  } ${
                    active
                      ? 'accent-bg'
                      : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-800'
                  }`}
                >
                  {preset.name}
                </button>
                {!preset.isBuiltIn && (
                  <button
                    type="button"
                    aria-label={`Delete ${preset.name}`}
                    onClick={() => {
                      tactile.tap();
                      onDeletePreset(preset.id);
                    }}
                    className="min-h-[40px] px-2.5 rounded-r-lg border border-l-0 border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 text-zinc-500 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Frequency Curve Visualization */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 p-4">
        <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 mb-2">
          <span className="flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5" />
            <span>Target Response Curve</span>
          </span>
          <span className="font-mono-tabular">
            Preamp {preampDb > 0 ? `+${preampDb.toFixed(1)}` : preampDb.toFixed(1)} dB
          </span>
        </div>
        <svg viewBox="0 0 600 100" className="w-full h-24 overflow-visible">
          <line x1="0" y1="50" x2="600" y2="50" stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" strokeDasharray="4 4" />
          <line x1="0" y1="15" x2="600" y2="15" stroke="currentColor" className="text-zinc-100 dark:text-zinc-800/50" />
          <line x1="0" y1="85" x2="600" y2="85" stroke="currentColor" className="text-zinc-100 dark:text-zinc-800/50" />
          <path
            d={curvePath}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2.5"
            strokeLinecap="round"
            className={enabled ? 'opacity-100' : 'opacity-35'}
          />
        </svg>
      </div>

      {/* Horizontally Scrollable 10-Band Rack + Preamp */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 p-4 overflow-x-auto">
        <div className="min-w-[560px] grid grid-cols-11 gap-2 items-end">
          {/* Preamp Slider */}
          <div className="flex flex-col items-center gap-2 pr-2 border-r border-zinc-200 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => {
                tactile.eqDetent();
                onChangePreamp(0);
              }}
              title="Tap to reset preamp to 0.0 dB"
              className="text-[11px] font-mono-tabular px-1.5 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
            >
              {preampDb > 0 ? `+${preampDb.toFixed(1)}` : preampDb.toFixed(1)}
            </button>
            <div className="h-40 flex items-center justify-center">
              <input
                type="range"
                aria-label="Preamp gain"
                min={-12}
                max={12}
                step={0.5}
                value={preampDb}
                onChange={(e) => {
                  const next = parseFloat(e.target.value);
                  if (next === 0 && preampDb !== 0) tactile.eqDetent();
                  onChangePreamp(next);
                }}
                className="w-36 -rotate-90 accent-amber-500 cursor-pointer"
              />
            </div>
            <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">PRE</span>
          </div>

          {/* 10 Frequency Bands */}
          {EQ_FREQUENCIES.map((freq, idx) => {
            const val = bands[idx] ?? 0;
            return (
              <div key={freq} className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    tactile.eqDetent();
                    onChangeBand(idx, 0);
                  }}
                  title="Tap to reset band to 0.0 dB"
                  className="text-[11px] font-mono-tabular px-1.5 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                >
                  {val > 0 ? `+${val.toFixed(1)}` : val.toFixed(1)}
                </button>
                <div className="h-40 flex items-center justify-center">
                  <input
                    type="range"
                    aria-label={`${freq} Hz gain`}
                    min={-12}
                    max={12}
                    step={0.5}
                    value={val}
                    disabled={!enabled}
                    onChange={(e) => {
                      const next = parseFloat(e.target.value);
                      if (next === 0 && val !== 0) tactile.eqDetent();
                      onChangeBand(idx, next);
                    }}
                    className="w-36 -rotate-90 accent-amber-500 cursor-pointer disabled:opacity-40"
                  />
                </div>
                <span className="text-[11px] font-mono-tabular text-zinc-500 dark:text-zinc-400">
                  {formatFreqLabel(freq)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
