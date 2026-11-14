import React from 'react';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

interface ProgressBarProps {
  label: string;
  detail?: string;
  current: number;
  total: number;
  percent: number;
  itemLabel?: string;
  itemCurrent?: number;
  itemTotal?: number;
  itemPercent?: number;
  status?: 'running' | 'done' | 'error';
  compact?: boolean;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  label,
  detail,
  current,
  total,
  percent,
  itemLabel,
  itemCurrent,
  itemTotal,
  itemPercent,
  status = 'running',
  compact = false,
}) => {
  const clampedPct = Math.max(0, Math.min(100, Math.round(percent)));
  const countLabel =
    total > 0 ? `${Math.min(current, total)} / ${total}` : `${clampedPct}%`;

  const resolvedItemPct =
    typeof itemPercent === 'number'
      ? Math.max(0, Math.min(100, Math.round(itemPercent)))
      : itemTotal && itemTotal > 0 && typeof itemCurrent === 'number'
      ? Math.max(0, Math.min(100, Math.round((itemCurrent / itemTotal) * 100)))
      : status === 'done'
      ? 100
      : clampedPct;

  const hasItemBar = Boolean(itemLabel || detail);
  const effectiveItemText = itemLabel || detail || '';

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clampedPct}
      className={`rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/95 dark:bg-zinc-900/90 ${
        compact ? 'px-3 py-2 space-y-2' : 'px-4 py-3 space-y-2.5'
      }`}
    >
      {/* Bar 1: Total Progress */}
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3 pr-6">
          <div className="flex items-center gap-2 min-w-0">
            {status === 'done' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            ) : status === 'error' ? (
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
            ) : (
              <Loader2 className="w-4 h-4 accent-text animate-spin shrink-0" />
            )}
            <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
              {label}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 text-[11px] font-mono-tabular text-zinc-600 dark:text-zinc-300">
            {total > 0 && <span>{countLabel}</span>}
            <span className="font-semibold">{clampedPct}%</span>
          </div>
        </div>

        <div className="h-2 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
          <div
            className={`h-full rounded-full transition-[width] duration-150 ease-out ${
              status === 'done'
                ? 'bg-emerald-500'
                : status === 'error'
                ? 'bg-red-500'
                : 'accent-bg'
            }`}
            style={{ width: `${clampedPct}%` }}
          />
        </div>
      </div>

      {/* Bar 2: Individual Syncing / Scanning Item Progress */}
      {hasItemBar && (
        <div className="space-y-1 pt-1 border-t border-zinc-200/70 dark:border-zinc-800/70">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="text-zinc-600 dark:text-zinc-300 truncate font-medium">
              {effectiveItemText}
            </span>
            <span className="font-mono-tabular text-zinc-500 dark:text-zinc-400 shrink-0">
              {resolvedItemPct}%
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-zinc-200/80 dark:bg-zinc-800/80 overflow-hidden">
            <div
              className={`h-full rounded-full transition-[width] duration-100 ease-out ${
                status === 'done'
                  ? 'bg-emerald-500/85'
                  : status === 'error'
                  ? 'bg-red-500/85'
                  : 'bg-amber-400 dark:bg-amber-400'
              }`}
              style={{ width: `${resolvedItemPct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
