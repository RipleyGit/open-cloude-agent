import type {
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
} from 'react';

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

/** Rendered by QuickSettingsPanelView on the chat column's edge to open and close its in-flow bottom sheet.
 * Hidden as quick settings elements have been moved to the main Settings modal.
 */
export default function QuickSettingsHandle(_props: QuickSettingsHandleProps) {
  return null;
}
