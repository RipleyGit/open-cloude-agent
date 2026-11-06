import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import ProjectSessionsHandle from '@/modules/project-sessions-panel/ProjectSessionsHandle';
import ProjectSessionsHeader from '@/modules/project-sessions-panel/ProjectSessionsHeader';
import ProjectSessionsList from '@/modules/project-sessions-panel/ProjectSessionsList';
import ProjectSessionsPanel from '@/modules/project-sessions-panel/ProjectSessionsPanel';
import ProjectSessionRow from '@/modules/project-sessions-panel/ProjectSessionRow';
import type { Project, SessionWithProvider } from '@/shared/types';

vi.mock('@/shared/hooks/useDeviceSettings', () => ({
  useDeviceSettings: () => ({ isMobile: false }),
}));

// Session delete inside the list resolves through the real `api` module; stub it
// so the hard-delete/archive buttons in the confirm modal settle the promise.
vi.mock('@/shared/api', () => ({
  api: {
    deleteSession: vi.fn(() => Promise.resolve({ ok: true })),
    renameSession: vi.fn(),
    forkSession: vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ data: {} }) })),
  },
}));

vi.mock('@/shared/context/SessionProtectionContext', () => ({
  useBusySessionIdSet: () => new Set<string>(),
  useBackgroundSessionIdSet: () => new Set<string>(),
}));

// react-i18next: return the key (with options appended) so toolbar labels can
// be asserted, the same pattern the sidebar bulk-selection test uses.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      options && typeof options === 'object'
        ? `${key}:${Object.entries(options as Record<string, unknown>)
            .map(([name, value]) => `${name}=${String(value)}`)
            .join(',')}`
        : key,
  }),
}));

// Stub the shared SessionOptions menu so row tests do not pull in ActionMenu,
// the provider-id fetch or the forking-capability request — the shared menu is
// covered by the sidebar tests. Records its props so a row test can assert them.
const recordedSessionOptionsProps: Array<Record<string, unknown>> = [];
vi.mock('@/shared/ui/SessionOptions', () => ({
  default: (props: Record<string, unknown>) => {
    recordedSessionOptionsProps.push(props);
    return <div data-testid="session-options-stub" />;
  },
}));

describe('ProjectSessionsHeader', () => {
  it('renders project name and session count, with no close or new-session button', () => {
    const onTogglePin = vi.fn();

    render(
      <ProjectSessionsHeader
        projectName="DemoProject"
        sessionCount={5}
        isPinned
        onTogglePin={onTogglePin}
      />,
    );

    expect(screen.getByText('会话列表')).toBeDefined();
    expect(screen.getByText('DemoProject')).toBeDefined();
    expect(screen.getByText('5')).toBeDefined();

    // The new-session button moved to the foot of the list; the close button is
    // gone — only the pin remains in the header.
    expect(screen.queryByText('新建')).toBeNull();
    expect(screen.queryByTitle('收起会话列表')).toBeNull();
    expect(screen.getByTitle('取消固定（收起会话列表）')).toBeDefined();
  });

  it('toggles the pin', () => {
    const onTogglePin = vi.fn();
    render(
      <ProjectSessionsHeader
        projectName="DemoProject"
        sessionCount={0}
        isPinned={false}
        onTogglePin={onTogglePin}
      />,
    );

    fireEvent.click(screen.getByTitle('固定（常驻显示会话列表）'));
    expect(onTogglePin).toHaveBeenCalledTimes(1);
  });

  it('lights the pin while pinned and dims it while not', () => {
    const pinButton = () => screen.getByTitle(/固定/);

    const { rerender } = render(
      <ProjectSessionsHeader
        projectName="DemoProject"
        sessionCount={0}
        isPinned={false}
        onTogglePin={vi.fn()}
      />,
    );

    expect(pinButton().getAttribute('aria-pressed')).toBe('false');
    expect(pinButton().className).toContain('text-muted-foreground');

    rerender(
      <ProjectSessionsHeader
        projectName="DemoProject"
        sessionCount={0}
        isPinned
        onTogglePin={vi.fn()}
      />,
    );

    expect(pinButton().getAttribute('aria-pressed')).toBe('true');
    expect(pinButton().className).toContain('text-primary');
  });
});

