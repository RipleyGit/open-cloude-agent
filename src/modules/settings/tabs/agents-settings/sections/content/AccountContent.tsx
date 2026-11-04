import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  Coins,
  Image,
  LogIn,
  RefreshCw,
  Search,
  Server,
  Sparkles,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import ProviderCliVersion from '@/modules/settings/tabs/agents-settings/sections/content/ProviderCliVersion';
import { api } from '@/shared/api';
import { Badge, Button, LLMProviderLogo } from '@/shared/ui';
import type {
  AgentProvider,
  ProviderAuthStatus,
  ProviderAuthSubscriptionOverride,
  ProviderModelQuotaItem,
  ProviderQuotaData,
} from '@/shared/types';

type AccountContentProps = {
  agent: AgentProvider;
  authStatus: ProviderAuthStatus;
  onLogin: () => void;
};

type AgentVisualConfig = {
  name: string;
  bgClass: string;
  borderClass: string;
  textClass: string;
  subtextClass: string;
  buttonClass: string;
  description?: string;
};

type ModelFilterCategory = 'all' | 'claude' | 'gemini3' | 'gemini2' | 'other';

const agentConfig: Record<AgentProvider, AgentVisualConfig> = {
  claude: {
    name: 'Claude',
    bgClass: 'bg-blue-50 dark:bg-blue-900/20',
    borderClass: 'border-blue-200 dark:border-blue-800',
    textClass: 'text-blue-900 dark:text-blue-100',
    subtextClass: 'text-blue-700 dark:text-blue-300',
    buttonClass: 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800',
  },
  cursor: {
    name: 'Cursor',
    bgClass: 'bg-purple-50 dark:bg-purple-900/20',
    borderClass: 'border-purple-200 dark:border-purple-800',
    textClass: 'text-purple-900 dark:text-purple-100',
    subtextClass: 'text-purple-700 dark:text-purple-300',
    buttonClass: 'bg-purple-600 hover:bg-purple-700 active:bg-purple-800',
  },
  codex: {
    name: 'Codex',
    bgClass: 'bg-muted/50',
    borderClass: 'border-gray-300 dark:border-gray-600',
    textClass: 'text-gray-900 dark:text-gray-100',
    subtextClass: 'text-gray-700 dark:text-gray-300',
    buttonClass: 'bg-gray-800 hover:bg-gray-900 active:bg-gray-950 dark:bg-gray-700 dark:hover:bg-gray-600 dark:active:bg-gray-500',
  },
  opencode: {
    name: 'OpenCode',
    description: 'OpenCode CLI assistant',
    bgClass: 'bg-zinc-50 dark:bg-zinc-900/20',
    borderClass: 'border-zinc-200 dark:border-zinc-700',
    textClass: 'text-zinc-900 dark:text-zinc-100',
    subtextClass: 'text-zinc-700 dark:text-zinc-300',
    buttonClass: 'bg-zinc-900 hover:bg-zinc-800 active:bg-zinc-950 dark:bg-zinc-700 dark:hover:bg-zinc-600',
  },
  agy: {
    name: 'Antigravity',
    description: 'Antigravity CLI agent',
    bgClass: 'bg-emerald-50 dark:bg-emerald-900/20',
    borderClass: 'border-emerald-200 dark:border-emerald-700',
    textClass: 'text-emerald-900 dark:text-emerald-100',
    subtextClass: 'text-emerald-700 dark:text-emerald-300',
    buttonClass: 'bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 dark:bg-emerald-600 dark:hover:bg-emerald-500',
  },
};

type SubscriptionOverrideNoticeProps = {
  override: ProviderAuthSubscriptionOverride;
};

