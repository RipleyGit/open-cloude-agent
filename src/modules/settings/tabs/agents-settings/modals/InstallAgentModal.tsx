import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, Download, ExternalLink, Loader2, Plus, Sparkles, X } from 'lucide-react';
import { api } from '@/shared/api.js';
import { Button, Input, LLMProviderLogo } from '@/shared/ui';

export type RecommendedAgentPlugin = {
  id: string;
  name: string;
  providerId: string;
  repoUrl: string;
  description: string;
  icon?: string;
  author?: string;
  version?: string;
  defaultModel?: string;
};

type InstallAgentModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onInstall: (url: string) => Promise<{ success: boolean; error?: string; providerId?: string }>;
  onInstalledSuccess: (providerId?: string) => void;
  installedRepoUrls: string[];
};

const DEFAULT_AGENT_RECOMMENDATIONS: RecommendedAgentPlugin[] = [
  {
    id: 'cloude-agent-agycli',
    name: 'Antigravity CLI',
    providerId: 'agy',
    repoUrl: 'https://github.com/RipleyGit/cloude-agent-agycli.git',
    description: '本地 Antigravity CLI (agy) 执行驱动与 Agent Provider，支持 Gemini 2.5/3.8 模型调度与双向会话同步',
    author: 'Ripley',
    version: '1.0.0',
  },
];

export default function InstallAgentModal({
  isOpen,
  onClose,
  onInstall,
  onInstalledSuccess,
  installedRepoUrls,
}: InstallAgentModalProps) {
  const [gitUrl, setGitUrl] = useState('');
  const [isInstalling, setIsInstalling] = useState(false);
  const [installingUrl, setInstallingUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendedAgentPlugin[]>(DEFAULT_AGENT_RECOMMENDATIONS);
  const [isLoadingRecs, setIsLoadingRecs] = useState(false);

  // Load dynamic recommendations from cloude-agent-plugins registry
  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;
    setIsLoadingRecs(true);
    const promise = api.agentPlugins?.recommended?.();
    if (promise && typeof promise.then === 'function') {
      promise
        .then((res: any) => {
          if (!mounted) return;
          const plugins = res?.data || res?.plugins || res;
          if (Array.isArray(plugins) && plugins.length > 0) {
            setRecommendations(plugins);
          }
        })
        .catch(() => {
          // Fallback to default recommendations
        })
        .finally(() => {
          if (mounted) setIsLoadingRecs(false);
        });
    } else {
      setIsLoadingRecs(false);
    }

    return () => {
      mounted = false;
    };
  }, [isOpen]);

  // Close on Escape without bubbling to Settings modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (!isInstalling) {
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen, isInstalling, onClose]);

  if (!isOpen) return null;

  const handleInstallUrl = async (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError('请输入 Git 仓库地址');
      return;
    }
    if (!trimmed.startsWith('https://') && !trimmed.startsWith('git@')) {
      setError('Git 仓库地址必须以 https:// 或 git@ 开头');
      return;
    }

    setError(null);
    setIsInstalling(true);
    setInstallingUrl(trimmed);
    try {
      const res = await onInstall(trimmed);
      if (res.success) {
        setGitUrl('');
        onInstalledSuccess(res.providerId);
        onClose();
      } else {
        setError(res.error || '安装 Agent 插件失败');
      }
    } catch (err: any) {
      setError(err.message || '安装过程中发生异常');
    } finally {
      setIsInstalling(false);
      setInstallingUrl(null);
    }
  };

  const isRepoInstalled = (targetUrl: string) => {
    const clean = targetUrl.toLowerCase().replace(/\.git$/, '').replace(/\/$/, '');
    const repoBase = clean.split('/').pop() || '';
    return installedRepoUrls.some((u) => {
      const uClean = u.toLowerCase().replace(/\.git$/, '').replace(/\/$/, '');
      const uBase = uClean.split('/').pop() || '';
      return uClean === clean || uBase === repoBase;
    });
  };

  return createPortal(
    <div
      data-escape-layer
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isInstalling) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-xl rounded-xl border border-border bg-background text-foreground shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Plus className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">安装 Agent 插件</h3>
              <p className="text-[11px] text-muted-foreground">独立 Provider 模式架构，与主界面 LLM 深度集成</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isInstalling}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Agent 插件是独立的 AI Coding Provider（例如 Antigravity CLI <code className="font-mono font-medium">agy</code>），安装后系统将根据该 Agent 插件进行会话创建、调度执行与模型选择。支持从官方插件集合仓库一键安装，或直接输入任意 GitHub 仓库地址。普通 UI 扩展请在“设置 - 插件”中安装。
          </p>

          {error && (
            <div className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex-1 leading-relaxed">{error}</div>
            </div>
          )}

          {/* Direct Git Repository Form */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-foreground">输入 GitHub 仓库地址安装</label>
            <div className="flex gap-2">
              <Input
                placeholder="https://github.com/.../cloude-agent-agycli.git"
                value={gitUrl}
                onChange={(e) => {
                  setGitUrl(e.target.value);
                  if (error) setError(null);
                }}
                disabled={isInstalling}
                className="font-mono text-xs"
              />
              <Button
                type="button"
                onClick={() => handleInstallUrl(gitUrl)}
                disabled={isInstalling || !gitUrl.trim()}
                className="shrink-0 gap-1.5"
              >
                {isInstalling && installingUrl === gitUrl.trim() ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                <span>{isInstalling && installingUrl === gitUrl.trim() ? '安装中...' : '安装'}</span>
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              支持 HTTPS（<code>https://github.com/owner/repo.git</code>）与 SSH（<code>git@github.com:...</code>）格式。
            </p>
          </div>

          {/* Recommendations from cloude-agent-plugins */}
          <div className="space-y-2.5 pt-2 border-t border-border/60">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span>推荐 Agent 插件</span>
                {isLoadingRecs && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              </div>
              <a
                href="https://github.com/RipleyGit/cloude-agent-plugins"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                <span>官方集合仓库 (cloude-agent-plugins)</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            <div className="space-y-2">
              {recommendations.map((rec) => {
                const isInstalled = isRepoInstalled(rec.repoUrl);
                const isThisInstalling = isInstalling && installingUrl === rec.repoUrl;

                return (
                  <div
                    key={rec.repoUrl || rec.id}
                    className="flex flex-col gap-2 rounded-xl border border-border/70 bg-muted/20 p-3.5 sm:flex-row sm:items-center sm:justify-between transition-colors hover:border-border"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-background p-1.5 shadow-sm">
                        <LLMProviderLogo provider={rec.providerId} className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-foreground">{rec.name}</span>
                          <span className="font-mono text-[11px] rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                            {rec.providerId}
                          </span>
                          {rec.version && (
                            <span className="text-[10px] text-muted-foreground">v{rec.version}</span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground leading-normal">{rec.description}</p>
                      </div>
                    </div>

                    <div className="sm:self-center shrink-0">
                      {isInstalled ? (
                        <div className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>已安装</span>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => handleInstallUrl(rec.repoUrl)}
                          disabled={isInstalling}
                          className="h-8 gap-1.5 text-xs"
                        >
                          {isThisInstalling ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Download className="h-3.5 w-3.5" />
                          )}
                          <span>一键安装</span>
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
