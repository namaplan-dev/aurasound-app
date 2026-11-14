import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Wand2,
  X,
} from 'lucide-react';
import { TagCleanupSuggestion, Track } from '../types/music';
import {
  AiQuotaExhaustedError,
  AiQuotaState,
  clearActiveAiQuotaState,
  getActiveAiQuotaState,
  runSingleItemAiScan,
} from '../services/aiAssistantService';
import { tactile } from '../services/tactileFeedback';
import { AiQuotaNotice, useAiQuotaCountdown } from './AiQuotaNotice';

export interface AiCorrectionTarget {
  label: string;
  kindLabel: string;
  tracks: Track[];
}

interface ItemAiCorrectionModalProps {
  target: AiCorrectionTarget | null;
  onClose: () => void;
  onApplySuggestions: (suggestions: TagCleanupSuggestion[]) => void;
  onShowNoChangesToast: (message?: string) => void;
}

interface FieldChange {
  field: string;
  from: string;
  to: string;
}

function summarizeLyricsChange(raw: string | undefined): string {
  const clean = (raw || '').trim();
  if (!clean) return '';
  const lines = clean.split(/\r?\n/).filter((l) => l.trim());
  const isSynced = /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/.test(clean);
  return `${isSynced ? 'Synced LRC' : 'Lyrics'} (${lines.length} lines)`;
}

function collectSuggestionFieldChanges(s: TagCleanupSuggestion): FieldChange[] {
  const out: FieldChange[] = [];
  const pushIfChanged = (field: string, fromRaw: string | undefined, toRaw: string | undefined) => {
    const fromVal = (fromRaw || '').trim();
    const toVal = (toRaw || '').trim();
    if (toVal !== fromVal && (toVal || fromVal)) {
      out.push({ field, from: fromVal || '—', to: toVal || '—' });
    }
  };
  pushIfChanged('Title', s.currentTitle, s.suggestedTitle);
  pushIfChanged('Artist', s.currentArtist, s.suggestedArtist);
  pushIfChanged('Album', s.currentAlbum, s.suggestedAlbum);
  pushIfChanged('Genre', s.currentGenre, s.suggestedGenre);
  pushIfChanged('Year', s.currentYear, s.suggestedYear);
  const prevLyrics = (s.currentLyrics || '').trim();
  const nextLyrics = (s.suggestedLyrics || '').trim();
  if (nextLyrics !== prevLyrics && (nextLyrics || prevLyrics)) {
    out.push({
      field: 'Lyrics',
      from: summarizeLyricsChange(prevLyrics) || 'None',
      to: summarizeLyricsChange(nextLyrics) || 'Removed',
    });
  }
  return out;
}

function renderDiffText(currentRaw: string | undefined, suggestedRaw: string | undefined): React.ReactNode {
  const prev = (currentRaw || '').trim();
  const next = (suggestedRaw || '').trim();
  if (!next) return <span className="text-zinc-400">—</span>;
  if (prev === next) return <span>{next}</span>;

  // If old field was empty or generic placeholder, highlight whole corrected value in red
  if (
    !prev ||
    /^(unknown album|unknown artist|local collection|local audio|unknown|audio|music)$/i.test(prev)
  ) {
    return (
      <span className="text-rose-600 dark:text-rose-400 font-semibold bg-rose-500/12 px-1 rounded">
        {next}
      </span>
    );
  }

  // Word-level LCS diff so changed/corrected words appear clearly in red
  const aTokens = prev.split(/(\s+)/);
  const bTokens = next.split(/(\s+)/);
  const m = aTokens.length;
  const n = bTokens.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (aTokens[i] === bTokens[j]) dp[i][j] = 1 + dp[i + 1][j + 1];
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const parts: Array<{ text: string; changed: boolean }> = [];
  let i = 0;
  let j = 0;
  while (j < n) {
    if (i < m && aTokens[i] === bTokens[j]) {
      parts.push({ text: bTokens[j], changed: false });
      i++;
      j++;
    } else if (i < m && dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      parts.push({ text: bTokens[j], changed: true });
      j++;
    }
  }

  if (!parts.some((p) => p.changed)) {
    return (
      <span className="text-rose-600 dark:text-rose-400 font-semibold bg-rose-500/12 px-1 rounded">
        {next}
      </span>
    );
  }

  return (
    <span>
      {parts.map((part, idx) =>
        part.changed && part.text.trim() ? (
          <span
            key={idx}
            className="text-rose-600 dark:text-rose-400 font-semibold bg-rose-500/12 px-0.5 rounded"
          >
            {part.text}
          </span>
        ) : (
          <React.Fragment key={idx}>{part.text}</React.Fragment>
        )
      )}
    </span>
  );
}