// Issue #568: Claude Code prefers ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN over
// the `claude /login` subscription and says nothing about it, so a subscriber
// who also has a key in the server env is billed pay-as-you-go without knowing.
function SubscriptionOverrideNotice({ override }: SubscriptionOverrideNoticeProps) {
  const { t } = useTranslation('settings');
  const source = t(`agents.subscriptionOverride.source.${override.source}`);
  const description = override.subscriptionEmail
    ? t('agents.subscriptionOverride.descriptionWithEmail', {
      variable: override.variable,
      source,
      email: override.subscriptionEmail,
    })
    : t('agents.subscriptionOverride.description', { variable: override.variable, source });

  return (
    <div
      role="alert"
      data-testid="provider-auth-subscription-override"
      className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/30"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="space-y-1 text-sm text-amber-900 dark:text-amber-100">
          <div className="font-medium">{t('agents.subscriptionOverride.title')}</div>
          <p>{description}</p>
          <p>{t(`agents.subscriptionOverride.fix.${override.source}`, { variable: override.variable })}</p>
        </div>
      </div>
    </div>
  );
}

function getQuotaColorClass(percentage: number): {
  bar: string;
  text: string;
} {
  if (percentage >= 80) {
    return {
      bar: 'bg-emerald-500',
      text: 'text-emerald-600 dark:text-emerald-400',
    };
  }
  if (percentage >= 40) {
    return {
      bar: 'bg-amber-500',
      text: 'text-amber-600 dark:text-amber-400',
    };
  }
  return {
    bar: 'bg-rose-500',
    text: 'text-rose-600 dark:text-rose-400',
  };
}

