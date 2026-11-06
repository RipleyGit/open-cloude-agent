import { memo, useRef } from 'react';

import ProjectEffects from '@/modules/project-workspace/controllers/ProjectEffects';
import type { ProjectWorkspaceShellProps } from '@/shared/types';
import ProjectCommandPalette from '@/modules/project-workspace/ProjectCommandPalette';
import ProjectMainRegion from '@/modules/project-workspace/ProjectMainRegion';
import ProjectSessionsRegion from '@/modules/project-workspace/ProjectSessionsRegion';
import ProjectSidebarRegion from '@/modules/project-workspace/ProjectSidebarRegion';

/** Rendered by ProjectWorkspaceRoute to lay out the workspace sidebar, main region and global overlays. */
function ProjectWorkspaceShell({
  isMobile,
  ws,
  sendMessage,
  navigate,
}: ProjectWorkspaceShellProps) {
  const conversationRegionRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className="fixed inset-0 flex bg-background"
      style={{ bottom: 'var(--keyboard-height, 0px)' }}
    >
      <ProjectEffects navigate={navigate} />
      <ProjectSidebarRegion isMobile={isMobile} />

      <div
        ref={conversationRegionRef}
        id="workspace-conversation-region"
        className="relative flex min-w-0 flex-1 flex-col overflow-hidden"
        style={{ order: 2 }}
      >
        <ProjectMainRegion
          isMobile={isMobile}
          ws={ws}
          sendMessage={sendMessage}
          navigate={navigate}
        />
      </div>

      <ProjectCommandPalette />
      {/* Session list — slide-in drawer portaled into the content region below the tab bar */}
      <ProjectSessionsRegion conversationRegionRef={conversationRegionRef} />
    </div>
  );
}

export default memo(ProjectWorkspaceShell);
