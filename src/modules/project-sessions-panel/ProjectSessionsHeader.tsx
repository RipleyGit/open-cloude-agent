import { MessageCircleMore, Pin } from 'lucide-react';

import { Badge, Button } from '@/shared/ui';

type ProjectSessionsHeaderProps = {
  projectName?: string | null;
  sessionCount: number;
  /** Lit pin keeps the panel docked and expanded; a dim pin leaves it collapsed. */
  isPinned: boolean;
  onTogglePin: () => void;
};

/**
 * Header of the docked project sessions panel: title, project name, session
 * count, and the pin toggle. The new-session button lives at the foot of the
 * list and the panel closes by pin-toggle / outside-click, so neither a close
 * button nor a new-session trigger belongs here.
 */
export default function ProjectSessionsHeader({
  projectName,
  sessionCount,
  isPinned,
  onTogglePin,
}: ProjectSessionsHeaderProps) {
  return (
    <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-border px-3 bg-muted/20">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <MessageCircleMore className="h-4 w-4 text-primary flex-shrink-0" />
        <span className="font-semibold text-sm text-foreground truncate">
          会话列表
        </span>
        {projectName && (
          <span className="text-xs text-muted-foreground truncate max-w-[90px]" title={projectName}>
            {projectName}
          </span>
        )}
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono h-4">
          {sessionCount}
        </Badge>
      </div>

      <div className="flex flex-shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={onTogglePin}
          aria-pressed={isPinned}
          className={`h-7 w-7 ${isPinned ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          title={isPinned ? '取消固定（收起会话列表）' : '固定（常驻显示会话列表）'}
        >
          <Pin className={`h-3.5 w-3.5 ${isPinned ? 'fill-primary/20' : ''}`} />
        </Button>
      </div>
    </div>
  );
}
