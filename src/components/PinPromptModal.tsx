import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Delete, Lock, ShieldCheck, X } from 'lucide-react';
import { RECORDINGS_PIN } from '../services/recordingService';
import { tactile } from '../services/tactileFeedback';

interface PinPadCoreProps {
  title: string;
  subtitle: string;
  onSuccess: () => void;
  onCancel?: () => void;
  compact?: boolean;
}

export const PinPadCore: React.FC<PinPadCoreProps> = ({
  title,
  subtitle,
  onSuccess,
  onCancel,
  compact = false,
}) => {
  const [digits, setDigits] = useState('');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [verifiedFlash, setVerifiedFlash] = useState(false);

  const handleDigit = useCallback(
    (d: string) => {
      if (verifiedFlash) return;
      tactile.tap();
      setErrorText(null);
      setDigits((prev) => {
        if (prev.length >= 4) return prev;
        const next = prev + d;
        if (next.length === 4) {
          if (next === RECORDINGS_PIN) {
            setVerifiedFlash(true);
            tactile.success();
            window.setTimeout(() => {
              setVerifiedFlash(false);
              setDigits('');
              onSuccess();
            }, 140);
          } else {
            setErrorText('Incorrect PIN code. Please try again.');
            window.setTimeout(() => {
              setDigits('');
            }, 260);
          }
        }
        return next;
      });
    },
    [onSuccess, verifiedFlash]
  );

  const handleBackspace = useCallback(() => {
    if (verifiedFlash) return;
    tactile.tap();
    setErrorText(null);
    setDigits((prev) => prev.slice(0, -1));
  }, [verifiedFlash]);

  const handleClear = useCallback(() => {
    if (verifiedFlash) return;
    tactile.tap();
    setErrorText(null);
    setDigits('');
  }, [verifiedFlash]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        handleDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === 'Escape' && onCancel) {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleBackspace, handleDigit, onCancel]);

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div className={`w-full max-w-[300px] mx-auto flex flex-col items-center ${compact ? 'gap-2.5' : 'gap-3.5'}`}>
      <div className="flex flex-col items-center text-center gap-1">
        <div
          className={`w-10 h-10 rounded-2xl flex items-center justify-center ${
            verifiedFlash
              ? 'bg-emerald-500/20 text-emerald-500'
              : 'accent-soft-bg'
          }`}
        >
          {verifiedFlash ? <ShieldCheck className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
        </div>
        <h3 className="text-sm sm:text-base font-display font-semibold text-zinc-900 dark:text-zinc-100">
          {title}
        </h3>
        <p className="text-[11px] sm:text-xs text-zinc-500 dark:text-zinc-400 leading-snug max-w-[260px]">
          {subtitle}
        </p>
      </div>

      {/* 4-dot PIN indicator */}
      <div className="flex items-center gap-3 py-1" aria-label="PIN progress">
        {[0, 1, 2, 3].map((slot) => {
          const filled = slot < digits.length;
          return (
            <div
              key={slot}
              className={`w-3.5 h-3.5 rounded-full border transition-all duration-150 ${
                verifiedFlash
                  ? 'bg-emerald-500 border-emerald-500 scale-110'
                  : filled
                  ? 'accent-bg border-transparent scale-110'
                  : errorText
                  ? 'border-rose-500 bg-rose-500/15'
                  : 'border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900'
              }`}
            />
          );
        })}
      </div>

      <div className="min-h-[16px] text-[11px] font-medium text-rose-500 text-center">
        {errorText || ''}
      </div>

      {/* 3x4 keypad */}
      <div className="grid grid-cols-3 gap-2 w-full">
        {keys.map((num) => (
          <button
            key={num}
            type="button"
            onClick={() => handleDigit(num)}
            className="min-h-[44px] sm:min-h-[48px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-base font-mono-tabular font-semibold text-zinc-900 dark:text-zinc-100 active:scale-95 transition-transform duration-100"
          >
            {num}
          </button>
        ))}

        <button
          type="button"
          onClick={handleClear}
          className="min-h-[44px] sm:min-h-[48px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 active:scale-95 transition-transform duration-100"
        >
          Clear
        </button>

        <button
          type="button"
          onClick={() => handleDigit('0')}
          className="min-h-[44px] sm:min-h-[48px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-base font-mono-tabular font-semibold text-zinc-900 dark:text-zinc-100 active:scale-95 transition-transform duration-100"
        >
          0
        </button>

        <button
          type="button"
          aria-label="Backspace"
          onClick={handleBackspace}
          className="min-h-[44px] sm:min-h-[48px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center text-zinc-600 dark:text-zinc-300 active:scale-95 transition-transform duration-100"
        >
          <Delete className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

interface PinPromptModalProps {
  open: boolean;
  title: string;
  subtitle: string;
  onSuccess: () => void;
  onClose: () => void;
}

export const PinPromptModal: React.FC<PinPromptModalProps> = ({
  open,
  title,
  subtitle,
  onSuccess,
  onClose,
}) => {
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-black/65 backdrop-blur-sm flex items-center justify-center p-3"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[340px] rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close PIN prompt"
          onClick={() => {
            tactile.tap();
            onClose();
          }}
          className="absolute top-3 right-3 min-w-[34px] min-h-[34px] rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          <X className="w-4 h-4" />
        </button>

        <PinPadCore
          title={title}
          subtitle={subtitle}
          onSuccess={onSuccess}
          onCancel={onClose}
          compact
        />
      </div>
    </div>,
    document.body
  );
};
