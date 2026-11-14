import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';

import type { Project, ProjectSession, SessionWithProvider } from '@/shared/types';

/**
 * A selected session row must read as selected in both layouts.
 *
 * On the touch layout the neutral border fallback used to run even when the row
 * was selected, and its `border-border/30` won the twMerge conflict, so the row
 * only ever showed the background tint. That tint lands within 9/255 of the
 * dark background, which made a selected row look unselected.
 */

let compactLayout = true;

vi.mock('@/modules/sidebar/hooks/useCompactSidebar', () => ({
  useCompactSidebar: () => compactLayout,
}));

vi.mock('@/shared/hooks/useProviderCapabilities', () => ({
  useSessionForkingProviders: () => new Set(),
}));

vi.mock('@/shared/ui/SessionOptions', () => ({ default: () => null }));

const { default: SidebarSessionItem } = await import('@/modules/sidebar/SidebarSessionItem');

const t = ((key: string) => key) as unknown as ComponentProps<typeof SidebarSessionItem>['t'];
const noop = () => {};

const PROJECT = {
  projectId: 'project-1',
  displayName: 'project one',
  fullPath: '/tmp/project-1',
  sessions: [],
} as unknown as Project;

const SESSION = {
  id: 's1',
  summary: 'session one',
  lastActivity: '2026-11-14T00:00:00.000Z',
  __provider: 'claude',
} as unknown as SessionWithProvider;

const SELECTED_SESSION = { id: 's1', summary: 'session one' } as unknown as ProjectSession;

const renderRow = (isSelected: boolean) => render(
  React.createElement(SidebarSessionItem, {
    project: PROJECT,
    session: SESSION,
    selectedSession: isSelected ? SELECTED_SESSION : null,
    isProcessing: false,
    hasBackgroundWork: false,
    needsAttention: false,
    currentTime: new Date('2026-11-14T00:10:00.000Z'),
    isEditing: false,
    renameDraft: '',
    onRenameDraftChange: noop,
    onStartEditingSession: noop,
    onCancelEditingSession: noop,
    onSaveEditingSession: noop,
    onProjectSelect: noop,
    onSessionSelect: noop,
    onDeleteSession: noop,
    isSelecting: false,
    isChecked: false,
    onToggleSessionSelected: noop,
    t,
  }),
);

beforeEach(() => {
  compactLayout = true;
});

const rowOf = (container: HTMLElement): HTMLElement => {
  const row = container.querySelector<HTMLElement>('div.p-2.mx-3, a[href="/session/s1"]');
  assert.ok(row instanceof HTMLElement);
  return row;
};

test('an unselected touch row keeps the neutral card surface', () => {
  const { container } = renderRow(false);

  const row = rowOf(container);
  assert.equal(row.className.includes('bg-card'), true);
  assert.equal(row.className.includes('border-border/30'), true);
  assert.equal(row.className.includes('bg-primary/10'), false);
});

test('a selected touch row keeps its primary border instead of the neutral fallback', () => {
  const { container } = renderRow(true);

  const row = rowOf(container);
  assert.equal(row.className.includes('bg-primary/10'), true);
  assert.equal(row.className.includes('border-primary/40'), true);
  // The fallback must not be handed to twMerge at all, or it wins the conflict.
  assert.equal(row.className.includes('border-border/30'), false);
});

test('a selected desktop row uses the same strong pair', () => {
  compactLayout = false;

  const { container } = renderRow(true);

  const row = rowOf(container);
  assert.equal(row.className.includes('bg-primary/10'), true);
  assert.equal(row.className.includes('border-primary/40'), true);
});