describe('ProjectSessionsList', () => {
  const mockProject: Project = {
    projectId: 'proj-1',
    displayName: 'My Workspace',
    fullPath: '/path/to/workspace',
    sessions: [
      {
        id: 'sess-1',
        summary: 'Fix authentication bug',
        __provider: 'claude',
        createdAt: '2026-11-04T10:00:00Z',
        lastActivity: '2026-11-04T10:05:00Z',
      } as unknown as SessionWithProvider,
      {
        id: 'sess-2',
        summary: 'Add dark mode theme',
        __provider: 'agy',
        createdAt: '2026-11-04T09:00:00Z',
        lastActivity: '2026-11-04T09:30:00Z',
      } as unknown as SessionWithProvider,
    ],
  };

  it('renders session items, the bulk-select entry and a bottom new-session button', () => {
    const onSelect = vi.fn();
    const onNew = vi.fn();

    render(
      <ProjectSessionsList
        project={mockProject}
        selectedSession={null}
        activeSessions={new Set()}
        backgroundSessionIds={new Set()}
        isLoading={false}
        onSessionSelect={onSelect}
        onNewSession={onNew}
      />,
    );

    expect(screen.getByText('Fix authentication bug')).toBeDefined();
    expect(screen.getByText('Add dark mode theme')).toBeDefined();
    // Shared bulk-select toolbar entry (same key the sidebar renders).
    expect(screen.getByText('sessions.select')).toBeDefined();
    // Bottom new-session button is the list's primary entry now.
    expect(screen.getAllByText('新建会话').length).toBeGreaterThan(0);
  });

  it('supports search filtering', () => {
    render(
      <ProjectSessionsList
        project={mockProject}
        selectedSession={null}
        activeSessions={new Set()}
        backgroundSessionIds={new Set()}
        isLoading={false}
        onSessionSelect={vi.fn()}
        onNewSession={vi.fn()}
      />,
    );

    const searchInput = screen.getByPlaceholderText('搜索当前项目会话...');
    fireEvent.change(searchInput, { target: { value: 'authentication' } });

    expect(screen.getByText('Fix authentication bug')).toBeDefined();
    expect(screen.queryByText('Add dark mode theme')).toBeNull();
  });

  it('enters selection mode, selects all, and deletes the selection', async () => {
    const { waitFor } = await import('@testing-library/react');
    const onSessionDelete = vi.fn();
    render(
      <ProjectSessionsList
        project={mockProject}
        selectedSession={null}
        activeSessions={new Set()}
        backgroundSessionIds={new Set()}
        isLoading={false}
        onSessionSelect={vi.fn()}
        onNewSession={vi.fn()}
        onSessionDelete={onSessionDelete}
      />,
    );

    // Enter selection mode via the shared toolbar.
    fireEvent.click(screen.getByText('sessions.select'));
    // Select all loaded rows.
    fireEvent.click(screen.getByText('sessions.selectAll'));
    // Open the confirm modal via the delete-selected button, then hard-delete.
    fireEvent.click(screen.getByText('sessions.deleteSelected:count=2'));
    fireEvent.click(screen.getByText('彻底删除 (不可恢复)'));

    await waitFor(() => {
      expect(onSessionDelete).toHaveBeenCalledTimes(2);
    });
    expect(onSessionDelete).toHaveBeenCalledWith('sess-1');
    expect(onSessionDelete).toHaveBeenCalledWith('sess-2');
  });

  it('renders empty state when no project is selected', () => {
    render(
      <ProjectSessionsList
        project={null}
        selectedSession={null}
        activeSessions={new Set()}
        backgroundSessionIds={new Set()}
        isLoading={false}
        onSessionSelect={vi.fn()}
        onNewSession={vi.fn()}
      />,
    );

    expect(screen.getByText('未选择项目')).toBeDefined();
  });
});

