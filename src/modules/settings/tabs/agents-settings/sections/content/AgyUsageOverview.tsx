import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/shared/ui';
import type { ProviderModelQuotaItem, ProviderQuotaData } from '@/shared/types';
import { getQuotaColorClass } from '@/modules/settings/tabs/agents-settings/sections/content/AccountContent';

type AgyUsageOverviewProps = {
  quota: ProviderQuotaData;
  email: string | null;
};

/**
 * Antigravity plan, resolved from the `subscription_tier` the CLI writes into
 * the local account file (`g1-pro-tier`, `g1-ultra-tier`, …).
 */
type AgyPlanKey = 'free' | 'pro' | 'ultra';

/** Countdowns only need minute precision, so a 30s tick keeps them honest cheaply. */
const COUNTDOWN_TICK_MS = 30_000;

/** The overview lists the tightest quotas first; more live in the section below. */
const MAX_VISIBLE_MODELS = 6;

const MS_PER_MINUTE = 60_000;

function resolvePlanKey(subscriptionTier?: string | null): AgyPlanKey {
  const tier = (subscriptionTier ?? '').toLowerCase();
  if (tier.includes('ultra')) return 'ultra';
  if (tier.includes('free')) return 'free';
  // `g1-pro-tier` is what the CLI records for a Pro subscription, and the
  // backend already defaults a missing tier to Google AI Pro.
  return 'pro';
}

function formatCountdown(msRemaining: number, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (!Number.isFinite(msRemaining) || msRemaining <= 0) {
    return t('agents.quota.usage.duration.now');
  }

  const totalMinutes = Math.floor(msRemaining / MS_PER_MINUTE);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return t('agents.quota.usage.duration.daysHours', { days, hours });
  }
  if (hours > 0) {
    return t('agents.quota.usage.duration.hoursMinutes', { hours, minutes });
  }
  return t('agents.quota.usage.duration.minutes', { minutes });
}

/**
 * Rendered by settings' AccountContent above the per-model quota list when the
 * Antigravity agent is connected: an account, weekly-usage, next-refresh and
 * plan-policy summary of the same quota data the CLI `/usage` panel reports.
 */
export default function AgyUsageOverview({ quota, email }: AgyUsageOverviewProps) {
  const { t } = useTranslation('settings');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), COUNTDOWN_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const planKey = resolvePlanKey(quota.subscriptionTier);
  const planShort = planKey === 'ultra' ? 'ULTRA' : planKey === 'free' ? 'FREE' : 'PRO';
  const planFull = t(`agents.quota.usage.plans.${planKey}`);

  // The account file records only each model's remaining fraction, never an
  // absolute weekly total, so the weekly figure is the average remaining
  // inverted — an estimate, which the UI labels as one.
  const weeklyUsedPercent = Math.min(100, Math.max(0, 100 - (quota.averagePercentage ?? 100)));

  const nextResetAt = useMemo(() => {
    const times = (quota.models ?? [])
      .map((model) => (model.resetTime ? Date.parse(model.resetTime) : Number.NaN))
      .filter((time) => Number.isFinite(time));
    return times.length > 0 ? Math.min(...times) : null;
  }, [quota.models]);

  // Tightest quota first: the models closest to their limit are the ones worth
  // surfacing in a six-row overview.
  const visibleModels = useMemo<ProviderModelQuotaItem[]>(
    () => [...(quota.models ?? [])]
      .sort((a, b) => (
        a.percentage - b.percentage
        || Number(Boolean(b.recommended)) - Number(Boolean(a.recommended))
        || a.displayName.localeCompare(b.displayName)
      ))
      .slice(0, MAX_VISIBLE_MODELS),
    [quota.models],
  );

  const initial = (email || 'A').charAt(0).toUpperCase();

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-600/15 text-base font-semibold text-emerald-700 dark:text-emerald-300">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground" title={email ?? undefined}>
              {email ?? t('agents.authStatus.authenticatedUser')}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              {t('agents.quota.usage.account.connected')}
            </div>
          </div>
          <Badge variant="secondary" className="bg-emerald-100 text-[11px] font-bold tracking-wide text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            {planShort}
          </Badge>
        </div>

        <div className="mt-4 space-y-2 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">{t('agents.quota.usage.account.plan')}</span>
            <span className="font-medium text-foreground">{planFull}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">{t('agents.quota.usage.account.status')}</span>
            <span className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {t('agents.quota.usage.account.statusNormal')}
            </span>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="text-xs text-muted-foreground">{t('agents.quota.usage.weekly.title')}</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-mono text-3xl font-bold leading-none text-foreground">{weeklyUsedPercent}%</span>
          <span className="text-xs text-muted-foreground">{t('agents.quota.usage.weekly.estimated')}</span>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${weeklyUsedPercent}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <span>{t('agents.quota.usage.weekly.noteLeft')}</span>
          <span>{t('agents.quota.usage.weekly.noteRight')}</span>
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-600/10 text-emerald-700 dark:text-emerald-300">
          <RotateCw className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">{t('agents.quota.usage.refresh.title')}</div>
          <div className="text-sm font-semibold text-foreground">
            {nextResetAt === null
              ? t('agents.quota.usage.refresh.unknown')
              : t('agents.quota.usage.refresh.inDuration', {
                  duration: formatCountdown(nextResetAt - now, t),
                })}
          </div>
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {planKey === 'free'
            ? t('agents.quota.usage.refresh.windowWeekly')
            : t('agents.quota.usage.refresh.windowFiveHour')}
        </span>
      </div>

      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-foreground">{t('agents.quota.usage.models.title')}</h4>
          <span className="text-[11px] text-muted-foreground">{t('agents.quota.usage.models.note')}</span>
        </div>

        <div className="space-y-2.5">
          {visibleModels.map((model) => {
            const colors = getQuotaColorClass(model.percentage);
            const clamped = Math.min(100, Math.max(0, model.percentage));

            return (
              <div key={model.name} className="rounded-lg border border-border/80 bg-background/50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-xs font-semibold text-foreground" title={model.displayName}>
                    {model.displayName}
                  </span>
                  <span className={`shrink-0 font-mono text-xs font-bold ${colors.text}`}>
                    {t('agents.quota.usage.models.remaining', { percent: model.percentage })}
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className={`h-full ${colors.bar} transition-all duration-300`} style={{ width: `${clamped}%` }} />
                </div>
                <div className="mt-1.5 text-[11px] text-muted-foreground">
                  {model.resetTime
                    ? t('agents.quota.usage.models.refreshIn', {
                        duration: formatCountdown(Date.parse(model.resetTime) - now, t),
                      })
                    : t('agents.quota.usage.models.refreshFull')}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-muted/30 p-4">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-foreground">{t('agents.quota.usage.policy.title')}</h4>
          <span className="text-[11px] text-muted-foreground">{t('agents.quota.usage.policy.note')}</span>
        </div>
        <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground">
          {(['free', 'pro', 'ultra'] as const).map((key) => (
            <li key={key} className={key === planKey ? 'font-medium text-foreground' : undefined}>
              {t(`agents.quota.usage.policy.${key}`)}
            </li>
          ))}
        </ul>
      </div>

      <p className="px-2 text-center text-[11px] leading-relaxed text-muted-foreground/70">
        {t('agents.quota.usage.footer.note')}
      </p>
    </div>
  );
}
