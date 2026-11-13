import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GripHorizontal } from 'lucide-react';
import { tactile } from '../services/tactileFeedback';

interface AlphabetIndexSliderProps {
  letters: string[];
  populatedLetters?: Set<string>;
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
    const activePointerIdRef = useRef<number | null>(null);

    const resolveFromClientY = useCallback(
      (clientY: number) => {
        const rail = railRef.current;
        if (!rail || letters.length === 0) return null;
        if (letters.length === 1) {
          return { letter: letters[0], idx: 0, ratio: 0.5 };
        }
        const rect = rail.getBoundingClientRect();
        const pad = 12;
        const innerHeight = Math.max(1, rect.height - pad * 2);
        const ratio = Math.max(0, Math.min(1, (clientY - (rect.top + pad)) / innerHeight));
        const idx = Math.min(letters.length - 1, Math.floor(ratio * letters.length));
        return { letter: letters[idx], idx, ratio };
      },
      [letters]
    );

    const emitLetter = useCallback(
      (clientY: number, isInitialGrab: boolean) => {
        const resolved = resolveFromClientY(clientY);
        if (!resolved) return;
        const { letter, idx, ratio } = resolved;

        setDraggingLetter(letter);
        setDragRatio(ratio);

        if (isInitialGrab || lastEmittedRef.current !== letter) {
          lastEmittedRef.current = letter;
          const isBoundary = idx === 0 || idx === letters.length - 1;
          if (isInitialGrab) {
            tactile.sliderGrab();
          } else {
            tactile.sliderDetent(idx / Math.max(1, letters.length - 1), isBoundary);
          }
          onSelectLetter(letter);
        }
      },
      [letters.length, onSelectLetter, resolveFromClientY]
    );

    useEffect(() => {
      return () => {
        isDraggingRef.current = false;
        activePointerIdRef.current = null;
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
      letters.length === 1
        ? 0.5
        : dragRatio !== null
        ? dragRatio
        : activeIdx / Math.max(1, letters.length - 1);
    const clampedPct = letters.length === 1 ? 50 : Math.max(8, Math.min(92, thumbRatio * 100));

    const step = letters.length > 28 ? 2 : 1;

    return (
      <div
        style={{ touchAction: 'none' }}
        className="relative h-full min-h-0 flex items-center select-none shrink-0 z-20 touch-none"
      >
        {/* Floating enlarged popup letter indicator while sliding */}
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

        {/* Rail Container displaying ONLY letters that have items */}
        <div
          ref={railRef}
          role="slider"
          aria-label="Alphabetical quick jump slider"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, letters.length - 1)}
          aria-valuenow={activeIdx}
          aria-valuetext={currentLetter}
          tabIndex={0}
          style={{ touchAction: 'none' }}
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
            e.stopPropagation();
            isDraggingRef.current = true;
            activePointerIdRef.current = e.pointerId;
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // ignore when pointer capture unavailable
            }
            emitLetter(e.clientY, true);
          }}
          onPointerMove={(e) => {
            if (!isDraggingRef.current && e.buttons === 0) return;
            if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) {
              return;
            }
            e.preventDefault();
            e.stopPropagation();
            emitLetter(e.clientY, false);
          }}
          onPointerUp={(e) => {
            e.stopPropagation();
            if (isDraggingRef.current) {
              tactile.sliderRelease();
            }
            isDraggingRef.current = false;
            activePointerIdRef.current = null;
            setDraggingLetter(null);
            setDragRatio(null);
            lastEmittedRef.current = null;
          }}
          onPointerCancel={() => {
            isDraggingRef.current = false;
            activePointerIdRef.current = null;
            setDraggingLetter(null);
            setDragRatio(null);
            lastEmittedRef.current = null;
          }}
          className={`relative flex flex-col items-center ${
            letters.length <= 5 ? 'justify-evenly' : 'justify-between'
          } py-2.5 px-1.5 w-9 sm:w-10 rounded-full bg-zinc-200/85 dark:bg-zinc-900/95 border border-zinc-300/80 dark:border-zinc-700/80 touch-none cursor-grab active:cursor-grabbing h-full max-h-[460px] min-h-[56px]`}
        >
          {letters.map((letter, idx) => {
            const isShown = idx % step === 0 || idx === 0 || idx === letters.length - 1;
            const isActive = currentLetter === letter;
            if (!isShown && !isActive) {
              return (
                <span
                  key={letter}
                  className="w-1 h-1 rounded-full bg-zinc-500/60 pointer-events-none"
                />
              );
            }
            return (
              <span
                key={letter}
                className={`text-[11px] font-semibold leading-none font-mono-tabular pointer-events-none transition-opacity ${
                  isActive
                    ? 'opacity-0'
                    : 'text-zinc-800 dark:text-zinc-200'
                }`}
              >
                {letter}
              </span>
            );
          })}

          {/* Tactile Slider Handle */}
          <div
            aria-hidden="true"
            style={{ top: `${clampedPct}%` }}
            className={`absolute left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none flex flex-col items-center justify-center rounded-xl border shadow-lg transition-transform duration-75 ${
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
