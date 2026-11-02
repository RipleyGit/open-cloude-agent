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

type QuickSettingsHandlePlacement = 'overlay' | 'docked';

type QuickSettingsHandleProps = {
  isOpen: boolean;
  isDragging: boolean;
  placement: QuickSettingsHandlePlacement;
  style: QuickSettingsHandleStyle;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onTouchStart: (event: ReactTouchEvent<HTMLButtonElement>) => void;
};

/** Rendered by QuickSettingsPanelView as the draggable edge handle that opens and closes the drawer. `overlay` hugs the viewport bottom; `docked` hugs the in-flow panel row's top edge. */
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

  // Overlay: the panel is fixed to the viewport bottom, so the handle tracks
  // the viewport — above the panel's top border when open, at the very bottom
  // edge when closed. Docked: the panel is an in-flow row in the chat column,
  // so the handle is absolute against that row's top border (and straddles it
  // by half its height via the translate).
  const placementClass = placement === 'overlay'
    ? `fixed ${isOpen ? 'bottom-64' : 'bottom-0'}`
    : 'absolute top-0';
  const transform = placement === 'overlay'
    ? 'translateX(-50%)'
    : 'translate(-50%, -50%)';
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
