import { useEffect, useState } from 'react';

export interface ViewportPageLayout {
  columns: number;
  rows: number;
  pageSize: number;
  width: number;
  height: number;
  maxCoverSize: number;
  cellHeight: number;
}

interface ViewportPageOptions {
  mode: 'list' | 'grid';
  /** Approximate pixel height per list row */
  listRowHeight?: number;
  /** Minimum card width when laying out a responsive grid */
  gridMinCardWidth?: number;
  /** Minimum pixel gap between grid items */
  gridGap?: number;
  /** Extra non-square height below cover art inside grid cards (text + action row) */
  gridCardExtraHeight?: number;
  /** Fixed row height for non-square horizontal cards */
  fixedGridCardHeight?: number;
  /** Max columns allowed on wide screens */
  maxColumns?: number;
  /** Vertical pixel reserve inside container */
  verticalPadding?: number;
}

export function useViewportPageSize(
  containerRef: React.RefObject<HTMLElement | null>,
  {
    mode,
    listRowHeight = 58,
    gridMinCardWidth = 144,
    gridGap = 10,
    gridCardExtraHeight = 58,
    fixedGridCardHeight,
    maxColumns = 6,
    verticalPadding = 4,
  }: ViewportPageOptions
): ViewportPageLayout {
  const [layout, setLayout] = useState<ViewportPageLayout>({
    columns: mode === 'list' ? 1 : 2,
    rows: 4,
    pageSize: mode === 'list' ? 6 : 4,
    width: 340,
    height: 360,
    maxCoverSize: 120,
    cellHeight: fixedGridCardHeight || 168,
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const w = Math.max(200, Math.floor(rect.width));
      const h = Math.max(72, Math.floor(rect.height - verticalPadding));

      if (mode === 'list') {
        const rows = Math.max(1, Math.floor(h / listRowHeight));
        setLayout((prev) =>
          prev.columns === 1 &&
          prev.rows === rows &&
          prev.pageSize === rows &&
          prev.width === w &&
          prev.height === h
            ? prev
            : {
                columns: 1,
                rows,
                pageSize: rows,
                width: w,
                height: h,
                maxCoverSize: 56,
                cellHeight: listRowHeight,
              }
        );
        return;
      }

      const rawCols = Math.floor((w + gridGap) / (gridMinCardWidth + gridGap));
      const columns = Math.max(1, Math.min(maxColumns, rawCols));
      const cardWidth = Math.max(96, (w - gridGap * (columns - 1)) / columns);

      if (typeof fixedGridCardHeight === 'number') {
        const cellHeight = Math.min(fixedGridCardHeight, h);
        const rows = Math.max(1, Math.floor((h + gridGap) / (cellHeight + gridGap)));
        const pageSize = Math.max(1, columns * rows);
        setLayout((prev) =>
          prev.columns === columns &&
          prev.rows === rows &&
          prev.pageSize === pageSize &&
          prev.width === w &&
          prev.height === h &&
          prev.cellHeight === cellHeight
            ? prev
            : {
                columns,
                rows,
                pageSize,
                width: w,
                height: h,
                maxCoverSize: Math.round(cardWidth),
                cellHeight,
              }
        );
        return;
      }

      const naturalCover = Math.max(56, Math.round(cardWidth - 16));
      const maxFitCover = Math.max(52, h - gridCardExtraHeight);
      const maxCoverSize = Math.min(naturalCover, maxFitCover);
      const cellHeight = maxCoverSize + gridCardExtraHeight;
      const rows = Math.max(1, Math.floor((h + gridGap) / (cellHeight + gridGap)));
      const pageSize = Math.max(1, columns * rows);

      setLayout((prev) =>
        prev.columns === columns &&
        prev.rows === rows &&
        prev.pageSize === pageSize &&
        prev.width === w &&
        prev.height === h &&
        prev.maxCoverSize === maxCoverSize &&
        prev.cellHeight === cellHeight
          ? prev
          : {
              columns,
              rows,
              pageSize,
              width: w,
              height: h,
              maxCoverSize,
              cellHeight,
            }
      );
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [
    containerRef,
    mode,
    listRowHeight,
    gridMinCardWidth,
    gridGap,
    gridCardExtraHeight,
    fixedGridCardHeight,
    maxColumns,
    verticalPadding,
  ]);

  return layout;
}
