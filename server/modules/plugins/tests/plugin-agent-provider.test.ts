import test from 'node:test';
import assert from 'node:assert/strict';

import { validateManifest } from '@/modules/plugins/plugin-registry.service.js';
import { PluginAgentProvider } from '@/modules/plugins/plugin-agent.provider.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { providerModelsService } from '@/modules/providers/services/provider-models.service.js';
import { providerAuthService } from '@/modules/providers/services/provider-auth.service.js';
import { createPluginsService } from '@/modules/plugins/plugins.service.js';

test('validateManifest: accepts agent plugin type and configuration', () => {
  const manifest = {
    name: 'test-agent',
    displayName: 'Test Agent',
    entry: 'dist/index.js',
    type: 'agent',
    agent: {
      providerId: 'test-agent',
      cliName: 'test-cli',
      defaultModel: 'agent-v1',
      models: [
        { value: 'agent-v1', label: 'Agent V1' },
        { value: 'agent-v2', label: 'Agent V2' },
      ],
      watchPaths: ['~/.test-agent/sessions'],
    },
  };

  const validation = validateManifest(manifest);
  assert.equal(validation.valid, true);
});

test('PluginAgentProvider: creates IProvider instance with facets', async () => {
  const manifest = {
    name: 'cloudcli-plugin-custom',
    displayName: 'Custom Agent',
    type: 'agent',
    agent: {
      providerId: 'custom-agent',
      cliName: 'custom-cli',
      defaultModel: 'custom-pro',
      models: [
        { value: 'custom-pro', label: 'Custom Pro' },
        { value: 'custom-flash', label: 'Custom Flash' },
      ],
      watchPaths: ['~/.custom/brain'],
    },
  };

  const provider = new PluginAgentProvider(manifest as any, '/tmp/test-plugin');
  assert.equal(provider.id, 'custom-agent');
  assert.equal(provider.displayName, 'Custom Agent');
  assert.equal(provider.isPlugin, true);

  // Models facet
  const models = await provider.models.getSupportedModels();
  assert.equal(models.DEFAULT, 'custom-pro');
  assert.equal(models.OPTIONS.length, 2);
  assert.equal(models.OPTIONS[0].value, 'custom-pro');

  // WatchPaths
  const watchPaths = provider.getWatchPaths();
  assert.equal(watchPaths.length, 1);
  assert.match(watchPaths[0].rootPath, /\.custom\/brain$/);
});

test('providerRegistry: supports dynamic register, resolve, and unregister of agent providers', async () => {
  const manifest = {
    name: 'test-agy-plugin',
    displayName: 'Google Antigravity (agy)',
    type: 'agent',
    agent: {
      providerId: 'agy',
      cliName: 'agy',
      defaultModel: 'gemini-2.5-pro',
      models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    },
  };

  const provider = new PluginAgentProvider(manifest as any, '/tmp/agy-plugin');

  let notified = 0;
  const unsubscribe = providerRegistry.onProvidersChanged(() => {
    notified++;
  });

  // Register
  providerRegistry.registerProvider(provider);
  assert.equal(providerRegistry.hasProvider('agy'), true);
  assert.equal(notified, 1);

  const resolved = providerRegistry.resolveProvider('agy');
  assert.equal(resolved.id, 'agy');

  // Resolve through higher-level services
  const models = await providerModelsService.getProviderModels('agy');
  assert.equal(models.DEFAULT, 'gemini-2.5-pro');

  const auth = await providerAuthService.getProviderAuthStatus('agy');
  assert.equal(auth.provider, 'agy');

  // Unregister
  const deleted = providerRegistry.unregisterProvider('agy');
  assert.equal(deleted, true);
  assert.equal(providerRegistry.hasProvider('agy'), false);
  assert.equal(notified, 2);

  unsubscribe();
});

test('pluginsService: dynamically registers agent provider on setEnabled', async () => {
  const agentManifest = {
    name: 'my-agent-plugin',
    displayName: 'My Dynamic Agent',
    type: 'agent',
    agent: {
      providerId: 'my-agent',
      cliName: 'my-agent',
    },
  };

  const configState: Record<string, any> = {};

  const service = createPluginsService({
    scanPlugins: () => [agentManifest as any],
    readConfig: () => configState,
    saveConfig: (cfg) => {
      Object.assign(configState, cfg);
    },
    getPluginDirectory: () => '/tmp/my-agent-plugin',
    getPluginsDirectory: () => '/tmp',
    resolveAsset: () => null,
    assetIsFile: () => false,
    contentType: () => '',
    install: async () => agentManifest,
    update: async () => agentManifest,
    uninstall: async () => {},
    startServer: async () => 0,
    stopServer: async () => {},
    getServerPort: () => undefined,
    isServerRunning: () => false,
    joinPath: (...parts: string[]) => parts.join('/'),
    logError: () => {},
  });

  // Enable plugin
  await service.setEnabled('my-agent-plugin', true);
  assert.equal(providerRegistry.hasProvider('my-agent'), true);

  // Disable plugin
  await service.setEnabled('my-agent-plugin', false);
  assert.equal(providerRegistry.hasProvider('my-agent'), false);
});
