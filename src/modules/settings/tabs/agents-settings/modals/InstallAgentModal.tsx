import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, Download, GitBranch, Loader2, Plus, Sparkles, X } from 'lucide-react';
import { Button, Input, LLMProviderLogo } from '@/shared/ui';

type InstallAgentModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onInstall: (url: string) => Promise<{ success: boolean; error?: string; providerId?: string }>;
  onInstalledSuccess: (providerId?: string) => void;
  installedRepoUrls: string[];
};

const AGENT_RECOMMENDATIONS = [
  {
    name: 'Google Antigravity (AGY)',
    providerId: 'agy',
    repoUrl: 'https://github.com/solshevik/cloudcli-plugin-agy.git',
    description: '本地 Google agy 执行驱动与控制面板，支持 Gemini 2.5/3.8 模型与双向会话同步',
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
  const [error, setError] = useState<string | null>(null);

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
    }
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
            <h3 className="text-base font-semibold text-foreground">安装 Agent 插件</h3>
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
            Agent 插件是独立的 AI Coding Provider（例如 Google Antigravity <code className="font-mono font-medium">agy</code>），安装后系统将根据该 Agent 插件进行会话创建、调度执行与模型选择。注意：此处仅安装 Agent 类型插件，普通 UI 扩展请在“设置 - 插件”中安装。
          </p>

          {error && (
            <div className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex-1 leading-relaxed">{error}</div>
            </div>
          )}

          {/* Form */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-foreground">Git 仓库地址</label>
            <div className="flex gap-2">
              <Input
                placeholder="https://github.com/.../cloudcli-plugin-agy.git"
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
                {isInstalling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                <span>{isInstalling ? '安装中...' : '安装'}</span>
              </Button>
            </div>
          </div>

          {/* Recommendations */}
          <div className="space-y-2.5 pt-2 border-t border-border/60">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span>推荐的 Agent 插件</span>
            </div>

            <div className="space-y-2">
              {AGENT_RECOMMENDATIONS.map((rec) => {
                const isInstalled = installedRepoUrls.some(
                  (url) => url.toLowerCase().replace(/\.git$/, '') === rec.repoUrl.toLowerCase().replace(/\.git$/, '')
                );

                return (
                  <div
                    key={rec.repoUrl}
                    className="flex flex-col gap-2 rounded-xl border border-border/70 bg-muted/20 p-3.5 sm:flex-row sm:items-center sm:justify-between transition-colors hover:border-border"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-background p-1.5 shadow-sm">
                        <LLMProviderLogo provider={rec.providerId} className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-foreground">{rec.name}</span>
                          <span className="font-mono text-[11px] text-muted-foreground">{rec.providerId}</span>
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
                          {isInstalling && gitUrl === rec.repoUrl ? (
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
