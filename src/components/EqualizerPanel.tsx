import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, RotateCcw, Sliders, Trash2 } from 'lucide-react';
import { EQ_FREQUENCIES } from '../data/seedLibrary';
import { EQPreset } from '../types/music';
import { PaginationBar } from './PaginationBar';
import { useViewportPageSize } from '../hooks/useViewportPageSize';
import { tactile } from '../services/tactileFeedback';

export type EqualizerPage = 'rack' | 'presets';

interface EqualizerPanelProps {
  page: EqualizerPage;
  enabled: boolean;
  bands: number[];
  preampDb: number;
  activePresetId: string;
  presets: EQPreset[];
  onChangePage?: (page: EqualizerPage) => void;
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

function buildCurvePath(bands: number[], enabled: boolean, width = 600, height = 80): string {
  const midY = height / 2;
  const pts = bands.map((db, idx) => {
    const x = (idx / Math.max(1, bands.length - 1)) * width;
    const y = midY - ((enabled ? db : 0) / 12) * (height * 0.4);
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
}

export const EqualizerPanel: React.FC<EqualizerPanelProps> = ({
  page,
  enabled,
  bands,
  preampDb,
  activePresetId,
  presets,
  onChangePage,
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
  const [mobileBank, setMobileBank] = useState<'low' | 'high'>('low');
  const [presetPage, setPresetPage] = useState(0);
  const [rackHeight, setRackHeight] = useState(140);

  const rackSlotRef = useRef<HTMLDivElement | null>(null);
  const presetsViewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = rackSlotRef.current;
    if (!el || page !== 'rack') return;
    const update = () => {
      const h = Math.max(84, Math.min(200, Math.floor(el.getBoundingClientRect().height - 54)));
      setRackHeight(h);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [page]);

  const presetLayout = useViewportPageSize(presetsViewportRef, {
    mode: 'grid',
    gridMinCardWidth: 210,
    fixedGridCardHeight: 96,
    gridGap: 10,
    maxColumns: 3,
    verticalPadding: 6,
  });

  const totalPresetPages = Math.max(1, Math.ceil(presets.length / presetLayout.pageSize));
  const safePresetPage = Math.max(0, Math.min(totalPresetPages - 1, presetPage));
  const pagedPresets = useMemo(() => {
    const start = safePresetPage * presetLayout.pageSize;
    return presets.slice(start, start + presetLayout.pageSize);
  }, [presets, safePresetPage, presetLayout.pageSize]);

  const activePreset = presets.find((p) => p.id === activePresetId);
  const curvePath = useMemo(() => buildCurvePath(bands, enabled, 600, 80), [bands, enabled]);

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
    <div className="h-full min-h-0 flex flex-col gap-3 overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2.5 pb-2.5 border-b border-zinc-200 dark:border-zinc-800">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg sm:text-xl font-display font-semibold text-zinc-900 dark:text-zinc-100 truncate">
              {page === 'rack' ? '10-Band Equalizer' : 'Sound Presets'}
            </h2>
            <span className="text-xs font-mono-tabular text-zinc-500 dark:text-zinc-400 truncate">
              · {activePreset ? activePreset.name : 'Custom'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {onChangePage && (
            <div className="inline-flex items-center p-0.5 rounded-lg bg-zinc-200/75 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => {
                  tactile.tap();
                  onChangePage('rack');
                }}
                className={`min-h-[32px] px-2.5 rounded-md text-xs font-medium transition-colors ${
                  page === 'rack'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-500'
                }`}
              >
                Faders
              </button>
              <button
                type="button"
                onClick={() => {
                  tactile.tap();
                  onChangePage('presets');
                }}
                className={`min-h-[32px] px-2.5 rounded-md text-xs font-medium transition-colors ${
                  page === 'presets'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-500'
                }`}
              >
                Presets
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              tactile.toggle(!enabled);
              onToggleEnabled();
            }}
            className={`min-h-[36px] px-3 rounded-lg text-xs font-medium active:scale-95 transition-all duration-100 whitespace-nowrap shrink-0 ${
              enabled
                ? 'accent-bg'
                : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
            }`}
          >
            {enabled ? 'Active' : 'Bypassed'}
          </button>
          <button
            type="button"
            onClick={() => {
              tactile.eqDetent();
              onResetFlat();
            }}
            className="min-h-[36px] px-2.5 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 flex items-center gap-1.5 active:scale-95 transition-transform duration-100 whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Flat</span>
          </button>
        </div>
      </div>

      {page === 'rack' ? (
        <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
          {/* Compact Frequency Curve Visualization */}
          <div className="shrink-0 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 px-3.5 py-2.5">
            <div className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400 mb-1">
              <span className="flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5" />
                <span>Target Response Curve</span>
              </span>
              <span className="font-mono-tabular">
                Preamp {preampDb > 0 ? `+${preampDb.toFixed(1)}` : preampDb.toFixed(1)} dB
              </span>
            </div>
            <svg viewBox="0 0 600 80" className="w-full h-14 sm:h-20 [@media(max-height:520px)]:h-10 overflow-visible">
              <line x1="0" y1="40" x2="600" y2="40" stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" strokeDasharray="4 4" />
              <line x1="0" y1="12" x2="600" y2="12" stroke="currentColor" className="text-zinc-100 dark:text-zinc-800/50" />
              <line x1="0" y1="68" x2="600" y2="68" stroke="currentColor" className="text-zinc-100 dark:text-zinc-800/50" />
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

          {/* Mobile Band Bank Switcher (eliminates horizontal scroll on narrow phones) */}
          <div className="sm:hidden shrink-0 flex items-center justify-between gap-2">
            <div className="flex-1 grid grid-cols-2 p-0.5 rounded-lg bg-zinc-200/75 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => {
                  tactile.tap();
                  setMobileBank('low');
                }}
                className={`min-h-[34px] rounded-md text-xs font-medium transition-colors ${
                  mobileBank === 'low'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-500'
                }`}
              >
                Pre + Low (31–500)
              </button>
              <button
                type="button"
                onClick={() => {
                  tactile.tap();
                  setMobileBank('high');
                }}
                className={`min-h-[34px] rounded-md text-xs font-medium transition-colors ${
                  mobileBank === 'high'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-500'
                }`}
              >
                High & Air (1k–16k)
              </button>
            </div>
          </div>

          {/* Fixed Height-Fitted Fader Rack (No Horizontal or Vertical Scroll) */}
          <div
            ref={rackSlotRef}
            className="flex-1 min-h-0 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 p-3 sm:p-4 overflow-hidden flex items-center"
          >
            {/* Mobile Banked View (< 640px) */}
            <div className="w-full h-full grid grid-cols-6 sm:hidden gap-1 items-center">
              {mobileBank === 'low' ? (
                <>
                  <div className="flex flex-col items-center justify-between h-full py-1 border-r border-zinc-200 dark:border-zinc-800 pr-1">
                    <button
                      type="button"
                      onClick={() => {
                        tactile.eqDetent();
                        onChangePreamp(0);
                      }}
                      className="text-[11px] font-mono-tabular px-1 py-0.5 rounded text-zinc-700 dark:text-zinc-300"
                    >
                      {preampDb > 0 ? `+${preampDb.toFixed(1)}` : preampDb.toFixed(1)}
                    </button>
                    <div style={{ height: `${rackHeight}px` }} className="flex items-center justify-center">
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
                        style={{ width: `${rackHeight}px` }}
                        className="-rotate-90 accent-amber-500 cursor-pointer"
                      />
                    </div>
                    <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">PRE</span>
                  </div>

                  {EQ_FREQUENCIES.slice(0, 5).map((freq, idx) => {
                    const val = bands[idx] ?? 0;
                    return (
                      <div key={freq} className="flex flex-col items-center justify-between h-full py-1">
                        <button
                          type="button"
                          onClick={() => {
                            tactile.eqDetent();
                            onChangeBand(idx, 0);
                          }}
                          className="text-[11px] font-mono-tabular px-1 py-0.5 rounded text-zinc-700 dark:text-zinc-300"
                        >
                          {val > 0 ? `+${val.toFixed(1)}` : val.toFixed(1)}
                        </button>
                        <div style={{ height: `${rackHeight}px` }} className="flex items-center justify-center">
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
                            style={{ width: `${rackHeight}px` }}
                            className="-rotate-90 accent-amber-500 cursor-pointer disabled:opacity-40"
                          />
                        </div>
                        <span className="text-[11px] font-mono-tabular text-zinc-500 dark:text-zinc-400">
                          {formatFreqLabel(freq)}
                        </span>
                      </div>
                    );
                  })}
                </>
              ) : (
                EQ_FREQUENCIES.slice(5).map((freq, offset) => {
                  const idx = offset + 5;
                  const val = bands[idx] ?? 0;
                  return (
                    <div key={freq} className="flex flex-col items-center justify-between h-full py-1 col-span-1">
                      <button
                        type="button"
                        onClick={() => {
                          tactile.eqDetent();
                          onChangeBand(idx, 0);
                        }}
                        className="text-[11px] font-mono-tabular px-1 py-0.5 rounded text-zinc-700 dark:text-zinc-300"
                      >
                        {val > 0 ? `+${val.toFixed(1)}` : val.toFixed(1)}
                      </button>
                      <div style={{ height: `${rackHeight}px` }} className="flex items-center justify-center">
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
                          style={{ width: `${rackHeight}px` }}
                          className="-rotate-90 accent-amber-500 cursor-pointer disabled:opacity-40"
                        />
                      </div>
                      <span className="text-[11px] font-mono-tabular text-zinc-500 dark:text-zinc-400">
                        {formatFreqLabel(freq)}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            {/* Tablet / Desktop Full 11-Column Rack (>= 640px) */}
            <div className="hidden sm:grid w-full h-full grid-cols-11 gap-1.5 items-center">
              <div className="flex flex-col items-center justify-between h-full py-1 pr-2 border-r border-zinc-200 dark:border-zinc-800">
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
                <div style={{ height: `${rackHeight}px` }} className="flex items-center justify-center">
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
                    style={{ width: `${rackHeight}px` }}
                    className="-rotate-90 accent-amber-500 cursor-pointer"
                  />
                </div>
                <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">PRE</span>
              </div>

              {EQ_FREQUENCIES.map((freq, idx) => {
                const val = bands[idx] ?? 0;
                return (
                  <div key={freq} className="flex flex-col items-center justify-between h-full py-1">
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
                    <div style={{ height: `${rackHeight}px` }} className="flex items-center justify-center">
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
                        style={{ width: `${rackHeight}px` }}
                        className="-rotate-90 accent-amber-500 cursor-pointer disabled:opacity-40"
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
      ) : (
        /* Dedicated Unscrollable Paginated Presets Page */
        <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
          <div className="shrink-0 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Select a studio reference curve or save your current EQ settings.
            </p>
            <button
              type="button"
              onClick={() => setShowSaveForm((s) => !s)}
              className="min-h-[36px] px-3 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 flex items-center gap-1.5 text-zinc-700 dark:text-zinc-200 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Save Current Curve</span>
            </button>
          </div>

          {showSaveForm && (
            <form onSubmit={handleSaveSubmit} className="shrink-0 flex items-center gap-2">
              <input
                type="text"
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                placeholder="Preset name (e.g. Planar Open-Back)"
                maxLength={40}
                className="flex-1 min-h-[40px] px-3 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              />
              <button
                type="submit"
                className="min-h-[40px] px-4 rounded-lg accent-bg text-xs font-medium whitespace-nowrap"
              >
                Save
              </button>
            </form>
          )}

          <div ref={presetsViewportRef} className="flex-1 min-h-0 overflow-hidden">
            <div
              style={{
                gridTemplateColumns: `repeat(${presetLayout.columns}, minmax(0, 1fr))`,
              }}
              className="grid gap-2.5"
            >
              {pagedPresets.map((preset) => {
                const active = preset.id === activePresetId;
                const miniCurve = buildCurvePath(preset.bands, true, 160, 28);
                return (
                  <div
                    key={preset.id}
                    className={`rounded-xl border p-3 flex flex-col justify-between gap-2 transition-colors h-[94px] ${
                      active
                        ? 'border-amber-500/70 bg-amber-500/10'
                        : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          tactile.tap();
                          onSelectPreset(preset);
                        }}
                        className="text-left min-w-0 flex-1"
                      >
                        <div
                          className={`text-sm font-semibold truncate ${
                            active ? 'accent-text' : 'text-zinc-900 dark:text-zinc-100'
                          }`}
                        >
                          {preset.name}
                        </div>
                        <div className="text-[11px] font-mono-tabular text-zinc-500">
                          {preset.isBuiltIn ? 'Reference' : 'Custom'} · Preamp{' '}
                          {preset.preampDb > 0 ? `+${preset.preampDb}` : preset.preampDb} dB
                        </div>
                      </button>

                      {!preset.isBuiltIn && (
                        <button
                          type="button"
                          aria-label={`Delete ${preset.name}`}
                          onClick={() => {
                            tactile.tap();
                            onDeletePreset(preset.id);
                          }}
                          className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-400 hover:text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        tactile.tap();
                        onSelectPreset(preset);
                      }}
                      className="w-full"
                    >
                      <svg viewBox="0 0 160 28" className="w-full h-7 overflow-visible">
                        <line x1="0" y1="14" x2="160" y2="14" stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" strokeDasharray="3 3" />
                        <path d={miniCurve} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <PaginationBar
            page={safePresetPage}
            totalPages={totalPresetPages}
            totalItems={presets.length}
            pageSize={presetLayout.pageSize}
            onChangePage={setPresetPage}
            itemLabel="presets"
          />
        </div>
      )}
    </div>
  );
};
