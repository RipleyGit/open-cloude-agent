import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type {
  AnyRecord,
  CliVersionProbe,
  ProviderAccountDetails,
  ProviderAuthStatus,
  ProviderModelQuotaItem,
  ProviderQuotaData,
} from '@/shared/types.js';
import { probeCliVersion } from '@/shared/utils.js';

const ANTIGRAVITY_HOME = path.join(os.homedir(), '.antigravity');
const ANTIGRAVITY_TOOLS_DIR = path.join(os.homedir(), '.antigravity_tools');
const ANTIGRAVITY_COCKPIT_DIR = path.join(os.homedir(), '.antigravity_cockpit');
const AGY_ACCOUNTS_PATH = path.join(os.homedir(), '.gemini', 'google_accounts.json');
const GEMINI_ENV_PATH = path.join(os.homedir(), '.gemini', '.env');

type AntigravityAccountInfo = {
  id?: string;
  email: string;
  name?: string | null;
  subscriptionTier?: string | null;
  projectId?: string | null;
  quotaModels?: Array<{ name: string; percentage: number; reset_time?: string }>;
};

/**
 * Masks an API key so only first 7 and last 4 chars are visible.
 */
function maskApiKey(key: string): string {
  if (key.length <= 12) return '••••••••';
  return `${key.slice(0, 7)}••••••••••••${key.slice(-4)}`;
}

/**
 * Reads ~/.gemini/.env variables as fallback.
 */
function parseGeminiEnv(): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    if (!fs.existsSync(GEMINI_ENV_PATH)) return result;
    const content = fs.readFileSync(GEMINI_ENV_PATH, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([A-Za-z_0-9]+)\s*=\s*(.*)$/);
      if (match) {
        let val = match[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        result[match[1]] = val;
      }
    }
  } catch {
    // Ignore read errors
  }
  return result;
}

/**
 * Reads the active Antigravity account from local storage (`~/.antigravity_tools/accounts.json` or fallback).
 */
function readAntigravityActiveAccount(): AntigravityAccountInfo | null {
  const accountsJsonPath = path.join(ANTIGRAVITY_TOOLS_DIR, 'accounts.json');
  if (fs.existsSync(accountsJsonPath)) {
    try {
      const index = JSON.parse(fs.readFileSync(accountsJsonPath, 'utf8')) as {
        current_account_id?: string;
        accounts?: Array<{ id: string; email?: string; name?: string }>;
      };
      const currentId = index.current_account_id;
      if (currentId) {
        const accPath = path.join(ANTIGRAVITY_TOOLS_DIR, 'accounts', `${currentId}.json`);
        if (fs.existsSync(accPath)) {
          const acc = JSON.parse(fs.readFileSync(accPath, 'utf8')) as AnyRecord;
          const token = (acc.token ?? {}) as AnyRecord;
          const quota = (acc.quota ?? {}) as AnyRecord;
          const email = typeof acc.email === 'string'
            ? acc.email
            : (typeof token.email === 'string' ? token.email : null);
          if (email) {
            return {
              id: currentId,
              email,
              name: typeof acc.name === 'string' ? acc.name : null,
              subscriptionTier: typeof quota.subscription_tier === 'string' ? quota.subscription_tier : null,
              projectId: typeof token.project_id === 'string' ? token.project_id : null,
              quotaModels: Array.isArray(quota.models)
                ? (quota.models as Array<{ name: string; percentage: number; reset_time?: string }>)
                : undefined,
            };
          }
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  // Fallback: check google_accounts.json
  if (fs.existsSync(AGY_ACCOUNTS_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(AGY_ACCOUNTS_PATH, 'utf8')) as {
        active?: unknown;
        old?: string[];
      };
      const active = parsed.active as AnyRecord | undefined;
      const email = (active && typeof active.email === 'string')
        ? active.email
        : (Array.isArray(parsed.old) && parsed.old.length > 0 ? parsed.old[0] : null);
      if (email) {
        return {
          email,
          name: email.split('@')[0],
        };
      }
    } catch {
      // Ignore
    }
  }

  return null;
}

/**
 * Reads available models catalog from ~/.antigravity_cockpit/cache/available_models.json
 */
function readAvailableModelsMap(): Map<string, string> {
  const map = new Map<string, string>();
  const availablePath = path.join(ANTIGRAVITY_COCKPIT_DIR, 'cache', 'available_models.json');
  if (fs.existsSync(availablePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(availablePath, 'utf8')) as {
        models?: Array<{ id: string; displayName?: string }>;
      };
      if (Array.isArray(data.models)) {
        for (const m of data.models) {
          if (m.id && m.displayName) {
            map.set(m.id, m.displayName);
          }
        }
      }
    } catch {
      // Ignore
    }
  }
  return map;
}

/**
 * Formats an ISO reset timestamp for display.
 */
function formatResetTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const now = new Date();
    if (d.getTime() <= now.getTime()) {
      return '已重置 (100%)';
    }
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return isoString;
  }
}

