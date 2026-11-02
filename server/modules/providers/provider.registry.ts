import { ClaudeProvider } from '@/modules/providers/list/claude/claude.provider.js';
import { CodexProvider } from '@/modules/providers/list/codex/codex.provider.js';
import { CursorProvider } from '@/modules/providers/list/cursor/cursor.provider.js';
import { OpenCodeProvider } from '@/modules/providers/list/opencode/opencode.provider.js';
import type { IProvider } from '@/shared/interfaces.js';
import type { LLMProvider } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const createBuiltinProviders = (): Map<string, IProvider> =>
  new Map<string, IProvider>([
    ['claude', new ClaudeProvider()],
    ['codex', new CodexProvider()],
    ['cursor', new CursorProvider()],
    ['opencode', new OpenCodeProvider()],
  ]);

const providers = createBuiltinProviders();
const changeListeners = new Set<() => void>();

function notifyChangeListeners(): void {
  for (const listener of changeListeners) {
    try {
      listener();
    } catch (err) {
      console.error('[ProviderRegistry] Error in change listener:', err);
    }
  }
}

/**
 * Central registry for resolving concrete provider implementations by id.
 * Supports built-in providers as well as dynamic providers registered by agent plugins.
 */
export const providerRegistry = {
  /**
   * Register a new or custom provider (e.g. from an agent plugin).
   */
  registerProvider(provider: IProvider): void {
    if (!provider || !provider.id) {
      throw new Error('Cannot register provider without valid id');
    }
    providers.set(provider.id, provider);
    notifyChangeListeners();
  },

  /**
   * Unregister a provider by id.
   */
  unregisterProvider(providerId: string): boolean {
    const deleted = providers.delete(providerId);
    if (deleted) {
      notifyChangeListeners();
    }
    return deleted;
  },

  /**
   * Check if a provider is registered.
   */
  hasProvider(provider: string): boolean {
    return providers.has(provider);
  },

  /**
   * List all currently registered providers (built-ins + agent plugins).
   */
  listProviders(): IProvider[] {
    return Array.from(providers.values());
  },

  /**
   * Resolve a provider implementation by id.
   */
  resolveProvider(provider: string): IProvider {
    const resolvedProvider = providers.get(provider);
    if (!resolvedProvider) {
      throw new AppError(`Unsupported provider "${provider}".`, {
        code: 'UNSUPPORTED_PROVIDER',
        statusCode: 400,
      });
    }

    return resolvedProvider;
  },

  /**
   * Subscribe to provider registry changes (register / unregister).
   */
  onProvidersChanged(listener: () => void): () => void {
    changeListeners.add(listener);
    return () => {
      changeListeners.delete(listener);
    };
  },

  /**
   * Reset providers back to initial built-ins (used for tests).
   */
  resetBuiltinProviders(): void {
    providers.clear();
    for (const [id, prov] of createBuiltinProviders()) {
      providers.set(id, prov);
    }
    notifyChangeListeners();
  },
};
