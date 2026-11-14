import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import type { TFunction } from 'i18next';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project } from '@/shared/types';

/**
 * On the touch layout (compact card) tapping a project used to only expand it,
 * so "opening a project" never switched the workspace to it. Both layouts now
 * share `selectAndToggleProject`.
 */

vi.mock('@/modules/file-tree', () => ({ FileTreeInline: () => null }));
vi.mock('@/modules/sidebar/TaskIndicator', () => ({ default: () => null }));
vi.mock('@/modules/sidebar/hooks/useCompactSidebar', () => ({ useCompactSidebar: () => true }));

const { default: SidebarProjectItem } = await import('@/modules/sidebar/SidebarProjectItem');

type SidebarProjectItemProps = ComponentProps<typeof SidebarProjectItem>;

const t = ((key: string) => key) as unknown as TFunction;

const PROJECT_A: Project = {
  projectId: 'project-a',
  displayName: 'Project A',
  fullPath: '/tmp/project-a',
  path: '/tmp/project-a',
  isStarred: false,
  sessions: [],
  sessionMeta: { hasMore: false, total: 0 },
};

const noop = () => {};

const buildProps = (overrides: Partial<SidebarProjectItemProps> = {}): SidebarProjectItemProps => ({
  project: PROJECT_A,
  selectedProject: null,
  selectedSession: null,
  isExpanded: false,
  isDeleting: false,
  isStarred: false,
  isEditing: false,
  renameDraft: '',
  sessions: [],
  initialSessionsLoaded: true,
  isLoadingMoreSessions: false,
  currentTime: new Date('2026-11-14T00:00:00Z'),
  sessionRenameId: null,
  sessionRenameDraft: '',
  tasksEnabled: false,
  mcpServerStatus: { status: 'disconnected' } as SidebarProjectItemProps['mcpServerStatus'],
  onRenameDraftChange: noop,
  onToggleProject: noop,
  onProjectSelect: noop,
  onToggleStarProject: noop,
  onStartEditingProject: noop,
  onCancelEditingProject: noop,
  onSaveProjectName: noop,
  onDeleteProject: noop,
  onSessionSelect: noop,
  onDeleteSession: noop,
  onLoadMoreSessions: noop,
  activeSessions: new Set<string>(),
  backgroundSessionIds: new Set<string>(),
  attentionSessionIds: new Set<string>(),
  onNewSession: noop,
  onStartEditingSession: noop,
  onCancelEditingSession: noop,
  onSaveEditingSession: noop,
  selectedSessionIds: null,
  onSetSessionSelection: noop,
  onToggleSessionSelected: noop,
  onCancelSessionSelection: noop,
  onDeleteSelectedSessions: noop,
  t,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('tapping a different project card switches the project and expands it', () => {
  const onProjectSelect = vi.fn();
  const onToggleProject = vi.fn();

  render(<SidebarProjectItem {...buildProps({ onProjectSelect, onToggleProject })} />);

  fireEvent.click(screen.getByText('Project A'));

  assert.equal(onProjectSelect.mock.calls.length, 1);
  assert.equal(onProjectSelect.mock.calls[0][0].projectId, 'project-a');
  assert.equal(onToggleProject.mock.calls.length, 1);
  assert.equal(onToggleProject.mock.calls[0][0], 'project-a');
});

test('tapping the already selected project card only toggles it', () => {
  const onProjectSelect = vi.fn();
  const onToggleProject = vi.fn();

  render(
    <SidebarProjectItem
      {...buildProps({
        selectedProject: PROJECT_A,
        onProjectSelect,
        onToggleProject,
      })}
    />,
  );

  fireEvent.click(screen.getByText('Project A'));

  assert.equal(onProjectSelect.mock.calls.length, 0);
  assert.equal(onToggleProject.mock.calls.length, 1);
});