/**
 * Reads per-model quota data for the active Antigravity account from local cockpit cache and tools store.
 */
function readAntigravityModelsQuota(account: AntigravityAccountInfo): ProviderModelQuotaItem[] {
  const availableMap = readAvailableModelsMap();
  const modelMap = new Map<string, ProviderModelQuotaItem>();

  // 1. Check Cockpit cache for this account: sha256(email).json
  const emailHash = crypto.createHash('sha256').update(account.email).digest('hex');
  const cockpitQuotaPath = path.join(
    ANTIGRAVITY_COCKPIT_DIR,
    'cache',
    'quota_api_v1_plugin',
    'authorized',
    `${emailHash}.json`,
  );

  if (fs.existsSync(cockpitQuotaPath)) {
    try {
      const cacheData = JSON.parse(fs.readFileSync(cockpitQuotaPath, 'utf8')) as AnyRecord;
      const payload = (cacheData.payload ?? {}) as AnyRecord;
      const models = (payload.models ?? {}) as Record<string, AnyRecord>;

      for (const [id, m] of Object.entries(models)) {
        const displayName = (typeof m.displayName === 'string' ? m.displayName : null)
          || availableMap.get(id)
          || id;
        const quotaInfo = (m.quotaInfo ?? {}) as AnyRecord;
        const fraction = typeof quotaInfo.remainingFraction === 'number' ? quotaInfo.remainingFraction : 1;
        const percentage = Math.round(fraction * 100);
        const resetTime = typeof quotaInfo.resetTime === 'string' ? quotaInfo.resetTime : null;

        modelMap.set(id, {
          name: id,
          displayName,
          percentage,
          resetTime,
          resetTimeFormatted: resetTime ? formatResetTime(resetTime) : '全额可用',
          supportsThinking: Boolean(m.supportsThinking),
          supportsImages: Boolean(m.supportsImages),
          recommended: Boolean(m.recommended),
        });
      }
    } catch {
      // Ignore
    }
  }

  // 2. Merge models from account.quotaModels (from ~/.antigravity_tools/accounts/*.json)
  if (account.quotaModels) {
    for (const qm of account.quotaModels) {
      if (!modelMap.has(qm.name)) {
        const displayName = availableMap.get(qm.name) || qm.name;
        const resetTime = qm.reset_time || null;
        modelMap.set(qm.name, {
          name: qm.name,
          displayName,
          percentage: typeof qm.percentage === 'number' ? qm.percentage : 100,
          resetTime,
          resetTimeFormatted: resetTime ? formatResetTime(resetTime) : '全额可用',
          supportsThinking: qm.name.includes('thinking'),
          supportsImages: qm.name.includes('image') || qm.name.includes('flash'),
          recommended: false,
        });
      }
    }
  }

  // Sort: recommended models first, then alphabetical
  return Array.from(modelMap.values()).sort((a, b) => {
    if (a.recommended && !b.recommended) return -1;
    if (!a.recommended && b.recommended) return 1;
    return a.displayName.localeCompare(b.displayName);
  });
}

/**
 * Queries token usage and quota data from a OneAPI / NewAPI endpoint as fallback.
 */
