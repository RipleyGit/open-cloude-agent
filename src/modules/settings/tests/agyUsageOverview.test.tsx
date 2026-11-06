import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '@/modules/i18n';
import AgyUsageOverview from '@/modules/settings/tabs/agents-settings/sections/content/AgyUsageOverview';
import type { ProviderModelQuotaItem, ProviderQuotaData } from '@/shared/types';

/**
 * The overview summarises the same quota payload AccountContent renders below
 * it: account/plan, an estimated weekly figure, a live countdown to the next
 * reset, and the plan's refresh rules.
 */

function model(overrides: Partial<ProviderModelQuotaItem> & { name: string }): ProviderModelQuotaItem {
  return {
    displayName: overrides.name,
    percentage: 100,
    resetTime: null,
    resetTimeFormatted: null,
    supportsThinking: false,
    supportsImages: false,
    recommended: false,
    ...overrides,
  };
}

function buildQuota(overrides: Partial<ProviderQuotaData> = {}): ProviderQuotaData {
  // Add a 30s margin so the bucket is comfortably inside 138 minutes even if a
  // few milliseconds elapse between this snapshot and the component's own
  // `Date.now()` read at render — otherwise the countdown can floor to "2h 17m".
  const inTwoHoursEighteen = new Date(Date.now() + 2 * 60 * 60_000 + 18 * 60_000 + 30_000).toISOString();

  return {
    email: 'manus.demo@gmail.com',
    subscriptionTier: 'g1-pro-tier',
    totalModels: 3,
    averagePercentage: 32,
    models: [
      model({ name: 'gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', percentage: 70, resetTime: inTwoHoursEighteen, recommended: true }),
      model({ name: 'gemini-3.1-pro', displayName: 'Gemini 3.1 Pro', percentage: 40, resetTime: inTwoHoursEighteen }),
      model({ name: 'gemini-3.0-flash', displayName: 'Gemini 3.0 Flash', percentage: 75, resetTime: null }),
    ],
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('AgyUsageOverview', () => {
  it('renders the account, its plan badge and a normal status', () => {
    render(<AgyUsageOverview quota={buildQuota()} email="manus.demo@gmail.com" />);

    expect(screen.getByText('manus.demo@gmail.com')).toBeDefined();
    expect(screen.getByText('Google account · Connected')).toBeDefined();
    expect(screen.getByText('PRO')).toBeDefined();
    expect(screen.getByText('Google AI Pro')).toBeDefined();
    expect(screen.getByText('Normal')).toBeDefined();
  });

  it('shows the weekly usage as the inverted average remaining quota', () => {
    render(<AgyUsageOverview quota={buildQuota({ averagePercentage: 32 })} email="manus.demo@gmail.com" />);

    // 100 - 32 average remaining = 68% used, matching the reference layout.
    expect(screen.getByText('68%')).toBeDefined();
    expect(screen.getByText('used · estimated')).toBeDefined();
  });

  it('counts down to the next reset across the plan window', () => {
    render(<AgyUsageOverview quota={buildQuota()} email="manus.demo@gmail.com" />);

    expect(screen.getByText('Next base quota refresh')).toBeDefined();
    expect(screen.getByText(/In about 2h 1[78]m/)).toBeDefined();
    expect(screen.getByText('5-hour window')).toBeDefined();
  });

  it('lists the tightest model quotas first with a per-model countdown', () => {
    render(<AgyUsageOverview quota={buildQuota()} email="manus.demo@gmail.com" />);

    // 40% remaining sorts ahead of 70% and 75%.
    const names = screen.getAllByText(/^(Gemini 3\.1 Pro|Gemini 3\.8 Flash)$/).map((node) => node.textContent);
    expect(names).toEqual(['Gemini 3.1 Pro', 'Gemini 3.8 Flash']);
    expect(screen.getByText('40% left')).toBeDefined();
    // The countdown string is shared by the next-refresh card and each model
    // row whose reset time lands in the same window, so both occurrences count.
    expect(screen.getAllByText(/Refreshes in about 2h 1[78]m/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Full quota available')).toBeDefined();
  });

  it('marks the plan that owns the displayed refresh rules as current', () => {
    render(<AgyUsageOverview quota={buildQuota()} email="manus.demo@gmail.com" />);

    expect(screen.getByText('Pro: refreshes every 5 hours until the weekly rate limit is hit.')).toBeDefined();
    expect(screen.getByText('Free: base quota refreshes weekly.')).toBeDefined();
    expect(screen.getByText('Ultra: higher quota, refreshes every 5 hours, plus a higher weekly rate limit.')).toBeDefined();
  });

  it('resolves the Ultra plan and its 5-hour window from the subscription tier', () => {
    render(
      <AgyUsageOverview
        quota={buildQuota({ subscriptionTier: 'g1-ultra-tier' })}
        email="manus.demo@gmail.com"
      />,
    );

    expect(screen.getByText('ULTRA')).toBeDefined();
    expect(screen.getByText('Google AI Ultra')).toBeDefined();
    expect(screen.getByText('5-hour window')).toBeDefined();
    expect(screen.queryByText('Weekly window')).toBeNull();
  });

  it('prefers official weeklyUsedPercentage and nextResetTime when provided', () => {
    const inTwoHours = new Date(Date.now() + 2 * 60 * 60_000 + 30_000).toISOString();
    render(
      <AgyUsageOverview
        quota={buildQuota({
          averagePercentage: 90,
          weeklyUsedPercentage: 18,
          weeklyPercentage: 82,
          nextResetTime: inTwoHours,
        })}
        email="zolshevik@gmail.com"
      />,
    );

    expect(screen.getByText('18%')).toBeDefined();
    expect(screen.getByText('used · estimated')).toBeDefined();
  });
});
