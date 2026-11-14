import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { tactile } from '../services/tactileFeedback';

export interface SlidableTabItem {
  id: string;
  label: string;
}

interface SlidableTabStripProps {
  items: SlidableTabItem[];
  activeId: string;
  onSelect: (id: string) => void;
  className?: string;
}

export const SlidableTabStrip: React.FC<SlidableTabStripProps> = React.memo(
  ({ items, activeId, onSelect, className = '' }) => {
    const outerRef = useRef<HTMLDivElement | null>(null);
    const trackRef = useRef<HTMLDivElement | null>(null);
    const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

    const [stripOffset, setStripOffset] = useState(0);
    const [minOffset, setMinOffset] = useState(0);
    const [isDraggingStrip, setIsDraggingStrip] = useState(false);
    const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number }>({
      left: 0,
      width: 0,
    });

    const dragStartXRef = useRef<number | null>(null);
    const dragStartOffsetRef = useRef(0);
    const hasSlidRef = useRef(false);
    const suppressClickRef = useRef(false);

    const recomputeBoundsAndCenter = useCallback(
      (targetId: string) => {
        const outer = outerRef.current;
        const track = trackRef.current;
        const activeBtn = btnRefs.current[targetId];
        if (!outer || !track) return;

        const outerW = outer.clientWidth;
        const trackW = track.scrollWidth;
        const boundMin = Math.min(0, outerW - trackW);
        setMinOffset(boundMin);

        if (activeBtn) {
          const btnLeft = activeBtn.offsetLeft;
          const btnW = activeBtn.offsetWidth;
          setIndicatorStyle({ left: btnLeft + 8, width: Math.max(20, btnW - 16) });

          if (boundMin < 0) {
            const centered = -(btnLeft + btnW / 2 - outerW / 2);
            const clamped = Math.max(boundMin, Math.min(0, centered));
            setStripOffset(clamped);
          } else {
            setStripOffset(0);
          }
        }
      },
      []
    );

    useLayoutEffect(() => {
      recomputeBoundsAndCenter(activeId);
    }, [activeId, items, recomputeBoundsAndCenter]);

    useEffect(() => {
      const outer = outerRef.current;
      if (!outer || typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(() => recomputeBoundsAndCenter(activeId));
      ro.observe(outer);
      return () => ro.disconnect();
    }, [activeId, recomputeBoundsAndCenter]);

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      dragStartXRef.current = e.clientX;
      dragStartOffsetRef.current = stripOffset;
      hasSlidRef.current = false;
      suppressClickRef.current = false;
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragStartXRef.current === null) return;
      const dx = e.clientX - dragStartXRef.current;
      if (!hasSlidRef.current && Math.abs(dx) < 6) return;
      hasSlidRef.current = true;
      suppressClickRef.current = true;
      setIsDraggingStrip(true);

      if (minOffset < 0) {
        const raw = dragStartOffsetRef.current + dx;
        if (raw > 0) {
          setStripOffset(raw * 0.25);
        } else if (raw < minOffset) {
          setStripOffset(minOffset + (raw - minOffset) * 0.25);
        } else {
          setStripOffset(raw);
        }
      }
    };

    const finishDrag = (endX?: number) => {
      if (dragStartXRef.current === null) return;
      const dx = endX !== undefined ? endX - dragStartXRef.current : 0;
      const slid = hasSlidRef.current;
      dragStartXRef.current = null;
      hasSlidRef.current = false;
      setIsDraggingStrip(false);

      if (slid) {
        if (minOffset < 0) {
          setStripOffset((prev) => Math.max(minOffset, Math.min(0, prev)));
        } else if (Math.abs(dx) >= 32 && items.length > 1) {
          const curIdx = items.findIndex((it) => it.id === activeId);
          const nextIdx = dx < 0 ? curIdx + 1 : curIdx - 1;
          if (nextIdx >= 0 && nextIdx < items.length) {
            tactile.tap();
            onSelect(items[nextIdx].id);
          }
        }
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 60);
      }
    };

    const canSlideLeft = stripOffset < -2;
    const canSlideRight = stripOffset > minOffset + 2;

    return (
      <div
        ref={outerRef}
        data-no-swipe="true"
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(e) => finishDrag(e.clientX)}
        onPointerCancel={() => finishDrag()}
        onClickCapture={(e) => {
          if (suppressClickRef.current) {
            e.preventDefault();
            e.stopPropagation();
            suppressClickRef.current = false;
          }
        }}
        role="tablist"
        aria-label="Workspace pages"
        className={`relative overflow-hidden select-none border-b border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 ${className}`}
      >
        <div
          ref={trackRef}
          style={{
            transform: `translate3d(${stripOffset}px, 0, 0)`,
            transition: isDraggingStrip ? 'none' : 'transform 200ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          className="relative inline-flex min-w-full items-center"
        >
          {items.map((item) => {
            const active = item.id === activeId;
            return (
              <button
                key={item.id}
                ref={(el) => {
                  btnRefs.current[item.id] = el;
                }}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  if (suppressClickRef.current) return;
                  tactile.tap();
                  onSelect(item.id);
                }}
                className={`min-w-[84px] sm:min-w-[96px] md:flex-1 h-9 px-3.5 text-xs font-semibold tracking-wide whitespace-nowrap shrink-0 flex items-center justify-center transition-colors ${
                  active
                    ? 'accent-text'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                {item.label}
              </button>
            );
          })}

          {/* Animated active underline indicator matching Rocket Player TabLayout */}
          <span
            aria-hidden="true"
            style={{
              transform: `translate3d(${indicatorStyle.left}px, 0, 0)`,
              width: `${indicatorStyle.width}px`,
              transition: 'transform 200ms cubic-bezier(0.16, 1, 0.3, 1), width 200ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            className="absolute bottom-0 left-0 h-[2.5px] rounded-full accent-bg pointer-events-none"
          />
        </div>

        {/* Subtle overflow edge masks */}
        {canSlideLeft && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-5 bg-gradient-to-r from-white dark:from-zinc-950 to-transparent"
          />
        )}
        {canSlideRight && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-5 bg-gradient-to-l from-white dark:from-zinc-950 to-transparent"
          />
        )}
      </div>
    );
  }
);

interface SlidablePageViewportProps {
  pageIds: string[];
  activePageId: string;
  pageLabels?: Record<string, string>;
  onChangePage: (id: string) => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}

export const SlidablePageViewport: React.FC<SlidablePageViewportProps> = ({
  pageIds,
  activePageId,
  pageLabels,
  onChangePage,
  disabled = false,
  className = '',
  children,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const axisRef = useRef<'pending' | 'horizontal' | 'vertical'>('pending');
  const suppressClickRef = useRef(false);

  const [dragDx, setDragDx] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [settleOffset, setSettleOffset] = useState(0);
  const [enableSettleTransition, setEnableSettleTransition] = useState(false);

  const activeIdx = pageIds.indexOf(activePageId);
  const prevId = activeIdx > 0 ? pageIds[activeIdx - 1] : null;
  const nextId = activeIdx >= 0 && activeIdx < pageIds.length - 1 ? pageIds[activeIdx + 1] : null;

  const prevActiveIdRef = useRef(activePageId);
  useEffect(() => {
    const oldIdx = pageIds.indexOf(prevActiveIdRef.current);
    const newIdx = pageIds.indexOf(activePageId);
    prevActiveIdRef.current = activePageId;

    if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
      const incomingFromRight = newIdx > oldIdx;
      setEnableSettleTransition(false);
      setSettleOffset(incomingFromRight ? 42 : -42);
      let clearTimer: number | null = null;
      const raf = window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          setEnableSettleTransition(true);
          setSettleOffset(0);
          clearTimer = window.setTimeout(() => {
            setEnableSettleTransition(false);
          }, 210);
        });
      });
      return () => {
        window.cancelAnimationFrame(raf);
        if (clearTimer !== null) window.clearTimeout(clearTimer);
      };
    }
  }, [activePageId, pageIds]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || pageIds.length <= 1) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const target = e.target as HTMLElement | null;
    if (
      target?.closest(
        'input, textarea, select, canvas, [data-no-swipe="true"], [role="dialog"], [role="menu"]'
      )
    ) {
      return;
    }
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    startTimeRef.current = Date.now();
    axisRef.current = 'pending';
    suppressClickRef.current = false;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (startXRef.current === null || startYRef.current === null) return;
    if (axisRef.current === 'vertical') return;

    const dx = e.clientX - startXRef.current;
    const dy = e.clientY - startYRef.current;

    if (axisRef.current === 'pending') {
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) {
        axisRef.current = 'vertical';
        return;
      }
      if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.25) {
        axisRef.current = 'horizontal';
        suppressClickRef.current = true;
        setIsDragging(true);
      } else {
        return;
      }
    }

    const boxWidth = containerRef.current?.clientWidth || 360;
    const maxShift = Math.min(180, boxWidth * 0.44);
    const hasTargetInDir = dx > 0 ? Boolean(prevId) : Boolean(nextId);
    const scaled = hasTargetInDir
      ? Math.max(-maxShift, Math.min(maxShift, dx))
      : Math.max(-52, Math.min(52, dx * 0.25));
    setDragDx(scaled);
  };

  const finishSwipe = (endX?: number) => {
    if (startXRef.current === null) return;
    const axis = axisRef.current;
    const rawDx = endX !== undefined ? endX - startXRef.current : dragDx;
    const dt = Math.max(1, Date.now() - startTimeRef.current);
    const velocity = Math.abs(rawDx) / dt;

    startXRef.current = null;
    startYRef.current = null;
    axisRef.current = 'pending';
    setIsDragging(false);
    setDragDx(0);

    if (axis === 'horizontal') {
      const triggered = Math.abs(rawDx) >= 54 || (velocity > 0.35 && Math.abs(rawDx) >= 22);
      if (triggered) {
        if (rawDx < 0 && nextId) {
          tactile.tap();
          onChangePage(nextId);
        } else if (rawDx > 0 && prevId) {
          tactile.tap();
          onChangePage(prevId);
        }
      }
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 90);
    }
  };

  const previewTargetId = dragDx > 18 ? prevId : dragDx < -18 ? nextId : null;
  const previewLabel = previewTargetId
    ? pageLabels?.[previewTargetId] || previewTargetId
    : null;

  const translateX = isDragging ? dragDx : settleOffset;
  const hasActiveTransform = isDragging || enableSettleTransition || translateX !== 0;
  const transition = isDragging
    ? 'none'
    : enableSettleTransition
    ? 'transform 190ms cubic-bezier(0.16, 1, 0.3, 1)'
    : 'none';

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => finishSwipe(e.clientX)}
      onPointerCancel={() => finishSwipe()}
      onClickCapture={(e) => {
        if (suppressClickRef.current) {
          e.preventDefault();
          e.stopPropagation();
          suppressClickRef.current = false;
        }
      }}
      className={`relative overflow-hidden ${className}`}
    >
      <div
        style={
          hasActiveTransform
            ? {
                transform: `translate3d(${translateX}px, 0, 0)`,
                transition,
              }
            : undefined
        }
        className="flex-1 min-h-0 flex flex-col overflow-hidden"
      >
        {children}
      </div>

      {/* Live directional page hint while swiping across the page */}
      {isDragging && previewLabel && (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 z-30 px-2.5 py-1.5 rounded-xl bg-zinc-900/90 dark:bg-zinc-100/95 text-white dark:text-zinc-900 text-xs font-semibold shadow-lg flex items-center gap-1 ${
            dragDx > 0 ? 'left-2' : 'right-2'
          }`}
        >
          {dragDx > 0 && <ChevronLeft className="w-3.5 h-3.5" />}
          <span>{previewLabel}</span>
          {dragDx < 0 && <ChevronRight className="w-3.5 h-3.5" />}
        </div>
      )}
    </div>
  );
};
