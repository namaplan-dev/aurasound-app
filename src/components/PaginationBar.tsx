import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { tactile } from '../services/tactileFeedback';

interface PaginationBarProps {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onChangePage: (nextPage: number) => void;
  itemLabel?: string;
  /** Optional explicit start index (0-based) for anchored alphabet jumps */
  rangeStartIndex?: number;
  onStepPrev?: () => void;
  onStepNext?: () => void;
}

export const PaginationBar: React.FC<PaginationBarProps> = ({
  page,
  totalPages,
  totalItems,
  pageSize,
  onChangePage,
  itemLabel = 'items',
  rangeStartIndex,
  onStepPrev,
  onStepNext,
}) => {
  if (totalItems === 0) return null;

  const safePage = Math.max(0, Math.min(totalPages - 1, page));
  const start =
    typeof rangeStartIndex === 'number'
      ? Math.min(totalItems, rangeStartIndex + 1)
      : safePage * pageSize + 1;
  const end =
    typeof rangeStartIndex === 'number'
      ? Math.min(totalItems, rangeStartIndex + pageSize)
      : Math.min(totalItems, (safePage + 1) * pageSize);

  const canPrev = typeof rangeStartIndex === 'number' ? rangeStartIndex > 0 : safePage > 0;
  const canNext =
    typeof rangeStartIndex === 'number'
      ? rangeStartIndex + pageSize < totalItems
      : safePage < totalPages - 1;

  const visiblePages: number[] = [];
  if (totalPages <= 5) {
    for (let i = 0; i < totalPages; i++) visiblePages.push(i);
  } else {
    const startPage = Math.max(0, Math.min(totalPages - 5, safePage - 2));
    for (let i = 0; i < 5; i++) visiblePages.push(startPage + i);
  }

  return (
    <div className="shrink-0 flex items-center justify-between gap-2 pt-2 border-t border-zinc-200/80 dark:border-zinc-800/80 select-none">
      <div className="text-[11px] font-mono-tabular text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
        {start}–{end} of {totalItems} {itemLabel}
      </div>

      {totalPages > 1 || canPrev || canNext ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!canPrev}
            onClick={() => {
              tactile.tap();
              if (onStepPrev) onStepPrev();
              else onChangePage(Math.max(0, safePage - 1));
            }}
            aria-label="Previous page"
            className="min-w-[36px] min-h-[34px] px-2 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center gap-1 text-xs font-medium disabled:opacity-35 active:scale-95 transition-transform duration-100"
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Prev</span>
          </button>

          <div className="hidden xs:flex sm:flex items-center gap-1">
            {visiblePages.map((pIdx) => {
              const active = pIdx === safePage;
              return (
                <button
                  key={pIdx}
                  type="button"
                  onClick={() => {
                    tactile.tap();
                    onChangePage(pIdx);
                  }}
                  aria-label={`Page ${pIdx + 1}`}
                  aria-current={active ? 'page' : undefined}
                  className={`min-w-[32px] min-h-[34px] px-1.5 rounded-lg text-xs font-mono-tabular font-medium transition-colors ${
                    active
                      ? 'accent-bg'
                      : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  {pIdx + 1}
                </button>
              );
            })}
          </div>

          <span className="xs:hidden sm:hidden px-1.5 text-xs font-mono-tabular text-zinc-600 dark:text-zinc-300">
            {safePage + 1}/{totalPages}
          </span>

          <button
            type="button"
            disabled={!canNext}
            onClick={() => {
              tactile.tap();
              if (onStepNext) onStepNext();
              else onChangePage(Math.min(totalPages - 1, safePage + 1));
            }}
            aria-label="Next page"
            className="min-w-[36px] min-h-[34px] px-2 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center gap-1 text-xs font-medium disabled:opacity-35 active:scale-95 transition-transform duration-100"
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="text-[11px] font-mono-tabular text-zinc-400 dark:text-zinc-500">
          Page 1 / 1
        </div>
      )}
    </div>
  );
};
