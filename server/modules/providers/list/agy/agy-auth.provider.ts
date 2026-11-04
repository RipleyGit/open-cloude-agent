import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AGY_PREDEFINED_MODELS } from './agy-models.provider.js';
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
const ANTIGRAVITY_CLI_HOME = path.join(os.homedir(), '.gemini', 'antigravity-cli');
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
 * Decodes a raw keyring secret output (e.g. from macOS Keychain or Linux secret-tool).
 */
function parseKeyringSecret(rawSecret: string): AntigravityAccountInfo | null {
  const trimmed = rawSecret.trim();
  if (trimmed.startsWith('go-keyring-base64:')) {
    try {
      const raw = trimmed.slice('go-keyring-base64:'.length);
      const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as AnyRecord;
      const email = typeof parsed.id_token_email === 'string'
        ? parsed.id_token_email
        : (parsed.token && typeof (parsed.token as AnyRecord).email === 'string'
          ? (parsed.token as AnyRecord).email as string
          : null);
      if (email && email.includes('@')) {
        return {
          email: email.trim(),
          name: email.split('@')[0],
          subscriptionTier: 'Google AI Pro',
        };
      }
    } catch {
      // Ignore JSON decode error
    }
  } else if (trimmed.includes('@')) {
    try {
      const parsed = JSON.parse(trimmed) as AnyRecord;
      const email = typeof parsed.email === 'string' ? parsed.email : null;
      if (email && email.includes('@')) {
        return {
          email: email.trim(),
          name: email.split('@')[0],
          subscriptionTier: 'Google AI Pro',
        };
      }
    } catch {
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        return {
          email: trimmed,
          name: trimmed.split('@')[0],
          subscriptionTier: 'Google AI Pro',
        };
      }
    }
  }
  return null;
}

/**
 * Reads active account from recent Antigravity CLI runtime logs.
 * Universally available across Linux, macOS, and Windows whenever agy is executed.
 */
function readAccountFromCliLogs(): AntigravityAccountInfo | null {
  const logDir = path.join(ANTIGRAVITY_CLI_HOME, 'log');
  const symlink = path.join(ANTIGRAVITY_CLI_HOME, 'cli.log');
  const filesToTry: string[] = [];

  if (fs.existsSync(symlink)) {
    try {
      const real = fs.realpathSync(symlink);
      filesToTry.push(real);
    } catch {
      filesToTry.push(symlink);
    }
  }

  if (fs.existsSync(logDir)) {
    try {
      const entries = fs.readdirSync(logDir)
        .filter((f) => f.startsWith('cli-') && f.endsWith('.log'))
        .map((f) => {
          try {
            return { fullPath: path.join(logDir, f), mtime: fs.statSync(path.join(logDir, f)).mtimeMs };
          } catch {
            return { fullPath: path.join(logDir, f), mtime: 0 };
          }
        })
        .sort((a, b) => b.mtime - a.mtime);

      for (const entry of entries.slice(0, 5)) {
        if (!filesToTry.includes(entry.fullPath)) {
          filesToTry.push(entry.fullPath);
        }
      }
    } catch {
      // Ignore directory read errors
    }
  }

  for (const filePath of filesToTry) {
    try {
      if (!fs.existsSync(filePath)) continue;
      // Read initial 128KB where startup auth output is recorded
      const buffer = Buffer.alloc(131072);
      const fd = fs.openSync(filePath, 'r');
      const bytesRead = fs.readSync(fd, buffer, 0, 131072, 0);
      fs.closeSync(fd);
      const content = buffer.toString('utf8', 0, bytesRead);

      const applyMatch = content.match(/applyAuthResult:\s*email=([^\s,]+)(?:,\s*authMethod=([^\s,]+))?/);
      if (applyMatch && applyMatch[1]) {
        const email = applyMatch[1].trim();
        const method = applyMatch[2]?.trim();
        return {
          email,
          name: email.split('@')[0],
          subscriptionTier: method === 'enterprise' ? 'Google Cloud Enterprise' : 'Google AI Pro',
        };
      }

      const oauthMatch = content.match(/OAuth:\s*authenticated successfully as\s+([^\s]+)/);
      if (oauthMatch && oauthMatch[1]) {
        const email = oauthMatch[1].trim();
        return {
          email,
          name: email.split('@')[0],
          subscriptionTier: 'Google AI Pro',
        };
      }
    } catch {
      // Ignore file reading errors
    }
  }

  return null;
}

