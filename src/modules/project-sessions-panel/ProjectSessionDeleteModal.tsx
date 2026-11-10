import ReactDOM from 'react-dom';
import { AlertTriangle, Archive, Trash2 } from 'lucide-react';

import { Button } from '@/shared/ui';

type ProjectSessionDeleteModalProps = {
  isOpen: boolean;
  sessionTitle: string;
  onConfirm: (hardDelete: boolean) => void;
  onCancel: () => void;
};

/**
 * Confirmation dialog for session deletion or archiving, mounted to document.body to avoid clipping.
 */
export default function ProjectSessionDeleteModal({
  isOpen,
  sessionTitle,
  onConfirm,
  onCancel,
}: ProjectSessionDeleteModalProps) {
  if (!isOpen || typeof document === 'undefined') {
    return null;
  }

  return ReactDOM.createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="删除会话"
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div className="w-full max-w-sm overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="p-5">
          <div className="flex items-start gap-3.5">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="mb-1.5 text-base font-semibold text-foreground">
                删除会话
              </h3>
              <p className="text-xs text-muted-foreground break-words">
                确定要删除会话 <span className="font-medium text-foreground">"{sessionTitle || '未命名会话'}"</span> 吗？
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                归档会将此会话从活动列表中隐藏并保留历史记录；彻底删除将抹去所有记录。
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-border bg-muted/30 p-3.5">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start text-xs h-8"
            onClick={() => onConfirm(false)}
          >
            <Archive className="mr-2 h-3.5 w-3.5" />
            移至归档 (保留历史)
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="w-full justify-start bg-red-600 text-white hover:bg-red-700 text-xs h-8"
            onClick={() => onConfirm(true)}
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            彻底删除 (不可恢复)
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs h-8 text-muted-foreground"
            onClick={onCancel}
          >
            取消
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
