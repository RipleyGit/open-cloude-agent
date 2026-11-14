import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project } from '@/shared/types';

/**
 * Switching a project should land the chat on that project's most recently
 * active session and navigate to it, so the conversation window reflects the
 * project the user just opened instead of a blank composer.
 */

const projectsResponse = vi.fn();
const sessionDetailsResponse = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    projects: () => projectsResponse(),
    projectTaskmaster: () => Promise.resolve({ ok: false }),
    sessionDetails: () => sessionDetailsResponse(),
    projectSessions: () => Promise.resolve({ ok: false }),
  },
}));

const buildSession = (overrides: Partial<Project['sessions'] extends (infer S)[] | undefined ? S : never> = {}) => ({
  id: 'session-a',
  summary: 'Session A',
  lastActivity: '2026-01-01T00:00:00Z',
  ...overrides,
});

const buildProject = (overrides: Partial<Project> = {}): Project => ({
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'Project One',
  isStarred: false,
  sessions: [],
  sessionMeta: { hasMore: false, total: 0 },
  ...overrides,
});

const respondWith = (projects: Project[]) => {
  projectsResponse.mockResolvedValue({
    ok: true,
    json: async () => projects,
  });
};

type ServerEventListener = (event: { kind: string }) => void;

const listeners = new Set<ServerEventListener>();

const navigateMock = vi.fn();

const renderProjectsState = async () => {
  const { useProjectsState } = await import(
    '@/modules/project-workspace/hooks/useProjectsState'
  );

  return renderHook(() =>
    useProjectsState({
      sessionId: undefined,
      navigate: navigateMock,
      subscribe: (listener: ServerEventListener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      isMobile: false,
      isSessionProcessing: () => false,
    }),
  );
};

beforeEach(() => {
  localStorage.clear();
  projectsResponse.mockReset();
  sessionDetailsResponse.mockReset();
  listeners.clear();
  navigateMock.mockReset();
  sessionDetailsResponse.mockResolvedValue({ ok: false });
});

afterEach(() => {
  vi.resetModules();
});

test('selecting a project opens its most recently active session', async () => {
  // project-1 auto-selects on first load with no sessions.
  respondWith([
    buildProject({
      sessions: [
        buildSession({ id: 'old', lastActivity: '2026-01-01T00:00:00Z' }),
        buildSession({ id: 'fresh', lastActivity: '2026-11-12T12:00:00Z' }),
      ],
      sessionMeta: { hasMore: false, total: 2 },
    }),
  ]);
  const { result } = await renderProjectsState();

  await waitFor(() => {
    assert.ok(result.current.selectedProject);
  });

  await act(async () => {
    // Simulate the sidebar selecting a different project that has a latest session.
    result.current.handleProjectSelect(
      buildProject({
        projectId: 'project-2',
        displayName: 'Project Two',
        sessions: [
          buildSession({ id: 'older', lastActivity: '2026-06-01T00:00:00Z' }),
          buildSession({ id: 'newest', lastActivity: '2026-10-01T00:00:00Z' }),
        ],
        sessionMeta: { hasMore: false, total: 2 },
      }),
    );
  });

  assert.equal(result.current.selectedProject?.projectId, 'project-2');
  assert.equal(result.current.selectedSession?.id, 'newest');
  assert.ok(
    navigateMock.mock.calls.some((call) => call[0] === '/session/newest'),
    'navigates to the latest session',
  );
});

test('selecting a project with no sessions leaves the session unset', async () => {
  respondWith([buildProject()]);
  const { result } = await renderProjectsState();

  await waitFor(() => {
    assert.ok(result.current.selectedProject);
  });

  await act(async () => {
    result.current.handleProjectSelect(
      buildProject({ projectId: 'empty', displayName: 'Empty', sessions: [] }),
    );
  });

  assert.equal(result.current.selectedProject?.projectId, 'empty');
  assert.equal(result.current.selectedSession, null);
  assert.ok(
    navigateMock.mock.calls.some((call) => call[0] === '/'),
    'navigates to root when no sessions',
  );
});
