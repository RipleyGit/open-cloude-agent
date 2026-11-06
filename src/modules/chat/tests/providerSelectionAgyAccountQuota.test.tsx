import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import '@/modules/i18n';
import ProviderSelectionEmptyState from '@/modules/chat/transcript/ProviderSelectionEmptyState';
import { useProviderAuthStatus } from '@/modules/provider-auth';
import type { ProviderAuthStatus, ProviderModelsDefinition } from '@/shared/types';

vi.mock('@/modules/provider-auth', () => ({
  useProviderAuthStatus: vi.fn(),
  ProviderLoginModal: () => <div data-testid="login-modal" />,
}));

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

describe('ProviderSelectionEmptyState with Agy account info & quota', () => {
  const checkProviderAuthStatus = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderComponent = (provider: 'agy' | 'claude') => {
    const authStatus: ProviderAuthStatus = {
      authenticated: true,
      email: 'zolshevik@gmail.com',
      method: 'oauth',
      error: null,
      loading: false,
      installedVersion: '1.5.1',
      quota: {
        email: 'zolshevik@gmail.com',
        subscriptionTier: 'g1-pro-tier',
        averagePercentage: 53,
        weeklyUsedPercentage: 18,
        fetchedAt: '2026-11-04T10:00:00.000Z',
        models: [
          {
            name: 'gemini-3.8-flash-high',
            displayName: 'Gemini 3.8 Flash',
            percentage: 85,
            resetTime: null,
            resetTimeFormatted: null,
            supportsThinking: true,
            supportsImages: true,
            recommended: true,
          },
        ],
      },
    };

    vi.mocked(useProviderAuthStatus).mockReturnValue({
      providerAuthStatus: {
        agy: authStatus,
        claude: { authenticated: false, email: null, method: null, error: null, loading: false },
        cursor: { authenticated: false, email: null, method: null, error: null, loading: false },
        codex: { authenticated: false, email: null, method: null, error: null, loading: false },
        opencode: { authenticated: false, email: null, method: null, error: null, loading: false },
      },
      checkProviderAuthStatus,
      refreshProviderAuthStatuses: vi.fn(),
    });

    return render(
      <ProviderSelectionEmptyState
        selectedSession={null}
        currentSessionId={null}
        provider={provider}
        setProvider={vi.fn()}
        textareaRef={{ current: null }}
        providerModels={{
          agy: 'gemini-3.8-flash-high',
          claude: 'claude-3-7-sonnet',
          cursor: 'auto',
          codex: 'auto',
          opencode: 'auto',
        }}
        setProviderModel={vi.fn()}
        providerModelCatalog={mockCatalog}
        providerModelActions={{
          create: vi.fn(),
          update: vi.fn(),
          remove: vi.fn(),
          setCustomModelsOnly: vi.fn(),
        }}
        providerModelsLoading={false}
        tasksEnabled={false}
        isTaskMasterInstalled={false}
        onShowAllTasks={null}
        setInput={vi.fn()}
      />,
    );
  };

  it('renders agy account info and quota overview when provider is agy', () => {
    renderComponent('agy');

    expect(checkProviderAuthStatus).toHaveBeenCalledWith('agy');
    expect(screen.getAllByText(/zolshevik@gmail\.com/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Connection Status')).toBeDefined();
    expect(screen.getByText('Supported Models & Usage Quota')).toBeDefined();
    expect(screen.getAllByText(/Gemini 3\.8 Flash/).length).toBeGreaterThanOrEqual(1);
  });

  it('does not render agy account quota when provider is claude', () => {
    renderComponent('claude');

    expect(checkProviderAuthStatus).not.toHaveBeenCalled();
    expect(screen.queryByText('zolshevik@gmail.com')).toBeNull();
    expect(screen.queryByText('PRO')).toBeNull();
  });
});
