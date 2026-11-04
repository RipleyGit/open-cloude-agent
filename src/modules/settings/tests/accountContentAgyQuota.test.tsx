import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

import '@/modules/i18n';
import AccountContent from '@/modules/settings/tabs/agents-settings/sections/content/AccountContent';
import type { ProviderAuthStatus } from '@/shared/types';

vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: {
      providers: {
        cliStatus: () => new Promise<Response>(() => {}),
        quota: () => Promise.resolve(new Response(JSON.stringify({ success: true, data: null }))),
      },
    },
  };
});

describe('AccountContent with Antigravity account and quota details', () => {
  it('renders Antigravity local login account and per-model quota cards', () => {
    const authStatus: ProviderAuthStatus = {
      authenticated: true,
      email: 'ripleyjmail@gmail.com',
      method: 'oauth',
      error: null,
      loading: false,
      accountDetails: {
        authType: 'oauth',
        accountName: 'Watt Yu',
        email: 'ripleyjmail@gmail.com',
        installPath: '~/.antigravity',
        subscriptionTier: 'g1-pro-tier',
        projectId: 'fiery-radar-vfg2z',
      },
      quota: {
        totalModels: 29,
        averagePercentage: 100,
        subscriptionTier: 'g1-pro-tier',
        models: [
          {
            name: 'claude-sonnet-4-6-thinking',
            displayName: 'Claude Sonnet 4.6 (Thinking)',
            percentage: 100,
            resetTime: '2026-09-25T16:11:54Z',
            resetTimeFormatted: '2026-09-25 16:11',
            supportsThinking: true,
            supportsImages: true,
            recommended: true,
          },
          {
            name: 'gemini-3.1-pro-high',
            displayName: 'Gemini 3.1 Pro (High)',
            percentage: 100,
            resetTime: null,
            resetTimeFormatted: null,
            supportsThinking: true,
            supportsImages: true,
            recommended: true,
          },
        ],
        fetchedAt: '2026-11-04T10:00:00.000Z',
      },
    };

    render(<AccountContent agent="agy" authStatus={authStatus} onLogin={() => {}} />);

    // Connection status
    expect(screen.getByText('Connection Status')).toBeDefined();
    expect(screen.getByText('Logged in as ripleyjmail@gmail.com')).toBeDefined();

    // Model quota section
    expect(screen.getByText('Supported Models & Usage Quota')).toBeDefined();
    expect(screen.getByText('29 supported models')).toBeDefined();
    expect(screen.getByText('Claude Sonnet 4.6 (Thinking)')).toBeDefined();
    expect(screen.getByText('claude-sonnet-4-6-thinking')).toBeDefined();
    expect(screen.getByText('Gemini 3.1 Pro (High)')).toBeDefined();
    expect(screen.getByText('gemini-3.1-pro-high')).toBeDefined();
  });

  it('renders fallback gateway quota when per-model list is not present', () => {
    const authStatus: ProviderAuthStatus = {
      authenticated: true,
      email: 'bolshevik',
      method: 'api_key',
      error: null,
      loading: false,
      quota: {
        unlimited: true,
        accountName: 'bolshevik',
        totalGranted: 0,
        totalUsed: 16053413732,
        totalAvailable: -16053413732,
        totalUsedUsd: '$32,106.83 USD',
        totalAvailableUsd: 'Unlimited',
        expiresAt: 0,
        expiresAtFormatted: 'Never Expires (Permanent)',
        modelLimitsEnabled: false,
        allowedModels: [],
        fetchedAt: '2026-11-04T10:00:00.000Z',
      },
    };

    render(<AccountContent agent="agy" authStatus={authStatus} onLogin={() => {}} />);

    // Connection status
    expect(screen.getByText('Connection Status')).toBeDefined();
    expect(screen.getByText('Logged in as bolshevik')).toBeDefined();

    // Gateway quota section
    expect(screen.getByText('Supported Models & Usage Quota')).toBeDefined();
    expect(screen.getByText('Unlimited Quota')).toBeDefined();
    expect(screen.getByText('$32,106.83 USD')).toBeDefined();
  });

  it('does not render quota section for other agents even if quota data is present', () => {
    const authStatusWithQuota: ProviderAuthStatus = {
      authenticated: true,
      email: 'test@example.com',
      method: 'cli',
      error: null,
      loading: false,
      quota: {
        totalModels: 5,
        averagePercentage: 80,
        models: [],
        fetchedAt: '2026-11-04T10:00:00.000Z',
      },
    };

    const { rerender } = render(
      <AccountContent agent="cursor" authStatus={authStatusWithQuota} onLogin={() => {}} />
    );
    expect(screen.queryByText('Supported Models & Usage Quota')).toBeNull();

    rerender(<AccountContent agent="opencode" authStatus={authStatusWithQuota} onLogin={() => {}} />);
    expect(screen.queryByText('Supported Models & Usage Quota')).toBeNull();

    rerender(<AccountContent agent="claude" authStatus={authStatusWithQuota} onLogin={() => {}} />);
    expect(screen.queryByText('Supported Models & Usage Quota')).toBeNull();
  });
});
