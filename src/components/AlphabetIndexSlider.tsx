import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GripHorizontal } from 'lucide-react';
import { tactile } from '../services/tactileFeedback';

interface AlphabetIndexSliderProps {
  letters: string[];
  activeLetter?: string;
  onSelectLetter: (letter: string) => void;
}

function getScriptHint(letter: string): string {
  if (letter === '#') return '0–9';
  if (/[А-ЯЁ]/i.test(letter)) return 'А–Я';
  return 'A–Z';
}

export const AlphabetIndexSlider: React.FC<AlphabetIndexSliderProps> = React.memo(
  ({ letters, activeLetter, onSelectLetter }) => {
    const railRef = useRef<HTMLDivElement | null>(null);
    const [draggingLetter, setDraggingLetter] = useState<string | null>(null);
    const [dragRatio, setDragRatio] = useState<number | null>(null);
    const lastEmittedRef = useRef<string | null>(null);
    const isDraggingRef = useRef(false);

    const resolveFromClientY = useCallback(
      (clientY: number) => {
        const rail = railRef.current;
        if (!rail || letters.length === 0) return null;
        const rect = rail.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, rect.height)));
        const idx = Math.min(letters.length - 1, Math.floor(ratio * letters.length));
        return { letter: letters[idx], idx, ratio };
      },
      [letters]
    );

    const handlePointer = useCallback(
      (clientY: number, isInitialGrab: boolean) => {
        const resolved = resolveFromClientY(clientY);
        if (!resolved) return;
        const { letter, idx, ratio } = resolved;

        setDraggingLetter(letter);
        setDragRatio(ratio);

        if (lastEmittedRef.current !== letter) {
          lastEmittedRef.current = letter;
          const isBoundary = letter === '#' || letter === 'A' || letter === 'А';
          if (isInitialGrab) {
            tactile.sliderGrab();
          } else {
            tactile.sliderDetent(idx / Math.max(1, letters.length - 1), isBoundary);
          }
          onSelectLetter(letter);
        } else if (isInitialGrab) {
          tactile.sliderGrab();
        }
      },
      [letters.length, onSelectLetter, resolveFromClientY]
    );

    useEffect(() => {
      return () => {
        isDraggingRef.current = false;
      };
    }, []);

    const activeIdx = useMemo(() => {
      const target = draggingLetter || activeLetter;
      if (!target || letters.length === 0) return 0;
      const found = letters.indexOf(target);
      return found >= 0 ? found : 0;
    }, [draggingLetter, activeLetter, letters]);

    if (letters.length === 0) return null;

    const currentLetter = draggingLetter || activeLetter || letters[0];
    const thumbRatio =
      dragRatio !== null
        ? dragRatio
        : letters.length <= 1
        ? 0
        : activeIdx / (letters.length - 1);
    const clampedPct = Math.max(6, Math.min(94, thumbRatio * 100));

    // Keep track labels readable while full pointer precision spans every bucket
    const step = letters.length > 36 ? 2 : 1;

    return (
      <div className="relative flex items-center select-none shrink-0 z-20 pr-0.5 sm:pr-1">
        {/* Enlarged floating popup letter indicator while sliding */}
        {draggingLetter && (
          <div
            aria-hidden="true"
            style={{ top: `${clampedPct}%` }}
            className="absolute right-14 sm:right-16 -translate-y-1/2 w-24 h-24 sm:w-28 sm:h-28 rounded-3xl bg-zinc-900/95 dark:bg-zinc-50/95 text-white dark:text-zinc-950 border-2 border-amber-500/80 shadow-2xl backdrop-blur-md flex flex-col items-center justify-center pointer-events-none transition-[top] duration-75 ease-out"
          >
            <span className="text-5xl sm:text-6xl font-display font-bold leading-none">
              {draggingLetter}
            </span>
            <span className="mt-1.5 text-[11px] font-mono-tabular uppercase tracking-wider opacity-70">
              {getScriptHint(draggingLetter)}
            </span>
          </div>
        )}

        {/* Rail Container */}
        <div
          ref={railRef}
          role="slider"
          aria-label="Alphabetical quick jump slider"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, letters.length - 1)}
          aria-valuenow={activeIdx}
          aria-valuetext={currentLetter}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && activeIdx < letters.length - 1) {
              e.preventDefault();
              const next = letters[activeIdx + 1];
              tactile.sliderDetent((activeIdx + 1) / Math.max(1, letters.length - 1));
              onSelectLetter(next);
            } else if (e.key === 'ArrowUp' && activeIdx > 0) {
              e.preventDefault();
              const prev = letters[activeIdx - 1];
              tactile.sliderDetent((activeIdx - 1) / Math.max(1, letters.length - 1));
              onSelectLetter(prev);
            }
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            isDraggingRef.current = true;
            handlePointer(e.clientY, true);
          }}
          onPointerMove={(e) => {
            if (isDraggingRef.current || e.buttons > 0) {
              handlePointer(e.clientY, false);
            }
          }}
          onPointerUp={() => {
            if (isDraggingRef.current) {
              tactile.sliderRelease();
            }
            isDraggingRef.current = false;
            setDraggingLetter(null);
            setDragRatio(null);
            lastEmittedRef.current = null;
          }}
          onPointerCancel={() => {
            isDraggingRef.current = false;
            setDraggingLetter(null);
            setDragRatio(null);
            lastEmittedRef.current = null;
          }}
          className="relative flex flex-col items-center justify-between py-3 px-1.5 w-8 sm:w-9 rounded-full bg-zinc-200/80 dark:bg-zinc-900/90 border border-zinc-300/80 dark:border-zinc-700/80 touch-none cursor-grab active:cursor-grabbing min-h-[280px] h-[64vh] max-h-[540px]"
        >
          {/* Letter indices along the track */}
          {letters.map((letter, idx) => {
            const isShown =
              idx % step === 0 ||
              letter === '#' ||
              letter === 'А' ||
              letter === 'Я' ||
              letter === 'Z';
            const isActive = currentLetter === letter;
            if (!isShown && !isActive) {
              return (
                <span
                  key={letter}
                  className="w-1 h-1 rounded-full bg-zinc-400/50 dark:bg-zinc-600/60 pointer-events-none"
                />
              );
            }
            return (
              <span
                key={letter}
                className={`text-[10px] leading-none font-mono-tabular pointer-events-none transition-opacity ${
                  isActive
                    ? 'opacity-0'
                    : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                {letter}
              </span>
            );
          })}

          {/* Easy-to-spot Sculpted Tactile Slider Handle */}
          <div
            aria-hidden="true"
            style={{ top: `${clampedPct}%` }}
            className={`absolute left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none flex flex-col items-center justify-center rounded-xl border shadow-lg transition-transform duration-100 ${
              draggingLetter
                ? 'w-11 h-12 sm:w-12 sm:h-14 accent-bg border-white/60 scale-110 shadow-xl'
                : 'w-9 h-10 sm:w-10 sm:h-11 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 border-zinc-300 dark:border-zinc-600'
            }`}
          >
            <span className="text-xs sm:text-sm font-display font-bold leading-none">
              {currentLetter}
            </span>
            <GripHorizontal className="w-3.5 h-3.5 opacity-60 mt-0.5" />
          </div>
        </div>
      </div>
    );
  }
);