describe('ProjectSessionRow', () => {
  const session: SessionWithProvider = {
    id: 's-1',
    summary: 'Refactor parser',
    __provider: 'claude',
    createdAt: '2026-11-04T10:00:00Z',
    lastActivity: '2026-11-04T10:00:00Z',
  } as unknown as SessionWithProvider;
  const project = {
    projectId: 'p1',
    displayName: 'Demo',
    fullPath: '/demo',
  } as unknown as Project;

  it('selects session on click and wires the shared options menu', () => {
    const onSelect = vi.fn();
    recordedSessionOptionsProps.length = 0;
    render(
      <ProjectSessionRow
        session={session}
        project={project}
        isSelected={false}
        isProcessing={false}
        hasBackgroundWork={false}
        hasAttention={false}
        isEditing={false}
        renameDraft=""
        onRenameDraftChange={vi.fn()}
        onStartEditing={vi.fn()}
        onCancelEditing={vi.fn()}
        onSaveEditing={vi.fn()}
        onSelect={onSelect}
        onDeleteSession={vi.fn()}
        isSelecting={false}
        isChecked={false}
        onToggleSelected={vi.fn()}
        t={((key: string) => key) as never}
      />,
    );

    fireEvent.click(screen.getByText('Refactor parser'));
    expect(onSelect).toHaveBeenCalledTimes(1);

    // The shared ⋯ menu is rendered with this row's session/provider/project.
    expect(recordedSessionOptionsProps).toHaveLength(1);
    expect(recordedSessionOptionsProps[0].sessionId).toBe('s-1');
    expect(recordedSessionOptionsProps[0].provider).toBe('claude');
    expect(recordedSessionOptionsProps[0].projectId).toBe('p1');
  });

  it('acts as a checkbox and hides the options menu while selecting', () => {
    const onToggleSelected = vi.fn();
    recordedSessionOptionsProps.length = 0;
    render(
      <ProjectSessionRow
        session={session}
        project={project}
        isSelected={false}
        isProcessing={false}
        hasBackgroundWork={false}
        hasAttention={false}
        isEditing={false}
        renameDraft=""
        onRenameDraftChange={vi.fn()}
        onStartEditing={vi.fn()}
        onCancelEditing={vi.fn()}
        onSaveEditing={vi.fn()}
        onSelect={vi.fn()}
        onDeleteSession={vi.fn()}
        isSelecting
        isChecked={false}
        onToggleSelected={onToggleSelected}
        t={((key: string) => key) as never}
      />,
    );

    const checkbox = screen.getByRole('checkbox');
    expect(checkbox.getAttribute('aria-checked')).toBe('false');
    // No options menu is rendered while selecting.
    expect(recordedSessionOptionsProps).toHaveLength(0);

    fireEvent.click(checkbox);
    expect(onToggleSelected).toHaveBeenCalledTimes(1);
  });
});

