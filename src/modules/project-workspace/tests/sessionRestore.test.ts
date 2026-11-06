import { beforeEach, describe, expect, it } from 'vitest';

import type { Project, ProjectSession } from '@/shared/types';
import {
  findLatestSessionAcrossProjects,
  OPEN_CLOUDE_LAST_PROJECT_ID_KEY,
  OPEN_CLOUDE_LAST_SESSION_ID_KEY,
  OPEN_CLOUDE_SERVER_BOOT_ID_KEY,
  persistActiveProjectAndSession,
  resolveInitialProjectAndSession,
} from '@/modules/project-workspace/utils/sessionRestore';

function createMockSession(id: string, overrides: Partial<ProjectSession> = {}): ProjectSession {
  return {
    id,
    summary: `Session ${id}`,
    lastActivity: '2026-11-01T10:00:00.000Z',
    __provider: 'claude',
    ...overrides,
  };
}

function createMockProject(projectId: string, sessions: ProjectSession[] = []): Project {
  return {
    projectId,
    displayName: `Project ${projectId}`,
    path: `/workspace/${projectId}`,
    fullPath: `/workspace/${projectId}`,
    isStarred: false,
    sessions,
  };
}

describe('sessionRestore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('findLatestSessionAcrossProjects', () => {
    it('returns null when there are no projects or sessions', () => {
      expect(findLatestSessionAcrossProjects([])).toBeNull();
      expect(findLatestSessionAcrossProjects([createMockProject('p1', [])])).toBeNull();
    });

    it('identifies the newest session across multiple projects based on timestamps', () => {
      const s1 = createMockSession('s1', { lastActivity: '2026-11-01T10:00:00.000Z' });
      const s2 = createMockSession('s2', { lastActivity: '2026-11-04T12:00:00.000Z' });
      const s3 = createMockSession('s3', { lastActivity: '2026-11-03T08:00:00.000Z' });

      const p1 = createMockProject('p1', [s1, s3]);
      const p2 = createMockProject('p2', [s2]);

      const result = findLatestSessionAcrossProjects([p1, p2]);
      expect(result).not.toBeNull();
      expect(result?.project.projectId).toBe('p2');
      expect(result?.session.id).toBe('s2');
    });
  });

  describe('persistActiveProjectAndSession', () => {
    it('stores project and session ids in localStorage and removes them when nullish', () => {
      persistActiveProjectAndSession('proj-123', 'sess-456');
      expect(localStorage.getItem(OPEN_CLOUDE_LAST_PROJECT_ID_KEY)).toBe('proj-123');
      expect(localStorage.getItem(OPEN_CLOUDE_LAST_SESSION_ID_KEY)).toBe('sess-456');

      persistActiveProjectAndSession('proj-123', null);
      expect(localStorage.getItem(OPEN_CLOUDE_LAST_PROJECT_ID_KEY)).toBe('proj-123');
      expect(localStorage.getItem(OPEN_CLOUDE_LAST_SESSION_ID_KEY)).toBeNull();

      persistActiveProjectAndSession(null, null);
      expect(localStorage.getItem(OPEN_CLOUDE_LAST_PROJECT_ID_KEY)).toBeNull();
      expect(localStorage.getItem(OPEN_CLOUDE_LAST_SESSION_ID_KEY)).toBeNull();
    });
  });

  describe('resolveInitialProjectAndSession', () => {
    it('restores previous project and session when re-entering on the same server boot', () => {
      const s1 = createMockSession('s1', { lastActivity: '2026-11-01T10:00:00.000Z' });
      const s2 = createMockSession('s2', { lastActivity: '2026-11-04T12:00:00.000Z' });
      const p1 = createMockProject('p1', [s1]);
      const p2 = createMockProject('p2', [s2]);

      // Seed previous visit where user was viewing s1
      localStorage.setItem(OPEN_CLOUDE_SERVER_BOOT_ID_KEY, 'boot-1');
      localStorage.setItem(OPEN_CLOUDE_LAST_PROJECT_ID_KEY, 'p1');
      localStorage.setItem(OPEN_CLOUDE_LAST_SESSION_ID_KEY, 's1');

      const result = resolveInitialProjectAndSession({
        projects: [p1, p2],
        serverBootId: 'boot-1',
      });

      expect(result.isRestart).toBe(false);
      expect(result.project?.projectId).toBe('p1');
      expect(result.session?.id).toBe('s1');
      expect(result.targetSessionIdToNavigate).toBe('s1');
    });

    it('loads the newest session across all projects when restarting (bootId changed)', () => {
      const oldSession = createMockSession('old-sess', { lastActivity: '2026-11-01T10:00:00.000Z' });
      const newestSession = createMockSession('newest-sess', { lastActivity: '2026-11-04T18:00:00.000Z' });
      const p1 = createMockProject('p1', [oldSession]);
      const p2 = createMockProject('p2', [newestSession]);

      // User was previously on oldSession under boot-1
      localStorage.setItem(OPEN_CLOUDE_SERVER_BOOT_ID_KEY, 'boot-1');
      localStorage.setItem(OPEN_CLOUDE_LAST_PROJECT_ID_KEY, 'p1');
      localStorage.setItem(OPEN_CLOUDE_LAST_SESSION_ID_KEY, 'old-sess');

      // Server rebooted to boot-2
      const result = resolveInitialProjectAndSession({
        projects: [p1, p2],
        serverBootId: 'boot-2',
      });

      expect(result.isRestart).toBe(true);
      expect(result.project?.projectId).toBe('p2');
      expect(result.session?.id).toBe('newest-sess');
      expect(result.targetSessionIdToNavigate).toBe('newest-sess');
      // Boot ID is now synced to new boot
      expect(localStorage.getItem(OPEN_CLOUDE_SERVER_BOOT_ID_KEY)).toBe('boot-2');
    });

    it('falls back to default project without selecting invalid session when stored session no longer exists', () => {
      const existingSession = createMockSession('valid-sess', { lastActivity: '2026-11-02T10:00:00.000Z' });
      const p1 = createMockProject('p1', [existingSession]);

      localStorage.setItem(OPEN_CLOUDE_SERVER_BOOT_ID_KEY, 'boot-1');
      localStorage.setItem(OPEN_CLOUDE_LAST_SESSION_ID_KEY, 'deleted-sess');

      const result = resolveInitialProjectAndSession({
        projects: [p1],
        serverBootId: 'boot-1',
      });

      expect(result.project?.projectId).toBe('p1');
      expect(result.session).toBeNull();
    });
  });
});
