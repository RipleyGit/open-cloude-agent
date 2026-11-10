import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import type { Project, SidebarProjectListProps } from '@/shared/types';

/**
 * An expanded project card used to render the project's session list; it now
 * renders the inline file tree, so the list has to hand it the project and
 * forward a picked file to the workspace with that project attached.
 */

const recordedInlineProps: Array<{
  project: Project;
  onFileOpen?: (filePath: string) => void;
}> = [];

vi.mock('@/modules/file-tree', () => ({
  FileTreeInline: (props: { project: Project; onFileOpen?: (filePath: string) => void }) => {
    recordedInlineProps.push(props);
    return null;
  },
}));

const { default: SidebarProjectList } = await import('@/modules/sidebar/SidebarProjectList');
const { getAllSessions } = await import('@/modules/sidebar/utils/sidebarProjectFormatting');

const PROJECT = {
  projectId: 'p1',
  name: 'p1',
  displayName: 'p1',
  fullPath: '/tmp/p1',
  sessions: [{ id: 's1', summary: 'session-one', lastActivity: '2026-08-21T10:00:00.000Z' }],
} as unknown as Project;

const noop = () => {};
const t = ((key: string) => key) as unknown as SidebarProjectListProps['t'];
const EMPTY_IDS: ReadonlySet<string> = new Set<string>();

const listProps = (
  isExpanded: boolean,
  onFileOpen?: SidebarProjectListProps['onFileOpen'],
): SidebarProjectListProps => ({
  projects: [PROJECT],
  filteredProjects: [PROJECT],
  selectedProject: null,
  selectedSession: null,
  isLoading: false,
  loadingProgress: null,
  isProjectExpanded: () => isExpanded,
  activeRename: null,
  initialSessionsLoaded: new Set(),
  currentTime: new Date('2026-08-21T10:00:00.000Z'),
  deletingProjects: new Set(),
  tasksEnabled: false,
  mcpServerStatus: null,
  getProjectSessions: getAllSessions,
  onLoadMoreSessions: noop,
  loadingMoreProjects: new Set(),
  activeSessions: EMPTY_IDS,
  backgroundSessionIds: EMPTY_IDS,
  attentionSessionIds: EMPTY_IDS,
  isProjectStarred: () => false,
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
  onNewSession: noop,
  onStartEditingSession: noop,
  onCancelEditingSession: noop,
  onSaveEditingSession: noop,
  sessionSelection: null,
  onSetSessionSelection: noop,
  onToggleSessionSelected: noop,
  onCancelSessionSelection: noop,
  onDeleteSelectedSessions: noop,
  onFileOpen,
  t,
});

beforeEach(() => {
  recordedInlineProps.length = 0;
});

test('an expanded project renders the file tree instead of its session rows', () => {
  render(<SidebarProjectList {...listProps(true)} />);

  assert.equal(recordedInlineProps.length, 1);
  assert.equal(recordedInlineProps[0].project, PROJECT);
  assert.equal(document.body.textContent?.includes('session-one'), false);
});

test('a collapsed project renders no file tree', () => {
  render(<SidebarProjectList {...listProps(false)} />);

  assert.equal(recordedInlineProps.length, 0);
});

test('a picked file reaches the workspace with its project attached', () => {
  const onFileOpen = vi.fn();
  render(<SidebarProjectList {...listProps(true, onFileOpen)} />);

  recordedInlineProps[0].onFileOpen?.('src/App.tsx');

  assert.deepEqual(onFileOpen.mock.calls, [[PROJECT, 'src/App.tsx']]);
});
