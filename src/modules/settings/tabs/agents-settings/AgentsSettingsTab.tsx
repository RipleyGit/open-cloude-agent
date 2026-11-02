import { useCallback, useEffect, useMemo, useState } from 'react';

import { api, readApiErrorMessage } from '@/shared/api';
import type {
  AgentCategory,
  AgentContextByProvider,
  AgentPluginItem,
  AgentProvider,
  AgentSettingsProject,
  ClaudePermissionsState,
  CodexPermissionMode,
  CursorPermissionsState,
  ProviderAuthStatus,
} from '@/shared/types';
import AgentCategoryContentSection from '@/modules/settings/tabs/agents-settings/sections/AgentCategoryContentSection';
import AgentCategoryTabsSection from '@/modules/settings/tabs/agents-settings/sections/AgentCategoryTabsSection';
import AgentSelectorSection from '@/modules/settings/tabs/agents-settings/sections/AgentSelectorSection';
import InstallAgentModal from '@/modules/settings/tabs/agents-settings/modals/InstallAgentModal';

type ProviderAuthStatusByProvider = Record<AgentProvider, ProviderAuthStatus>;

type AgentsSettingsTabProps = {
  providerAuthStatus: ProviderAuthStatusByProvider;
  onProviderLogin: (provider: AgentProvider) => void;
  claudePermissions: ClaudePermissionsState;
  onClaudePermissionsChange: (value: ClaudePermissionsState) => void;
  cursorPermissions: CursorPermissionsState;
  onCursorPermissionsChange: (value: CursorPermissionsState) => void;
  codexPermissionMode: CodexPermissionMode;
  onCodexPermissionModeChange: (value: CodexPermissionMode) => void;
  projects: AgentSettingsProject[];
};

const BUILTIN_AGENTS: AgentProvider[] = ['claude', 'cursor', 'codex', 'opencode'];

