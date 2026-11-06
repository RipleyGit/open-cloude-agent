import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderPlus, MessageSquareDashed, Plus, RotateCw, Search, X } from 'lucide-react';

import { api } from '@/shared/api';
import { Button, SessionBulkToolbar } from '@/shared/ui';
import type { LLMProvider, Project, ProjectSession, SessionWithProvider } from '@/shared/types';
import ProjectSessionDeleteModal from '@/modules/project-sessions-panel/ProjectSessionDeleteModal';
import ProjectSessionRow from '@/modules/project-sessions-panel/ProjectSessionRow';

type ProjectSessionsListProps = {
  project: Project | null;
  selectedSession: ProjectSession | null;
  activeSessions: ReadonlySet<string>;
  backgroundSessionIds: ReadonlySet<string>;
  attentionSessionIds?: ReadonlySet<string>;
  isLoading: boolean;
  onSessionSelect: (session: SessionWithProvider) => void;
  onNewSession: () => void;
  onSessionDelete?: (sessionId: string) => void;
  onLoadMoreSessions?: (projectId: string) => void;
  onRenameSession?: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onSessionItemClick?: () => void;
};

// A delete confirmation the list can open. `batch` carries the ids to remove;
// `single` is one session. Both reuse ProjectSessionDeleteModal.
type PendingDelete =
  | { kind: 'single'; id: string; title: string }
  | { kind: 'batch'; ids: string[]; title: string };

/**
 * Renders the session items under the selected project with search, rename,
 * fork, delete, bulk selection and load-more. Its rows share `SessionOptions`
 * and `SessionBulkToolbar` with the sidebar so the two lists stay in sync.
 */