describe('ProjectSessionsHandle', () => {
  it('renders the conversation icon, forwards clicks and takes placement from its style', () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <ProjectSessionsHandle
        isOpen={false}
        isDragging={false}
        side="right"
        style={{ top: '40%', right: 0 }}
        onClick={onClick}
        onMouseDown={vi.fn()}
        onTouchStart={vi.fn()}
      />,
    );

    const button = screen.getByRole('button', { name: '展开会话列表' });
    expect(button.style.top).toBe('40%');
    expect(button.style.right).toBe('0px');
    expect(button.getAttribute('title')).toBe('拖拽可停靠在对话窗口左侧或右侧，点击展开/收起会话列表');

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    // Placement is the parent's call, so switching sides only changes the icon.
    rerender(
      <ProjectSessionsHandle
        isOpen
        isDragging={false}
        side="left"
        style={{ top: '40%', right: '-2.25rem' }}
        onClick={onClick}
        onMouseDown={vi.fn()}
        onTouchStart={vi.fn()}
      />,
    );

    const openButton = screen.getByRole('button', { name: '收起会话列表' });
    expect(openButton.style.right).toBe('-2.25rem');
  });

  it('mirrors the icon when the panel is docked on the right', () => {
    const { rerender } = render(
      <ProjectSessionsHandle
        isOpen={false}
        isDragging={false}
        side="left"
        style={{ top: '40%' }}
        onClick={vi.fn()}
        onMouseDown={vi.fn()}
        onTouchStart={vi.fn()}
      />,
    );

    const icon = () => screen.getByRole('button').querySelector('svg');
    expect(icon()?.getAttribute('class')).not.toContain('scale-x-[-1]');

    rerender(
      <ProjectSessionsHandle
        isOpen={false}
        isDragging={false}
        side="right"
        style={{ top: '40%' }}
        onClick={vi.fn()}
        onMouseDown={vi.fn()}
        onTouchStart={vi.fn()}
      />,
    );

    expect(icon()?.getAttribute('class')).toContain('scale-x-[-1]');
  });

  it('shows the grab icon while dragging', () => {
    render(
      <ProjectSessionsHandle
        isOpen={false}
        isDragging
        side="right"
        style={{ top: '40%' }}
        onClick={vi.fn()}
        onMouseDown={vi.fn()}
        onTouchStart={vi.fn()}
      />,
    );

    expect(screen.getByRole('button').className).toContain('cursor-grabbing');
  });
});

