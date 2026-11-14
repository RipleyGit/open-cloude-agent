import type { Project, ProjectSession } from '@/shared/types';

export const OPEN_CLOUDE_SERVER_BOOT_ID_KEY = 'open_cloude_server_boot_id';
export const OPEN_CLOUDE_LAST_PROJECT_ID_KEY = 'open_cloude_last_project_id';
export const OPEN_CLOUDE_LAST_SESSION_ID_KEY = 'open_cloude_last_session_id';

export type ResolvedInitialSelection = {
  project: Project | null;
  session: ProjectSession | null;
  targetSessionIdToNavigate: string | null;
  isRestart: boolean;
};

/**
 * Finds the session with the newest activity timestamp across all projects and sessions.
 */
export function findLatestSessionAcrossProjects(projects: Project[]): {
  project: Project;
  session: ProjectSession;
} | null {
  let newestMatch: { project: Project; session: ProjectSession; timestamp: number } | null = null;

  for (const project of projects) {
    for (const session of project.sessions ?? []) {
      const timeStr = session.lastActivity || session.updated_at || session.createdAt || session.created_at;
      const timestamp = timeStr ? Date.parse(timeStr) : 0;
      if (!newestMatch || timestamp > newestMatch.timestamp) {
        newestMatch = { project, session, timestamp };
      }
    }
  }

  return newestMatch ? { project: newestMatch.project, session: newestMatch.session } : null;
}

/**
 * Finds the most recently active session within a single project's loaded
 * sessions, using the same activity-timestamp precedence as
 * `findLatestSessionAcrossProjects`. Used when switching projects to land the
 * chat on that project's latest conversation instead of a blank composer.
 */
export function findLatestSessionInProject(project: Project): ProjectSession | null {
  let newest: { session: ProjectSession; timestamp: number } | null = null;

  for (const session of project.sessions ?? []) {
    const timeStr = session.lastActivity || session.updated_at || session.createdAt || session.created_at;
    const timestamp = timeStr ? Date.parse(timeStr) : 0;
    if (!newest || timestamp > newest.timestamp) {
      newest = { session, timestamp };
    }
  }

  return newest ? newest.session : null;
}

/**
 * Persists the currently viewed project and session identifiers into localStorage.
 */
export function persistActiveProjectAndSession(
  projectId: string | null | undefined,
  sessionId: string | null | undefined,
): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (projectId) {
      localStorage.setItem(OPEN_CLOUDE_LAST_PROJECT_ID_KEY, projectId);
    } else {
      localStorage.removeItem(OPEN_CLOUDE_LAST_PROJECT_ID_KEY);
    }

    if (sessionId) {
      localStorage.setItem(OPEN_CLOUDE_LAST_SESSION_ID_KEY, sessionId);
    } else {
      localStorage.removeItem(OPEN_CLOUDE_LAST_SESSION_ID_KEY);
    }
  } catch {
    // Ignore storage quota or access errors in restricted environments
  }
}

/**
 * Resolves the initial project and session to open on entry.
 * - If restarting (server boot ID changed): opens the project and session corresponding to the newest active session.
 * - If returning/exiting and re-entering: restores the project and session the user was viewing on last exit.
 */
export function resolveInitialProjectAndSession(args: {
  projects: Project[];
  serverBootId: string | null;
  storage?: Storage;
}): ResolvedInitialSelection {
  const { projects, serverBootId } = args;
  const storage = args.storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);

  if (!projects.length) {
    return { project: null, session: null, targetSessionIdToNavigate: null, isRestart: false };
  }

  const storedBootId = storage?.getItem(OPEN_CLOUDE_SERVER_BOOT_ID_KEY) ?? null;
  const isRestart = Boolean(serverBootId && storedBootId && storedBootId !== serverBootId);

  // Sync server boot ID into storage
  if (serverBootId && storage) {
    try {
      storage.setItem(OPEN_CLOUDE_SERVER_BOOT_ID_KEY, serverBootId);
    } catch {
      // Ignore storage errors
    }
  }

  // 1. RESTART: Load the newest active session across all projects
  if (isRestart) {
    const latest = findLatestSessionAcrossProjects(projects);
    if (latest) {
      persistActiveProjectAndSession(latest.project.projectId, latest.session.id);
      return {
        project: latest.project,
        session: latest.session,
        targetSessionIdToNavigate: latest.session.id,
        isRestart: true,
      };
    }

    // No sessions exist yet, open the first project
    persistActiveProjectAndSession(projects[0].projectId, null);
    return { project: projects[0], session: null, targetSessionIdToNavigate: null, isRestart: true };
  }

  // 2. NORMAL EXIT & RE-ENTRY: Restore the project and session from last visit
  const lastProjectId = storage?.getItem(OPEN_CLOUDE_LAST_PROJECT_ID_KEY) ?? null;
  const lastSessionId = storage?.getItem(OPEN_CLOUDE_LAST_SESSION_ID_KEY) ?? null;

  if (lastSessionId) {
    for (const project of projects) {
      const match = project.sessions?.find((s) => s.id === lastSessionId);
      if (match) {
        return {
          project,
          session: match,
          targetSessionIdToNavigate: match.id,
          isRestart: false,
        };
      }
    }
  }

  if (lastProjectId) {
    const matchedProject = projects.find((p) => p.projectId === lastProjectId);
    if (matchedProject) {
      return {
        project: matchedProject,
        session: null,
        targetSessionIdToNavigate: null,
        isRestart: false,
      };
    }
  }

  // Fallback when no previous exit state is saved: keep session null and select the first project
  return { project: projects[0] ?? null, session: null, targetSessionIdToNavigate: null, isRestart: false };
}