export default function ProjectSessionsList({
  project,
  selectedSession,
  activeSessions,
  backgroundSessionIds,
  attentionSessionIds = new Set<string>(),
  isLoading,
  onSessionSelect,
  onNewSession,
  onSessionDelete,
  onLoadMoreSessions,
  onRenameSession,
  onSessionItemClick,
}: ProjectSessionsListProps) {
  const { t } = useTranslation(['sidebar', 'common']);

  const [searchQuery, setSearchQuery] = useState('');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  // null = not in selection mode; a Set = the ticked session ids.
  const [selectedSessionIds, setSelectedSessionIds] = useState<ReadonlySet<string> | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const rawSessions = (project?.sessions ?? []) as SessionWithProvider[];
  const sessionMeta = project?.sessionMeta;
  const hasMore = Boolean(sessionMeta?.hasMore);
  const totalCount = Number(sessionMeta?.total ?? rawSessions.length);
  const isSelecting = selectedSessionIds !== null;

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return rawSessions;
    const q = searchQuery.toLowerCase().trim();
    return rawSessions.filter((s) => {
      const summary = (s.summary || s.name || '').toLowerCase();
      return summary.includes(q);
    });
  }, [rawSessions, searchQuery]);

  // A session with a response in flight cannot be deleted, so it is not
  // selectable either; the row still renders, locked.
  const isSessionRunning = useCallback(
    (session: SessionWithProvider) =>
      activeSessions.has(session.id) && !backgroundSessionIds.has(session.id),
    [activeSessions, backgroundSessionIds],
  );
  const selectableSessionIds = useMemo(
    () => filteredSessions.filter((s) => !isSessionRunning(s)).map((s) => s.id),
    [filteredSessions, isSessionRunning],
  );
  // Re-derived from the selectable rows so a row that started running after it
  // was ticked drops out of the count and the ids the confirmation opens with.
  const effectiveSelectedIds = useMemo(
    () =>
      selectedSessionIds
        ? selectableSessionIds.filter((id) => selectedSessionIds.has(id))
        : [],
    [selectableSessionIds, selectedSessionIds],
  );
  const checkedSessionIds = useMemo(() => new Set(effectiveSelectedIds), [effectiveSelectedIds]);
  const allLoadedSelected =
    selectableSessionIds.length > 0 && effectiveSelectedIds.length === selectableSessionIds.length;
  const selectAllLabel = allLoadedSelected
    ? t('sessions.clearSelection')
    : hasMore
      ? t('sessions.selectAllLoaded')
      : t('sessions.selectAll');

  const handleStartEditing = useCallback((session: SessionWithProvider) => {
    setEditingSessionId(session.id);
    setRenameDraft(session.summary || session.name || '');
  }, []);

  const handleCancelEditing = useCallback(() => {
    setEditingSessionId(null);
    setRenameDraft('');
  }, []);

  const handleSaveEditing = useCallback(
    async (session: SessionWithProvider, newSummary: string) => {
      if (!project) return;
      const provider = (session.__provider || session.provider || 'claude') as LLMProvider;
      const projectName = project.displayName || project.projectId;

      try {
        await api.renameSession(session.id, newSummary);
        onRenameSession?.(projectName, session.id, newSummary, provider);
      } catch (err) {
        console.error('Failed to rename session:', err);
      } finally {
        setEditingSessionId(null);
      }
    },
    [onRenameSession, project],
  );

  const handleForkSession = useCallback(
    async (session: SessionWithProvider) => {
      if (!project) return;
      try {
        const response = await api.forkSession(session.id);
        const payload = await response.json();
        const forkedSessionId = payload?.data?.sessionId;
        if (response.ok && typeof forkedSessionId === 'string') {
          onSessionSelect({
            id: forkedSessionId,
            summary: payload.data.sessionName || session.summary,
            __provider: session.__provider,
            __projectId: project.projectId,
          } as SessionWithProvider);
          onSessionItemClick?.();
        }
      } catch (err) {
        console.error('Failed to fork session:', err);
      }
    },
    [onSessionItemClick, onSessionSelect, project],
  );

  const handleConfirmDelete = useCallback(
    async (hardDelete: boolean) => {
      const pending = pendingDelete;
      if (!pending) return;
      setPendingDelete(null);

      const targets = pending.kind === 'single' ? [pending.id] : pending.ids;
      try {
        await Promise.allSettled(
          targets.map(async (id) => {
            const response = await api.deleteSession(id, hardDelete);
            if (response.ok) {
              onSessionDelete?.(id);
            }
          }),
        );
      } finally {
        // A batch delete clears the selection; a single delete drops only that id.
        if (pending.kind === 'batch') {
          setSelectedSessionIds(null);
        }
      }
    },
    [onSessionDelete, pendingDelete],
  );

  const handleLoadMore = useCallback(async () => {
    if (!project || isLoadingMore || !onLoadMoreSessions) return;
    setIsLoadingMore(true);
    try {
      await onLoadMoreSessions(project.projectId);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, onLoadMoreSessions, project]);

  const toggleSessionSelected = useCallback((sessionId: string) => {
    setSelectedSessionIds((prev) => {
      if (prev === null) return null;
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  }, []);

  if (!project) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-6 text-center text-muted-foreground">
        <FolderPlus className="mb-2 h-8 w-8 opacity-40 text-muted-foreground" />
        <p className="text-xs font-medium text-foreground">未选择项目</p>
        <p className="mt-1 text-[11px]">请在左侧项目列表中选择一个项目以查看其下会话</p>
      </div>
    );
  }

  const showBulkToolbar =
    isSelecting || (isLoading === false && rawSessions.length > 0);

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Search Bar */}
      <div className="px-3 py-2 border-b border-border/50 bg-background/50">
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索当前项目会话..."
            className="h-7.5 w-full rounded-md border border-input bg-muted/40 pl-8 pr-7 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Bulk selection toolbar — same shared component the sidebar rows use. */}
      {showBulkToolbar && (
        <div className="px-3 py-1.5 border-b border-border/50">
          <SessionBulkToolbar
            isSelecting={isSelecting}
            selectLabel={t('sessions.select')}
            onStartSelection={() => setSelectedSessionIds(new Set())}
            selectAllLabel={selectAllLabel}
            canSelectAll={selectableSessionIds.length > 0}
            onToggleSelectAll={() =>
              setSelectedSessionIds(new Set(allLoadedSelected ? [] : selectableSessionIds))
            }
            cancelLabel={t('actions.cancel')}
            onCancelSelection={() => setSelectedSessionIds(null)}
            deleteLabel={t('sessions.deleteSelected', { count: effectiveSelectedIds.length })}
            selectedCount={effectiveSelectedIds.length}
            canDelete={effectiveSelectedIds.length > 0}
            onDeleteSelected={() =>
              setPendingDelete({
                kind: 'batch',
                ids: effectiveSelectedIds,
                title: `${effectiveSelectedIds.length} 个会话`,
              })
            }
          />
        </div>
      )}

      {/* Session Items List */}
      <div className="flex-1 overflow-y-auto min-h-0 p-2 space-y-1">
        {isLoading && rawSessions.length === 0 ? (
          <div className="space-y-2 p-1">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div key={idx} className="h-10 rounded-md bg-muted/30 animate-pulse" />
            ))}
          </div>
        ) : filteredSessions.length > 0 ? (
          <>
            {filteredSessions.map((session) => (
              <ProjectSessionRow
                key={session.id}
                session={session}
                project={project}
                isSelected={selectedSession?.id === session.id}
                isProcessing={isSessionRunning(session)}
                hasBackgroundWork={backgroundSessionIds.has(session.id)}
                hasAttention={attentionSessionIds.has(session.id)}
                isEditing={editingSessionId === session.id}
                renameDraft={renameDraft}
                onRenameDraftChange={setRenameDraft}
                onStartEditing={(projectId, sessionId, initialName) => handleStartEditing(session)}
                onCancelEditing={handleCancelEditing}
                onSaveEditing={(projectName, sessionId, summary, provider) =>
                  handleSaveEditing(session, summary)
                }
                onSelect={() => {
                  onSessionSelect(session);
                  onSessionItemClick?.();
                }}
                onDeleteSession={(sessionId, sessionTitle) =>
                  setPendingDelete({ kind: 'single', id: sessionId, title: sessionTitle })
                }
                onFork={() => handleForkSession(session)}
                isSelecting={isSelecting}
                isChecked={checkedSessionIds.has(session.id)}
                onToggleSelected={() => toggleSessionSelected(session.id)}
                t={t}
              />
            ))}

            {hasMore && (
              <div className="pt-2 pb-1 text-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className="w-full text-xs text-muted-foreground h-7 gap-1 hover:text-foreground"
                >
                  <RotateCw className={`h-3 w-3 ${isLoadingMore ? 'animate-spin' : ''}`} />
                  <span>
                    {isLoadingMore
                      ? '加载中...'
                      : `加载更多 (${rawSessions.length}/${totalCount})`}
                  </span>
                </Button>
              </div>
            )}

            {/* Bottom new-session button — the list's primary entry once the
                header button is gone. Shown whenever there are sessions (the
                empty-no-sessions state keeps its own). */}
            <div className="pt-1">
              <Button
                variant="default"
                size="sm"
                onClick={onNewSession}
                className="h-8 w-full justify-center gap-1.5 bg-primary text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>新建会话</span>
              </Button>
            </div>
          </>
        ) : searchQuery ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            <p>未找到匹配的会话</p>
            <Button
              variant="link"
              size="sm"
              onClick={() => setSearchQuery('')}
              className="mt-1 h-auto p-0 text-xs text-primary"
            >
              清空搜索条件
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={onNewSession}
              className="mt-3 h-8 w-full justify-center gap-1.5 bg-primary text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>新建会话</span>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
            <MessageSquareDashed className="mb-2 h-7 w-7 opacity-40 text-muted-foreground" />
            <p className="text-xs font-medium text-foreground">暂无会话</p>
            <p className="mt-1 text-[11px]">当前项目还没有会话记录</p>
            <Button
              variant="outline"
              size="sm"
              onClick={onNewSession}
              className="mt-3 h-7 px-3 text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>新建会话</span>
            </Button>
          </div>
        )}
      </div>

      <ProjectSessionDeleteModal
        isOpen={pendingDelete !== null}
        sessionTitle={pendingDelete?.title ?? ''}
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