describe('ProjectSessionsPanel', () => {
  const panelProps = {
    project: null,
    selectedSession: null,
    onSessionSelect: vi.fn(),
    onNewSession: vi.fn(),
  };

  it('re-docks into the content region when the project (and its container) appears', () => {
    // Regression: `contentRegionReady` (= !isLoadingProjects) flipped true one
    // commit before `#workspace-content-region` mounted, caching the portal on
    // the column-oriented conversation region. Tapping the handle then opened
    // the list *inside* that wrong container, where it stacked under the chat
    // and was clipped — icon gone, list invisible. The portal target must
    // re-resolve when the project is selected, not one commit early.
    const conversationRegion = document.createElement('div');
    conversationRegion.id = 'workspace-conversation-region';
    document.body.appendChild(conversationRegion);

    const { rerender } = render(
      <ProjectSessionsPanel {...panelProps} selectedProjectForDocking={null} />,
    );

    expect(screen.getByRole('button', { name: '展开会话列表' }).parentElement)
      .toBe(conversationRegion);

    const contentRegion = document.createElement('div');
    contentRegion.id = 'workspace-content-region';
    document.body.appendChild(contentRegion);

    const project = {
      projectId: 'p1',
      displayName: 'Demo',
      fullPath: '/demo',
      sessions: [],
    } as unknown as Project;

    rerender(<ProjectSessionsPanel {...panelProps} selectedProjectForDocking={project} />);

    expect(screen.getByRole('button', { name: '展开会话列表' }).parentElement)
      .toBe(contentRegion);

    // Tapping the handle must open the list inside the correct (row-oriented)
    // content region — the aside itself, not just the handle, is what docks.
    fireEvent.click(screen.getByRole('button', { name: '展开会话列表' }));
    const panel = screen.getByRole('complementary', { name: '项目会话列表' });
    expect(panel.parentElement).toBe(contentRegion);

    conversationRegion.remove();
    contentRegion.remove();
  });

  it('overlays the chat as an absolute drawer, keeping the chat full-width', () => {
    const contentRegion = document.createElement('div');
    contentRegion.id = 'workspace-content-region';
    document.body.appendChild(contentRegion);

    render(<ProjectSessionsPanel {...panelProps} />);

    // Collapsed: nothing is laid out over the chat, just the edge handle.
    expect(screen.queryByRole('complementary', { name: '项目会话列表' })).toBeNull();
    const handle = screen.getByRole('button', { name: '展开会话列表' });
    expect(handle.style.right).toBe('0px');

    fireEvent.click(handle);

    const panel = screen.getByRole('complementary', { name: '项目会话列表' });
    expect(panel.parentElement).toBe(contentRegion);
    // Absolute overlay, not a flex sibling: the chat column keeps full width.
    expect(panel.className).toContain('absolute');
    expect(panel.className).not.toContain('flex-shrink-0');
    // Anchored to an edge (default side is right) rather than placed in flow.
    expect(panel.className).toContain('right-0');
    expect(panel.className).not.toContain('order-last');
    expect(panel.className).not.toContain('order-first');
    // No backdrop is ever rendered over the conversation.
    expect(panel.querySelector('.inset-0')).toBeNull();
    // The floating handle disappears once the list opens; it returns on close.
    expect(panel.querySelector('button[aria-label="展开会话列表"]')).toBeNull();
    expect(panel.querySelector('button[aria-label="收起会话列表"]')).toBeNull();

    contentRegion.remove();
  });

  it('opening the list docks the aside into the content region, never under the chat', () => {
    // Regression for "图标没了，列表完全没出现": the handle disappeared (isOpen
    // became true) but the aside was portaled into the column-oriented
    // conversation region, where it stacked below the full-height chat and was
    // clipped by overflow-hidden — so the list was never visible.
    const conversationRegion = document.createElement('div');
    conversationRegion.id = 'workspace-conversation-region';
    document.body.appendChild(conversationRegion);
    const contentRegion = document.createElement('div');
    contentRegion.id = 'workspace-content-region';
    document.body.appendChild(contentRegion);

    const project = {
      projectId: 'p1',
      displayName: 'Demo',
      fullPath: '/demo',
      sessions: [
        {
          id: 's1',
          summary: 'Refactor parser',
          __provider: 'claude',
          createdAt: '2026-11-04T10:00:00Z',
          lastActivity: '2026-11-04T10:00:00Z',
        },
      ],
    } as unknown as Project;

    render(
      <ProjectSessionsPanel
        {...panelProps}
        project={project}
        selectedProjectForDocking={project}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '展开会话列表' }));

    // The aside docks into the row-oriented content region — never the
    // conversation region — so it sits beside the chat rather than under it.
    const panel = screen.getByRole('complementary', { name: '项目会话列表' });
    expect(panel.parentElement).toBe(contentRegion);
    expect(panel.parentElement).not.toBe(conversationRegion);
    // The floating handle is gone while the list is open.
    expect(screen.queryByRole('button', { name: '展开会话列表' })).toBeNull();

    conversationRegion.remove();
    contentRegion.remove();
  });

  it('hides the handle once the list opens and brings it back on blank-area close', () => {
    const contentRegion = document.createElement('div');
    contentRegion.id = 'workspace-content-region';
    document.body.appendChild(contentRegion);

    render(<ProjectSessionsPanel {...panelProps} />);

    const handle = screen.getByRole('button', { name: '展开会话列表' });
    fireEvent.click(handle);

    // Entering the list hides the session icon.
    const panel = screen.getByRole('complementary', { name: '项目会话列表' });
    expect(panel).toBeDefined();
    expect(screen.queryByRole('button', { name: '展开会话列表' })).toBeNull();

    // Clicking the panel's blank area (not a row/button/input) closes the list
    // and brings the handle back.
    fireEvent.click(panel);

    expect(screen.queryByRole('complementary', { name: '项目会话列表' })).toBeNull();
    expect(screen.getByRole('button', { name: '展开会话列表' })).toBeDefined();

    contentRegion.remove();
  });

  it('closes an unpinned drawer when a session is picked, and closes on Escape', () => {
    const contentRegion = document.createElement('div');
    contentRegion.id = 'workspace-content-region';
    document.body.appendChild(contentRegion);

    const onSessionSelect = vi.fn();
    const project = {
      projectId: 'p1',
      displayName: 'Demo',
      fullPath: '/demo',
      sessions: [
        {
          id: 's1',
          summary: 'Refactor parser',
          __provider: 'claude',
          createdAt: '2026-11-04T10:00:00Z',
          lastActivity: '2026-11-04T10:00:00Z',
        },
      ],
    } as unknown as Project;

    render(
      <ProjectSessionsPanel
        {...panelProps}
        project={project}
        onSessionSelect={onSessionSelect}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '展开会话列表' }));
    fireEvent.click(screen.getByText('Refactor parser'));

    expect(onSessionSelect).toHaveBeenCalledTimes(1);
    // Unpinned: picking a session is the drawer's primary action, so the
    // drawer closes once the chat lands on that session.
    expect(screen.queryByRole('complementary', { name: '项目会话列表' })).toBeNull();
    // The handle returns.
    expect(screen.getByRole('button', { name: '展开会话列表' })).toBeDefined();

    contentRegion.remove();
  });

  it('keeps a pinned drawer open when a session is picked, and closes on Escape', () => {
    const contentRegion = document.createElement('div');
    contentRegion.id = 'workspace-content-region';
    document.body.appendChild(contentRegion);

    const onSessionSelect = vi.fn();
    const project = {
      projectId: 'p1',
      displayName: 'Demo',
      fullPath: '/demo',
      sessions: [
        {
          id: 's1',
          summary: 'Refactor parser',
          __provider: 'claude',
          createdAt: '2026-11-04T10:00:00Z',
          lastActivity: '2026-11-04T10:00:00Z',
        },
      ],
    } as unknown as Project;

    render(
      <ProjectSessionsPanel
        {...panelProps}
        project={project}
        onSessionSelect={onSessionSelect}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '展开会话列表' }));
    // Pin the drawer so it stays open across session switches.
    fireEvent.click(screen.getByTitle('固定（常驻显示会话列表）'));

    fireEvent.click(screen.getByText('Refactor parser'));
    expect(onSessionSelect).toHaveBeenCalledTimes(1);
    // Pinned: the drawer stays open after a session is picked.
    expect(screen.getByRole('complementary', { name: '项目会话列表' })).toBeDefined();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('complementary', { name: '项目会话列表' })).toBeNull();

    contentRegion.remove();
  });

  it('lights the pin to keep the list open and unlighting it closes the list', () => {
    const contentRegion = document.createElement('div');
    contentRegion.id = 'workspace-content-region';
    document.body.appendChild(contentRegion);

    render(<ProjectSessionsPanel {...panelProps} />);

    fireEvent.click(screen.getByRole('button', { name: '展开会话列表' }));
    expect(screen.getByRole('complementary', { name: '项目会话列表' })).toBeDefined();

    // Lighting the pin keeps the list 常驻: it stays open.
    fireEvent.click(screen.getByTitle('固定（常驻显示会话列表）'));
    expect(screen.getByRole('complementary', { name: '项目会话列表' })).toBeDefined();
    const pin = screen.getByTitle('取消固定（收起会话列表）');
    expect(pin.getAttribute('aria-pressed')).toBe('true');

    // A pinned list ignores blank-area clicks.
    fireEvent.click(screen.getByRole('complementary', { name: '项目会话列表' }));
    expect(screen.getByRole('complementary', { name: '项目会话列表' })).toBeDefined();

    // Unlighting the pin closes the list and brings the handle back.
    fireEvent.click(pin);
    expect(screen.queryByRole('complementary', { name: '项目会话列表' })).toBeNull();
    expect(screen.getByRole('button', { name: '展开会话列表' })).toBeDefined();

    contentRegion.remove();
  });
});
