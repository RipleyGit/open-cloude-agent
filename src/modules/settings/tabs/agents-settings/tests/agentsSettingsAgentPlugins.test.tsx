import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import AgentsSettingsTab from '@/modules/settings/tabs/agents-settings/AgentsSettingsTab';
import { api } from '@/shared/api';

vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    api: {
      ...actual.api,
      agentPlugins: {
        list: vi.fn(),
        recommended: vi.fn().mockResolvedValue({ success: true, data: [] }),
        install: vi.fn(),
        update: vi.fn(),
        toggle: vi.fn(),
        uninstall: vi.fn(),
        status: vi.fn(),
      },
    },
  };
});

const mockProviderAuthStatus = {
  claude: { authenticated: true, email: 'user@example.com', method: 'oauth', error: null, loading: false },
  cursor: { authenticated: false, email: null, method: null, error: null, loading: false },
  codex: { authenticated: false, email: null, method: null, error: null, loading: false },
  opencode: { authenticated: false, email: null, method: null, error: null, loading: false },
};

describe('AgentsSettingsTab - Agent Plugins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if ((api.agentPlugins as any)?.recommended) {
      (api.agentPlugins.recommended as any).mockResolvedValue({ success: true, data: [] });
    }
  });

  it('renders built-in agents and loads installed agent plugins into the selector', async () => {
    const mockPlugins = [
      {
        name: 'cloudcli-plugin-agy',
        displayName: 'Google Antigravity (agy)',
        version: '1.0.0',
        description: 'Local Google Antigravity driver',
        author: 'Google',
        icon: 'Bot',
        type: 'agent',
        providerId: 'agy',
        cliName: 'agy',
        defaultModel: 'gemini-2.5-pro',
        models: [
          { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
          { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
        ],
        enabled: true,
        repoUrl: 'https://github.com/solshevik/cloudcli-plugin-agy.git',
        serverRunning: true,
        cliStatus: { installed: true, version: '1.0.0', exitCode: 0 },
      },
    ];

    (api.agentPlugins.list as any).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: mockPlugins }),
    });

    render(
      <AgentsSettingsTab
        providerAuthStatus={mockProviderAuthStatus as any}
        onProviderLogin={vi.fn()}
        claudePermissions={{ allowedTools: [], disallowedTools: [], skipPermissions: false }}
        onClaudePermissionsChange={vi.fn()}
        cursorPermissions={{ allowedCommands: [], disallowedCommands: [], skipPermissions: false }}
        onCursorPermissionsChange={vi.fn()}
        codexPermissionMode="default"
        onCodexPermissionModeChange={vi.fn()}
        projects={[]}
      />
    );

    // Built-ins should be present
    expect(screen.getAllByText('Claude').length).toBeGreaterThan(0);
    expect(screen.getByText('Cursor')).toBeTruthy();
    expect(screen.getByText('Codex')).toBeTruthy();
    expect(screen.getByText('OpenCode')).toBeTruthy();
    expect(screen.getByText('安装 Agent')).toBeTruthy();

    // After loading, AGY should appear in the pills
    await waitFor(() => {
      expect(screen.getByText('Google Antigravity (agy)')).toBeTruthy();
    });

    // Click on AGY pill button to switch to it
    const agyPill = screen.getByText('Google Antigravity (agy)').closest('button');
    expect(agyPill).toBeTruthy();
    fireEvent.click(agyPill!);

    // Should display AgentPluginContent with its details
    await waitFor(() => {
      expect(screen.getByText('CLI 运行环境与探针状态')).toBeTruthy();
      expect(screen.getAllByText('gemini-2.5-pro').length).toBeGreaterThan(0);
      expect(screen.getByText('Gemini 2.5 Flash')).toBeTruthy();
    });
  });

  it('opens install agent modal when clicking "安装 Agent"', async () => {
    (api.agentPlugins.list as any).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: [] }),
    });

    render(
      <AgentsSettingsTab
        providerAuthStatus={mockProviderAuthStatus as any}
        onProviderLogin={vi.fn()}
        claudePermissions={{ allowedTools: [], disallowedTools: [], skipPermissions: false }}
        onClaudePermissionsChange={vi.fn()}
        cursorPermissions={{ allowedCommands: [], disallowedCommands: [], skipPermissions: false }}
        onCursorPermissionsChange={vi.fn()}
        codexPermissionMode="default"
        onCodexPermissionModeChange={vi.fn()}
        projects={[]}
      />
    );

    const installBtn = screen.getByText('安装 Agent');
    fireEvent.click(installBtn);

    // Modal title should appear in the document
    await waitFor(() => {
      expect(screen.getByText('安装 Agent 插件')).toBeTruthy();
      expect(screen.getByText('Google Antigravity (AGY)')).toBeTruthy();
    });
  });
});
