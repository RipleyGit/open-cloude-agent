import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import { validateManifest } from '@/modules/plugins/plugin-registry.service.js';
import { PluginAgentProvider } from '@/modules/plugins/plugin-agent.provider.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { providerModelsService } from '@/modules/providers/services/provider-models.service.js';
import { providerAuthService } from '@/modules/providers/services/provider-auth.service.js';
import { createPluginsService } from '@/modules/plugins/plugins.service.js';
import { sessionsDb } from '@/modules/database/index.js';

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

test('PluginAgentSessionSynchronizer & PluginAgentSessions: discovers nested transcripts and normalizes messages', async () => {
  const tmpBrainDir = path.join(os.tmpdir(), `test-brain-${Date.now()}`);
  const sessDir = path.join(tmpBrainDir, 'test-sess-1', '.system_generated', 'logs');
  fs.mkdirSync(sessDir, { recursive: true });

  const transcriptFile = path.join(sessDir, 'transcript.jsonl');
  const rows = [
    JSON.stringify({
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: '2026-10-30T09:16:37Z',
      content: '<USER_REQUEST>\n请帮我安装项目组件\n</USER_REQUEST>',
    }),
    JSON.stringify({
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: '2026-10-30T09:16:38Z',
      thinking: '准备执行安装流程...',
      tool_calls: [{ id: 'call_1', name: 'run_command', args: { CommandLine: 'npm install' } }],
      content: '开始安装项目依赖',
    }),
    JSON.stringify({
      step_index: 2,
      source: 'MODEL',
      type: 'GENERIC',
      status: 'DONE',
      created_at: '2026-10-30T09:16:40Z',
      content: 'Dependencies installed successfully',
    }),
  ];
  fs.writeFileSync(transcriptFile, rows.join('\n') + '\n');

  try {
    const manifest = {
      name: 'cloude-agent-test',
      displayName: 'Test Agent',
      type: 'agent',
      agent: {
        providerId: 'test-agent',
        cliName: 'test-agent',
        watchPaths: [tmpBrainDir],
      },
    };

    const provider = new PluginAgentProvider(manifest as any, tmpBrainDir);
    const count = await provider.sessionSynchronizer.synchronize();
    assert.equal(count >= 1, true);

    const history = await provider.sessions.fetchHistory('test-sess-1');
    assert.equal(history.total >= 3, true);

    const userMsg = history.messages.find((m) => m.role === 'user' && m.kind === 'text');
    assert.ok(userMsg);
    assert.equal(userMsg?.content, '请帮我安装项目组件');

    const thinkingMsg = history.messages.find((m) => m.kind === 'thinking');
    assert.ok(thinkingMsg);
    assert.equal(thinkingMsg?.content, '准备执行安装流程...');

    const toolUse = history.messages.find((m) => m.kind === 'tool_use');
    assert.ok(toolUse);
    assert.equal(toolUse?.toolName, 'run_command');

    const toolRes = history.messages.find((m) => m.kind === 'tool_result');
    assert.ok(toolRes);
    assert.equal(toolRes?.content, 'Dependencies installed successfully');

    // Verify chunk files, transcript_full.jsonl, and steps are ignored
    const chunkFile = path.join(sessDir, 'chunks', 'transcript', '00000001.jsonl');
    fs.mkdirSync(path.dirname(chunkFile), { recursive: true });
    fs.writeFileSync(chunkFile, rows[0] + '\n');
    const syncChunk = await provider.sessionSynchronizer.synchronizeFile(chunkFile);
    assert.equal(syncChunk, null, 'chunks must be ignored');

    const fullFile = path.join(sessDir, 'transcript_full.jsonl');
    fs.writeFileSync(fullFile, rows[0] + '\n');
    const syncFull = await provider.sessionSynchronizer.synchronizeFile(fullFile);
    assert.equal(syncFull, null, 'transcript_full.jsonl must be ignored');
  } finally {
    try {
      fs.rmSync(tmpBrainDir, { recursive: true, force: true });
    } catch {}
  }
});

test('PluginAgentSessionSynchronizer: merges discovered transcript into existing unlinked app session', async () => {
  const tmpBrainDir = path.join(os.tmpdir(), `test-brain-dedupe-${Date.now()}`);
  const sessDir = path.join(tmpBrainDir, 'agy-uuid-999', '.system_generated', 'logs');
  fs.mkdirSync(sessDir, { recursive: true });

  const transcriptFile = path.join(sessDir, 'transcript.jsonl');
  const rows = [
    JSON.stringify({
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: new Date().toISOString(),
      content: '<USER_REQUEST>\n用户提问内容\n</USER_REQUEST>',
    }),
  ];
  fs.writeFileSync(transcriptFile, rows.join('\n') + '\n');

  try {
    const manifest = {
      name: 'cloude-agent-agy',
      displayName: 'Antigravity CLI',
      type: 'agent',
      agent: {
        providerId: 'agy',
        cliName: 'agy',
        watchPaths: [tmpBrainDir],
      },
    };

    const provider = new PluginAgentProvider(manifest as any, tmpBrainDir);

    // Create an unlinked app session beforehand
    const appSessionId = `app-sess-${Date.now()}`;
    sessionsDb.createAppSession(appSessionId, 'agy', process.cwd(), '用户提问内容');

    // Now synchronize the newly created transcript on disk
    const resultSessionId = await provider.sessionSynchronizer.synchronizeFile(transcriptFile);
    assert.equal(resultSessionId, appSessionId, 'must merge into the existing app session');

    // Confirm only 1 session exists for this conversation
    const row = sessionsDb.getSessionById(appSessionId);
    assert.ok(row);
    assert.equal(row?.provider_session_id, 'agy-uuid-999');
    assert.equal(row?.jsonl_path, transcriptFile);

    // Verify history can be fetched via appSessionId
    const history = await provider.sessions.fetchHistory(appSessionId);
    assert.equal(history.messages.length, 1);
    assert.equal(history.messages[0].content, '用户提问内容');
  } finally {
    try {
      fs.rmSync(tmpBrainDir, { recursive: true, force: true });
    } catch {}
  }
});
