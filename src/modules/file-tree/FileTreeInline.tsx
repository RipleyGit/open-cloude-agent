import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, FileText, Folder, FolderPlus, MoreHorizontal, RefreshCw, Search, Upload, X } from 'lucide-react';

import { ActionMenu, Button, Input } from '@/shared/ui';
import { cn } from '@/shared/utils';
import type { FileTreeImageSelection, FileTreeNode, Project, ToastMessage } from '@/shared/types';
import { ICON_SIZE_CLASS, getFileIconData } from '@/modules/file-tree/utils/fileIcons';
import { formatFileSize, formatRelativeTime, isImageFile } from '@/modules/file-tree/utils/fileTreeUtils';
import { useExpandedDirectories } from '@/modules/file-tree/hooks/useExpandedDirectories';
import { useFileTreeData } from '@/modules/file-tree/hooks/useFileTreeData';
import { useFileTreeOperations } from '@/modules/file-tree/hooks/useFileTreeOperations';
import { useFileTreeSearch } from '@/modules/file-tree/hooks/useFileTreeSearch';
import { useFileTreeUpload } from '@/modules/file-tree/hooks/useFileTreeUpload';
import FileTreeBody from '@/modules/file-tree/FileTreeBody';
import FileTreeOverlays from '@/modules/file-tree/FileTreeOverlays';
import FileTreeUploadProgress from '@/modules/file-tree/FileTreeUploadProgress';
import ImageViewer from '@/modules/file-tree/ImageViewer';

type FileTreeInlineProps = {
  project: Project;
  onFileOpen?: (filePath: string) => void;
};

/**
 * Compact file tree without its own header or scroll container, so it can sit
 * inside the sidebar's expanded project card and reuse the sidebar's scrollbar.
 * Rendered by the sidebar module through the file-tree barrel.
 */
