import { memo, useCallback } from 'react';

import {
  useProjectCommandState,
  useProjectMainState,
  useProjectSidebarState,
} from '@/modules/project-workspace/context/ProjectsStateContext';
import { ProjectSessionsPanel } from '@/modules/project-sessions-panel';
import type { SessionWithProvider } from '@/shared/types';

/**
 * Rendered by ProjectWorkspaceShell to bind workspace project state to the ProjectSessionsPanel.
 */
function ProjectSessionsRegion() {
  const { selectedProject, selectedSession, renameSession } = useProjectMainState();
  const { handleNewSession } = useProjectCommandState();
  const { sidebarSharedProps } = useProjectSidebarState();

  const activeProject = sidebarSharedProps.projects.find(
    (p) => p.projectId === selectedProject?.projectId,
  ) ?? selectedProject;

  const handleTriggerNewSession = useCallback(() => {
    if (activeProject) {
      handleNewSession(activeProject);
    }
  }, [activeProject, handleNewSession]);

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
      isLoading={sidebarSharedProps.isLoading}
      attentionSessionIds={sidebarSharedProps.attentionSessionIds}
    />
  );
}

export default memo(ProjectSessionsRegion);
