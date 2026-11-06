import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, RefObject, TouchEvent as ReactTouchEvent } from 'react';

export type ProjectSessionsSide = 'left' | 'right';

const HANDLE_SIDE_STORAGE_KEY = 'project_sessions_handle_side';
const HANDLE_POSITION_STORAGE_KEY = 'project_sessions_handle_position';

const DEFAULT_HANDLE_SIDE: ProjectSessionsSide = 'right';
const DEFAULT_HANDLE_POSITION = 40;
const HANDLE_POSITION_MIN = 10;
const HANDLE_POSITION_MAX = 90;
const DRAG_THRESHOLD_PX = 5;
const HANDLE_RADIUS_PX = 20;

type UseProjectSessionsDragProps = {
  isMobile: boolean;
  containerRef?: RefObject<HTMLElement | null>;
};

type StartDragEvent = ReactMouseEvent<HTMLButtonElement> | ReactTouchEvent<HTMLButtonElement>;
type MoveDragEvent = MouseEvent | TouchEvent;

type Point = {
  x: number;
  y: number;
};

const clampPosition = (value: number): number => (
  Math.max(HANDLE_POSITION_MIN, Math.min(HANDLE_POSITION_MAX, value))
);

const readHandleSide = (): ProjectSessionsSide => {
  if (typeof window === 'undefined') {
    return DEFAULT_HANDLE_SIDE;
  }

  const saved = localStorage.getItem(HANDLE_SIDE_STORAGE_KEY);
  return saved === 'left' || saved === 'right' ? saved : DEFAULT_HANDLE_SIDE;
};

const readHandlePosition = (): number => {
  if (typeof window === 'undefined') {
    return DEFAULT_HANDLE_POSITION;
  }

  const saved = localStorage.getItem(HANDLE_POSITION_STORAGE_KEY);
  if (!saved) {
    return DEFAULT_HANDLE_POSITION;
  }

  try {
    const parsed = JSON.parse(saved) as { y?: unknown };
    if (typeof parsed.y === 'number' && Number.isFinite(parsed.y)) {
      return clampPosition(parsed.y);
    }
  } catch {
    localStorage.removeItem(HANDLE_POSITION_STORAGE_KEY);
    return DEFAULT_HANDLE_POSITION;
  }

  return DEFAULT_HANDLE_POSITION;
};

const isTouchEvent = (event: { type: string }): boolean => event.type.includes('touch');

const getClientCoordinates = (event: StartDragEvent | MoveDragEvent): Point | null => {
  if ('touches' in event) {
    const touch = event.touches[0];
    if (touch && typeof touch.clientX === 'number' && typeof touch.clientY === 'number') {
      return { x: touch.clientX, y: touch.clientY };
    }
    return null;
  }

  if ('clientX' in event && typeof event.clientX === 'number' && typeof event.clientY === 'number') {
    return { x: event.clientX, y: event.clientY };
  }

  return null;
};

/**
 * Provides 2D draggable positioning clamped strictly to the conversation window boundaries,
 * snapping to its left or right edge with vertical adjustment.
 */
