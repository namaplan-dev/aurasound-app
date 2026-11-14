import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, RefreshCw, Sparkles, X } from 'lucide-react';
import {
  AiQuotaState,
  clearActiveAiQuotaState,
  formatAiQuotaCountdown,
  subscribeAiQuotaState,
} from '../services/aiAssistantService';

export function useAiQuotaCountdown(overrideQuota?: AiQuotaState | null) {
  const [globalQuota, setGlobalQuota] = useState<AiQuotaState | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    return subscribeAiQuotaState((next) => {
      setGlobalQuota(next);
      setNowMs(Date.now());
    });
  }, []);

  const quota = overrideQuota !== undefined ? overrideQuota : globalQuota;

  useEffect(() => {
    if (!quota) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, [quota]);

  if (!quota) return null;
  return {
    quota,
    ...formatAiQuotaCountdown(quota.resetAtMs, nowMs),
  };
}

interface AiQuotaNoticeProps {
  quota?: AiQuotaState | null;
  extraNote?: string | null;
  onRetry?: () => void;
  retryLabel?: string;
  onDismiss?: () => void;
  compact?: boolean;
}

export const AiQuotaNotice: React.FC<AiQuotaNoticeProps> = ({
  quota: explicitQuota,
  extraNote,
  onRetry,
  retryLabel = 'Resume AI Scan',
  onDismiss,
  compact = false,
}) => {
  const info = useAiQuotaCountdown(explicitQuota);
  if (!info) return null;

  const { quota, countdownText, readyTimeText, isRestored } = info;

  const handleDismiss = () => {
    clearActiveAiQuotaState();
    onDismiss?.();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-xl border transition-colors ${
        isRestored
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200'
          : 'border-amber-500/45 bg-amber-500/10 text-amber-950 dark:text-amber-100'
      } ${compact ? 'p-3 space-y-2' : 'px-3.5 py-2.5 space-y-1.5'} text-xs`}
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex items-start gap-2.5 min-w-0">
          {isRestored ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
          ) : (
            <Clock className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          )}

          <div className="min-w-0 space-y-0.5">
            <div className="font-semibold flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span>
                {isRestored
                  ? 'AI Tokens Restored — Ready to Continue'
                  : quota.quotaScope === 'daily'
                  ? 'AI Daily Token Limit Reached'
                  : 'AI Taking a Short Breather (Tokens Used Up)'}
              </span>
              {!isRestored && (
                <span className="font-mono-tabular text-[11px] px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-800 dark:text-amber-200 border border-amber-500/30">
                  Back in {countdownText} · ~{readyTimeText}
                </span>
              )}
            </div>

            <p className="text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300">
              {isRestored
                ? 'Your AI token allowance has refilled. You can continue scanning right where you left off.'
                : quota.quotaScope === 'daily'
                ? `Large or heavily disordered track batches used today's AI token quota. AI will be back automatically around ${readyTimeText} when tokens reset.`
                : `Scanning large or heavily disordered batches temporarily used up AI tokens. Tokens automatically refill in ${countdownText} (around ${readyTimeText}).`}
            </p>

            {extraNote && (
              <div className="text-[11px] font-medium text-zinc-800 dark:text-zinc-200 flex items-center gap-1 pt-0.5">
                <Sparkles className="w-3 h-3 text-amber-500 shrink-0" />
                <span>{extraNote}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {onRetry && (
            <button
              type="button"
              disabled={!isRestored}
              onClick={() => {
                clearActiveAiQuotaState();
                onRetry();
              }}
              className={`min-h-[30px] px-2.5 rounded-lg text-[11px] font-medium inline-flex items-center gap-1.5 transition-transform active:scale-95 ${
                isRestored
                  ? 'accent-bg'
                  : 'border border-amber-500/35 bg-amber-500/15 text-amber-900 dark:text-amber-200 opacity-75 cursor-not-allowed'
              }`}
            >
              <RefreshCw className={`w-3 h-3 ${isRestored ? '' : 'opacity-60'}`} />
              <span>{isRestored ? retryLabel : `Wait ${countdownText}`}</span>
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dismiss AI token notice"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
