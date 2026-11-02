import { Plus } from 'lucide-react';

import { Button, LLMProviderLogo, PillBar, Pill } from '@/shared/ui';
import type { AgentContextByProvider, AgentProvider } from '@/shared/types';

type AgentSelectorSectionProps = {
  agents: AgentProvider[];
  selectedAgent: AgentProvider;
  onSelectAgent: (agent: AgentProvider) => void;
  agentContextById: AgentContextByProvider;
  agentDisplayNames?: Record<string, string>;
  onOpenInstallModal: () => void;
};

const AGENT_NAMES: Record<string, string> = {
  claude: 'Claude',
  cursor: 'Cursor',
  codex: 'Codex',
  opencode: 'OpenCode',
};

/** Rendered by AgentsSettingsTab to pick which agent provider the tab is configuring. */
export default function AgentSelectorSection({
  agents,
  selectedAgent,
  onSelectAgent,
  agentContextById,
  agentDisplayNames = {},
  onOpenInstallModal,
}: AgentSelectorSectionProps) {
  const getAgentLabel = (agent: AgentProvider) => {
    if (agentDisplayNames[agent]) return agentDisplayNames[agent];
    if (AGENT_NAMES[agent]) return AGENT_NAMES[agent];
    return agent.charAt(0).toUpperCase() + agent.slice(1);
  };

  return (
    <div className="flex-shrink-0 border-b border-border px-3 py-2 md:px-4 md:py-3 flex items-center justify-between gap-3 overflow-x-auto">
      <PillBar className="w-auto shrink-0 flex-wrap md:flex-nowrap">
        {agents.map((agent) => {
          const dotColor =
            agent === 'claude' ? 'bg-blue-500' :
            agent === 'cursor' ? 'bg-purple-500' :
            agent === 'opencode' ? 'bg-zinc-500' : 'bg-primary/80';

          const isAuthenticated = agentContextById[agent]?.authStatus?.authenticated ?? false;

          return (
            <Pill
              key={agent}
              isActive={selectedAgent === agent}
              onClick={() => onSelectAgent(agent)}
              className="min-w-0 flex-initial justify-center gap-1.5"
            >
              <LLMProviderLogo provider={agent} className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">{getAgentLabel(agent)}</span>
              {isAuthenticated && (
                <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${dotColor}`} />
              )}
            </Pill>
          );
        })}
      </PillBar>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpenInstallModal();
        }}
        className="h-8 shrink-0 gap-1.5 border-dashed text-xs hover:border-primary hover:text-primary"
      >
        <Plus className="h-3.5 w-3.5" />
        <span>安装 Agent</span>
      </Button>
    </div>
  );
}
