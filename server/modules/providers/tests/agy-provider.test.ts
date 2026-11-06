import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AGY_PREDEFINED_MODELS } from '@/modules/providers/list/agy/agy-models.provider.js';
import { AgySessionsProvider } from '@/modules/providers/list/agy/agy-sessions.provider.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { providerCapabilitiesService } from '@/modules/providers/services/provider-capabilities.service.js';
import type { LLMProvider } from '@/shared/types.js';

test('providerRegistry resolves agy and aliases antigravity and activity', () => {
  const agy = providerRegistry.resolveProvider('agy');
  assert.equal(agy.id, 'agy');

  const antigravity = providerRegistry.resolveProvider('antigravity' as LLMProvider);
  assert.equal(antigravity.id, 'agy');

  const activity = providerRegistry.resolveProvider('activity' as LLMProvider);
  assert.equal(activity.id, 'agy');
});

test('providerCapabilitiesService reports correct capabilities for agy', () => {
  const caps = providerCapabilitiesService.getProviderCapabilities('agy');
  assert.equal(caps.provider, 'agy');
  assert.equal(caps.defaultPermissionMode, 'default');
  assert.ok(caps.permissionModes.includes('bypassPermissions'));
  assert.equal(caps.supportsAbort, true);
  assert.equal(caps.supportsEffort, true);
  assert.deepEqual(caps.effortLevels, ['low', 'medium', 'high', 'xhigh', 'max']);
});

test('agy predefined models catalog has expected default and effort options', async () => {
  const agy = providerRegistry.resolveProvider('agy');
  const models = await agy.models.getSupportedModels();

  assert.equal(models.DEFAULT, 'gemini-3.8-flash-high');
  assert.ok(models.OPTIONS.some((m) => m.value === 'gemini-3.8-flash-high'));
  assert.ok(models.OPTIONS.some((m) => m.value === 'claude-sonnet-4-6'));
  assert.ok(models.OPTIONS.some((m) => m.value === 'gpt-oss-120b-medium'));
});

test('AgyProviderSessions correctly parses and normalizes transcript.jsonl entries', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'agy-sessions-test-'));
  const transcriptPath = path.join(tempDir, 'transcript.jsonl');

  const sampleLines = [
    JSON.stringify({
      step_index: 0,
      type: 'USER_INPUT',
      content: 'Hello Antigravity CLI!',
      created_at: '2026-11-03T10:00:00.000Z',
    }),
    JSON.stringify({
      step_index: 1,
      type: 'PLANNER_RESPONSE',
      thinking: 'Thinking about the greeting...',
      tool_calls: [
        {
          id: 'call_1',
          name: 'read_file',
          parameters: { Path: '/test/hello.txt' },
        },
      ],
      content: 'Hello! How can I help you today?',
      created_at: '2026-11-03T10:00:02.000Z',
    }),
    JSON.stringify({
      step_index: 2,
      type: 'GENERIC',
      source: 'MODEL',
      content: 'hello world file content',
      status: 'DONE',
      created_at: '2026-11-03T10:00:03.000Z',
    }),
    JSON.stringify({
      step_index: 3,
      type: 'CHECKPOINT',
      source: 'SYSTEM',
      content: 'Summary of earlier work',
      status: 'DONE',
      created_at: '2026-11-03T10:00:04.000Z',
    }),
  ].join('\n');

  await writeFile(transcriptPath, sampleLines, 'utf8');

  try {
    const sessionsProvider = new AgySessionsProvider();
    const result = await sessionsProvider.fetchHistory('test-session-id', {
      limit: null,
      offset: 0,
      transcriptPath,
    });

    assert.equal(result.messages.length, 5); // 1 user + 1 thinking + 1 tool_use (with result attached) + 1 text response + 1 checkpoint

    // 1. User message
    assert.equal(result.messages[0].role, 'user');
    assert.equal(result.messages[0].content, 'Hello Antigravity CLI!');

    // 2. Thinking
    assert.equal(result.messages[1].role, 'assistant');
    assert.equal(result.messages[1].kind, 'thinking');
    assert.equal(result.messages[1].content, 'Thinking about the greeting...');

    // 3. Tool call with toolResult attached from step 2 GENERIC
    assert.equal(result.messages[2].role, 'assistant');
    assert.equal(result.messages[2].kind, 'tool_use');
    assert.equal(result.messages[2].toolName, 'read_file');
    assert.equal(result.messages[2].toolResult?.content, 'hello world file content');
    assert.equal(result.messages[2].toolResult?.isError, false);

    // 4. Response
    assert.equal(result.messages[3].role, 'assistant');
    assert.equal(result.messages[3].kind, 'text');
    assert.equal(result.messages[3].content, 'Hello! How can I help you today?');

    // 5. Compaction checkpoint
    assert.equal(result.messages[4].kind, 'text');
    assert.equal(result.messages[4].isCompactSummary, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('AgyProviderAuth returns valid status and parses account / quota details', async () => {
  const agy = providerRegistry.resolveProvider('agy');
  const status = await agy.auth.getStatus();

  assert.equal(status.installed, true);
  assert.equal(status.authenticated, true);
  assert.ok(status.method === 'api_key' || status.method === 'oauth');
  assert.ok(typeof status.email === 'string' && status.email.length > 0);
  assert.ok(status.quota);
  assert.ok(Array.isArray(status.quota.models) && status.quota.models.length > 0);
  assert.ok(typeof status.quota.averagePercentage === 'number');
  if (status.quota.weeklyUsedPercentage !== undefined) {
    assert.ok(typeof status.quota.weeklyUsedPercentage === 'number');
    assert.ok(status.quota.weeklyUsedPercentage >= 0 && status.quota.weeklyUsedPercentage <= 100);
  }
});
