import { memo, useCallback, useEffect, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

import { useBackgroundSessionIdSet, useBusySessionIdSet } from '@/shared/context/SessionProtectionContext';
import { useDeviceSettings } from '@/shared/hooks/useDeviceSettings';
import type { LLMProvider, Project, ProjectSession, SessionWithProvider } from '@/shared/types';
import { useProjectSessionsDrag } from '@/modules/project-sessions-panel/hooks/useProjectSessionsDrag';
import ProjectSessionsHandle from '@/modules/project-sessions-panel/ProjectSessionsHandle';
import ProjectSessionsHeader from '@/modules/project-sessions-panel/ProjectSessionsHeader';
import ProjectSessionsList from '@/modules/project-sessions-panel/ProjectSessionsList';

export type ProjectSessionsPanelProps = {
  project: Project | null;
  selectedSession: ProjectSession | null;
  onSessionSelect: (session: SessionWithProvider) => void;
  onNewSession: () => void;
  onSessionDelete?: (sessionId: string) => void;
  onLoadMoreSessions?: (projectId: string) => void;
  onRenameSession?: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onLocateProject?: () => void;
  isLoading?: boolean;
  attentionSessionIds?: ReadonlySet<string>;
};

/**
 * Session list of the active project, rendered by the workspace shell. On
 * desktop it is a column docked into the shell's flex row, so the conversation
 * window shrinks instead of being covered — the composer stays reachable while
 * the list is open. On mobile there is no room to dock, so it falls back to a
 * drawer over the whole window, the same presentation as the sidebar's drawer.
 * Used by ProjectSessionsRegion (workspace) to let the user switch sessions
 * without leaving the conversation.
 *
 * While unpinned the panel is transient either way: clicking its blank area, or
 * anywhere else in the window, closes it. The mobile drawer adds a dimmed
 * backdrop to make that dismissal obvious; the docked desktop panel has none,
 * since the chat beside it is already visible and clickable.
 */
function ProjectSessionsPanel({
  project,
  selectedSession,
  onSessionSelect,
  onNewSession,
  onSessionDelete,
  onLoadMoreSessions,
  onRenameSession,
  onLocateProject,
  isLoading = false,
  attentionSessionIds,
}: ProjectSessionsPanelProps) {
  const { isMobile } = useDeviceSettings({ trackPWA: false });

  // Two orthogonal knobs: `isOpen` is transient — tapping the handle opens the
  // list and clicking its blank area closes it. `isPinned` makes the list stay
  // (常驻): lighting the pin keeps it open for good, and unlighting it closes.
  // The panel renders whenever either is true.
  const [isOpen, setIsOpen] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const isPanelVisible = isOpen || isPinned;

  const {
    side,
    isDragging,
    handleStyle,
    startDrag,
    consumeSuppressedClick,
  } = useProjectSessionsDrag(isMobile);

  const activeSessions = useBusySessionIdSet();
  const backgroundSessionIds = useBackgroundSessionIdSet();

  const sessions = project?.sessions ?? [];

  const close = useCallback(() => {
    setIsPinned(false);
    setIsOpen(false);
  }, []);

  // Lighting the pin keeps the list 常驻; unlighting it closes the list.
  const togglePin = useCallback(() => {
    if (isPinned) {
      close();
    } else {
      setIsPinned(true);
    }
  }, [close, isPinned]);

  const handleToggleFromHandle = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      if (consumeSuppressedClick()) {
        event.preventDefault();
        return;
      }
      setIsOpen(true);
    },
    [consumeSuppressedClick],
  );

  // Clicking the panel's blank area (not a row, button, input or link) closes
  // an unpinned panel and brings the handle back. A pinned panel stays put.
  const handlePanelBlankClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (isPinned) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('[data-session-row], button, input, a, textarea, [role="button"]')
      ) {
        return;
      }
      setIsOpen(false);
    },
    [isPinned],
  );

  const handleSessionItemSelect = useCallback(
    (session: SessionWithProvider) => {
      onSessionSelect(session);
      // Selecting a session is the panel's primary action, so an unpinned
      // panel closes once it lands — the chat is now showing that session.
      if (!isPinned) {
        setIsOpen(false);
      }
    },
    [isPinned, onSessionSelect],
  );

  // Locating the project is a jump out of this panel, so on mobile the drawer
  // closes to uncover whatever the sidebar does with the request. On desktop the
  // panel is docked beside the sidebar, so it stays and the user can keep
  // switching sessions after looking at the project's files.
  const handleLocateProject = useCallback(() => {
    onLocateProject?.();
    if (isMobile) {
      setIsOpen(false);
    }
  }, [isMobile, onLocateProject]);

  // Clicking outside an unpinned panel closes it — the chat window, or any
  // blank area of the workspace. That is what makes the panel feel transient:
  // it steps aside the moment the user goes back to the conversation, and the
  // pin is there for keeping it around. The options menu and the delete
  // confirmation portal to document.body, so clicks there must not close the
  // panel either — closing it would unmount the list (and the dialog's pending
  // state) before the click lands. The menu role, the dialog role and the panel
  // itself are whitelisted.
  useEffect(() => {
    if (!isPanelVisible || isPinned) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (
        target.closest(
          'aside[aria-label="项目会话列表"], [role="menu"], [role="alertdialog"]',
        )
      ) {
        return;
      }
      setIsOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isPanelVisible, isPinned]);

  useEffect(() => {
    if (!isPanelVisible) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      close();
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [close, isPanelVisible]);

  // The handle only exists while the list is collapsed (see the return below),
  // so the drag hook places it against the window's edge — or against the
  // project sidebar when it is docked on the left.
  const handle = (
    <ProjectSessionsHandle
      isOpen={false}
      isDragging={isDragging}
      side={side}
      style={handleStyle}
      onClick={handleToggleFromHandle}
      onMouseDown={startDrag}
      onTouchStart={startDrag}
    />
  );

  const panelBody = (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <ProjectSessionsHeader
        projectName={project?.displayName || project?.projectId || null}
        sessionCount={sessions.length}
        isPinned={isPinned}
        onTogglePin={togglePin}
        onLocateProject={handleLocateProject}
        onClose={close}
      />
      <ProjectSessionsList
        project={project}
        selectedSession={selectedSession}
        activeSessions={activeSessions}
        backgroundSessionIds={backgroundSessionIds}
        attentionSessionIds={attentionSessionIds}
        isLoading={isLoading}
        onSessionSelect={handleSessionItemSelect}
        onNewSession={onNewSession}
        onSessionDelete={onSessionDelete}
        onLoadMoreSessions={onLoadMoreSessions}
        onRenameSession={onRenameSession}
      />
    </div>
  );

  // Slide in from the edge the handle was last docked on, so a handle dragged
  // to the left opens a left-hand panel and vice versa.
  const isLeft = side === 'left';
  const slideClass = isMobile
    ? (isLeft ? 'session-drawer-enter-left' : 'session-drawer-enter-right')
    : (isLeft ? 'session-dock-enter-left' : 'session-dock-enter-right');
  const borderClass = isLeft ? 'border-r' : 'border-l';

  // Mobile: a drawer over the whole window, mirroring the sidebar's drawer — a
  // dimmed backdrop plus a panel that slides in from the edge the handle sits
  // on. `--keyboard-height` keeps it above the virtual keyboard, the same
  // offset the workspace shell uses. A pinned list drops the backdrop so the
  // chat beside it stays usable, which is why the wrapper lets clicks through.
  const mobileDrawer = (
    <div
      className="pointer-events-none fixed inset-0 z-50"
      style={{ bottom: 'var(--keyboard-height, 0px)' }}
    >
      {!isPinned && (
        <button
          type="button"
          onClick={close}
          aria-label="关闭会话列表"
          className="session-drawer-backdrop-enter pointer-events-auto absolute inset-0 bg-background/60 backdrop-blur-sm"
        />
      )}
      <aside
        aria-label="项目会话列表"
        onClick={handlePanelBlankClick}
        className={`${slideClass} pointer-events-auto absolute inset-y-0 ${isLeft ? 'left-0' : 'right-0'} flex w-[85vw] max-w-sm flex-col ${borderClass} border-border bg-card shadow-xl sm:w-72 lg:w-80`}
      >
        {panelBody}
      </aside>
    </div>
  );

  // Desktop: a column docked into the workspace shell's flex row, next to the
  // project sidebar and the conversation window. Taking part in the layout is
  // what keeps it from covering anything — the chat shrinks, so the composer
  // stays reachable. `order` puts it on the handle's side, which on the left
  // means immediately right of the project sidebar rather than over it.
  const dockedPanel = (
    <aside
      aria-label="项目会话列表"
      onClick={handlePanelBlankClick}
      className={`${slideClass} flex h-full w-72 flex-shrink-0 flex-col ${borderClass} border-border bg-card lg:w-80`}
      style={{ order: isLeft ? 1 : 3 }}
    >
      {panelBody}
    </aside>
  );

  if (isMobile) {
    return isPanelVisible ? mobileDrawer : handle;
  }

  return isPanelVisible ? dockedPanel : handle;
}

export default memo(ProjectSessionsPanel);
