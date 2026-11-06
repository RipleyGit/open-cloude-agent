import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import '@/modules/i18n';
import CommandResultModal from '@/modules/chat/modals/CommandResultModal';
import { useProviderAuthStatus } from '@/modules/provider-auth';
import type {
  CostCommandData,
  ProviderAuthStatus,
  ProviderModelsDefinition,
} from '@/shared/types';

vi.mock('@/modules/provider-auth', () => ({
  useProviderAuthStatus: vi.fn(),
  ProviderLoginModal: () => <div data-testid="login-modal" />,
}));

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

const mockCatalog: Partial<Record<'agy' | 'claude', ProviderModelsDefinition>> = {
  agy: {
    OPTIONS: [
      { value: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash' },
      { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    ],
    DEFAULT: 'gemini-3.8-flash-high',
  },
  claude: {
    OPTIONS: [
      { value: 'claude-3-7-sonnet', label: 'Claude 3.7 Sonnet' },
    ],
    DEFAULT: 'claude-3-7-sonnet',
  },
};

const mockAgyAuthStatus: ProviderAuthStatus = {
  authenticated: true,
  email: 'zolshevik@gmail.com',
  method: 'oauth',
  error: null,
  loading: false,
  installedVersion: '1.4.12',
  accountDetails: {
    authType: 'oauth',
    accountName: 'zolshevik',
    email: 'zolshevik@gmail.com',
    installPath: '~/.antigravity',
    subscriptionTier: 'Google AI Pro',
    projectId: 'aicode-consumers',
  },
  quota: {
    email: 'zolshevik@gmail.com',
    subscriptionTier: 'Google AI Pro',
    averagePercentage: 82,
    weeklyUsedPercentage: 18,
    weeklyPercentage: 82,
    nextResetTime: '2026-11-06T14:21:21Z',
    fetchedAt: '2026-11-06T07:00:00.000Z',
    totalModels: 16,
    models: [
      {
        name: 'gemini-3.8-flash-high',
        displayName: 'Gemini 3.8 Flash',
        percentage: 85,
        resetTime: '2026-11-06T14:21:21Z',
        resetTimeFormatted: '2026-11-06 14:21',
        supportsThinking: true,
        supportsImages: true,
        recommended: true,
      },
      {
        name: 'claude-sonnet-4-6',
        displayName: 'Claude Sonnet 4.6',
        percentage: 90,
        resetTime: null,
        resetTimeFormatted: '全额可用',
        supportsThinking: true,
        supportsImages: true,
        recommended: false,
      },
    ],
  },
};

describe('CommandResultModal with agy cost/token usage', () => {
  const checkProviderAuthStatus = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useProviderAuthStatus).mockReturnValue({
      providerAuthStatus: {
        agy: mockAgyAuthStatus,
        claude: { authenticated: false, email: null, method: null, error: null, loading: false },
        cursor: { authenticated: false, email: null, method: null, error: null, loading: false },
        codex: { authenticated: false, email: null, method: null, error: null, loading: false },
        opencode: { authenticated: false, email: null, method: null, error: null, loading: false },
      },
      checkProviderAuthStatus,
      refreshProviderAuthStatuses: vi.fn(),
    });
  });

  it('renders Antigravity account info, weekly usage overview, and model quotas when activeProvider is agy', () => {
    const costData: CostCommandData = {
      tokenUsage: { used: 1250, total: 200000 },
      tokenBreakdown: { input: 1000, output: 250 },
      provider: 'agy',
      model: 'gemini-3.8-flash-high',
    };

    render(
      <CommandResultModal
        payload={{ kind: 'cost', data: costData }}
        onClose={vi.fn()}
        providerModelCatalog={mockCatalog}
        providerModelActions={{
          create: vi.fn(),
          update: vi.fn(),
          remove: vi.fn(),
          setCustomModelsOnly: vi.fn(),
        }}
        activeProvider="agy"
        activeProviderModel="gemini-3.8-flash-high"
        currentSessionId="session-1"
        onSelectProviderModel={vi.fn()}
      />,
    );

    // 1. Should trigger checkProviderAuthStatus for agy
    expect(checkProviderAuthStatus).toHaveBeenCalledWith('agy');

    // 2. Renders session token summary
    expect(screen.getByText('1.3K tokens')).toBeDefined();
    expect(screen.getByText('(1.0K in / 250 out)')).toBeDefined();

    // 3. Renders account connection details
    expect(screen.getAllByText('zolshevik@gmail.com').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('PRO')).toBeDefined();

    // 4. Renders weekly usage percentage
    expect(screen.getByText('18%')).toBeDefined();

    // 5. Renders model quota list
    expect(screen.getByText('Supported Models & Usage Quota')).toBeDefined();
    expect(screen.getAllByText('Gemini 3.8 Flash').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('gemini-3.8-flash-high').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Claude Sonnet 4.6').length).toBeGreaterThanOrEqual(1);
  });

  it('renders standard CostContent when activeProvider is claude', () => {
    const costData: CostCommandData = {
      tokenUsage: { used: 3400, total: 200000 },
      tokenBreakdown: { input: 3000, output: 400 },
      provider: 'claude',
      model: 'claude-3-7-sonnet',
    };

    render(
      <CommandResultModal
        payload={{ kind: 'cost', data: costData }}
        onClose={vi.fn()}
        providerModelCatalog={mockCatalog}
        providerModelActions={{
          create: vi.fn(),
          update: vi.fn(),
          remove: vi.fn(),
          setCustomModelsOnly: vi.fn(),
        }}
        activeProvider="claude"
        activeProviderModel="claude-3-7-sonnet"
        currentSessionId="session-1"
        onSelectProviderModel={vi.fn()}
      />,
    );

    // Should NOT call checkProviderAuthStatus for agy
    expect(checkProviderAuthStatus).not.toHaveBeenCalled();

    // Should render standard rows
    expect(screen.getByText('Total tokens used')).toBeDefined();
    expect(screen.getByText('3.4K')).toBeDefined();
    expect(screen.getByText('Input tokens')).toBeDefined();
    expect(screen.getByText('Output tokens')).toBeDefined();
    expect(screen.queryByText('Supported Models & Usage Quota')).toBeNull();
  });
});
