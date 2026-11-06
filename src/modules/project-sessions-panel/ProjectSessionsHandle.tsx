import type { CSSProperties, MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react';
import { GripVertical, MessageCircleMore } from 'lucide-react';

import type { ProjectSessionsSide } from '@/modules/project-sessions-panel/hooks/useProjectSessionsDrag';

type ProjectSessionsHandleProps = {
  isOpen: boolean;
  isDragging: boolean;
  side: ProjectSessionsSide;
  style: CSSProperties;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onTouchStart: (event: ReactTouchEvent<HTMLButtonElement>) => void;
};

/**
 * The 2D draggable handle that toggles the docked sessions panel. Used by
 * ProjectSessionsPanel, which owns placement: pinned to the conversation
 * window's edge while collapsed, and straddling the docked panel's inner edge
 * while it is open.
 */
export default function ProjectSessionsHandle({
  isOpen,
  isDragging,
  side,
  style,
  onClick,
  onMouseDown,
  onTouchStart,
}: ProjectSessionsHandleProps) {
  // Mirrored on the right so the icon always faces the conversation.
  const iconClass = `h-5 w-5 ${side === 'right' ? 'scale-x-[-1]' : ''}`;

  const borderClass = isDragging
    ? 'border-primary shadow-primary/20'
    : 'border-border';
  const roundedClass = isDragging ? 'rounded-md shadow-2xl scale-110' : 'rounded-md';
  const transitionClass = isDragging ? '' : 'transition-all duration-150 ease-out';
  const cursorClass = isDragging ? 'cursor-grabbing' : 'cursor-grab';
  const activeIconClass = isOpen ? 'text-primary fill-primary/10' : 'text-muted-foreground group-hover:text-primary';

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      className={`z-50 border bg-background p-2 shadow-md hover:bg-muted/80 ${borderClass} ${roundedClass} ${transitionClass} ${cursorClass} touch-none group`}
      style={{
        ...style,
        touchAction: 'none',
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
      }}
      aria-label={isOpen ? '收起会话列表' : '展开会话列表'}
      title="拖拽可停靠在对话窗口左侧或右侧，点击展开/收起会话列表"
    >
      {isDragging ? (
        <GripVertical className={`${iconClass} text-primary`} />
      ) : (
        <MessageCircleMore className={`${iconClass} transition-colors ${activeIconClass}`} />
      )}
    </button>
  );
}
