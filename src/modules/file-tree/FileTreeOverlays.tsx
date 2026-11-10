import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Loader2, X } from 'lucide-react';

import { cn } from '@/shared/utils';
import type { DeleteConfirmation, ToastMessage } from '@/shared/types';

type FileTreeOverlaysProps = {
  deleteConfirmation: DeleteConfirmation;
  operationLoading: boolean;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  toast: ToastMessage | null;
  onToastDismiss: () => void;
};

const TOAST_AUTO_HIDE_MS = 3000;

/** Rendered by FileTree and FileTreeInline so the delete confirmation and operation toast stay identical in both. */
export default function FileTreeOverlays({
  deleteConfirmation,
  operationLoading,
  onCancelDelete,
  onConfirmDelete,
  toast,
  onToastDismiss,
}: FileTreeOverlaysProps) {
  const { t } = useTranslation();

  // Auto-hide lives here so both trees get the same timeout instead of each
  // keeping its own effect.
  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = setTimeout(onToastDismiss, TOAST_AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [toast, onToastDismiss]);

  return (
    <>
      {deleteConfirmation.isOpen && deleteConfirmation.item && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
          <div className="mx-4 max-w-sm rounded-lg border border-border bg-background p-4 shadow-lg">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-full bg-red-100 p-2 dark:bg-red-900/30">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3 className="font-medium text-foreground">
                  {t('fileTree.delete.title', 'Delete {{type}}', {
                    type: deleteConfirmation.item.type === 'directory' ? 'Folder' : 'File',
                  })}
                </h3>
                <p className="text-sm text-muted-foreground">{deleteConfirmation.item.name}</p>
              </div>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              {deleteConfirmation.item.type === 'directory'
                ? t('fileTree.delete.folderWarning', 'This folder and all its contents will be permanently deleted.')
                : t('fileTree.delete.fileWarning', 'This file will be permanently deleted.')}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={onCancelDelete}
                disabled={operationLoading}
                className="rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-accent"
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                onClick={onConfirmDelete}
                disabled={operationLoading}
                className="flex items-center gap-2 rounded-md bg-red-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {operationLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('fileTree.delete.confirm', 'Delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          className={cn(
            'fixed bottom-4 right-4 z-[9999] flex items-center gap-2 rounded-lg px-4 py-2 shadow-lg animate-in slide-in-from-bottom-2',
            toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white',
          )}
        >
          {toast.type === 'success' ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
          <span className="text-sm">{toast.message}</span>
        </div>
      )}
    </>
  );
}
