import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, RefObject } from 'react';
import { createPortal } from 'react-dom';

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
  conversationRegionRef?: RefObject<HTMLElement | null>;
  onSessionSelect: (session: SessionWithProvider) => void;
  onNewSession: () => void;
  onSessionDelete?: (sessionId: string) => void;
  onLoadMoreSessions?: (projectId: string) => void;
  onRenameSession?: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  isLoading?: boolean;
  attentionSessionIds?: ReadonlySet<string>;
  /**
   * The content region the panel docks into (`#workspace-content-region`) only
   * mounts once the workspace has a selected project — WorkspaceMain early-
   * returns a loading/empty view while none is set, in which case that node is
   * absent and the portal must fall back. Passing the project (not a boolean)
   * makes the effect re-resolve exactly when the region appears, instead of
   * one commit earlier on the coarse `!isLoadingProjects` flag — that one-
   * commit gap left the portal cached on the column-oriented conversation
   * region, where the docked aside stacked under the chat and was clipped.
   */
  selectedProjectForDocking?: Project | null;
};

/**
 * Session list of the active project, rendered as an overlay drawer over the
 * workspace content region. Used by ProjectSessionsRegion (workspace) to let
 * the user switch sessions without leaving the conversation.
 *
 * Because the panel is absolutely positioned over the content region, the chat
 * column keeps its full width and remains usable underneath; only the drawn
 * panel covers it while the list is open.
 */
function ProjectSessionsPanel({
  project,
  selectedSession,
  conversationRegionRef,
  onSessionSelect,
  onNewSession,
  onSessionDelete,
  onLoadMoreSessions,
  onRenameSession,
  isLoading = false,
  attentionSessionIds,
  selectedProjectForDocking,
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
  } = useProjectSessionsDrag({ isMobile, containerRef: conversationRegionRef });

  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  // Re-resolves the dock target whenever the content region may have just
  // appeared or disappeared: the region mounts only once a project is selected,
  // so `selectedProjectForDocking` (not a loading flag) is the reliable trigger.
  useEffect(() => {
    const element = document.getElementById('workspace-content-region');
    setPortalTarget(
      element ??
        conversationRegionRef?.current ??
        document.getElementById('workspace-conversation-region'),
    );
  }, [conversationRegionRef, selectedProjectForDocking]);

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

  // Clicking the list's blank area (not a row, button, input or link) closes an
  // unpinned list and brings the handle back. A pinned list stays put.
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
      // Selecting a session is the drawer's primary action, so an unpinned
      // drawer closes once it lands — the chat is now showing that session.
      if (!isPinned) {
        setIsOpen(false);
      }
    },
    [isPinned, onSessionSelect],
  );

  // Clicking outside an unpinned drawer closes it. The options menu portals to
  // document.body, so clicks there must not close the drawer while the menu is
  // open — the menu role and the drawer itself are whitelisted.
  useEffect(() => {
    if (!isPanelVisible || isPinned) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (target.closest('aside[aria-label="项目会话列表"], [role="menu"]')) {
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

  // The handle only exists while the list is collapsed (see `content` below),
  // so it is always pinned to the conversation window's edge here. While
  // dragging the hook owns the absolute cursor position.
  const handleEdgeStyle = useMemo<CSSProperties>(() => {
    if (isDragging) {
      return handleStyle;
    }

    return side === 'left' ? { ...handleStyle, left: 0 } : { ...handleStyle, right: 0 };
  }, [handleStyle, isDragging, side]);

  const handle = (
    <ProjectSessionsHandle
      isOpen={false}
      isDragging={isDragging}
      side={side}
      style={handleEdgeStyle}
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

  // Overlay drawer: absolutely positioned over the content region so the chat
  // column keeps its full width instead of being squeezed by a flex sibling.
  // The floating handle is not rendered here: once the list opens the icon
  // disappears, and clicking the list's blank area closes it again.
  const dockedContent = (
    <aside
      aria-label="项目会话列表"
      onClick={handlePanelBlankClick}
      className={`absolute inset-y-0 z-40 flex w-[42%] min-w-[168px] max-w-[220px] flex-col border-border bg-background shadow-xl sm:max-w-none sm:w-72 lg:w-80 ${
        side === 'left' ? 'left-0 border-r' : 'right-0 border-l'
      }`}
    >
      {panelBody}
    </aside>
  );

  const content = isPanelVisible ? dockedContent : handle;

  return (
    <>
      {portalTarget ? createPortal(content, portalTarget) : content}
    </>
  );
}

export default memo(ProjectSessionsPanel);
