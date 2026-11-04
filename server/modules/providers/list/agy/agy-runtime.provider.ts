import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import crossSpawn from 'cross-spawn';

import { sessionsDb } from '@/modules/database/index.js';
import { notifyRunFailed, notifyRunStopped } from '@/modules/notifications/index.js';
import type { IProviderRuntime } from '@/shared/interfaces.js';
import type { AnyRecord, ProviderRuntimeContext, ProviderRuntimeWriter } from '@/shared/types.js';
import { createCompleteMessage, createNormalizedMessage } from '@/shared/utils.js';

const reportRunFailed = notifyRunFailed as (input: AnyRecord) => void;
const reportRunStopped = notifyRunStopped as (input: AnyRecord) => void;

const PROVIDER = 'agy' as const;
const AGY_EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

/**
 * Resolves the path to the Antigravity CLI executable.
 * Prefers ~/.antigravity/antigravity/bin/agy if present, falling back to agy on PATH.
 */
function resolveAgyExecutable(): string {
  const customPath = path.join(os.homedir(), '.antigravity', 'antigravity', 'bin', 'agy');
  if (fs.existsSync(customPath)) {
    return customPath;
  }
  return 'agy';
}

/**
 * Converts the composer's shared default sentinel into an omitted Agy flag.
 * Agy rejects `--effort default`, while omitting the flag selects the model's
 * configured default effort level.
 */
function resolveAgyEffort(value: unknown): string | undefined {
  return typeof value === 'string' && AGY_EFFORT_LEVELS.has(value) ? value : undefined;
}

/**
 * Live execution adapter for Antigravity CLI (`agy`).
 * Runs prompts by spawning `agy -p ... --output-format stream-json` and streams events to the WebSocket client.
 */
export class AgyRuntime implements IProviderRuntime {
  private activeProcesses = new Map<string, ChildProcess>();

  async run(
    command: string,
    options: AnyRecord,
    writer: ProviderRuntimeWriter,
    context: ProviderRuntimeContext,
  ): Promise<unknown> {
    const appSessionId = String(options.sessionId ?? '');
    const providerSessionId = context.resolveProviderSessionId(appSessionId);
    const resolvedModel = await context.resolveResumeModel(appSessionId, options.model as string | undefined);

    return new Promise((resolve, reject) => {
      let capturedSessionId = providerSessionId;
      let completeSent = false;

      const args = [
        '-p',
        command,
        '--output-format',
        'stream-json',
        '--dangerously-skip-permissions',
        '--disable-slash-commands',
      ];

      if (resolvedModel) {
        args.push('--model', resolvedModel);
      }

      const effort = resolveAgyEffort(options.effort);
      if (effort) {
        args.push('--effort', effort);
      }

      if (providerSessionId) {
        args.push('--conversation', providerSessionId);
      }

      const cwd = typeof options.cwd === 'string' && options.cwd
        ? options.cwd
        : typeof options.projectPath === 'string' && options.projectPath
          ? options.projectPath
          : process.cwd();

      const proc = crossSpawn(resolveAgyExecutable(), args, {
        cwd,
        env: {
          ...process.env,
          ...((options.env as Record<string, string>) ?? {}),
        },
      });

      this.activeProcesses.set(appSessionId, proc);

      if (proc.stdout) {
        const rl = readline.createInterface({
          input: proc.stdout,
          crlfDelay: Infinity,
        });

        rl.on('line', (line) => {
          const trimmed = line.trim();
          if (!trimmed) return;

          try {
            const data = JSON.parse(trimmed) as AnyRecord;

            // 1. Session initialization: capture conversation_id
            if (data.event === 'init') {
              const initConvId = typeof data.conversation_id === 'string'
                ? data.conversation_id
                : typeof (data.init as AnyRecord)?.conversation_id === 'string'
                  ? (data.init as AnyRecord).conversation_id as string
                  : undefined;

              if (initConvId && !capturedSessionId) {
                capturedSessionId = initConvId;

                const transcriptPath = path.join(
                  os.homedir(),
                  '.gemini',
                  'antigravity-cli',
                  'brain',
                  initConvId,
                  '.system_generated',
                  'logs',
                  'transcript.jsonl',
                );

                sessionsDb.assignProviderSessionId(appSessionId, initConvId);
                sessionsDb.repointSessionToProviderSession(appSessionId, {
                  providerSessionId: initConvId,
                  jsonlPath: transcriptPath,
                });

                writer.setSessionId?.(initConvId);
                writer.send(
                  createNormalizedMessage({
                    kind: 'session_created',
                    newSessionId: initConvId,
                    sessionId: initConvId,
                    provider: 'agy',
                  }),
                );
              }
            }

            // 2. Incremental streaming updates
            if (data.event === 'step_update') {
              const stepUpdate = data.step_update as AnyRecord | undefined;
              if (stepUpdate) {
                if (typeof stepUpdate.text_delta === 'string') {
                  writer.send({
                    type: 'text_delta',
                    content: stepUpdate.text_delta,
                  });
                }

                if (stepUpdate.usage && typeof stepUpdate.usage === 'object') {
                  const usage = stepUpdate.usage as AnyRecord;
                  writer.send({
                    type: 'token_budget',
                    used: Number(usage.total_tokens ?? 0),
                    total: 1000000,
                    inputTokens: Number(usage.input_tokens ?? 0),
                    outputTokens: Number(usage.output_tokens ?? 0),
                  });
                }
              }
            }

            // 3. Final turn result
            if (data.event === 'result') {
              const result = data.result as AnyRecord | undefined;
              if (result?.usage && typeof result.usage === 'object') {
                const usage = result.usage as AnyRecord;
                writer.send({
                  type: 'token_budget',
                  used: Number(usage.total_tokens ?? 0),
                  total: 1000000,
                  inputTokens: Number(usage.input_tokens ?? 0),
                  outputTokens: Number(usage.output_tokens ?? 0),
                });
              }
            }
          } catch {
            // Raw text fallback if non-JSON output occurs
            writer.send({
              type: 'text_delta',
              content: line,
            });
          }
        });
      }

      proc.on('close', (code) => {
        this.activeProcesses.delete(appSessionId);

        if (!completeSent) {
          completeSent = true;
          writer.send(createCompleteMessage({
            provider: PROVIDER,
            sessionId: capturedSessionId || appSessionId || null,
            exitCode: code ?? 0,
          }));
        }

        if (code === 0) {
          resolve({ success: true, exitCode: code });
        } else {
          reportRunFailed({
            userId: null,
            provider: 'agy',
            sessionId: appSessionId,
            sessionName: 'Antigravity Session',
            error: new Error(`Antigravity CLI process exited with code ${code}`),
          });
          resolve({ success: false, exitCode: code });
        }
      });

      proc.on('error', (err) => {
        this.activeProcesses.delete(appSessionId);
        reportRunFailed({
          userId: null,
          provider: 'agy',
          sessionId: appSessionId,
          sessionName: 'Antigravity Session',
          error: err,
        });
        reject(err);
      });
    });
  }

  abort(sessionId: string): boolean {
    const proc = this.activeProcesses.get(sessionId);
    if (proc) {
      reportRunStopped({
        userId: null,
        provider: 'agy',
        sessionId,
        sessionName: 'Antigravity Session',
        stopReason: 'user_requested',
      });
      proc.kill('SIGTERM');
      this.activeProcesses.delete(sessionId);
      return true;
    }
    return false;
  }
}

export const agyRuntime = new AgyRuntime();