export default function FileTreeInline({ project, onFileOpen }: FileTreeInlineProps) {
  const { t } = useTranslation();
  // The image the user clicked; the viewer renders it above the whole drawer.
  const [selectedImage, setSelectedImage] = useState<FileTreeImageSelection | null>(null);
  // Result banner for the last create/rename/delete/upload; overlays auto-hide it.
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const newItemInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const fileUploadInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  const { files, loading, error, refreshFiles } = useFileTreeData(project);
  const { expandedDirs, toggleDirectory, expandDirectories, collapseAll } = useExpandedDirectories();
  const { searchQuery, setSearchQuery, filteredFiles } = useFileTreeSearch({
    files,
    expandDirectories,
  });

  const operations = useFileTreeOperations({
    selectedProject: project,
    onRefresh: refreshFiles,
    showToast,
  });

  const upload = useFileTreeUpload({
    selectedProject: project,
    onRefresh: refreshFiles,
    showToast,
  });
  const operationLoading = operations.operationLoading || upload.operationLoading;

  useEffect(() => {
    if (operations.isCreating && newItemInputRef.current) {
      newItemInputRef.current.focus();
      newItemInputRef.current.select();
    }
  }, [operations.isCreating]);

  useEffect(() => {
    if (operations.renamingItem && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [operations.renamingItem]);

  const { handleFileSelect, uploadProgress } = upload;

  const handleUploadInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const { files: pickedFiles } = event.target;
      if (pickedFiles && pickedFiles.length > 0) {
        handleFileSelect(pickedFiles);
      }
      event.target.value = '';
    },
    [handleFileSelect],
  );

  const renderFileIcon = useCallback((filename: string) => {
    const { icon: Icon, color } = getFileIconData(filename);
    return <Icon className={cn(ICON_SIZE_CLASS, color)} />;
  }, []);

  // Mirrors FileTree's click handling so a file behaves the same here and in the Files tab.
  const handleItemClick = useCallback(
    (item: FileTreeNode) => {
      if (item.type === 'directory') {
        toggleDirectory(item.path);
        return;
      }

      if (isImageFile(item.name)) {
        setSelectedImage({
          name: item.name,
          path: item.path,
          projectPath: project.path,
          projectId: project.projectId,
        });
        return;
      }

      onFileOpen?.(item.path);
    },
    [onFileOpen, project.path, project.projectId, toggleDirectory],
  );

  const formatRelativeTimeLabel = useCallback(
    (date?: string) => formatRelativeTime(date, t),
    [t],
  );

  return (
    <div className="flex flex-col">
      <input
        ref={fileUploadInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleUploadInputChange}
        tabIndex={-1}
        aria-hidden="true"
      />

      <div className="px-1 pb-1">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t('fileTree.searchPlaceholder')}
            className="h-7 pl-7 pr-7 text-xs"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              aria-label={t('fileTree.clearSearch')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-0.5 px-1 pb-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 min-w-0 flex-1 gap-1 px-1 text-[11px] font-normal text-muted-foreground hover:text-foreground"
          onClick={() => operations.handleStartCreate('', 'file')}
          disabled={operationLoading}
        >
          <FileText className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{t('fileTree.context.newFile')}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 min-w-0 flex-1 gap-1 px-1 text-[11px] font-normal text-muted-foreground hover:text-foreground"
          onClick={() => operations.handleStartCreate('', 'directory')}
          disabled={operationLoading}
        >
          <FolderPlus className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{t('fileTree.context.newFolder')}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 min-w-0 flex-1 gap-1 px-1 text-[11px] font-normal text-muted-foreground hover:text-foreground"
          onClick={refreshFiles}
          disabled={operationLoading}
        >
          <RefreshCw className={cn('h-3.5 w-3.5 shrink-0', loading && 'animate-spin')} />
          <span className="truncate">{t('fileTree.refresh')}</span>
        </Button>
        <ActionMenu
          label={t('fileTree.context.menuLabel')}
          icon={MoreHorizontal}
          iconOnly
          variant="ghost"
          size="sm"
          triggerClassName="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
          items={[
            {
              key: 'upload',
              label: t('fileTree.context.upload'),
              icon: Upload,
              onSelect: () => fileUploadInputRef.current?.click(),
              disabled: operationLoading,
            },
            {
              key: 'collapse',
              label: t('fileTree.collapseAll'),
              icon: ChevronDown,
              onSelect: collapseAll,
              showDividerBefore: true,
            },
          ]}
        />
      </div>

      <FileTreeUploadProgress upload={uploadProgress} />

      {loading ? (
        <div className="px-2 py-3 text-xs text-muted-foreground">{t('fileTree.loading')}</div>
      ) : (
        <>
          {operations.isCreating && (
            <div
              className="mb-1 flex items-center gap-1.5 py-[3px] pr-2"
              style={{ paddingLeft: `${(operations.newItemParent.split('/').length - 1) * 16 + 4}px` }}
            >
              {operations.newItemType === 'directory' ? (
                <Folder className={cn(ICON_SIZE_CLASS, 'text-blue-500')} />
              ) : (
                <span className="ml-[18px]">{renderFileIcon(operations.newItemName)}</span>
              )}
              <Input
                ref={newItemInputRef}
                type="text"
                value={operations.newItemName}
                onChange={(event) => operations.setNewItemName(event.target.value)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Enter') operations.handleConfirmCreate();
                  if (event.key === 'Escape') operations.handleCancelCreate();
                }}
                onBlur={() => {
                  setTimeout(() => {
                    if (operations.isCreating) operations.handleConfirmCreate();
                  }, 100);
                }}
                className="h-6 flex-1 text-sm"
                disabled={operationLoading}
              />
            </div>
          )}

          <FileTreeBody
            files={files}
            filteredFiles={filteredFiles}
            error={error}
            searchQuery={searchQuery}
            viewMode="simple"
            expandedDirs={expandedDirs}
            onItemClick={handleItemClick}
            renderFileIcon={renderFileIcon}
            formatFileSize={formatFileSize}
            formatRelativeTime={formatRelativeTimeLabel}
            onRename={operations.handleStartRename}
            onDelete={operations.handleStartDelete}
            onNewFile={(path) => operations.handleStartCreate(path, 'file')}
            onNewFolder={(path) => operations.handleStartCreate(path, 'directory')}
            onCopyPath={operations.handleCopyPath}
            onDownload={operations.handleDownload}
            onRefresh={refreshFiles}
            renamingItem={operations.renamingItem}
            renameValue={operations.renameValue}
            setRenameValue={operations.setRenameValue}
            handleConfirmRename={operations.handleConfirmRename}
            handleCancelRename={operations.handleCancelRename}
            renameInputRef={renameInputRef}
            operationLoading={operationLoading}
          />
        </>
      )}

      {selectedImage && (
        <ImageViewer
          file={selectedImage}
          onClose={() => setSelectedImage(null)}
        />
      )}

      <FileTreeOverlays
        deleteConfirmation={operations.deleteConfirmation}
        operationLoading={operationLoading}
        onCancelDelete={operations.handleCancelDelete}
        onConfirmDelete={operations.handleConfirmDelete}
        toast={toast}
        onToastDismiss={dismissToast}
      />
    </div>
  );
}