async function fetchNewApiQuota(baseUrl: string, apiKey: string): Promise<ProviderQuotaData | null> {
  try {
    const normalizedUrl = baseUrl.replace(/\/+$/, '');
    const url = `${normalizedUrl}/api/usage/token/`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(3500),
    });

    if (!response.ok) return null;
    const json = (await response.json()) as AnyRecord;
    const data = (json.data ?? json) as AnyRecord;

    const unlimited = Boolean(data.unlimited_quota);
    const totalUsed = typeof data.total_used === 'number' ? data.total_used : 0;
    const totalGranted = typeof data.total_granted === 'number' ? data.total_granted : 0;
    const totalAvailable = typeof data.total_available === 'number' ? data.total_available : 0;
    const expiresAt = typeof data.expires_at === 'number' && data.expires_at > 0 ? data.expires_at : null;

    const usedUsd = (totalUsed / 500000).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const availUsd = unlimited
      ? '无限额度'
      : totalAvailable > 0
        ? `$${(totalAvailable / 500000).toFixed(2)}`
        : '$0.00';

    const modelLimits = (typeof data.model_limits === 'object' && data.model_limits !== null)
      ? Object.keys(data.model_limits as Record<string, unknown>)
      : [];

    return {
      unlimited,
      accountName: typeof data.name === 'string' ? data.name : null,
      totalGranted,
      totalUsed,
      totalAvailable: unlimited ? undefined : totalAvailable,
      totalUsedUsd: `$${usedUsd}`,
      totalAvailableUsd: availUsd,
      expiresAt,
      expiresAtFormatted: expiresAt ? new Date(expiresAt * 1000).toLocaleDateString() : '永久有效',
      modelLimitsEnabled: Boolean(data.model_limits_enabled),
      allowedModels: modelLimits,
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Auth and quota adapter for Antigravity CLI (`agy`).
 * Used by AgyProvider to report installation, authentication status, account details, and per-model quota data.
 */
export class AgyProviderAuth implements IProviderAuth {
  private cachedQuota: { data: ProviderQuotaData | null; fetchedAt: number } | null = null;
  private readonly QUOTA_TTL_MS = 60_000;

  checkInstalled(): CliVersionProbe {
    const customBin = path.join(ANTIGRAVITY_HOME, 'antigravity', 'bin', 'agy');
    if (fs.existsSync(customBin)) {
      const probe = probeCliVersion(customBin, ['--version']);
      if (probe.installed) return probe;
    }
    const antigravityBin = path.join(ANTIGRAVITY_HOME, 'antigravity', 'bin', 'antigravity');
    if (fs.existsSync(antigravityBin)) {
      const probe = probeCliVersion(antigravityBin, ['--version']);
      if (probe.installed) return probe;
    }
    return probeCliVersion('agy', ['--version']);
  }

  async getQuota(forceRefresh = false): Promise<ProviderQuotaData | null> {
    const now = Date.now();
    if (!forceRefresh && this.cachedQuota && (now - this.cachedQuota.fetchedAt < this.QUOTA_TTL_MS)) {
      return this.cachedQuota.data;
    }

    // 1. Antigravity local account quota (Primary)
    const account = readAntigravityActiveAccount();
    if (account) {
      const models = readAntigravityModelsQuota(account);
      const avg = models.length > 0
        ? Math.round(models.reduce((sum, m) => sum + m.percentage, 0) / models.length)
        : 100;

      const quotaData: ProviderQuotaData = {
        unlimited: true,
        accountName: account.name || account.email.split('@')[0],
        email: account.email,
        subscriptionTier: account.subscriptionTier || 'g1-pro-tier',
        models,
        totalModels: models.length,
        averagePercentage: avg,
        fetchedAt: new Date().toISOString(),
      };

      this.cachedQuota = { data: quotaData, fetchedAt: now };
      return quotaData;
    }

    // 2. Fallback: New API token quota if API key is configured
    const geminiEnv = parseGeminiEnv();
    const apiKey = geminiEnv.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    const baseUrl = geminiEnv.GOOGLE_GEMINI_BASE_URL || process.env.GOOGLE_GEMINI_BASE_URL;

    if (apiKey && baseUrl) {
      const quota = await fetchNewApiQuota(baseUrl, apiKey);
      this.cachedQuota = { data: quota, fetchedAt: now };
      return quota;
    }

    return null;
  }

  async getStatus(): Promise<ProviderAuthStatus> {
    const probe = this.checkInstalled();
    const installPath = fs.existsSync(ANTIGRAVITY_HOME) ? '~/.antigravity' : null;
    const installed = probe.installed || Boolean(installPath);
    const installedVersion = probe.version ?? (installed ? '2.1.295' : null);

    // 1. Check Antigravity account login (Primary mode)
    const account = readAntigravityActiveAccount();
    if (account) {
      const quota = await this.getQuota();
      const accountDetails: ProviderAccountDetails = {
        authType: 'Antigravity Account (OAuth)',
        accountName: account.name || account.email.split('@')[0],
        email: account.email,
        installPath: installPath || '~/.antigravity',
        subscriptionTier: account.subscriptionTier || 'g1-pro-tier',
        projectId: account.projectId || 'aicode-consumers',
      };

      return {
        installed,
        provider: 'agy',
        installedVersion,
        authenticated: true,
        email: account.email,
        method: 'oauth',
        accountDetails,
        quota: quota ?? undefined,
      };
    }

    // 2. Check API Key mode (Fallback mode)
    const geminiEnv = parseGeminiEnv();
    const apiKey = geminiEnv.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    const baseUrl = geminiEnv.GOOGLE_GEMINI_BASE_URL || process.env.GOOGLE_GEMINI_BASE_URL || null;
    const defaultModel = geminiEnv.GEMINI_MODEL || process.env.GEMINI_MODEL || 'gemini-3.6-flash';

    if (apiKey) {
      const quota = await this.getQuota();
      const accountDetails: ProviderAccountDetails = {
        authType: 'gemini-api-key',
        accountName: quota?.accountName || 'bolshevik',
        email: null,
        installPath: installPath || '~/.antigravity',
        baseUrl,
        defaultModel,
        keyMasked: maskApiKey(apiKey),
      };

      return {
        installed,
        provider: 'agy',
        installedVersion,
        authenticated: true,
        email: quota?.accountName || 'bolshevik',
        method: 'api_key',
        accountDetails,
        quota: quota ?? undefined,
      };
    }

    // 3. Unauthenticated state
    return {
      installed,
      provider: 'agy',
      installedVersion,
      authenticated: false,
      email: null,
      method: null,
      error: !installed
        ? 'Antigravity is not installed at ~/.antigravity'
        : 'Antigravity is not signed in. Please sign in to your account.',
    };
  }
}
