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

    // Account details
    expect(screen.getByText('Account & Environment Configuration')).toBeDefined();
    expect(screen.getByText('Watt Yu')).toBeDefined();
    expect(screen.getByText('ripleyjmail@gmail.com')).toBeDefined();
    expect(screen.getByText('~/.antigravity')).toBeDefined();
    expect(screen.getByText('g1-pro-tier')).toBeDefined();
    expect(screen.getByText('fiery-radar-vfg2z')).toBeDefined();

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
      email: 'bolshevik@example.com',
      method: 'api_key',
      error: null,
      loading: false,
      accountDetails: {
        authType: 'gemini-api-key',
        accountName: 'bolshevik',
        email: 'bolshevik@example.com',
        baseUrl: 'https://newapi.bleem.site',
        defaultModel: 'gemini-3.6-flash',
        keyMasked: 'sk-RVJ2••••••••••••uccJ',
      },
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

    expect(screen.getByText('Account & Environment Configuration')).toBeDefined();
    expect(screen.getByText('bolshevik')).toBeDefined();
    expect(screen.getByText('https://newapi.bleem.site')).toBeDefined();
    expect(screen.getByText('Unlimited Quota')).toBeDefined();
    expect(screen.getByText('$32,106.83 USD')).toBeDefined();
  });
});