/** Rendered by AgentCategoryContentSection for the "account" category to show sign-in state for one provider. */
export default function AccountContent({ agent, authStatus, onLogin }: AccountContentProps) {
  const { t } = useTranslation('settings');
  const config = agentConfig[agent];

  const [isRefreshingQuota, setIsRefreshingQuota] = useState(false);
  const [currentQuota, setCurrentQuota] = useState<ProviderQuotaData | null>(authStatus.quota ?? null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<ModelFilterCategory>('all');

  useEffect(() => {
    if (authStatus.quota) {
      setCurrentQuota(authStatus.quota);
    }
  }, [authStatus.quota]);

  const handleRefreshQuota = async () => {
    if (!api?.providers?.quota) return;
    setIsRefreshingQuota(true);
    try {
      const response = await api.providers.quota(agent, true);
      if (response.ok) {
        const payload = await response.json();
        if (payload?.data) {
          setCurrentQuota(payload.data as ProviderQuotaData);
        }
      }
    } catch (err) {
      console.error(`Failed to refresh quota for ${agent}:`, err);
    } finally {
      setIsRefreshingQuota(false);
    }
  };

  const accountDetails = authStatus.accountDetails;

  const filteredModels = useMemo<ProviderModelQuotaItem[]>(() => {
    if (!currentQuota?.models) return [];
    return currentQuota.models.filter((m) => {
      const lowerName = (m.name || '').toLowerCase();
      const lowerDisplay = (m.displayName || '').toLowerCase();

      if (activeCategory === 'claude') {
        if (!lowerName.includes('claude') && !lowerDisplay.includes('claude')) return false;
      } else if (activeCategory === 'gemini3') {
        if (!lowerName.includes('gemini-3') && !lowerDisplay.includes('gemini 3')) return false;
      } else if (activeCategory === 'gemini2') {
        if (!lowerName.includes('gemini-2') && !lowerDisplay.includes('gemini 2')) return false;
      } else if (activeCategory === 'other') {
        if (
          lowerName.includes('claude') ||
          lowerDisplay.includes('claude') ||
          lowerName.includes('gemini-3') ||
          lowerDisplay.includes('gemini 3') ||
          lowerName.includes('gemini-2') ||
          lowerDisplay.includes('gemini 2')
        ) {
          return false;
        }
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        return lowerName.includes(q) || lowerDisplay.includes(q);
      }
      return true;
    });
  }, [currentQuota?.models, activeCategory, searchQuery]);

  return (
    <div className="space-y-6">
      <div className="mb-4 flex items-center gap-3">
        <LLMProviderLogo provider={agent} className="h-6 w-6" />
        <div>
          <h3 className="text-lg font-medium text-foreground">{config.name}</h3>
          <p className="text-sm text-muted-foreground">
            {t(`agents.account.${agent}.description`, {
              defaultValue: config.description || `${config.name} CLI assistant`,
            })}
          </p>
        </div>
      </div>

      <div className={`${config.bgClass} border ${config.borderClass} rounded-lg p-4`}>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className={`font-medium ${config.textClass}`}>
                {t('agents.connectionStatus')}
              </div>
              <div className={`text-sm ${config.subtextClass}`}>
                {authStatus.loading ? (
                  t('agents.authStatus.checkingAuth')
                ) : authStatus.authenticated ? (
                  t('agents.authStatus.loggedInAs', {
                    email: authStatus.email || t('agents.authStatus.authenticatedUser'),
                  })
                ) : (
                  t('agents.authStatus.notConnected')
                )}
              </div>
            </div>
            <div>
              {authStatus.loading ? (
                <Badge variant="secondary" className="bg-muted">
                  {t('agents.authStatus.checking')}
                </Badge>
              ) : authStatus.authenticated ? (
                <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                  {t('agents.authStatus.connected')}
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300">
                  {t('agents.authStatus.disconnected')}
                </Badge>
              )}
            </div>
          </div>

          {!authStatus.loading && authStatus.subscriptionOverride && (
            <SubscriptionOverrideNotice override={authStatus.subscriptionOverride} />
          )}
          <ProviderCliVersion
            key={agent}
            agent={agent}
            installedVersion={authStatus.installedVersion ?? null}
            textClass={config.textClass}
            subtextClass={config.subtextClass}
          />

          {authStatus.method !== 'api_key' ? (
            <div className="border-t border-border/50 pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className={`font-medium ${config.textClass}`}>
                    {authStatus.authenticated ? t('agents.login.reAuthenticate') : t('agents.login.title')}
                  </div>
                  <div className={`text-sm ${config.subtextClass}`}>
                    {authStatus.authenticated
                      ? t('agents.login.reAuthDescription')
                      : t('agents.login.description', { agent: config.name })}
                  </div>
                </div>
                <Button
                  onClick={onLogin}
                  className={`${config.buttonClass} text-white`}
                  size="sm"
                >
                  <LogIn className="mr-2 h-4 w-4" />
                  {authStatus.authenticated ? t('agents.login.reLoginButton') : t('agents.login.button')}
                </Button>
              </div>
            </div>
          ) : authStatus.authenticated && (
            <div className="border-t border-border/50 pt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                {t('agents.accountDetails.apiKeyActive')}
              </span>
            </div>
          )}

          {authStatus.error && (
            <div className="border-t border-border/50 pt-4">
              <div className="text-sm text-red-600 dark:text-red-400">
                {t('agents.error', { error: authStatus.error })}
              </div>
            </div>
          )}
        </div>
      </div>

      {accountDetails && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-primary" />
              <h4 className="text-sm font-semibold text-foreground">
                {t('agents.accountDetails.title')}
              </h4>
            </div>
            {authStatus.authenticated && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                {t('agents.accountDetails.accountActive')}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {accountDetails.authType && (
              <div className="flex flex-col gap-1 rounded bg-muted/40 p-2.5">
                <span className="text-muted-foreground">{t('agents.accountDetails.authType')}</span>
                <span className="font-medium text-foreground">{accountDetails.authType}</span>
              </div>
            )}
            {accountDetails.accountName && (
              <div className="flex flex-col gap-1 rounded bg-muted/40 p-2.5">
                <span className="text-muted-foreground">{t('agents.accountDetails.accountName')}</span>
                <span className="font-medium text-foreground font-mono">{accountDetails.accountName}</span>
              </div>
            )}
            {accountDetails.email && (
              <div className="flex flex-col gap-1 rounded bg-muted/40 p-2.5">
                <span className="text-muted-foreground">{t('agents.accountDetails.email')}</span>
                <span className="font-medium text-foreground">{accountDetails.email}</span>
              </div>
            )}
            {accountDetails.installPath && (
              <div className="flex flex-col gap-1 rounded bg-muted/40 p-2.5">
                <span className="text-muted-foreground">{t('agents.accountDetails.installPath')}</span>
                <span className="font-medium text-foreground font-mono">{accountDetails.installPath}</span>
              </div>
            )}
            {accountDetails.subscriptionTier && (
              <div className="flex flex-col gap-1 rounded bg-muted/40 p-2.5">
                <span className="text-muted-foreground">{t('agents.accountDetails.subscriptionTier')}</span>
                <span className="font-medium text-foreground font-mono">{accountDetails.subscriptionTier}</span>
              </div>
            )}
            {accountDetails.projectId && (
              <div className="flex flex-col gap-1 rounded bg-muted/40 p-2.5">
                <span className="text-muted-foreground">{t('agents.accountDetails.projectId')}</span>
                <span className="font-medium text-foreground font-mono">{accountDetails.projectId}</span>
              </div>
            )}
            {accountDetails.defaultModel && (
              <div className="flex flex-col gap-1 rounded bg-muted/40 p-2.5">
                <span className="text-muted-foreground">{t('agents.accountDetails.defaultModel')}</span>
                <span className="font-medium text-foreground font-mono">{accountDetails.defaultModel}</span>
              </div>
            )}
            {accountDetails.baseUrl && (
              <div className="flex flex-col gap-1 rounded bg-muted/40 p-2.5 md:col-span-2">
                <span className="text-muted-foreground">{t('agents.accountDetails.baseUrl')}</span>
                <span className="font-medium text-foreground font-mono break-all">{accountDetails.baseUrl}</span>
              </div>
            )}
            {accountDetails.keyMasked && (
              <div className="flex flex-col gap-1 rounded bg-muted/40 p-2.5 md:col-span-2">
                <span className="text-muted-foreground">{t('agents.accountDetails.apiKey')}</span>
                <span className="font-medium text-foreground font-mono">{accountDetails.keyMasked}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {(currentQuota || agent === 'agy') && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <Coins className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <h4 className="text-sm font-semibold text-foreground">
                  {t('agents.quota.title')}
                </h4>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('agents.quota.subtitle')}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {currentQuota?.totalModels !== undefined && (
                <Badge variant="outline" className="text-xs">
                  {t('agents.quota.totalModels', { count: currentQuota.totalModels })}
                </Badge>
              )}
              {currentQuota?.averagePercentage !== undefined && (
                <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-xs">
                  {t('agents.quota.averageQuota', { percent: currentQuota.averagePercentage })}
                </Badge>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefreshQuota}
                disabled={isRefreshingQuota}
                className="h-7 text-xs px-2.5 gap-1.5"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isRefreshingQuota ? 'animate-spin' : ''}`} />
                {isRefreshingQuota ? t('agents.quota.refreshing') : t('agents.quota.refresh')}
              </Button>
            </div>
          </div>

          {currentQuota?.models && currentQuota.models.length > 0 ? (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t('agents.quota.searchPlaceholder')}
                    className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    variant={activeCategory === 'all' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setActiveCategory('all')}
                    className="h-7 text-xs px-2.5"
                  >
                    {t('agents.quota.filterAll', { count: currentQuota.models.length })}
                  </Button>
                  <Button
                    variant={activeCategory === 'claude' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setActiveCategory('claude')}
                    className="h-7 text-xs px-2.5"
                  >
                    {t('agents.quota.filterClaude')}
                  </Button>
                  <Button
                    variant={activeCategory === 'gemini3' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setActiveCategory('gemini3')}
                    className="h-7 text-xs px-2.5"
                  >
                    {t('agents.quota.filterGemini3')}
                  </Button>
                  <Button
                    variant={activeCategory === 'gemini2' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setActiveCategory('gemini2')}
                    className="h-7 text-xs px-2.5"
                  >
                    {t('agents.quota.filterGemini2')}
                  </Button>
                  <Button
                    variant={activeCategory === 'other' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setActiveCategory('other')}
                    className="h-7 text-xs px-2.5"
                  >
                    {t('agents.quota.filterOther')}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredModels.map((model) => {
                  const colors = getQuotaColorClass(model.percentage);
                  return (
                    <div
                      key={model.name}
                      className="flex flex-col justify-between rounded-lg border border-border/80 bg-background/50 p-3 hover:border-border transition-colors space-y-2.5"
                    >
                      <div className="space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <h5 className="text-xs font-semibold text-foreground leading-snug line-clamp-1" title={model.displayName}>
                            {model.displayName}
                          </h5>
                          <span className={`text-xs font-bold font-mono ${colors.text}`}>
                            {model.percentage}%
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-muted-foreground truncate" title={model.name}>
                          {model.name}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1">
                        {model.recommended && (
                          <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400 border border-amber-500/20">
                            <Sparkles className="h-2.5 w-2.5" />
                            {t('agents.quota.tagRecommended')}
                          </span>
                        )}
                        {model.supportsThinking && (
                          <span className="inline-flex items-center gap-1 rounded bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:text-purple-300 border border-purple-500/20">
                            <Brain className="h-2.5 w-2.5" />
                            {t('agents.quota.tagThinking')}
                          </span>
                        )}
                        {model.supportsImages && (
                          <span className="inline-flex items-center gap-1 rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-300 border border-blue-500/20">
                            <Image className="h-2.5 w-2.5" />
                            {t('agents.quota.tagImages')}
                          </span>
                        )}
                      </div>

                      <div className="space-y-1 pt-1">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full ${colors.bar} transition-all duration-300`}
                            style={{ width: `${Math.min(100, Math.max(0, model.percentage))}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <span>{t('agents.quota.remainingQuota')}</span>
                          <span>
                            {model.resetTimeFormatted
                              ? t('agents.quota.resetTime', { time: model.resetTimeFormatted })
                              : t('agents.quota.resetFull')}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {filteredModels.length === 0 && (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  {t('common.noResults', { defaultValue: 'No models found' })}
                </div>
              )}

              {currentQuota.fetchedAt && (
                <div className="text-[11px] text-muted-foreground text-right pt-1">
                  {t('agents.quota.lastUpdated', {
                    time: new Date(currentQuota.fetchedAt).toLocaleString(),
                  })}
                </div>
              )}
            </div>
          ) : currentQuota ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                <div className="flex flex-col gap-1 rounded bg-muted/40 p-2.5">
                  <span className="text-muted-foreground">{t('agents.quota.status')}</span>
                  <div>
                    {currentQuota.unlimited ? (
                      <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 font-medium">
                        {t('agents.quota.unlimited')}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 font-medium">
                        {t('agents.quota.limited')}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-1 rounded bg-muted/40 p-2.5">
                  <span className="text-muted-foreground">{t('agents.quota.totalUsed')}</span>
                  <div className="font-semibold text-foreground">
                    {currentQuota.totalUsedUsd || '$0.00 USD'}
                    {currentQuota.totalUsed !== undefined && (
                      <span className="ml-1 text-[11px] font-normal text-muted-foreground font-mono">
                        ({currentQuota.totalUsed.toLocaleString()})
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-1 rounded bg-muted/40 p-2.5">
                  <span className="text-muted-foreground">{t('agents.quota.expiresAt')}</span>
                  <span className="font-medium text-foreground">
                    {currentQuota.expiresAtFormatted || t('agents.quota.neverExpires')}
                  </span>
                </div>

                <div className="flex flex-col gap-1 rounded bg-muted/40 p-2.5 sm:col-span-2 md:col-span-3">
                  <span className="text-muted-foreground">{t('agents.quota.modelPermissions')}</span>
                  <span className="font-medium text-foreground">
                    {currentQuota.modelLimitsEnabled && currentQuota.allowedModels && currentQuota.allowedModels.length > 0
                      ? currentQuota.allowedModels.join(', ')
                      : t('agents.quota.allModels')}
                  </span>
                </div>
              </div>

              {currentQuota.fetchedAt && (
                <div className="text-[11px] text-muted-foreground text-right">
                  {t('agents.quota.lastUpdated', {
                    time: new Date(currentQuota.fetchedAt).toLocaleString(),
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground py-2">
              {t('agents.quota.unavailable')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