type ModalPhase = 'scanning' | 'compare' | 'confirm' | 'report' | 'quota' | 'error';

export const ItemAiCorrectionModal: React.FC<ItemAiCorrectionModalProps> = ({
  target,
  onClose,
  onApplySuggestions,
  onShowNoChangesToast,
}) => {
  const [phase, setPhase] = useState<ModalPhase>('scanning');
  const [suggestions, setSuggestions] = useState<TagCleanupSuggestion[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [quotaInfo, setQuotaInfo] = useState<AiQuotaState | null>(null);
  const [selectedChoice, setSelectedChoice] = useState<'current' | 'ai' | null>(null);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [reportIdx, setReportIdx] = useState(0);
  const [appliedReport, setAppliedReport] = useState<
    Array<{ trackTitle: string; changes: FieldChange[] }>
  >([]);
  const [scanAttempt, setScanAttempt] = useState(0);
  const quotaCountdown = useAiQuotaCountdown(phase === 'quota' ? quotaInfo : null);

  const onCloseRef = useRef(onClose);
  const onShowNoChangesToastRef = useRef(onShowNoChangesToast);
  onCloseRef.current = onClose;
  onShowNoChangesToastRef.current = onShowNoChangesToast;

  useEffect(() => {
    if (!target) return;
    let cancelled = false;

    const existingQuota = getActiveAiQuotaState();
    if (existingQuota && existingQuota.resetAtMs > Date.now()) {
      setQuotaInfo(existingQuota);
      setPhase('quota');
      return;
    }

    setPhase('scanning');
    setSuggestions([]);
    setErrorMsg('');
    setQuotaInfo(null);
    setSelectedChoice(null);
    setPreviewIdx(0);
    setReportIdx(0);
    setAppliedReport([]);

    void (async () => {
      try {
        const res = await runSingleItemAiScan(target.tracks);
        if (cancelled) return;
        if (res.length === 0) {
          tactile.tap();
          onShowNoChangesToastRef.current('No changes were made');
          onCloseRef.current();
          return;
        }
        setSuggestions(res);
        setPhase('compare');
      } catch (err) {
        if (cancelled) return;
        if (err instanceof AiQuotaExhaustedError) {
          setQuotaInfo(err.quota);
          setPhase('quota');
          return;
        }
        setErrorMsg(err instanceof Error ? err.message : 'Unable to scan item with AI.');
        setPhase('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [target, scanAttempt]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (phase === 'confirm') {
          setPhase('compare');
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, phase, onClose]);

  const activeSuggestion = suggestions[Math.min(previewIdx, Math.max(0, suggestions.length - 1))];
  const totalChangedFieldsCount = useMemo(
    () => suggestions.reduce((sum, s) => sum + collectSuggestionFieldChanges(s).length, 0),
    [suggestions]
  );

  if (!target || typeof document === 'undefined') return null;

  const handleChooseVersion = (choice: 'current' | 'ai') => {
    tactile.tap();
    setSelectedChoice(choice);
    setPhase('confirm');
  };

  const handleConfirmApply = () => {
    if (selectedChoice === 'current') {
      tactile.tap();
      onShowNoChangesToast('No changes were made');
      onClose();
      return;
    }

    const reportEntries = suggestions
      .map((s) => ({
        trackTitle: s.suggestedTitle || s.currentTitle,
        changes: collectSuggestionFieldChanges(s),
      }))
      .filter((entry) => entry.changes.length > 0);

    if (reportEntries.length === 0) {
      tactile.tap();
      onShowNoChangesToast('No changes were made');
      onClose();
      return;
    }

    tactile.success();
    onApplySuggestions(suggestions);
    setAppliedReport(reportEntries);
    setReportIdx(0);
    setPhase('report');
  };

  const currentReportEntry =
    appliedReport[Math.min(reportIdx, Math.max(0, appliedReport.length - 1))];

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="AI Tag Correction"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => {
        if (phase === 'confirm') setPhase('compare');
        else if (phase !== 'scanning') onClose();
      }}
      className="fixed inset-0 z-[75] bg-black/65 backdrop-blur-[2px] flex items-center justify-center p-2.5 sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[540px] max-h-[calc(100dvh-1.25rem)] rounded-2xl border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Modal Header */}
        <div className="shrink-0 px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/70 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {phase === 'report' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            ) : (
              <Wand2 className="w-4 h-4 accent-text shrink-0" />
            )}
            <div className="min-w-0">
              <h3 className="text-sm font-display font-semibold truncate">
                {phase === 'scanning'
                  ? 'Scanning with AI...'
                  : phase === 'report'
                  ? 'Changes Applied'
                  : phase === 'confirm'
                  ? 'Confirm Selection'
                  : phase === 'quota'
                  ? 'AI Resting Briefly'
                  : phase === 'error'
                  ? 'AI Scan Error'
                  : `AI Correction · ${target.label}`}
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close AI correction dialog"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-500 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Phase 1: Scanning */}
        {phase === 'scanning' && (
          <div className="p-6 flex flex-col items-center justify-center text-center gap-3">
            <Loader2 className="w-7 h-7 accent-text animate-spin" />
            <div className="space-y-1">
              <div className="text-sm font-medium">
                Analyzing {target.kindLabel.toLowerCase()} "{target.label}"
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Checking {target.tracks.length} track(s) for missing albums, years, genres, typos, and synced lyrics...
              </div>
            </div>
          </div>
        )}

        {/* Phase Quota: Friendly Token Restore Countdown */}
        {phase === 'quota' && quotaInfo && (
          <div className="p-4 space-y-3 text-xs">
            <AiQuotaNotice quota={quotaInfo} compact />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[34px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 font-medium"
              >
                Close
              </button>
              <button
                type="button"
                disabled={!quotaCountdown?.isRestored}
                onClick={() => {
                  clearActiveAiQuotaState();
                  setScanAttempt((n) => n + 1);
                }}
                className="min-h-[34px] px-4 rounded-lg accent-bg font-medium disabled:opacity-50"
              >
                {quotaCountdown?.isRestored
                  ? 'Scan with AI Now'
                  : `Ready in ${quotaCountdown?.countdownText || '...'}`}
              </button>
            </div>
          </div>
        )}

        {/* Phase Error */}
        {phase === 'error' && (
          <div className="p-4 space-y-3 text-xs">
            <div className="flex items-start gap-2.5 text-rose-600 dark:text-rose-400">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>{errorMsg}</div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[32px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 font-medium"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => setScanAttempt((n) => n + 1)}
                className="min-h-[32px] px-3.5 rounded-lg accent-bg font-medium"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Phase 2: Two Selectable Versions (Current vs AI Corrected with red differences) */}
        {phase === 'compare' && activeSuggestion && (
          <div className="p-3 sm:p-4 space-y-2.5 text-xs">
            <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              <span className="truncate">
                Tap the version you want to save ({suggestions.length} track
                {suggestions.length === 1 ? '' : 's'} · {totalChangedFieldsCount} field update
                {totalChangedFieldsCount === 1 ? '' : 's'}). Differences in{' '}
                <span className="text-rose-600 dark:text-rose-400 font-semibold">red</span>.
              </span>

              {suggestions.length > 1 && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    disabled={previewIdx <= 0}
                    onClick={() => setPreviewIdx((i) => Math.max(0, i - 1))}
                    aria-label="Previous changed track"
                    className="w-6 h-6 rounded border border-zinc-200 dark:border-zinc-700 flex items-center justify-center disabled:opacity-35"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="font-mono-tabular px-1">
                    {previewIdx + 1}/{suggestions.length}
                  </span>
                  <button
                    type="button"
                    disabled={previewIdx >= suggestions.length - 1}
                    onClick={() => setPreviewIdx((i) => Math.min(suggestions.length - 1, i + 1))}
                    aria-label="Next changed track"
                    className="w-6 h-6 rounded border border-zinc-200 dark:border-zinc-700 flex items-center justify-center disabled:opacity-35"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Option A: Current Version */}
              <button
                type="button"
                onClick={() => handleChooseVersion('current')}
                className="text-left rounded-xl border border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600 bg-zinc-50/70 dark:bg-zinc-950/60 p-3 space-y-1.5 transition-colors active:scale-[0.99]"
              >
                <div className="flex items-center justify-between gap-2 pb-1 border-b border-zinc-200/80 dark:border-zinc-800">
                  <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                    Current Version
                  </span>
                  <span className="text-[11px] text-zinc-400">Keep as-is</span>
                </div>
                <div className="space-y-1 text-[11px]">
                  <div className="truncate">
                    <span className="text-zinc-400">Title: </span>
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">
                      {activeSuggestion.currentTitle || '—'}
                    </span>
                  </div>
                  <div className="truncate">
                    <span className="text-zinc-400">Artist: </span>
                    <span className="text-zinc-700 dark:text-zinc-300">
                      {activeSuggestion.currentArtist || '—'}
                    </span>
                  </div>
                  <div className="truncate">
                    <span className="text-zinc-400">Album: </span>
                    <span className="text-zinc-700 dark:text-zinc-300">
                      {activeSuggestion.currentAlbum || '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      <span className="text-zinc-400">Genre: </span>
                      <span>{activeSuggestion.currentGenre || '—'}</span>
                    </span>
                    <span className="font-mono-tabular shrink-0">
                      <span className="text-zinc-400">Year: </span>
                      <span>{activeSuggestion.currentYear || '—'}</span>
                    </span>
                  </div>
                  <div className="truncate">
                    <span className="text-zinc-400">Lyrics: </span>
                    <span className="text-zinc-600 dark:text-zinc-400">
                      {summarizeLyricsChange(activeSuggestion.currentLyrics) || 'None'}
                    </span>
                  </div>
                </div>
              </button>

              {/* Option B: AI Corrected Version (Differences Highlighted in Red) */}
              <button
                type="button"
                onClick={() => handleChooseVersion('ai')}
                className="text-left rounded-xl border border-amber-500/60 hover:border-amber-500 bg-amber-500/5 p-3 space-y-1.5 transition-colors active:scale-[0.99]"
              >
                <div className="flex items-center justify-between gap-2 pb-1 border-b border-amber-500/20">
                  <span className="text-xs font-semibold accent-text flex items-center gap-1">
                    <Wand2 className="w-3 h-3" />
                    <span>AI Corrected</span>
                  </span>
                  <span className="text-[11px] text-zinc-500 truncate max-w-[130px]">
                    {activeSuggestion.reason}
                  </span>
                </div>
                <div className="space-y-1 text-[11px]">
                  <div className="truncate">
                    <span className="text-zinc-400">Title: </span>
                    {renderDiffText(activeSuggestion.currentTitle, activeSuggestion.suggestedTitle)}
                  </div>
                  <div className="truncate">
                    <span className="text-zinc-400">Artist: </span>
                    {renderDiffText(activeSuggestion.currentArtist, activeSuggestion.suggestedArtist)}
                  </div>
                  <div className="truncate">
                    <span className="text-zinc-400">Album: </span>
                    {renderDiffText(activeSuggestion.currentAlbum, activeSuggestion.suggestedAlbum)}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      <span className="text-zinc-400">Genre: </span>
                      {renderDiffText(activeSuggestion.currentGenre, activeSuggestion.suggestedGenre)}
                    </span>
                    <span className="font-mono-tabular shrink-0">
                      <span className="text-zinc-400">Year: </span>
                      {renderDiffText(activeSuggestion.currentYear, activeSuggestion.suggestedYear)}
                    </span>
                  </div>
                  <div className="truncate">
                    <span className="text-zinc-400">Lyrics: </span>
                    {(activeSuggestion.currentLyrics || '').trim() !==
                    (activeSuggestion.suggestedLyrics || '').trim() ? (
                      <span className="text-rose-600 dark:text-rose-400 font-semibold bg-rose-500/12 px-1 rounded">
                        {summarizeLyricsChange(activeSuggestion.suggestedLyrics) || 'None'}
                      </span>
                    ) : (
                      <span>{summarizeLyricsChange(activeSuggestion.suggestedLyrics) || 'None'}</span>
                    )}
                  </div>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Phase 3: Confirmation Popup Before Applying Changes */}
        {phase === 'confirm' && (
          <div className="p-4 space-y-3 text-xs">
            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {selectedChoice === 'ai'
                ? `Apply AI Corrected tags to "${target.label}"?`
                : `Keep Current version for "${target.label}"?`}
            </div>
            <p className="text-zinc-500 dark:text-zinc-400 leading-relaxed">
              {selectedChoice === 'ai'
                ? `This will update ${totalChangedFieldsCount} field(s) across ${suggestions.length} track(s) and embed updated tags directly into your source audio file(s).`
                : 'No edits will be applied to your library or audio files.'}
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  tactile.tap();
                  setPhase('compare');
                }}
                className="min-h-[34px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmApply}
                className="min-h-[34px] px-4 rounded-lg accent-bg font-medium inline-flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{selectedChoice === 'ai' ? 'Confirm & Apply' : 'Confirm'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Phase 4: Short Change Report After Applying */}
        {phase === 'report' && currentReportEntry && (
          <div className="p-4 space-y-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                {currentReportEntry.trackTitle}
              </div>
              {appliedReport.length > 1 && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    disabled={reportIdx <= 0}
                    onClick={() => setReportIdx((i) => Math.max(0, i - 1))}
                    aria-label="Previous updated track"
                    className="w-6 h-6 rounded border border-zinc-200 dark:border-zinc-700 flex items-center justify-center disabled:opacity-35"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="font-mono-tabular px-1">
                    {reportIdx + 1}/{appliedReport.length}
                  </span>
                  <button
                    type="button"
                    disabled={reportIdx >= appliedReport.length - 1}
                    onClick={() => setReportIdx((i) => Math.min(appliedReport.length - 1, i + 1))}
                    aria-label="Next updated track"
                    className="w-6 h-6 rounded border border-zinc-200 dark:border-zinc-700 flex items-center justify-center disabled:opacity-35"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 divide-y divide-zinc-200/70 dark:divide-zinc-800">
              {currentReportEntry.changes.map((chg) => (
                <div key={chg.field} className="px-3 py-1.5 flex items-center gap-2">
                  <span className="w-12 text-[11px] font-medium text-zinc-400 shrink-0">
                    {chg.field}
                  </span>
                  <span className="truncate text-zinc-500 line-through">{chg.from}</span>
                  <ArrowRight className="w-3 h-3 text-zinc-400 shrink-0" />
                  <span className="truncate font-semibold text-rose-600 dark:text-rose-400">
                    {chg.to}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-2 pt-0.5">
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Updated {appliedReport.length} track{appliedReport.length === 1 ? '' : 's'} and saved embedded file tags.
              </span>
              <button
                type="button"
                onClick={onClose}
                className="min-h-[32px] px-4 rounded-lg accent-bg font-medium shrink-0"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
