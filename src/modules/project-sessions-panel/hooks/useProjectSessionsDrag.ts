import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react';

export type ProjectSessionsSide = 'left' | 'right';

const HANDLE_SIDE_STORAGE_KEY = 'project_sessions_handle_side';
const HANDLE_POSITION_STORAGE_KEY = 'project_sessions_handle_position';

// Rendered by ProjectSidebarRegion only while a sidebar is docked on the left,
// so its right edge is where the handle may rest. Absent on mobile, where the
// sidebar is a drawer and the whole window is free.
const SIDEBAR_REGION_ID = 'workspace-sidebar-region';

const DEFAULT_HANDLE_SIDE: ProjectSessionsSide = 'right';
const DEFAULT_HANDLE_POSITION = 40;
const HANDLE_POSITION_MIN = 10;
const HANDLE_POSITION_MAX = 90;
const DRAG_THRESHOLD_PX = 5;
const HANDLE_RADIUS_PX = 20;

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

const readSidebarInset = (): number => {
  if (typeof document === 'undefined') {
    return 0;
  }

  // The shell is `fixed inset-0`, so viewport coordinates are shell coordinates
  // and the region's right edge is the handle's left boundary.
  const region = document.getElementById(SIDEBAR_REGION_ID);
  if (!region) {
    return 0;
  }

  return Math.max(0, Math.round(region.getBoundingClientRect().right));
};

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
 * Provides 2D draggable positioning clamped strictly to the viewport bounds,
 * snapping to its left or right edge with vertical adjustment. The handle is
 * rendered by the workspace shell, outside the chat window, so the viewport —
 * not the chat's content region — is the box it is dragged in.
 *
 * On the left it stops against the project sidebar instead of the window edge,
 * so it never comes to rest on top of it. `isMobile` says whether that sidebar
 * is docked at all: it is a drawer on mobile, leaving the whole window free.
 */
export function useProjectSessionsDrag(isMobile: boolean) {
  const [side, setSide] = useState<ProjectSessionsSide>(readHandleSide);
  const [handlePosition, setHandlePosition] = useState<number>(readHandlePosition);
  const [isPointerDown, setIsPointerDown] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragPoint, setDragPoint] = useState<Point | null>(null);
  const [sidebarInset, setSidebarInset] = useState(0);

  const dragStartRef = useRef<Point | null>(null);
  const dragPointRef = useRef<Point | null>(null);

  const didDragRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const bodyStylesAppliedRef = useRef(false);

  // The sidebar is resizable, so the boundary has to be tracked rather than
  // read once. Re-runs on the mobile switch because that is what mounts and
  // unmounts the docked sidebar region.
  useEffect(() => {
    const sync = () => {
      setSidebarInset(readSidebarInset());
    };

    sync();

    const region = document.getElementById(SIDEBAR_REGION_ID);
    if (!region || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(sync);
    observer.observe(region);
    return () => observer.disconnect();
  }, [isMobile]);

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
      const { x, y } = dragPointRef.current;
      const targetSide: ProjectSessionsSide = x < window.innerWidth / 2 ? 'left' : 'right';
      const targetYPercent = clampPosition((y / Math.max(window.innerHeight, 1)) * 100);

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
  }, [clearBodyDragStyles, isPointerDown]);

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

      // Restrict drag coordinates strictly within the viewport bounds, and on
      // the left within the space the project sidebar has left free.
      const clampedX = Math.max(
        sidebarInset + HANDLE_RADIUS_PX,
        Math.min(window.innerWidth - HANDLE_RADIUS_PX, point.x),
      );
      const clampedY = Math.max(HANDLE_RADIUS_PX, Math.min(window.innerHeight - HANDLE_RADIUS_PX, point.y));

      const nextPoint = { x: clampedX, y: clampedY };
      dragPointRef.current = nextPoint;
      setDragPoint(nextPoint);
    },
    [applyBodyDragStyles, isPointerDown, sidebarInset],
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

  const baseStyle = useMemo<CSSProperties>(() => {
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

  // Resting against the sidebar rather than the window edge keeps the handle
  // clear of it, matching the boundary it was dragged against.
  const edgeOffset = side === 'left' ? sidebarInset : 0;

  const handleStyle = useMemo<CSSProperties>(() => {
    if (isDragging) {
      return baseStyle;
    }

    return side === 'left'
      ? { ...baseStyle, left: edgeOffset }
      : { ...baseStyle, right: 0 };
  }, [baseStyle, edgeOffset, isDragging, side]);

  return {
    side,
    isDragging,
    handleStyle,
    startDrag,
    consumeSuppressedClick,
  };
}
