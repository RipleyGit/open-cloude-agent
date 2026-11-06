import { memo } from 'react';
import type { KeyboardEvent } from 'react';
import { CheckSquare, Loader2, Square } from 'lucide-react';
import type { TFunction } from 'i18next';

import { LLMProviderLogo, SessionOptions } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { PROVIDER_LABELS } from '@/shared/constants';
import type { LLMProvider, Project, SessionWithProvider } from '@/shared/types';

function formatRelativeTime(dateString: string | null | undefined): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  const now = Date.now();
  const diffMinutes = Math.floor(Math.max(0, now - date.getTime()) / 60000);
  if (diffMinutes < 1) return '刚刚';
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d`;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

type ProjectSessionRowProps = {
  session: SessionWithProvider;
  /** The owning project, so the shared SessionOptions menu can key rename/delete by projectId. */
  project: Project;
  isSelected: boolean;
  isProcessing: boolean;
  hasBackgroundWork: boolean;
  hasAttention: boolean;
  isEditing: boolean;
  renameDraft: string;
  onRenameDraftChange: (value: string) => void;
  onStartEditing: (projectId: string, sessionId: string, initialName: string) => void;
  onCancelEditing: () => void;
  onSaveEditing: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onSelect: () => void;
  onDeleteSession: (sessionId: string, sessionTitle: string) => void;
  onFork?: () => void;
  /** Bulk-selection mode: the row acts as a checkbox and hides its options menu. */
  isSelecting: boolean;
  isChecked: boolean;
  onToggleSelected: () => void;
  t: TFunction;
};

/**
 * Single session row in the project sessions panel list. Its trailing controls
 * are the shared `SessionOptions` (⋯ menu: rename/copy id/fork/delete), the
 * same component the sidebar rows render, so the two lists cannot drift.
 */
function ProjectSessionRow({
  session,
  project,
  isSelected,
  isProcessing,
  hasBackgroundWork,
  hasAttention,
  isEditing,
  renameDraft,
  onRenameDraftChange,
  onStartEditing,
  onCancelEditing,
  onSaveEditing,
  onSelect,
  onDeleteSession,
  onFork,
  isSelecting,
  isChecked,
  onToggleSelected,
  t,
}: ProjectSessionRowProps) {
  const provider = (session.__provider || session.provider || 'claude') as LLMProvider;
  const timeFormatted = formatRelativeTime(session.lastActivity || session.createdAt);
  const title = session.summary || session.name || '未命名会话';
  const providerLabel = PROVIDER_LABELS[provider];

  // A running session cannot be deleted or ticked; the row still renders,
  // locked, instead of disappearing mid-selection.
  const isSelectable = isSelecting && !isProcessing;
  const handleSelectionKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!isSelectable || (event.key !== ' ' && event.key !== 'Enter')) {
      return;
    }
    event.preventDefault();
    onToggleSelected();
  };
  const SelectionIcon = isChecked ? CheckSquare : Square;
  const selectionIcon = isSelecting ? (
    <SelectionIcon
      className={cn(
        'h-4 w-4 flex-shrink-0',
        isChecked ? 'text-primary' : 'text-muted-foreground',
        !isSelectable && 'opacity-40',
      )}
      aria-hidden="true"
    />
  ) : null;

  return (
    <div
      data-session-row=""
      role={isSelecting ? 'checkbox' : undefined}
      aria-checked={isSelecting ? isChecked : undefined}
      aria-disabled={isSelecting && !isSelectable ? true : undefined}
      tabIndex={isSelecting ? 0 : undefined}
      onClick={isEditing ? undefined : (isSelecting ? (isSelectable ? onToggleSelected : undefined) : onSelect)}
      onKeyDown={isSelecting ? handleSelectionKeyDown : undefined}
      onDoubleClick={isSelecting || isEditing ? undefined : () =>
        onStartEditing(project.projectId, session.id, title)}
      className={cn(
        'group relative flex items-center gap-1.5 rounded-md p-2 text-xs transition-colors border',
        isSelecting ? 'cursor-pointer' : 'cursor-pointer',
        isSelected
          ? 'bg-accent border-primary/40 text-accent-foreground font-medium shadow-sm'
          : 'bg-card/40 border-transparent hover:border-border hover:bg-muted/60 text-muted-foreground hover:text-foreground',
        isChecked && 'border-primary/40 bg-primary/10',
      )}
    >
      {selectionIcon}

      <div className="flex-shrink-0 flex items-center justify-center">
        {isProcessing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
        ) : hasBackgroundWork ? (
          <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" title="后台任务运行中" />
        ) : hasAttention ? (
          <span className="h-2 w-2 rounded-full bg-rose-500 animate-ping" title="等待处理" />
        ) : (
          <LLMProviderLogo provider={provider} className="h-3.5 w-3.5 opacity-80" />
        )}
      </div>

      <span className={cn('truncate font-medium flex-1 text-left', isSelected && 'text-foreground')} title={title}>
        {title}
      </span>

      {!isSelecting && (
        <div
          className="flex items-center gap-1 flex-shrink-0"
          onClick={(event) => event.stopPropagation()}
        >
          {timeFormatted && !isEditing && (
            <span className="text-[10px] text-muted-foreground/70 font-mono group-hover:hidden">
              {timeFormatted}
            </span>
          )}
          <SessionOptions
            className={cn(
              'absolute right-1 top-1/2 -translate-y-1/2 transform',
              isEditing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
            )}
            sessionId={session.id}
            sessionName={title}
            provider={provider}
            projectId={project.projectId}
            isProcessing={isProcessing}
            isEditing={isEditing}
            renameDraft={renameDraft}
            onRenameDraftChange={onRenameDraftChange}
            onStartEditingSession={onStartEditing}
            onCancelEditingSession={onCancelEditing}
            onSaveEditingSession={onSaveEditing}
            onDeleteSession={onDeleteSession}
            onFork={onFork}
            t={t}
          />
        </div>
      )}
    </div>
  );
}

export default memo(ProjectSessionRow);
