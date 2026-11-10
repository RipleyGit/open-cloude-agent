import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { beforeEach, test, vi } from 'vitest';

import { REVEAL_PROJECT_EVENT } from '@/shared/constants';
import type { Project } from '@/shared/types';

/**
 * The workspace session list has a "locate project" control: the user is working
 * through sessions, wants the files of the project behind the selected one, and
 * clicks it. The sidebar owns project expansion, so the request arrives as a
 * window event — and it has to re-open the card even though that project is
 * already the selected one, since the selected-project effect fires only when
 * the selection's identity changes.
 */

vi.mock('@/shared/api', () => ({
  api: {
    recentConversations: () => Promise.resolve({ ok: true, json: async () => ({ data: { conversations: [] } }) }),
    archivedProjects: () => Promise.resolve({ ok: true, json: async () => ({ data: { projects: [] } }) }),
    getArchivedSessions: () => Promise.resolve({ ok: true, json: async () => ({ data: { sessions: [] } }) }),
  },
}));

const { useSidebarController } = await import('@/modules/sidebar/hooks/useSidebarController');

const t = ((key: string) => key) as unknown as TFunction;

const buildProject = (projectId: string): Project => ({
  projectId,
  path: `/${projectId}`,
  fullPath: `/${projectId}`,
  displayName: projectId,
  isStarred: false,
  sessions: [],
});

const projects = [buildProject('project-1'), buildProject('project-2')];

const setSidebarVisible = vi.fn();

const renderController = (options: { sidebarVisible?: boolean } = {}) => renderHook(
  () => useSidebarController({
    projects,
    // The located project is the selected one, so its identity never changes
    // and the selected-project effect cannot reveal it.
    selectedProject: projects[1],
    selectedSession: null,
    activeSessions: new Set<string>(),
    backgroundSessionIds: new Set<string>(),
    isLoading: false,
    isMobile: false,
    t,
    onRefresh: vi.fn(),
    onProjectSelect: vi.fn(),
    onSessionSelect: vi.fn(),
    setCurrentProject: vi.fn(),
    setSidebarVisible,
    sidebarVisible: options.sidebarVisible ?? true,
  }),
);

/** Stands in for the sidebar's scroll container, which jsdom does not lay out. */
const mountProjectRow = (projectId: string) => {
  const row = document.createElement('div');
  row.dataset.projectId = projectId;
  row.scrollIntoView = vi.fn();
  document.body.appendChild(row);
  return row;
};

const revealProject = (projectId: unknown) => act(() => {
  window.dispatchEvent(
    new CustomEvent(REVEAL_PROJECT_EVENT, { detail: { projectId } }),
  );
});

/** The selected project starts expanded; collapse it, as the user may have. */
const collapseSelectedProject = (result: { current: { toggleProject: (id: string) => void } }) => {
  act(() => {
    result.current.toggleProject('project-2');
  });
};

beforeEach(() => {
  localStorage.clear();
  setSidebarVisible.mockReset();
  document.body.innerHTML = '';
});

test('a reveal request re-expands a project the user had collapsed and scrolls to it', async () => {
  const { result } = renderController();
  await waitFor(() => {
    assert.equal(result.current.isProjectExpanded('project-2'), true);
  });

  collapseSelectedProject(result);
  assert.equal(result.current.isProjectExpanded('project-2'), false);

  const row = mountProjectRow('project-2');
  revealProject('project-2');

  assert.equal(result.current.isProjectExpanded('project-2'), true);
  await waitFor(() => {
    assert.equal((row.scrollIntoView as unknown as ReturnType<typeof vi.fn>).mock.calls.length, 1);
  });
  assert.deepEqual(
    (row.scrollIntoView as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
    { block: 'nearest' },
  );
});

test('a collapsed desktop sidebar is restored so the reveal is visible', async () => {
  const { result } = renderController({ sidebarVisible: false });
  await waitFor(() => {
    assert.equal(result.current.isProjectExpanded('project-2'), true);
  });
  collapseSelectedProject(result);
  setSidebarVisible.mockReset();

  revealProject('project-2');

  assert.equal(setSidebarVisible.mock.calls.length, 1);
  assert.equal(setSidebarVisible.mock.calls[0]?.[0], true);
  assert.equal(result.current.isProjectExpanded('project-2'), true);
});

test('a reveal request without a usable project id is ignored', () => {
  const { result } = renderController();
  collapseSelectedProject(result);

  revealProject(42);

  assert.equal(setSidebarVisible.mock.calls.length, 0);
  assert.equal(result.current.isProjectExpanded('project-2'), false);
});
