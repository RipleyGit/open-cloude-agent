import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

import { AppError } from '@/shared/utils.js';
import { providerRegistry } from '../providers/provider.registry.js';
import { PluginAgentProvider, type PluginAgentManifest } from './plugin-agent.provider.js';
import {
  getPluginDir,
  getPluginsConfig,
  getPluginsDir,
  installPluginFromGit,
  savePluginsConfig,
  scanPlugins,
  uninstallPlugin,
  updatePluginFromGit,
} from './plugin-registry.service.js';
import {
  getPluginPort,
  isPluginRunning,
  startPluginServer,
  stopPluginServer,
} from './plugin-process.service.js';

export interface AgentPluginDetails {
  name: string;
  displayName: string;
  version: string;
  description: string;
  author: string;
  icon: string;
  type: string;
  providerId: string;
  cliName: string;
  defaultModel?: string;
  models: Array<{ value: string; label: string; description?: string }>;
  enabled: boolean;
  repoUrl: string | null;
  serverRunning: boolean;
  cliStatus: {
    installed: boolean;
    version: string | null;
    exitCode: number | null;
  };
}

export interface RecommendedAgentPlugin {
  id: string;
  name: string;
  providerId: string;
  repoUrl: string;
  description: string;
  icon?: string;
  author?: string;
  version?: string;
  defaultModel?: string;
  models?: Array<{ value: string; label: string }>;
}

export const DEFAULT_RECOMMENDED_PLUGINS: RecommendedAgentPlugin[] = [];

let recommendedCache: { data: RecommendedAgentPlugin[]; expiresAt: number } | null = null;

function probeCli(cliName: string): { installed: boolean; version: string | null; exitCode: number | null } {
  try {
    const probe = spawnSync(cliName, ['--version'], { encoding: 'utf-8', timeout: 3000 });
    const installed = probe.status === 0;
    const version = installed ? probe.stdout.trim().split('\n')[0] : null;
    return {
      installed,
      version,
      exitCode: probe.status,
    };
  } catch {
    return {
      installed: false,
      version: null,
      exitCode: null,
    };
  }
}

function extractProviderId(manifest: any): string {
  return (
    manifest.agent?.id ||
    manifest.agent?.providerId ||
    manifest.name.replace(/^cloudcli-plugin-/, '').replace(/^cloude-agent-/, '')
  );
}

