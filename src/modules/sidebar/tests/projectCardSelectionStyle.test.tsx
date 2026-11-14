import assert from 'node:assert/strict';

import { render, screen } from '@testing-library/react';
import type { TFunction } from 'i18next';
import type { ComponentProps } from 'react';
import { beforeEach, test, vi } from 'vitest';

import type { Project } from '@/shared/types';

/**
 * The compact project card is the only selected affordance the touch layout
 * has. Its two states must differ by more than the old 5%/20% tint, which
 * landed within 9/255 of the dark background and read as "not selected".
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

const compactCardOf = (): HTMLElement => {
  const card = screen.getByText('Project A').closest('div.p-3');
  assert.ok(card instanceof HTMLElement);
  return card;
};

test('an unselected project card keeps the neutral card surface', () => {
  render(<SidebarProjectItem {...buildProps()} />);

  const card = compactCardOf();
  assert.equal(card.className.includes('bg-card'), true);
  assert.equal(card.className.includes('bg-primary/10'), false);
  assert.equal(card.className.includes('border-primary/40'), false);
});

test('a selected project card uses the strong primary tint', () => {
  render(<SidebarProjectItem {...buildProps({ selectedProject: PROJECT_A })} />);

  const card = compactCardOf();
  assert.equal(card.className.includes('bg-primary/10'), true);
  assert.equal(card.className.includes('border-primary/40'), true);
  // twMerge resolves the background conflict in favour of the tint, so the
  // neutral card surface must be gone rather than layered underneath it.
  assert.equal(card.className.includes('bg-card'), false);
});
