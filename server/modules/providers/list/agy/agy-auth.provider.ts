import type { IProviderAuth } from '@/shared/interfaces.js';
import type { CliVersionProbe, ProviderAuthStatus } from '@/shared/types.js';
import { probeCliVersion } from '@/shared/utils.js';

/**
 * Auth adapter for Antigravity CLI (`agy`).
 * Used by AgyProvider to report installation and authentication status.
 */
export class AgyProviderAuth implements IProviderAuth {
  checkInstalled(): CliVersionProbe {
    return probeCliVersion('agy', ['--version']);
  }

  async getStatus(): Promise<ProviderAuthStatus> {
    const { installed, version: installedVersion } = this.checkInstalled();

    return {
      installed,
      provider: 'agy',
      installedVersion,
      authenticated: installed,
      email: installed ? 'Local CLI' : null,
      method: installed ? 'cli' : null,
      error: installed ? undefined : 'Antigravity CLI (agy) is not installed on PATH',
    };
  }
}