export const agentPluginsService = {
  async getRecommended(): Promise<RecommendedAgentPlugin[]> {
    const now = Date.now();
    if (recommendedCache && recommendedCache.expiresAt > now) {
      return recommendedCache.data;
    }

    const registryUrl = 'https://raw.githubusercontent.com/RipleyGit/cloude-agent-plugins/main/plugins.json';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const resp = await fetch(registryUrl, { signal: controller.signal });
      clearTimeout(timeout);

      if (resp.ok) {
        const data: any = await resp.json();
        if (Array.isArray(data?.plugins) && data.plugins.length > 0) {
          recommendedCache = {
            data: data.plugins,
            expiresAt: now + 10 * 60 * 1000,
          };
          return data.plugins;
        }
      }
    } catch {
      // Offline or network error: return empty array
    }

    return DEFAULT_RECOMMENDED_PLUGINS;
  },

  list(): AgentPluginDetails[] {
    const plugins = scanPlugins();
    const config = getPluginsConfig();
    const agentPlugins: AgentPluginDetails[] = [];

    for (const plugin of plugins) {
      const isAgent = plugin.type === 'agent' || Boolean(plugin.agent);
      if (!isAgent) continue;

      const manifestAgent = plugin.agent as any;
      const providerId = extractProviderId(plugin);
      const cliName = manifestAgent?.cliName || manifestAgent?.binary || providerId;
      const defaultModel = manifestAgent?.defaultModel;

      let models: Array<{ value: string; label: string }> = [];
      if (Array.isArray(manifestAgent?.models)) {
        models = manifestAgent.models.map((m: any) =>
          typeof m === 'string' ? { value: m, label: m } : { value: m.value || m.id, label: m.label || m.name || m.value }
        );
      }

      const cliStatus = probeCli(cliName);
      const isRunning = plugin.server ? isPluginRunning(plugin.name) : false;

      agentPlugins.push({
        name: plugin.name,
        displayName: plugin.displayName || manifestAgent?.displayName || plugin.name,
        version: plugin.version || '0.0.0',
        description: plugin.description || '',
        author: plugin.author || '',
        icon: plugin.icon || 'Bot',
        type: 'agent',
        providerId,
        cliName,
        defaultModel,
        models,
        enabled: config[plugin.name]?.enabled !== false,
        repoUrl: plugin.repoUrl,
        serverRunning: isRunning,
        cliStatus,
      });
    }

    return agentPlugins;
  },

  async install(urlInput: unknown): Promise<{ success: boolean; plugin: any; providerId: string }> {
    let url = typeof urlInput === 'string' ? urlInput.trim() : '';

    // If a short plugin identifier was passed, resolve to repoUrl from recommended list
    const recommended = await this.getRecommended();
    const matchedRecommended = recommended.find(
      (r) => r.id === url || r.repoUrl.toLowerCase() === url.toLowerCase() || r.providerId === url
    );
    if (matchedRecommended) {
      url = matchedRecommended.repoUrl;
    }

    if (!url || (!url.startsWith('https://') && !url.startsWith('git@'))) {
      throw new AppError('URL must start with https:// or git@', {
        code: 'INVALID_PLUGIN_URL',
        statusCode: 400,
      });
    }

    const urlClean = url.replace(/\.git$/, '').replace(/\/$/, '');
    const repoName = urlClean.split('/').pop() || '';
    const pluginsDir = getPluginsDir();
    const targetDir = path.resolve(pluginsDir, repoName);

    let rawManifest: any;
    if (fs.existsSync(targetDir)) {
      try {
        rawManifest = (await updatePluginFromGit(repoName)) as any;
      } catch (err: any) {
        try {
          fs.rmSync(targetDir, { recursive: true, force: true });
          rawManifest = (await installPluginFromGit(url)) as any;
        } catch (innerErr: any) {
          throw new AppError(`Failed to install plugin: ${innerErr.message || err.message}`, {
            code: 'PLUGIN_INSTALL_FAILED',
            statusCode: 500,
          });
        }
      }
    } else {
      rawManifest = (await installPluginFromGit(url)) as any;
    }

    const isAgent = rawManifest.type === 'agent' || Boolean(rawManifest.agent);

    if (!isAgent) {
      try {
        await uninstallPlugin(rawManifest.name);
      } catch {
        // Ignore cleanup error
      }
      throw new AppError(
        'The specified repository is not an Agent plugin. Regular UI tab plugins should be installed in Settings -> Plugins.',
        {
          code: 'NOT_AN_AGENT_PLUGIN',
          statusCode: 400,
        }
      );
    }

    const config = getPluginsConfig();
    config[rawManifest.name] = { ...config[rawManifest.name], enabled: true };
    savePluginsConfig(config);

    const pluginDir = getPluginDir(rawManifest.name);
    if (!pluginDir) {
      throw new AppError('Failed to locate installed agent plugin directory', {
        code: 'PLUGIN_DIR_NOT_FOUND',
        statusCode: 500,
      });
    }

    if (rawManifest.server) {
      try {
        await startPluginServer(rawManifest.name, pluginDir, rawManifest.server);
      } catch (err: any) {
        console.warn(`[AgentPlugins] Could not start server for ${rawManifest.name}: ${err.message}`);
      }
    }

    const provider = new PluginAgentProvider(rawManifest, pluginDir);
    providerRegistry.registerProvider(provider);
    console.log(`[AgentPlugins] Successfully installed and registered agent provider "${provider.id}"`);

    return {
      success: true,
      plugin: rawManifest,
      providerId: provider.id,
    };
  },

  async update(name: string): Promise<{ success: boolean; plugin: any }> {
    if (!name || typeof name !== 'string') {
      throw new AppError('Plugin name is required', { code: 'INVALID_PLUGIN_NAME', statusCode: 400 });
    }

    const wasRunning = isPluginRunning(name);
    if (wasRunning) {
      await stopPluginServer(name);
    }

    const updatedManifest = (await updatePluginFromGit(name)) as any;
    const pluginDir = getPluginDir(name);

    if (wasRunning && pluginDir && updatedManifest.server) {
      try {
        await startPluginServer(name, pluginDir, updatedManifest.server);
      } catch (err: any) {
        console.warn(`[AgentPlugins] Could not restart server for ${name}: ${err.message}`);
      }
    }

    if (pluginDir && (updatedManifest.type === 'agent' || updatedManifest.agent)) {
      const provider = new PluginAgentProvider(updatedManifest, pluginDir);
      providerRegistry.registerProvider(provider);
    }

    return {
      success: true,
      plugin: updatedManifest,
    };
  },

  async uninstall(name: string): Promise<{ success: boolean; name: string }> {
    if (!name || typeof name !== 'string') {
      throw new AppError('Plugin name is required', { code: 'INVALID_PLUGIN_NAME', statusCode: 400 });
    }

    const plugins = scanPlugins();
    const plugin = plugins.find((p) => p.name === name);
    if (plugin) {
      const providerId = extractProviderId(plugin);
      providerRegistry.unregisterProvider(providerId);
      console.log(`[AgentPlugins] Unregistered agent provider "${providerId}"`);
    }

    if (isPluginRunning(name)) {
      await stopPluginServer(name);
    }

    await uninstallPlugin(name);
    return { success: true, name };
  },

  async setEnabled(name: string, enabled: unknown): Promise<{ success: boolean; name: string; enabled: boolean }> {
    if (!name || typeof name !== 'string') {
      throw new AppError('Plugin name is required', { code: 'INVALID_PLUGIN_NAME', statusCode: 400 });
    }
    if (typeof enabled !== 'boolean') {
      throw new AppError('"enabled" must be a boolean', { code: 'INVALID_PLUGIN_ENABLED', statusCode: 400 });
    }

    const plugins = scanPlugins();
    const plugin = plugins.find((p) => p.name === name);
    if (!plugin) {
      throw new AppError(`Plugin "${name}" not found`, { code: 'PLUGIN_NOT_FOUND', statusCode: 404 });
    }

    const config = getPluginsConfig();
    config[name] = { ...config[name], enabled };
    savePluginsConfig(config);

    const providerId = extractProviderId(plugin);
    const pluginDir = getPluginDir(name);

    if (enabled && pluginDir) {
      if (plugin.server && !isPluginRunning(name)) {
        try {
          await startPluginServer(name, pluginDir, plugin.server);
        } catch {}
      }
      const provider = new PluginAgentProvider(plugin as any, pluginDir);
      providerRegistry.registerProvider(provider);
    } else {
      if (isPluginRunning(name)) {
        try {
          await stopPluginServer(name);
        } catch {}
      }
      providerRegistry.unregisterProvider(providerId);
    }

    return { success: true, name, enabled };
  },

  getStatus(name: string) {
    if (!name || typeof name !== 'string') {
      throw new AppError('Plugin name is required', { code: 'INVALID_PLUGIN_NAME', statusCode: 400 });
    }

    const plugins = scanPlugins();
    const plugin = plugins.find((p) => p.name === name);
    if (!plugin) {
      throw new AppError(`Plugin "${name}" not found`, { code: 'PLUGIN_NOT_FOUND', statusCode: 404 });
    }

    const manifestAgent = plugin.agent as any;
    const providerId = extractProviderId(plugin);
    const cliName = manifestAgent?.cliName || manifestAgent?.binary || providerId;
    const cliStatus = probeCli(cliName);
    const serverRunning = plugin.server ? isPluginRunning(name) : false;

    return {
      name,
      providerId,
      cliName,
      cliStatus,
      serverRunning,
      port: getPluginPort(name) || null,
    };
  },
};
