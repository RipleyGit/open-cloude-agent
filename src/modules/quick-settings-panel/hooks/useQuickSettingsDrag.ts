import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react';

import type { QuickSettingsHandleStyle } from '@/shared/types';

// Bottom-docked handle: a new key so a stored vertical `{ y }` position from
// the right-docked panel is never misread as a horizontal `{ x }`.
const HANDLE_POSITION_STORAGE_KEY = 'quickSettingsHandlePositionBottom';

const DEFAULT_HANDLE_POSITION = 50;
const HANDLE_POSITION_MIN = 10;
const HANDLE_POSITION_MAX = 90;
const DRAG_THRESHOLD_PX = 5;

type UseQuickSettingsDragProps = {
  isMobile: boolean;
};

type StartDragEvent = ReactMouseEvent<HTMLButtonElement> | ReactTouchEvent<HTMLButtonElement>;
type MoveDragEvent = MouseEvent | TouchEvent;
type EventWithClientX = StartDragEvent | MoveDragEvent;

const clampPosition = (value: number): number => (
  Math.max(HANDLE_POSITION_MIN, Math.min(HANDLE_POSITION_MAX, value))
);

const readHandlePosition = (): number => {
  if (typeof window === 'undefined') {
    return DEFAULT_HANDLE_POSITION;
  }

  const saved = localStorage.getItem(HANDLE_POSITION_STORAGE_KEY);
  if (!saved) {
    return DEFAULT_HANDLE_POSITION;
  }

  try {
    const parsed = JSON.parse(saved) as { x?: unknown };
    if (typeof parsed.x === 'number' && Number.isFinite(parsed.x)) {
      return clampPosition(parsed.x);
    }
  } catch {
    localStorage.removeItem(HANDLE_POSITION_STORAGE_KEY);
    return DEFAULT_HANDLE_POSITION;
  }

  return DEFAULT_HANDLE_POSITION;
};

const isTouchEvent = (event: { type: string }): boolean => event.type.includes('touch');

const getClientX = (event: EventWithClientX): number | null => {
  if ('touches' in event) {
    return event.touches[0]?.clientX ?? null;
  }

  return 'clientX' in event && typeof event.clientX === 'number'
    ? event.clientX
    : null;
};

export function useQuickSettingsDrag({ isMobile }: UseQuickSettingsDragProps) {
  // The bottom panel's handle slides horizontally along the panel edge, so the
  // position is a horizontal percentage. `isMobile` is retained to keep the
  // hook's signature stable for its existing caller.
  void isMobile;
  const [handlePosition, setHandlePosition] = useState<number>(readHandlePosition);
  const [isPointerDown, setIsPointerDown] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const dragStartXRef = useRef<number | null>(null);
  const dragStartPositionRef = useRef(DEFAULT_HANDLE_POSITION);
  const didDragRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const bodyStylesAppliedRef = useRef(false);

  const clearBodyDragStyles = useCallback(() => {
    if (!bodyStylesAppliedRef.current) {
      return;
    }

    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
    bodyStylesAppliedRef.current = false;
  }, []);

  const applyBodyDragStyles = useCallback((isTouchDragging: boolean) => {
    if (bodyStylesAppliedRef.current) {
      return;
    }

    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    // Touch drag should lock body scroll so the handle movement stays smooth.
    if (isTouchDragging) {
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
    }

    bodyStylesAppliedRef.current = true;
  }, []);

  const endDrag = useCallback(() => {
    if (!isPointerDown && dragStartXRef.current === null) {
      return;
    }

    suppressNextClickRef.current = didDragRef.current;
    didDragRef.current = false;
    dragStartXRef.current = null;
    setIsPointerDown(false);
    setIsDragging(false);
    clearBodyDragStyles();
  }, [clearBodyDragStyles, isPointerDown]);

  const handleMove = useCallback(
    (event: MoveDragEvent) => {
      if (!isPointerDown || dragStartXRef.current === null) {
        return;
      }

      const clientX = getClientX(event);
      if (clientX === null) {
        return;
      }

      const rawDelta = clientX - dragStartXRef.current;
      const movedPastThreshold = Math.abs(rawDelta) > DRAG_THRESHOLD_PX;

      if (!didDragRef.current && movedPastThreshold) {
        didDragRef.current = true;
        setIsDragging(true);
        applyBodyDragStyles(isTouchEvent(event));
      }

      if (!didDragRef.current) {
        return;
      }

      if (isTouchEvent(event)) {
        event.preventDefault();
      }

      const viewportWidth = Math.max(window.innerWidth, 1);
      const normalizedDelta = (rawDelta / viewportWidth) * 100;
      setHandlePosition(clampPosition(dragStartPositionRef.current + normalizedDelta));
    },
    [applyBodyDragStyles, isPointerDown],
  );

  const startDrag = useCallback((event: StartDragEvent) => {
    event.stopPropagation();

    const clientX = getClientX(event);
    if (clientX === null) {
      return;
    }

    dragStartXRef.current = clientX;
    dragStartPositionRef.current = handlePosition;
    didDragRef.current = false;
    setIsDragging(false);
    setIsPointerDown(true);
  }, [handlePosition]);

  // Persist drag-handle position so users keep their preferred quick-access location.
  useEffect(() => {
    localStorage.setItem(
      HANDLE_POSITION_STORAGE_KEY,
      JSON.stringify({ x: handlePosition }),
    );
  }, [handlePosition]);

  useEffect(() => {
    if (!isPointerDown) {
      return undefined;
    }

    const handleMouseMove = (event: MouseEvent) => {
      handleMove(event);
    };
    const handleMouseUp = () => {
      endDrag();
    };
    const handleTouchMove = (event: TouchEvent) => {
      handleMove(event);
    };
    const handleTouchEnd = () => {
      endDrag();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [endDrag, handleMove, isPointerDown]);

  useEffect(() => (
    () => {
      clearBodyDragStyles();
    }
  ), [clearBodyDragStyles]);

  const consumeSuppressedClick = useCallback((): boolean => {
    if (!suppressNextClickRef.current) {
      return false;
    }

    suppressNextClickRef.current = false;
    return true;
  }, []);

  const handleStyle = useMemo<QuickSettingsHandleStyle>(() => ({
    left: `${handlePosition}%`,
    transform: 'translateX(-50%)',
  }), [handlePosition]);

  return {
    isDragging,
    handleStyle,
    startDrag,
    consumeSuppressedClick,
  };
}