/**
 * Reads account identity from environment variables.
 * Ideal for headless Linux servers, Docker containers, and CI environments.
 */
function readAccountFromEnv(): AntigravityAccountInfo | null {
  const geminiEnv = parseGeminiEnv();
  const email = process.env.ANTIGRAVITY_ACCOUNT
    || process.env.AGY_ACCOUNT
    || process.env.GEMINI_ACCOUNT_EMAIL
    || geminiEnv.ANTIGRAVITY_ACCOUNT
    || geminiEnv.GEMINI_ACCOUNT_EMAIL;

  if (email && email.includes('@')) {
    const trimmed = email.trim();
    return {
      email: trimmed,
      name: trimmed.split('@')[0],
      subscriptionTier: process.env.ANTIGRAVITY_TIER || 'Google AI Pro',
    };
  }
  return null;
}

/**
 * Reads the active Antigravity account using a cross-platform, multi-tiered resolution:
 * 1. OS-specific system keyring (macOS Keychain, Linux secret-tool/SecretService)
 * 2. Antigravity CLI runtime logs (~/.gemini/antigravity-cli/cli.log)
 * 3. Environment variables (ANTIGRAVITY_ACCOUNT, AGY_ACCOUNT, GEMINI_ACCOUNT_EMAIL)
 * 4. Standard Gemini CLI store (~/.gemini/google_accounts.json)
 * 5. Antigravity tools store (~/.antigravity_tools/accounts.json, filtering expired tokens)
 */
