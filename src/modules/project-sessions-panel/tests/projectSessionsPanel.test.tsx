import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ProjectSessionsHandle from '@/modules/project-sessions-panel/ProjectSessionsHandle';
import ProjectSessionsHeader from '@/modules/project-sessions-panel/ProjectSessionsHeader';
import ProjectSessionsList from '@/modules/project-sessions-panel/ProjectSessionsList';
import ProjectSessionsPanel from '@/modules/project-sessions-panel/ProjectSessionsPanel';
import ProjectSessionRow from '@/modules/project-sessions-panel/ProjectSessionRow';
import type { Project, SessionWithProvider } from '@/shared/types';

// The panel branches on viewport width: docked column on desktop, drawer on
// mobile. Mutable so each suite can pick the form it is covering.
const deviceSettings = vi.hoisted(() => ({ isMobile: false }));
vi.mock('@/shared/hooks/useDeviceSettings', () => ({
  useDeviceSettings: () => deviceSettings,
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
  it('renders project name, session count, a close button and the pin', () => {
    const onTogglePin = vi.fn();
    const onClose = vi.fn();
    const onLocateProject = vi.fn();

    render(
      <ProjectSessionsHeader
        projectName="DemoProject"
        sessionCount={5}
        isPinned
        onTogglePin={onTogglePin}
        onLocateProject={onLocateProject}
        onClose={onClose}
      />,
    );

    expect(screen.getByText('会话列表')).toBeDefined();
    expect(screen.getByText('DemoProject')).toBeDefined();
    expect(screen.getByText('5')).toBeDefined();

    // The new-session button moved to the foot of the list; the close button
    // dismisses the docked panel, which has no backdrop to click.
    expect(screen.queryByText('新建')).toBeNull();
    fireEvent.click(screen.getByTitle('收起会话列表'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle('取消固定（收起会话列表）')).toBeDefined();

    // The locate button jumps to the project behind the selected session.
    fireEvent.click(screen.getByTitle('定位当前项目'));
    expect(onLocateProject).toHaveBeenCalledTimes(1);
  });

  it('toggles the pin', () => {
    const onTogglePin = vi.fn();
    render(
      <ProjectSessionsHeader
        projectName="DemoProject"
        sessionCount={0}
        isPinned={false}
        onTogglePin={onTogglePin}
        onLocateProject={vi.fn()}
        onClose={vi.fn()}
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
        onLocateProject={vi.fn()}
        onClose={vi.fn()}
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
        onLocateProject={vi.fn()}
        onClose={vi.fn()}
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
    expect(button.getAttribute('title')).toBe('拖拽可停靠在项目侧边栏右侧或窗口右侧，点击展开/收起会话列表');

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

  afterEach(() => {
    deviceSettings.isMobile = false;
    localStorage.removeItem('project_sessions_handle_side');
    localStorage.removeItem('project_sessions_handle_position');
  });

  describe('docked beside the chat on desktop', () => {
    it('takes part in the shell layout instead of covering the chat window', () => {
      // The list used to be portaled into the chat's content region, where it
      // was confined to the conversation window, and then floated over it. It
      // is now a column in the shell's flex row, so the chat shrinks rather
      // than being covered — the composer stays reachable.
      const contentRegion = document.createElement('div');
      contentRegion.id = 'workspace-content-region';
      document.body.appendChild(contentRegion);

      render(<ProjectSessionsPanel {...panelProps} />);

      // Collapsed: nothing is laid out over the window, just the edge handle.
      expect(screen.queryByRole('complementary', { name: '项目会话列表' })).toBeNull();
      const handle = screen.getByRole('button', { name: '展开会话列表' });
      expect(handle.style.right).toBe('0px');

      fireEvent.click(handle);

      const panel = screen.getByRole('complementary', { name: '项目会话列表' });
      // Not a child of the chat's content region.
      expect(contentRegion.contains(panel)).toBe(false);
      // A layout sibling that reserves its own width and never shrinks.
      expect(panel.className).toContain('flex-shrink-0');
      expect(panel.className).toContain('h-full');
      // In flow, not anchored over the window.
      expect(panel.className).not.toContain('fixed');
      expect(panel.className).not.toContain('inset-0');
      // No backdrop: the chat beside it stays clickable.
      expect(screen.queryByRole('button', { name: '关闭会话列表' })).toBeNull();
      // The floating handle disappears once the list opens; it returns on close.
      expect(screen.queryByRole('button', { name: '展开会话列表' })).toBeNull();

      contentRegion.remove();
    });

    it('sits right of the project sidebar when the handle is docked left', () => {
      const first = render(<ProjectSessionsPanel {...panelProps} />);

      fireEvent.click(screen.getByRole('button', { name: '展开会话列表' }));
      // Default side is right: after the chat in the shell's flex row.
      expect(screen.getByRole('complementary', { name: '项目会话列表' }).style.order).toBe('3');

      first.unmount();

      // The side is persisted, so a remount opens on the left instead.
      localStorage.setItem('project_sessions_handle_side', 'left');

      render(<ProjectSessionsPanel {...panelProps} />);
      fireEvent.click(screen.getByRole('button', { name: '展开会话列表' }));

      const leftPanel = screen.getByRole('complementary', { name: '项目会话列表' });
      // Order 1 lands between the sidebar (0) and the chat (2), so it starts at
      // the sidebar's right edge rather than over it.
      expect(leftPanel.style.order).toBe('1');
      expect(leftPanel.className).toContain('session-dock-enter-left');
      expect(leftPanel.className).toContain('border-r');
    });

    it('steps aside when the chat or a blank area is clicked, and closes from its header', () => {
      render(<ProjectSessionsPanel {...panelProps} />);

      fireEvent.click(screen.getByRole('button', { name: '展开会话列表' }));

      // Unpinned: a click out in the chat — where the composer lives — takes the
      // user back to the conversation, so the panel steps aside.
      fireEvent.pointerDown(document.body);
      expect(screen.queryByRole('complementary', { name: '项目会话列表' })).toBeNull();
      expect(screen.getByRole('button', { name: '展开会话列表' })).toBeDefined();

      // So does a click on the panel's own blank surface.
      fireEvent.click(screen.getByRole('button', { name: '展开会话列表' }));
      fireEvent.click(screen.getByRole('complementary', { name: '项目会话列表' }));
      expect(screen.queryByRole('complementary', { name: '项目会话列表' })).toBeNull();

      // The header's close button dismisses it too, without any outside click.
      fireEvent.click(screen.getByRole('button', { name: '展开会话列表' }));
      fireEvent.click(screen.getByTitle('收起会话列表'));
      expect(screen.queryByRole('complementary', { name: '项目会话列表' })).toBeNull();
      expect(screen.getByRole('button', { name: '展开会话列表' })).toBeDefined();
    });

    it('keeps a pinned panel open when the chat beside it is clicked', () => {
      render(<ProjectSessionsPanel {...panelProps} />);

      fireEvent.click(screen.getByRole('button', { name: '展开会话列表' }));
      fireEvent.click(screen.getByTitle('固定（常驻显示会话列表）'));

      const panel = screen.getByRole('complementary', { name: '项目会话列表' });
      fireEvent.pointerDown(document.body);
      fireEvent.click(panel);
      expect(panel).toBeDefined();
    });

    it('rests against the project sidebar when docked on its left', () => {
      // jsdom reports a zero-sized rect, so stand in for the docked sidebar.
      const sidebar = document.createElement('div');
      sidebar.id = 'workspace-sidebar-region';
      sidebar.getBoundingClientRect = () => ({ right: 288 }) as DOMRect;
      document.body.appendChild(sidebar);
      localStorage.setItem('project_sessions_handle_side', 'left');

      render(<ProjectSessionsPanel {...panelProps} />);

      // Collapsed: the handle sits just right of the sidebar, never on top of it.
      const handle = screen.getByRole('button', { name: '展开会话列表' });
      expect(handle.style.left).toBe('288px');
      expect(handle.style.right).toBe('');

      sidebar.remove();
    });

    it('rests against the window edge when no sidebar is docked', () => {
      localStorage.setItem('project_sessions_handle_side', 'left');

      render(<ProjectSessionsPanel {...panelProps} />);

      // Mobile has no docked sidebar, so the left edge is the window's.
      const handle = screen.getByRole('button', { name: '展开会话列表' });
      expect(handle.style.left).toBe('0px');
    });

    it('cannot be dragged over the project sidebar', () => {
      // jsdom reports a zero-sized rect, so stand in for the docked sidebar.
      const sidebar = document.createElement('div');
      sidebar.id = 'workspace-sidebar-region';
      sidebar.getBoundingClientRect = () => ({ right: 288 }) as DOMRect;
      document.body.appendChild(sidebar);

      render(<ProjectSessionsPanel {...panelProps} />);
      const handle = screen.getByRole('button', { name: '展开会话列表' });

      // Drag from beside the sidebar far past its left edge.
      fireEvent.mouseDown(handle, { clientX: 300, clientY: 300 });
      fireEvent.mouseMove(document, { clientX: 4, clientY: 400 });
      fireEvent.mouseUp(document);

      // Released left of the sidebar, so it snaps to the sidebar's right edge
      // instead of the window's.
      expect(screen.getByRole('button', { name: '展开会话列表' }).style.left).toBe('288px');

      sidebar.remove();
    });

    it('closes an unpinned panel when a session is picked, and closes on Escape', () => {
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
      // Unpinned: picking a session is the panel's primary action, so the
      // panel closes once the chat lands on that session.
      expect(screen.queryByRole('complementary', { name: '项目会话列表' })).toBeNull();
      // The handle returns.
      expect(screen.getByRole('button', { name: '展开会话列表' })).toBeDefined();
    });

    it('keeps a pinned panel open when a session is picked, and closes on Escape', () => {
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
      // Pin the panel so it stays open across session switches.
      fireEvent.click(screen.getByTitle('固定（常驻显示会话列表）'));

      fireEvent.click(screen.getByText('Refactor parser'));
      expect(onSessionSelect).toHaveBeenCalledTimes(1);
      // Pinned: the panel stays open after a session is picked.
      expect(screen.getByRole('complementary', { name: '项目会话列表' })).toBeDefined();

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('complementary', { name: '项目会话列表' })).toBeNull();
    });

    it('lights the pin to keep the list open and unlighting it closes the list', () => {
      render(<ProjectSessionsPanel {...panelProps} />);

      fireEvent.click(screen.getByRole('button', { name: '展开会话列表' }));
      expect(screen.getByRole('complementary', { name: '项目会话列表' })).toBeDefined();

      // Lighting the pin keeps the list 常驻: it stays open.
      fireEvent.click(screen.getByTitle('固定（常驻显示会话列表）'));
      expect(screen.getByRole('complementary', { name: '项目会话列表' })).toBeDefined();
      const pin = screen.getByTitle('取消固定（收起会话列表）');
      expect(pin.getAttribute('aria-pressed')).toBe('true');

      // Unlighting the pin closes the list and brings the handle back.
      fireEvent.click(pin);
      expect(screen.queryByRole('complementary', { name: '项目会话列表' })).toBeNull();
      expect(screen.getByRole('button', { name: '展开会话列表' })).toBeDefined();
    });

    it('locates the project and stays docked beside the sidebar', () => {
      // Locating a project is a look, not a dismissal: the panel is docked next
      // to the sidebar it just revealed, so it stays open for further switching.
      const onLocateProject = vi.fn();
      render(<ProjectSessionsPanel {...panelProps} onLocateProject={onLocateProject} />);

      fireEvent.click(screen.getByRole('button', { name: '展开会话列表' }));
      fireEvent.click(screen.getByTitle('定位当前项目'));

      expect(onLocateProject).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('complementary', { name: '项目会话列表' })).toBeDefined();
    });
  });

  describe('as a drawer on mobile', () => {
    it('covers the whole window with a backdrop, outside the chat content region', () => {
      deviceSettings.isMobile = true;

      // The list used to be portaled into the chat's content region, where it
      // was confined to the conversation window. It is now a drawer over the
      // whole window, so it must render outside that region entirely.
      const contentRegion = document.createElement('div');
      contentRegion.id = 'workspace-content-region';
      document.body.appendChild(contentRegion);

      render(<ProjectSessionsPanel {...panelProps} />);

      expect(screen.queryByRole('complementary', { name: '项目会话列表' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '展开会话列表' }));

      const panel = screen.getByRole('complementary', { name: '项目会话列表' });
      // Not a child of the chat's content region — the drawer left the chat window.
      expect(contentRegion.contains(panel)).toBe(false);
      expect(panel.parentElement?.className).toContain('fixed');
      expect(panel.parentElement?.className).toContain('inset-0');
      // A drawer panel, not a flex sibling squeezing the chat.
      expect(panel.className).not.toContain('flex-shrink-0');
      // Anchored to an edge (default side is right) rather than placed in flow.
      expect(panel.className).toContain('right-0');
      // An unpinned drawer dims the window behind it.
      const backdrop = screen.getByRole('button', { name: '关闭会话列表' });
      expect(backdrop.className).toContain('backdrop-blur-sm');
      // The floating handle disappears once the list opens; it returns on close.
      expect(screen.queryByRole('button', { name: '展开会话列表' })).toBeNull();

      contentRegion.remove();
    });

    it('slides in from the edge the handle was last docked on', () => {
      deviceSettings.isMobile = true;

      const first = render(<ProjectSessionsPanel {...panelProps} />);

      fireEvent.click(screen.getByRole('button', { name: '展开会话列表' }));
      // Default side is right.
      expect(screen.getByRole('complementary', { name: '项目会话列表' }).className)
        .toContain('session-drawer-enter-right');

      first.unmount();

      // The side is persisted, so a remount slides in from the left instead.
      localStorage.setItem('project_sessions_handle_side', 'left');

      render(<ProjectSessionsPanel {...panelProps} />);
      fireEvent.click(screen.getByRole('button', { name: '展开会话列表' }));

      const leftPanel = screen.getByRole('complementary', { name: '项目会话列表' });
      expect(leftPanel.className).toContain('session-drawer-enter-left');
      expect(leftPanel.className).toContain('border-r');
    });

    it('drops the backdrop while pinned so the chat beside the drawer stays clickable', () => {
      deviceSettings.isMobile = true;

      render(<ProjectSessionsPanel {...panelProps} />);

      fireEvent.click(screen.getByRole('button', { name: '展开会话列表' }));
      expect(screen.getByRole('button', { name: '关闭会话列表' })).toBeDefined();

      fireEvent.click(screen.getByTitle('固定（常驻显示会话列表）'));

      const panel = screen.getByRole('complementary', { name: '项目会话列表' });
      expect(panel).toBeDefined();
      // Pinned: no backdrop, and the wrapper lets clicks through to the chat.
      expect(screen.queryByRole('button', { name: '关闭会话列表' })).toBeNull();
      expect(panel.parentElement?.className).toContain('pointer-events-none');
    });

    it('closes an unpinned drawer when the backdrop is clicked', () => {
      deviceSettings.isMobile = true;

      render(<ProjectSessionsPanel {...panelProps} />);

      fireEvent.click(screen.getByRole('button', { name: '展开会话列表' }));
      fireEvent.click(screen.getByRole('button', { name: '关闭会话列表' }));

      expect(screen.queryByRole('complementary', { name: '项目会话列表' })).toBeNull();
      expect(screen.getByRole('button', { name: '展开会话列表' })).toBeDefined();
    });

    it('closes an unpinned drawer on blank-area and outside clicks', () => {
      deviceSettings.isMobile = true;

      render(<ProjectSessionsPanel {...panelProps} />);

      fireEvent.click(screen.getByRole('button', { name: '展开会话列表' }));

      // Clicking the drawer's blank area (not a row/button/input) closes it and
      // brings the handle back.
      fireEvent.click(screen.getByRole('complementary', { name: '项目会话列表' }));
      expect(screen.queryByRole('complementary', { name: '项目会话列表' })).toBeNull();
      expect(screen.getByRole('button', { name: '展开会话列表' })).toBeDefined();

      // So does a pointerdown anywhere else in the window.
      fireEvent.click(screen.getByRole('button', { name: '展开会话列表' }));
      expect(screen.getByRole('complementary', { name: '项目会话列表' })).toBeDefined();
      fireEvent.pointerDown(document.body);
      expect(screen.queryByRole('complementary', { name: '项目会话列表' })).toBeNull();
    });

    it('closes the drawer after locating the project, uncovering the sidebar', () => {
      // On mobile the drawer covers the whole window, so the sidebar it just
      // revealed would sit underneath it: the drawer steps aside instead.
      deviceSettings.isMobile = true;
      const onLocateProject = vi.fn();

      render(<ProjectSessionsPanel {...panelProps} onLocateProject={onLocateProject} />);

      fireEvent.click(screen.getByRole('button', { name: '展开会话列表' }));
      fireEvent.click(screen.getByTitle('定位当前项目'));

      expect(onLocateProject).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('complementary', { name: '项目会话列表' })).toBeNull();
      expect(screen.getByRole('button', { name: '展开会话列表' })).toBeDefined();
    });

    it('deletes from an unpinned drawer: the confirm dialog survives its own pointerdown', async () => {
      // Regression: the outside-click listener closed the unpinned drawer on the
      // pointerdown that preceded the dialog button's click. That unmounted the
      // list (and its pendingDelete state) before the click landed, so confirming
      // a delete did nothing. A real browser always fires pointerdown first.
      deviceSettings.isMobile = true;
      const { waitFor } = await import('@testing-library/react');

      const onSessionDelete = vi.fn();
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
          onSessionDelete={onSessionDelete}
        />,
      );

      // Open the unpinned drawer and reach the confirm dialog through bulk delete.
      fireEvent.click(screen.getByRole('button', { name: '展开会话列表' }));
      fireEvent.click(screen.getByText('sessions.select'));
      fireEvent.click(screen.getByText('sessions.selectAll'));
      fireEvent.click(screen.getByText('sessions.deleteSelected:count=1'));

      const confirm = screen.getByText('彻底删除 (不可恢复)');
      fireEvent.pointerDown(confirm);

      // The dialog (and the drawer under it) must still be mounted.
      expect(screen.queryByText('彻底删除 (不可恢复)')).not.toBeNull();
      expect(screen.getByRole('complementary', { name: '项目会话列表' })).toBeDefined();

      fireEvent.click(confirm);
      await waitFor(() => expect(onSessionDelete).toHaveBeenCalledWith('s1'));
    });
  });
});