export function useProjectSessionsDrag({ isMobile: _isMobile, containerRef }: UseProjectSessionsDragProps) {
  const [side, setSide] = useState<ProjectSessionsSide>(readHandleSide);
  const [handlePosition, setHandlePosition] = useState<number>(readHandlePosition);
  const [isPointerDown, setIsPointerDown] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragPoint, setDragPoint] = useState<Point | null>(null);

  const dragStartRef = useRef<Point | null>(null);
  const dragPointRef = useRef<Point | null>(null);

  const didDragRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const bodyStylesAppliedRef = useRef(false);

  const getContainerElement = useCallback((): HTMLElement | null => {
    if (typeof window === 'undefined') return null;
    return (
      document.getElementById('workspace-content-region') ??
      containerRef?.current ??
      document.getElementById('workspace-conversation-region')
    );
  }, [containerRef]);

  const getContainerRect = useCallback((): DOMRect | null => {
    const element = getContainerElement();
    return element ? element.getBoundingClientRect() : null;
  }, [getContainerElement]);

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

    if (isTouchDragging) {
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
    }

    bodyStylesAppliedRef.current = true;
  }, []);

  const endDrag = useCallback(() => {
    if (!isPointerDown && dragStartRef.current === null) {
      return;
    }

    if (didDragRef.current && dragPointRef.current && typeof window !== 'undefined') {
      const rect = getContainerRect();
      const containerWidth = rect?.width ?? window.innerWidth;
      const containerHeight = rect?.height ?? window.innerHeight;

      const { x, y } = dragPointRef.current;
      const targetSide: ProjectSessionsSide = x < containerWidth / 2 ? 'left' : 'right';
      const targetYPercent = clampPosition((y / Math.max(containerHeight, 1)) * 100);

      setSide(targetSide);
      setHandlePosition(targetYPercent);

      try {
        localStorage.setItem(HANDLE_SIDE_STORAGE_KEY, targetSide);
        localStorage.setItem(HANDLE_POSITION_STORAGE_KEY, JSON.stringify({ y: targetYPercent }));
      } catch {
        // Ignore storage errors in restricted context
      }
    }

    suppressNextClickRef.current = didDragRef.current;
    didDragRef.current = false;
    dragStartRef.current = null;
    dragPointRef.current = null;
    setDragPoint(null);
    setIsPointerDown(false);
    setIsDragging(false);
    clearBodyDragStyles();
  }, [clearBodyDragStyles, getContainerRect, isPointerDown]);

  const handleMove = useCallback(
    (event: MoveDragEvent) => {
      if (!isPointerDown || dragStartRef.current === null) {
        return;
      }

      const point = getClientCoordinates(event);
      if (point === null) {
        return;
      }

      const rawDeltaX = point.x - dragStartRef.current.x;
      const rawDeltaY = point.y - dragStartRef.current.y;
      const distance = Math.hypot(rawDeltaX, rawDeltaY);

      if (!didDragRef.current && distance > DRAG_THRESHOLD_PX) {
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

      // Restrict drag coordinates strictly within the conversation window bounds
      const rect = getContainerRect();
      let localX = 0;
      let localY = 0;

      if (rect) {
        const clampedX = Math.max(rect.left + HANDLE_RADIUS_PX, Math.min(rect.right - HANDLE_RADIUS_PX, point.x));
        const clampedY = Math.max(rect.top + HANDLE_RADIUS_PX, Math.min(rect.bottom - HANDLE_RADIUS_PX, point.y));
        localX = clampedX - rect.left;
        localY = clampedY - rect.top;
      } else if (typeof window !== 'undefined') {
        const clampedX = Math.max(HANDLE_RADIUS_PX, Math.min(window.innerWidth - HANDLE_RADIUS_PX, point.x));
        const clampedY = Math.max(HANDLE_RADIUS_PX, Math.min(window.innerHeight - HANDLE_RADIUS_PX, point.y));
        localX = clampedX;
        localY = clampedY;
      }

      const nextPoint = { x: localX, y: localY };
      dragPointRef.current = nextPoint;
      setDragPoint(nextPoint);
    },
    [applyBodyDragStyles, getContainerRect, isPointerDown],
  );

  const startDrag = useCallback((event: StartDragEvent) => {
    event.stopPropagation();

    const point = getClientCoordinates(event);
    if (point === null) {
      return;
    }

    dragStartRef.current = point;
    didDragRef.current = false;
    setIsDragging(false);
    setIsPointerDown(true);
  }, []);

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

  const handleStyle = useMemo<CSSProperties>(() => {
    if (isDragging && dragPoint) {
      return {
        position: 'absolute',
        left: `${dragPoint.x}px`,
        top: `${dragPoint.y}px`,
        transform: 'translate(-50%, -50%)',
        zIndex: 99999,
        transition: 'none',
      };
    }

    return {
      position: 'absolute',
      top: `${handlePosition}%`,
      transform: 'translateY(-50%)',
    };
  }, [dragPoint, handlePosition, isDragging]);

  return {
    side,
    isDragging,
    handleStyle,
    startDrag,
    consumeSuppressedClick,
  };
}
