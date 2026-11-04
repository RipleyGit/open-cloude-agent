import type {
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
} from 'react';
import {
  ChevronDown,
  ChevronUp,
  GripHorizontal,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { QuickSettingsHandleStyle } from '@/shared/types';

type QuickSettingsHandlePlacement = 'workspace';

type QuickSettingsHandleProps = {
  isOpen: boolean;
  isDragging: boolean;
  placement: QuickSettingsHandlePlacement;
  style: QuickSettingsHandleStyle;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onTouchStart: (event: ReactTouchEvent<HTMLButtonElement>) => void;
};

/** Rendered by QuickSettingsPanelView on the chat column's edge to open and close its in-flow bottom sheet. */
export default function QuickSettingsHandle({
  isOpen,
  isDragging,
  placement,
  style,
  onClick,
  onMouseDown,
  onTouchStart,
}: QuickSettingsHandleProps) {
  const { t } = useTranslation('settings');

  // The sheet lives in the chat layout, so its trigger stays on that layout's
  // top edge instead of being fixed to the viewport or covering the sidebar.
  const placementClass = 'absolute top-0';
  const transform = 'translate(-50%, -50%)';
  const borderClass = isDragging
    ? 'border-blue-500 dark:border-blue-400'
    : 'border-gray-200 dark:border-gray-700';
  const transitionClass = isDragging
    ? ''
    : 'transition-all duration-150 ease-out';
  const cursorClass = isDragging ? 'cursor-grabbing' : 'cursor-pointer';
  const ariaLabel = isDragging
    ? t('quickSettings.dragHandle.dragging')
    : isOpen
      ? t('quickSettings.dragHandle.closePanel')
      : t('quickSettings.dragHandle.openPanel');
  const title = isDragging
    ? t('quickSettings.dragHandle.draggingStatus')
    : t('quickSettings.dragHandle.toggleAndMove');

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      className={`${placementClass} z-50 ${transitionClass} border bg-white dark:bg-gray-800 ${borderClass} rounded-md p-2 shadow-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 ${cursorClass} touch-none`}
      style={{
        ...style,
        transform,
        touchAction: 'none',
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
      }}
      aria-label={ariaLabel}
      title={title}
    >
      {isDragging ? (
        <GripHorizontal className="h-5 w-5 text-blue-500 dark:text-blue-400" />
      ) : isOpen ? (
        <ChevronDown className="h-5 w-5 text-gray-600 dark:text-gray-400" />
      ) : (
        <ChevronUp className="h-5 w-5 text-gray-600 dark:text-gray-400" />
      )}
    </button>
  );
}
