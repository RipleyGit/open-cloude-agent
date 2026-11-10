import { memo, useCallback } from 'react';

import {
  useProjectCommandState,
  useProjectMainState,
  useProjectSidebarState,
} from '@/modules/project-workspace/context/ProjectsStateContext';
import { ProjectSessionsPanel } from '@/modules/project-sessions-panel';
import { REVEAL_PROJECT_EVENT } from '@/shared/constants';
import type { SessionWithProvider } from '@/shared/types';

/**
 * Rendered by ProjectWorkspaceShell to bind workspace project state to the ProjectSessionsPanel.
 */
function ProjectSessionsRegion() {
  const { selectedProject, selectedSession, renameSession } = useProjectMainState();
  const { handleNewSession } = useProjectCommandState();
  const { setSidebarOpen, sidebarSharedProps } = useProjectSidebarState();

  const activeProject = sidebarSharedProps.projects.find(
    (p) => p.projectId === selectedProject?.projectId,
  ) ?? selectedProject;

  const handleTriggerNewSession = useCallback(() => {
    if (activeProject) {
      handleNewSession(activeProject);
    }
  }, [activeProject, handleNewSession]);

  // "Locate project" sends the user to the project behind the selected session.
  // The expansion state is private to the sidebar module, so the request travels
  // as a window event instead of a prop. Opening the sidebar's drawer first is
  // what makes the reveal visible on mobile; on desktop the sidebar is always
  // docked, so setting it open there does nothing.
  const handleLocateProject = useCallback(() => {
    if (!activeProject) return;
    setSidebarOpen(true);
    window.dispatchEvent(
      new CustomEvent(REVEAL_PROJECT_EVENT, {
        detail: { projectId: activeProject.projectId },
      }),
    );
  }, [activeProject, setSidebarOpen]);

  const handleSessionSelect = useCallback(
    (session: SessionWithProvider) => {
      sidebarSharedProps.onSessionSelect(session);
    },
    [sidebarSharedProps],
  );

  return (
    <ProjectSessionsPanel
      project={activeProject}
      selectedSession={selectedSession}
      onSessionSelect={handleSessionSelect}
      onNewSession={handleTriggerNewSession}
      onSessionDelete={sidebarSharedProps.onSessionDelete}
      onLoadMoreSessions={sidebarSharedProps.onLoadMoreSessions}
      onRenameSession={renameSession}
      onLocateProject={handleLocateProject}
      isLoading={sidebarSharedProps.isLoading}
      attentionSessionIds={sidebarSharedProps.attentionSessionIds}
    />
  );
}

export default memo(ProjectSessionsRegion);
