import { CheckSquare, Trash2 } from 'lucide-react';

import { Button } from '@/shared/ui/Button';
import { cn } from '@/shared/utils';

type SessionBulkToolbarProps = {
  /** True while this list is in selection mode (rows render checkboxes). */
  isSelecting: boolean;
  /** Label for the entry control shown when not selecting. */
  selectLabel: string;
  onStartSelection: () => void;
  /** Label for the select-all toggle while selecting. */
  selectAllLabel: string;
  /** Disabled when there is nothing selectable. */
  canSelectAll: boolean;
  onToggleSelectAll: () => void;
  cancelLabel: string;
  onCancelSelection: () => void;
  /** Delete button label, already interpolated with the selected count. */
  deleteLabel: string;
  selectedCount: number;
  /** Disabled when nothing is selected or deletion is otherwise unavailable. */
  canDelete: boolean;
  onDeleteSelected: () => void;
  className?: string;
};

/**
 * The selection toolbar a session list shows above its rows: a "Select" entry
 * when idle, and select-all / cancel / delete-selected when actively selecting.
 *
 * Lifted from the sidebar's project sessions list so the project sessions panel
 * renders the same controls without re-implementing them. The list that mounts
 * it still owns the selection state and derived ids; this only renders from the
 * props it is handed.
 */
export default function SessionBulkToolbar({
  isSelecting,
  selectLabel,
  onStartSelection,
  selectAllLabel,
  canSelectAll,
  onToggleSelectAll,
  cancelLabel,
  onCancelSelection,
  deleteLabel,
  selectedCount,
  canDelete,
  onDeleteSelected,
  className,
}: SessionBulkToolbarProps) {
  if (isSelecting) {
    return (
      <div className={cn('space-y-1', className)}>
        {/* Wraps rather than clips: at a narrow width a long select-all label
            leaves no room for Cancel. */}
        <div className="flex flex-wrap items-center justify-between gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={onToggleSelectAll}
            disabled={!canSelectAll}
          >
            {selectAllLabel}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={onCancelSelection}
          >
            {cancelLabel}
          </Button>
        </div>
        <Button
          variant="destructive"
          size="sm"
          className="h-8 w-full justify-center gap-2 bg-red-600 text-xs font-medium text-white hover:bg-red-700"
          onClick={onDeleteSelected}
          disabled={!canDelete}
        >
          <Trash2 className="h-3 w-3" />
          {deleteLabel}
        </Button>
      </div>
    );
  }

  return (
    <div className={cn('flex justify-end', className)}>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
        onClick={onStartSelection}
      >
        <CheckSquare className="h-3 w-3" />
        {selectLabel}
      </Button>
    </div>
  );
}