/** Rendered by Settings for the "agents" tab, hosting per-provider account, permission, MCP, skills, and Agent plugin settings. */
export default function AgentsSettingsTab({
  providerAuthStatus,
  onProviderLogin,
  claudePermissions,
  onClaudePermissionsChange,
  cursorPermissions,
  onCursorPermissionsChange,
  codexPermissionMode,
  onCodexPermissionModeChange,
  projects,
}: AgentsSettingsTabProps) {
  const [selectedAgent, setSelectedAgent] = useState<AgentProvider>('claude');
  const [selectedCategory, setSelectedCategory] = useState<AgentCategory>('account');
  const [agentPlugins, setAgentPlugins] = useState<AgentPluginItem[]>([]);
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);

  const loadAgentPlugins = useCallback(async () => {
    try {
      const res = await api.agentPlugins.list();
      if (res.ok) {
        const body = await res.json();
        setAgentPlugins(body.data || []);
      }
    } catch (err) {
      console.error('[AgentsSettingsTab] Failed to load agent plugins:', err);
    }
  }, []);

  useEffect(() => {
    void loadAgentPlugins();
  }, [loadAgentPlugins]);

  const selectedAgentPlugin = useMemo(() => {
    return agentPlugins.find((p) => p.providerId === selectedAgent) || null;
  }, [agentPlugins, selectedAgent]);

  const visibleCategories = useMemo<AgentCategory[]>(() => {
    if (selectedAgentPlugin) {
      return ['account', 'mcp', 'skills'];
    }
    if (selectedAgent === 'opencode') {
      return ['account', 'permissions', 'mcp'];
    }
    return ['account', 'permissions', 'mcp', 'skills'];
  }, [selectedAgent, selectedAgentPlugin]);

  const visibleAgents = useMemo<AgentProvider[]>(() => {
    const list: AgentProvider[] = [...BUILTIN_AGENTS];
    for (const plugin of agentPlugins) {
      const id = plugin.providerId as AgentProvider;
      if (!list.includes(id)) {
        list.push(id);
      }
    }
    return list;
  }, [agentPlugins]);

  const agentDisplayNames = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {
      claude: 'Claude',
      cursor: 'Cursor',
      codex: 'Codex',
      opencode: 'OpenCode',
    };
    for (const plugin of agentPlugins) {
      map[plugin.providerId] = plugin.displayName || plugin.name;
    }
    return map;
  }, [agentPlugins]);

  const agentContextById = useMemo<AgentContextByProvider>(() => {
    const context: Record<string, { authStatus: ProviderAuthStatus; onLogin: () => void }> = {
      claude: {
        authStatus: providerAuthStatus.claude || { authenticated: false, email: null, method: null, error: null, loading: false },
        onLogin: () => onProviderLogin('claude'),
      },
      cursor: {
        authStatus: providerAuthStatus.cursor || { authenticated: false, email: null, method: null, error: null, loading: false },
        onLogin: () => onProviderLogin('cursor'),
      },
      codex: {
        authStatus: providerAuthStatus.codex || { authenticated: false, email: null, method: null, error: null, loading: false },
        onLogin: () => onProviderLogin('codex'),
      },
      opencode: {
        authStatus: providerAuthStatus.opencode || { authenticated: false, email: null, method: null, error: null, loading: false },
        onLogin: () => onProviderLogin('opencode'),
      },
    };

    for (const plugin of agentPlugins) {
      context[plugin.providerId] = {
        authStatus: {
          authenticated: Boolean(plugin.cliStatus?.installed || plugin.serverRunning),
          email: null,
          method: 'plugin',
          error: null,
          loading: false,
          installedVersion: plugin.cliStatus?.version || plugin.version,
        },
        onLogin: () => {},
      };
    }

    return context as AgentContextByProvider;
  }, [
    agentPlugins,
    onProviderLogin,
    providerAuthStatus.claude,
    providerAuthStatus.codex,
    providerAuthStatus.cursor,
    providerAuthStatus.opencode,
  ]);

  useEffect(() => {
    if (!visibleCategories.includes(selectedCategory)) {
      setSelectedCategory(visibleCategories[0] ?? 'account');
    }
  }, [selectedCategory, visibleCategories]);

  // If currently selected agent was removed, switch back to claude
  useEffect(() => {
    if (!visibleAgents.includes(selectedAgent)) {
      setSelectedAgent('claude');
    }
  }, [selectedAgent, visibleAgents]);

  const handleInstallPlugin = async (url: string) => {
    try {
      const res = await api.agentPlugins.install(url);
      const data = await res.json();
      if (res.ok && data.success) {
        await loadAgentPlugins();
        window.dispatchEvent(new CustomEvent('projects:refresh'));
        return { success: true, providerId: data.data?.providerId };
      }
      return { success: false, error: readApiErrorMessage(data) ?? '安装失败' };
    } catch (err: any) {
      return { success: false, error: err.message || '安装请求失败' };
    }
  };

  const handleUpdatePlugin = async (name: string) => {
    try {
      const res = await api.agentPlugins.update(name);
      const data = await res.json();
      if (res.ok && data.success) {
        await loadAgentPlugins();
        window.dispatchEvent(new CustomEvent('projects:refresh'));
        return { success: true };
      }
      return { success: false, error: readApiErrorMessage(data) ?? '更新失败' };
    } catch (err: any) {
      return { success: false, error: err.message || '更新请求失败' };
    }
  };

  const handleTogglePlugin = async (name: string, enabled: boolean) => {
    try {
      const res = await api.agentPlugins.toggle(name, enabled);
      const data = await res.json();
      if (res.ok && data.success) {
        await loadAgentPlugins();
        window.dispatchEvent(new CustomEvent('projects:refresh'));
        return { success: true };
      }
      return { success: false, error: readApiErrorMessage(data) ?? '切换失败' };
    } catch (err: any) {
      return { success: false, error: err.message || '切换请求失败' };
    }
  };

  const handleUninstallPlugin = async (name: string) => {
    try {
      const res = await api.agentPlugins.uninstall(name);
      const data = await res.json();
      if (res.ok && data.success) {
        await loadAgentPlugins();
        setSelectedAgent('claude');
        window.dispatchEvent(new CustomEvent('projects:refresh'));
        return { success: true };
      }
      return { success: false, error: readApiErrorMessage(data) ?? '卸载失败' };
    } catch (err: any) {
      return { success: false, error: err.message || '卸载请求失败' };
    }
  };

  const installedRepoUrls = useMemo(() => {
    return agentPlugins.map((p) => p.repoUrl).filter((u): u is string => Boolean(u));
  }, [agentPlugins]);

  return (
    <div className="-mx-4 -mb-4 -mt-2 flex min-h-[300px] min-w-0 flex-col overflow-hidden md:-mx-6 md:-mb-6 md:-mt-2 md:min-h-[500px]">
      <AgentSelectorSection
        agents={visibleAgents}
        selectedAgent={selectedAgent}
        onSelectAgent={setSelectedAgent}
        agentContextById={agentContextById}
        agentDisplayNames={agentDisplayNames}
        onOpenInstallModal={() => setIsInstallModalOpen(true)}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <AgentCategoryTabsSection
          categories={visibleCategories}
          selectedAgent={selectedAgent}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
        />

        <AgentCategoryContentSection
          selectedAgent={selectedAgent}
          selectedCategory={selectedCategory}
          agentContextById={agentContextById}
          claudePermissions={claudePermissions}
          onClaudePermissionsChange={onClaudePermissionsChange}
          cursorPermissions={cursorPermissions}
          onCursorPermissionsChange={onCursorPermissionsChange}
          codexPermissionMode={codexPermissionMode}
          onCodexPermissionModeChange={onCodexPermissionModeChange}
          projects={projects}
          selectedAgentPlugin={selectedAgentPlugin}
          onRefreshAgentPlugins={loadAgentPlugins}
          onUpdateAgentPlugin={handleUpdatePlugin}
          onToggleAgentPlugin={handleTogglePlugin}
          onUninstallAgentPlugin={handleUninstallPlugin}
        />
      </div>

      <InstallAgentModal
        isOpen={isInstallModalOpen}
        onClose={() => setIsInstallModalOpen(false)}
        onInstall={handleInstallPlugin}
        onInstalledSuccess={(providerId) => {
          if (providerId) {
            setSelectedAgent(providerId as AgentProvider);
          }
        }}
        installedRepoUrls={installedRepoUrls}
      />
    </div>
  );
}