function readAntigravityActiveAccount(): AntigravityAccountInfo | null {
  // 1. Primary on macOS: Keychain
  if (process.platform === 'darwin') {
    try {
      const stdout = execSync('security find-generic-password -s "gemini" -a "antigravity" -w', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2500,
      });
      const account = parseKeyringSecret(stdout);
      if (account) return account;
    } catch {
      // Ignore keyring read errors
    }
  }

  // 1. Primary on Linux: SecretService via secret-tool
  if (process.platform === 'linux') {
    try {
      const stdout = execSync('secret-tool lookup service gemini account antigravity', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2500,
      });
      const account = parseKeyringSecret(stdout);
      if (account) return account;
    } catch {
      // Ignore
    }

    try {
      const stdout = execSync('secret-tool lookup service gemini username antigravity', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2500,
      });
      const account = parseKeyringSecret(stdout);
      if (account) return account;
    } catch {
      // Ignore
    }
  }

  // 2. Secondary: Antigravity CLI recent logs (Universal on macOS/Linux/Windows)
  const logAccount = readAccountFromCliLogs();
  if (logAccount) return logAccount;

  // 3. Tertiary: Environment variables
  const envAccount = readAccountFromEnv();
  if (envAccount) return envAccount;

  // 4. Quaternary: Standard Gemini CLI accounts store
  if (fs.existsSync(AGY_ACCOUNTS_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(AGY_ACCOUNTS_PATH, 'utf8')) as {
        active?: unknown;
        old?: string[];
      };
      const active = parsed.active as AnyRecord | undefined;
      if (active && typeof active.email === 'string' && active.email.trim().length > 0) {
        const email = active.email.trim();
        return {
          email,
          name: typeof active.name === 'string' ? active.name : email.split('@')[0],
          subscriptionTier: 'Google AI Pro',
        };
      }
    } catch {
      // Ignore
    }
  }

  // 5. Quinary: check ~/.antigravity_tools/accounts.json only if token is valid and unexpired
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

          const expirySec = typeof token.expiry_timestamp === 'number'
            ? token.expiry_timestamp
            : (typeof token.expires_in === 'number' && typeof token.created_at === 'number'
              ? token.created_at + token.expires_in
              : null);
          const isExpired = expirySec !== null && (expirySec * 1000 < Date.now());

          if (email && !isExpired) {
            return {
              id: currentId,
              email,
              name: typeof acc.name === 'string' ? acc.name : null,
              subscriptionTier: typeof quota.subscription_tier === 'string' ? quota.subscription_tier : 'Google AI Pro',
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

  return null;
}

/**
 * Returns candidate binary locations for agy / antigravity across platforms.
 */
function getCandidateAgyBinaries(): string[] {
  const home = os.homedir();
  const isWin = process.platform === 'win32';
  const binName = isWin ? 'agy.exe' : 'agy';
  const altBinName = isWin ? 'antigravity.exe' : 'antigravity';

  const candidates = [
    // Standard user-level binaries
    path.join(home, '.local', 'bin', binName),
    path.join(home, '.local', 'bin', altBinName),
    // Antigravity bundle locations
    path.join(ANTIGRAVITY_CLI_HOME, 'bin', binName),
    path.join(ANTIGRAVITY_HOME, 'antigravity', 'bin', binName),
    path.join(ANTIGRAVITY_HOME, 'antigravity', 'bin', altBinName),
    // Unix / macOS global paths
    '/usr/local/bin/agy',
    '/opt/homebrew/bin/agy',
    '/usr/bin/agy',
  ];

  if (isWin) {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    candidates.push(
      path.join(localAppData, 'Programs', 'antigravity', 'bin', 'agy.exe'),
      path.join(appData, 'npm', 'agy.cmd'),
      path.join(appData, 'npm', 'agy.ps1'),
    );
  }

  // System PATH lookups
  candidates.push('agy', 'antigravity');

  return candidates;
}

/**
 * Resolves the display installation path of Antigravity CLI.
 */
function resolveAgyInstallPath(resolvedBin?: string | null): string {
  const home = os.homedir();
  if (fs.existsSync(ANTIGRAVITY_CLI_HOME)) return '~/.gemini/antigravity-cli';
  if (fs.existsSync(ANTIGRAVITY_HOME)) return '~/.antigravity';
  if (resolvedBin && resolvedBin.startsWith(home)) {
    return resolvedBin.replace(home, '~');
  }
  return resolvedBin || '~/.gemini/antigravity-cli';
}

/**
 * Reads available models catalog from ~/.antigravity_cockpit/cache/available_models.json if present.
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
 * Reads per-model quota data for the active Antigravity account.
 * Merges cached quota with AGY_PREDEFINED_MODELS to ensure complete, universal model availability across all environments.
 */
function readAntigravityModelsQuota(account: AntigravityAccountInfo): ProviderModelQuotaItem[] {
  const availableMap = readAvailableModelsMap();
  const modelMap = new Map<string, ProviderModelQuotaItem>();

  // 1. Check Cockpit cache for this account if it exists: sha256(email).json
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
          supportsThinking: qm.name.includes('thinking') || qm.name.includes('sonnet') || qm.name.includes('opus'),
          supportsImages: qm.name.includes('image') || qm.name.includes('flash'),
          recommended: false,
        });
      }
    }
  }

  // 3. Guaranteed Baseline: Always ensure standard AGY_PREDEFINED_MODELS are present.
  // This guarantees that in ANY new/clean environment or headless server, models are cleanly populated.
  for (const opt of AGY_PREDEFINED_MODELS.OPTIONS) {
    if (!modelMap.has(opt.value)) {
      const lower = opt.value.toLowerCase();
      modelMap.set(opt.value, {
        name: opt.value,
        displayName: opt.label,
        percentage: 100,
        resetTime: null,
        resetTimeFormatted: '全额可用',
        supportsThinking: lower.includes('thinking') || lower.includes('sonnet') || lower.includes('opus') || (opt.effort?.values.length ?? 0) > 2,
        supportsImages: lower.includes('image') || lower.includes('flash') || lower.includes('pro'),
        recommended: opt.value === 'gemini-3.8-flash-high' || opt.value.includes('sonnet'),
      });
    }
  }

  // 4. Merge any additional models found in available_models catalog
  if (availableMap.size > 0) {
    for (const [id, displayName] of availableMap.entries()) {
      if (id.startsWith('tab_') || id.startsWith('chat_')) continue;
      if (!modelMap.has(id)) {
        const lower = id.toLowerCase();
        modelMap.set(id, {
          name: id,
          displayName,
          percentage: 100,
          resetTime: null,
          resetTimeFormatted: '全额可用',
          supportsThinking: lower.includes('thinking') || lower.includes('sonnet') || lower.includes('opus') || lower.includes('pro'),
          supportsImages: lower.includes('image') || lower.includes('flash') || lower.includes('pro'),
          recommended: id === 'gemini-3.8-flash-high' || id === 'gemini-3.6-flash-high',
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
  private detectedBinPath: string | null = null;

  checkInstalled(): CliVersionProbe {
    const candidates = getCandidateAgyBinaries();
    for (const bin of candidates) {
      const isPath = bin.includes(path.sep) || bin.includes('/') || bin.includes('\\');
      if (isPath && !fs.existsSync(bin)) {
        continue;
      }
      const probe = probeCliVersion(bin, ['--version']);
      if (probe.installed) {
        this.detectedBinPath = isPath ? bin : null;
        return probe;
      }
    }
    return { installed: false, exitCode: null, version: null };
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
        subscriptionTier: account.subscriptionTier || 'Google AI Pro',
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
    const apiKey = geminiEnv.GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    const baseUrl = geminiEnv.GOOGLE_GEMINI_BASE_URL || process.env.GOOGLE_GEMINI_BASE_URL;

    if (apiKey && baseUrl) {
      const quota = await fetchNewApiQuota(baseUrl, apiKey);
      if (quota) {
        this.cachedQuota = { data: quota, fetchedAt: now };
        return quota;
      }
    }

    // 3. Fallback: Standalone Gemini API Key without custom proxy
    if (apiKey) {
      const models: ProviderModelQuotaItem[] = AGY_PREDEFINED_MODELS.OPTIONS.map((opt) => ({
        name: opt.value,
        displayName: opt.label,
        percentage: 100,
        resetTime: null,
        resetTimeFormatted: '全额可用',
        supportsThinking: opt.value.includes('thinking') || opt.value.includes('sonnet') || opt.value.includes('opus'),
        supportsImages: opt.value.includes('flash') || opt.value.includes('image'),
        recommended: opt.value === 'gemini-3.8-flash-high',
      }));

      const quotaData: ProviderQuotaData = {
        unlimited: true,
        accountName: 'Google Gemini API Key',
        models,
        totalModels: models.length,
        averagePercentage: 100,
        fetchedAt: new Date().toISOString(),
      };

      this.cachedQuota = { data: quotaData, fetchedAt: now };
      return quotaData;
    }

    return null;
  }

  async getStatus(): Promise<ProviderAuthStatus> {
    const probe = this.checkInstalled();
    const installPath = resolveAgyInstallPath(this.detectedBinPath);
    const installed = probe.installed || fs.existsSync(ANTIGRAVITY_HOME) || fs.existsSync(ANTIGRAVITY_CLI_HOME);
    const installedVersion = probe.version ?? (installed ? '1.4.12' : null);

    // 1. Check Antigravity account login (Primary mode)
    const account = readAntigravityActiveAccount();
    if (account) {
      const quota = await this.getQuota();
      const accountDetails: ProviderAccountDetails = {
        authType: 'Antigravity Account (OAuth)',
        accountName: account.name || account.email.split('@')[0],
        email: account.email,
        installPath,
        subscriptionTier: account.subscriptionTier || 'Google AI Pro',
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
    const apiKey = geminiEnv.GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    const baseUrl = geminiEnv.GOOGLE_GEMINI_BASE_URL || process.env.GOOGLE_GEMINI_BASE_URL || null;
    const defaultModel = geminiEnv.GEMINI_MODEL || process.env.GEMINI_MODEL || 'gemini-3.8-flash-high';

    if (apiKey) {
      const quota = await this.getQuota();
      const accountDetails: ProviderAccountDetails = {
        authType: 'gemini-api-key',
        accountName: quota?.accountName || 'bolshevik',
        email: null,
        installPath,
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
        ? 'Antigravity CLI is not installed. Please install agy or ensure it is in PATH.'
        : 'Antigravity is not signed in. Please sign in to your account.',
    };
  }
}
