import { useState } from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ExternalLink,
  GitBranch,
  Loader2,
  RefreshCw,
  Terminal,
  Trash2,
  Power,
  Layers,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { AgentPluginItem } from '@/shared/types';
import { Badge, Button, LLMProviderLogo } from '@/shared/ui';

type AgentPluginContentProps = {
  plugin: AgentPluginItem;
  onRefresh: () => Promise<void>;
  onUpdate: (name: string) => Promise<{ success: boolean; error?: string }>;
  onToggle: (name: string, enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  onUninstall: (name: string) => Promise<{ success: boolean; error?: string }>;
};

export default function AgentPluginContent({
  plugin,
  onRefresh,
  onUpdate,
  onToggle,
  onUninstall,
}: AgentPluginContentProps) {
  const { t } = useTranslation('settings');
  const [isUpdating, setIsUpdating] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const [isUninstalling, setIsUninstalling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [showConfirmUninstall, setShowConfirmUninstall] = useState(false);

  const handleUpdate = async () => {
    setActionError(null);
    setActionSuccess(null);
    setIsUpdating(true);
    try {
      const res = await onUpdate(plugin.name);
      if (res.success) {
        setActionSuccess('Agent 插件已成功更新到最新版本');
        await onRefresh();
      } else {
        setActionError(res.error || '更新失败');
      }
    } catch (err: any) {
      setActionError(err.message || '更新出错');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleToggle = async () => {
    setActionError(null);
    setActionSuccess(null);
    setIsToggling(true);
    try {
      const res = await onToggle(plugin.name, !plugin.enabled);
      if (res.success) {
        setActionSuccess(plugin.enabled ? 'Agent 插件已停用' : 'Agent 插件已启用');
        await onRefresh();
      } else {
        setActionError(res.error || '状态切换失败');
      }
    } catch (err: any) {
      setActionError(err.message || '操作出错');
    } finally {
      setIsToggling(false);
    }
  };

  const handleUninstall = async () => {
    setActionError(null);
    setActionSuccess(null);
    setIsUninstalling(true);
    try {
      const res = await onUninstall(plugin.name);
      if (res.success) {
        setShowConfirmUninstall(false);
      } else {
        setActionError(res.error || '卸载失败');
      }
    } catch (err: any) {
      setActionError(err.message || '卸载出错');
    } finally {
      setIsUninstalling(false);
    }
  };

  const isCliReady = plugin.cliStatus?.installed;

  return (
    <div className="space-y-6">
      {actionSuccess && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {actionError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Header Info Card */}
      <div className="rounded-xl border border-border bg-card p-4 md:p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border/80 bg-muted/60 p-2.5 shadow-sm">
              <LLMProviderLogo provider={plugin.providerId} className="h-7 w-7" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold text-foreground">{plugin.displayName}</h3>
                <Badge variant="outline" className="font-mono text-xs">
                  v{plugin.version}
                </Badge>
                {plugin.enabled ? (
                  <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
                    已启用
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground text-xs">
                    已停用
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{plugin.description || '自定义 Agent Provider 插件'}</p>
              {plugin.repoUrl && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <GitBranch className="h-3.5 w-3.5" />
                  <a
                    href={plugin.repoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                  >
                    <span>{plugin.repoUrl}</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:self-center">
            <Button
              variant="outline"
              size="sm"
              onClick={handleToggle}
              disabled={isToggling || isUpdating || isUninstalling}
              className="gap-1.5"
            >
              <Power className="h-3.5 w-3.5" />
              <span>{plugin.enabled ? '停用' : '启用'}</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleUpdate}
              disabled={isUpdating || isToggling || isUninstalling}
              className="gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isUpdating ? 'animate-spin' : ''}`} />
              <span>{isUpdating ? '更新中...' : '更新'}</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowConfirmUninstall(true)}
              disabled={isUninstalling || isUpdating || isToggling}
              className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>卸载</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Confirmation modal for uninstall */}
      {showConfirmUninstall && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 text-destructive shrink-0" />
            <div className="flex-1 space-y-2">
              <p className="font-medium text-foreground">确认卸载 Agent 插件 “{plugin.displayName}”？</p>
              <p className="text-muted-foreground text-xs">
                卸载将删除插件目录并从 Provider 列表中移除该 Agent。已保存的会话记录不会被删除。
              </p>
              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleUninstall}
                  disabled={isUninstalling}
                >
                  {isUninstalling ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  确认卸载
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowConfirmUninstall(false)}
                  disabled={isUninstalling}
                >
                  取消
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CLI & Runtime Status */}
      <div className="rounded-xl border border-border bg-card p-4 md:p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 font-medium text-foreground text-sm">
          <Terminal className="h-4 w-4 text-primary" />
          <span>CLI 运行环境与探针状态</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/30 p-3">
            <div className="space-y-0.5">
              <div className="text-xs text-muted-foreground">CLI 二进制名称</div>
              <div className="font-mono text-sm font-semibold">{plugin.cliName}</div>
            </div>
            {isCliReady ? (
              <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 gap-1 text-xs">
                <CheckCircle2 className="h-3 w-3" />
                已检测就绪
              </Badge>
            ) : (
              <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400 gap-1 text-xs">
                <AlertCircle className="h-3 w-3" />
                未在 PATH 中找到
              </Badge>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/30 p-3">
            <div className="space-y-0.5">
              <div className="text-xs text-muted-foreground">检测到的版本</div>
              <div className="font-mono text-sm font-semibold">
                {plugin.cliStatus?.version || (isCliReady ? '已安装' : '无')}
              </div>
            </div>
            {plugin.serverRunning && (
              <Badge variant="secondary" className="bg-blue-500/15 text-blue-600 dark:text-blue-400 text-xs">
                服务进程运行中
              </Badge>
            )}
          </div>
        </div>

        {!isCliReady && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
            提示：系统未在当前环境全局 PATH 中检测到命令 <code className="font-mono font-bold">{plugin.cliName}</code>。
            请确保该 Agent 的 CLI 工具已在宿主环境中安装并配置到环境变量 PATH 中。
          </div>
        )}
      </div>

      {/* Models List */}
      <div className="rounded-xl border border-border bg-card p-4 md:p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-medium text-foreground text-sm">
            <Layers className="h-4 w-4 text-primary" />
            <span>支持的模型 ({plugin.models.length})</span>
          </div>
          {plugin.defaultModel && (
            <span className="text-xs text-muted-foreground">
              默认模型: <span className="font-mono font-semibold text-foreground">{plugin.defaultModel}</span>
            </span>
          )}
        </div>

        {plugin.models.length > 0 ? (
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {plugin.models.map((model) => (
              <div
                key={model.value}
                className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/20 p-3 transition-colors hover:border-border"
              >
                <div className="min-w-0 pr-2">
                  <div className="truncate text-xs font-semibold text-foreground">{model.label}</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">{model.value}</div>
                </div>
                {model.value === plugin.defaultModel && (
                  <Badge variant="secondary" className="text-[10px] shrink-0 font-medium">
                    默认
                  </Badge>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">此 Agent 插件未声明独立模型列表，将使用默认模型。</div>
        )}
      </div>
    </div>
  );
}
