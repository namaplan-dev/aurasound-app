import React from 'react';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

interface ProgressBarProps {
  label: string;
  detail?: string;
  current: number;
  total: number;
  percent: number;
  status?: 'running' | 'done' | 'error';
  compact?: boolean;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  label,
  detail,
  current,
  total,
  percent,
  status = 'running',
  compact = false,
}) => {
  const clampedPct = Math.max(0, Math.min(100, Math.round(percent)));
  const countLabel =
    total > 0 ? `${Math.min(current, total)} / ${total}` : `${clampedPct}%`;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clampedPct}
      className={`rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/90 dark:bg-zinc-900/80 ${
        compact ? 'px-3 py-2 space-y-1.5' : 'px-4 py-3 space-y-2'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {status === 'done' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          ) : status === 'error' ? (
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
          ) : (
            <Loader2 className="w-4 h-4 accent-text animate-spin shrink-0" />
          )}
          <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">
            {label}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0 text-[11px] font-mono-tabular text-zinc-600 dark:text-zinc-300">
          {total > 0 && <span>{countLabel}</span>}
          <span className="font-semibold">{clampedPct}%</span>
        </div>
      </div>

      <div className="h-2 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
        <div
          className={`h-full rounded-full transition-[width] duration-200 ease-out ${
            status === 'done'
              ? 'bg-emerald-500'
              : status === 'error'
              ? 'bg-red-500'
              : 'accent-bg'
          }`}
          style={{ width: `${clampedPct}%` }}
        />
      </div>

      {detail && (
        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
          {detail}
        </div>
      )}
    </div>
  );
};
