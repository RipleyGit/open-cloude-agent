import type {
  AgentCategory,
  AgentContextByProvider,
  AgentPluginItem,
  AgentProvider,
  AgentSettingsProject,
  ClaudePermissionsState,
  CodexPermissionMode,
  CursorPermissionsState,
  McpProject,
  SkillsProject,
} from '@/shared/types';
import { McpServers } from '@/modules/mcp';
import { ProviderSkills } from '@/modules/skills';
import AccountContent from '@/modules/settings/tabs/agents-settings/sections/content/AccountContent';
import AgentPluginContent from '@/modules/settings/tabs/agents-settings/sections/content/AgentPluginContent';
import PermissionsContent from '@/modules/settings/tabs/agents-settings/sections/content/PermissionsContent';

type AgentCategoryContentSectionProps = {
  selectedAgent: AgentProvider;
  selectedCategory: AgentCategory;
  agentContextById: AgentContextByProvider;
  claudePermissions: ClaudePermissionsState;
  onClaudePermissionsChange: (value: ClaudePermissionsState) => void;
  cursorPermissions: CursorPermissionsState;
  onCursorPermissionsChange: (value: CursorPermissionsState) => void;
  codexPermissionMode: CodexPermissionMode;
  onCodexPermissionModeChange: (value: CodexPermissionMode) => void;
  projects: AgentSettingsProject[];
  selectedAgentPlugin?: AgentPluginItem | null;
  onRefreshAgentPlugins?: () => Promise<void>;
  onUpdateAgentPlugin?: (name: string) => Promise<{ success: boolean; error?: string }>;
  onToggleAgentPlugin?: (name: string, enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  onUninstallAgentPlugin?: (name: string) => Promise<{ success: boolean; error?: string }>;
};

const DEFAULT_AUTH_STATUS = {
  authenticated: false,
  email: null,
  method: null,
  error: null,
  loading: false,
};

/** Rendered by AgentsSettingsTab to show the panel for the selected provider and category. */
export default function AgentCategoryContentSection({
  selectedAgent,
  selectedCategory,
  agentContextById,
  claudePermissions,
  onClaudePermissionsChange,
  cursorPermissions,
  onCursorPermissionsChange,
  codexPermissionMode,
  onCodexPermissionModeChange,
  projects,
  selectedAgentPlugin,
  onRefreshAgentPlugins,
  onUpdateAgentPlugin,
  onToggleAgentPlugin,
  onUninstallAgentPlugin,
}: AgentCategoryContentSectionProps) {
  const currentAgentContext = agentContextById[selectedAgent] || {
    authStatus: DEFAULT_AUTH_STATUS,
    onLogin: () => {},
  };

  return (
    <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-3 md:p-4">
      {selectedCategory === 'account' && selectedAgentPlugin ? (
        <AgentPluginContent
          plugin={selectedAgentPlugin}
          onRefresh={onRefreshAgentPlugins || (async () => {})}
          onUpdate={onUpdateAgentPlugin || (async () => ({ success: false }))}
          onToggle={onToggleAgentPlugin || (async () => ({ success: false }))}
          onUninstall={onUninstallAgentPlugin || (async () => ({ success: false }))}
        />
      ) : selectedCategory === 'account' ? (
        <AccountContent
          agent={selectedAgent}
          authStatus={currentAgentContext.authStatus}
          onLogin={currentAgentContext.onLogin}
        />
      ) : null}

      {selectedCategory === 'permissions' && selectedAgent === 'claude' && (
        <PermissionsContent
          agent="claude"
          skipPermissions={claudePermissions.skipPermissions}
          onSkipPermissionsChange={(value) => {
            onClaudePermissionsChange({ ...claudePermissions, skipPermissions: value });
          }}
          allowedTools={claudePermissions.allowedTools}
          onAllowedToolsChange={(value) => {
            onClaudePermissionsChange({ ...claudePermissions, allowedTools: value });
          }}
          disallowedTools={claudePermissions.disallowedTools}
          onDisallowedToolsChange={(value) => {
            onClaudePermissionsChange({ ...claudePermissions, disallowedTools: value });
          }}
        />
      )}

      {selectedCategory === 'permissions' && selectedAgent === 'cursor' && (
        <PermissionsContent
          agent="cursor"
          skipPermissions={cursorPermissions.skipPermissions}
          onSkipPermissionsChange={(value) => {
            onCursorPermissionsChange({ ...cursorPermissions, skipPermissions: value });
          }}
          allowedCommands={cursorPermissions.allowedCommands}
          onAllowedCommandsChange={(value) => {
            onCursorPermissionsChange({ ...cursorPermissions, allowedCommands: value });
          }}
          disallowedCommands={cursorPermissions.disallowedCommands}
          onDisallowedCommandsChange={(value) => {
            onCursorPermissionsChange({ ...cursorPermissions, disallowedCommands: value });
          }}
        />
      )}

      {selectedCategory === 'permissions' && selectedAgent === 'codex' && (
        <PermissionsContent
          agent="codex"
          permissionMode={codexPermissionMode}
          onPermissionModeChange={onCodexPermissionModeChange}
        />
      )}

      {selectedCategory === 'mcp' && (
        // AgentSettingsProject.name is populated from the DB projectId by
        // normalizeProjectForSettings, so we can map it straight through.
        <McpServers
          selectedProvider={selectedAgent}
          currentProjects={projects.map<McpProject>((project) => ({
            projectId: project.name,
            displayName: project.displayName,
            fullPath: project.fullPath,
            path: project.path,
          }))}
        />
      )}

      {selectedCategory === 'skills' && selectedAgent !== 'opencode' && (
        <ProviderSkills
          selectedProvider={selectedAgent}
          currentProjects={projects.map<SkillsProject>((project) => ({
            projectId: project.name,
            displayName: project.displayName,
            fullPath: project.fullPath,
            path: project.path,
          }))}
        />
      )}
    </div>
  );
}
