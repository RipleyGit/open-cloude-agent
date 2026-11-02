import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'cross-spawn';
import { spawnSync } from 'node:child_process';

import { sessionsDb } from '@/modules/database/index.js';
import { getPluginPort, isPluginRunning } from '@/modules/plugins/plugin-process.service.js';
import type {
  IProvider,
  IProviderAuth,
  IProviderMcp,
  IProviderModels,
  IProviderRuntime,
  IProviderSessionSynchronizer,
  IProviderSessions,
  IProviderSkills,
} from '@/shared/interfaces.js';
import type {
  AnyRecord,
  CliVersionProbe,
  FetchHistoryOptions,
  FetchHistoryResult,
  LLMProvider,
  McpScope,
  NormalizedMessage,
  ProviderAuthStatus,
  ProviderCurrentActiveModel,
  ProviderMcpServer,
  ProviderModelOption,
  ProviderModelsDefinition,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
  ProviderSkill,
  ProviderSkillCreateInput,
  ProviderSkillListOptions,
  ProviderSkillRemoveInput,
  UpsertProviderMcpServerInput,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

export interface PluginAgentManifest {
  name: string;
  displayName?: string;
  type?: string;
  agent?: {
    id?: string;
    providerId?: string;
    displayName?: string;
    cliName?: string;
    binary?: string;
    watchPaths?: string[];
    models?: Array<string | ProviderModelOption>;
    defaultModel?: string;
    sessionsPath?: string;
  };
  server?: string | { entry: string };
  [key: string]: unknown;
}

export class NoopMcpProvider implements IProviderMcp {
  constructor(private providerId: LLMProvider) {}

  async listServers(): Promise<Record<McpScope, ProviderMcpServer[]>> {
    return { user: [], local: [], project: [] };
  }

  async listServersForScope(scope: McpScope): Promise<ProviderMcpServer[]> {
    return [];
  }

  async upsertServer(input: UpsertProviderMcpServerInput): Promise<ProviderMcpServer> {
    throw new AppError('MCP is not supported by this agent provider.', {
      code: 'MCP_NOT_SUPPORTED',
      statusCode: 400,
    });
  }

  async removeServer(input: { name: string; scope?: McpScope; workspacePath?: string }): Promise<{
    removed: boolean;
    provider: LLMProvider;
    name: string;
    scope: McpScope;
  }> {
    return {
      removed: false,
      provider: this.providerId,
      name: input.name,
      scope: input.scope || 'user',
    };
  }
}

export class NoopSkillsProvider implements IProviderSkills {
  constructor(private providerId: LLMProvider) {}

  async listSkills(options?: ProviderSkillListOptions): Promise<ProviderSkill[]> {
    return [];
  }

  async addSkills(input: ProviderSkillCreateInput): Promise<ProviderSkill[]> {
    throw new AppError('Skills are not supported by this agent provider.', {
      code: 'SKILLS_NOT_SUPPORTED',
      statusCode: 400,
    });
  }

  async removeSkill(input: ProviderSkillRemoveInput): Promise<{
    removed: boolean;
    provider: LLMProvider;
    directoryName: string;
  }> {
    return {
      removed: false,
      provider: this.providerId,
      directoryName: input.directoryName,
    };
  }
}

export class PluginAgentRuntime implements IProviderRuntime {
  private activeProcesses = new Map<string, any>();

  constructor(
    private pluginName: string,
    private manifest: PluginAgentManifest,
  ) {}

  async run(
    command: string,
    options: AnyRecord,
    writer: ProviderRuntimeWriter,
    context: ProviderRuntimeContext,
  ): Promise<unknown> {
    const port = getPluginPort(this.pluginName);
    const sessionId = (options.sessionId as string) || `sess_${Date.now()}`;
    const model = (options.model as string) || this.manifest.agent?.defaultModel;

    // 1. If plugin background server subprocess is running, route turn via loopback HTTP
    if (port && isPluginRunning(this.pluginName)) {
      try {
        const payload = JSON.stringify({
          message: command,
          prompt: command,
          model,
          sessionId,
        });

        const res = await new Promise<{ response?: string; error?: string }>((resolve, reject) => {
          const req = http.request(
            {
              hostname: '127.0.0.1',
              port,
              path: '/chat',
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              },
              timeout: 120_000,
            },
            (response) => {
              let body = '';
              response.on('data', (chunk) => {
                const text = chunk.toString();
                body += text;
                writer.send({
                  type: 'text_delta',
                  content: text,
                });
              });
              response.on('end', () => {
                try {
                  resolve(body ? JSON.parse(body) : {});
                } catch {
                  resolve({ response: body });
                }
              });
            },
          );
          req.on('error', reject);
          req.on('timeout', () => {
            req.destroy(new Error('Turn timeout'));
          });
          req.write(payload);
          req.end();
        });

        const reply = res.response || (res as any).output || '';
        writer.send({
          type: 'text',
          content: reply,
        });
        return { success: true, response: reply };
      } catch (err: any) {
        console.warn(`[PluginAgentRuntime] HTTP run failed, falling back to CLI spawn: ${err.message}`);
      }
    }

    // 2. Direct CLI spawn fallback
    const binary = this.manifest.agent?.cliName || this.manifest.agent?.binary || 'agy';
    return new Promise((resolve, reject) => {
      const args = [
        '-p',
        command,
        '--output-format',
        'stream-json',
        '--dangerously-skip-permissions',
        '--disable-slash-commands',
      ];
      if (model) {
        args.push('--model', model);
      }
      if (sessionId) {
        args.push('--conversation', sessionId);
      }

      const proc = spawn(binary, args, {
        cwd: (options.cwd as string) || process.cwd(),
        env: { ...process.env, ...(options.env as Record<string, string>) },
      });

      this.activeProcesses.set(sessionId, proc);

      let stdoutAcc = '';
      proc.stdout?.on('data', (data) => {
        const str = data.toString();
        stdoutAcc += str;
        const lines = str.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.event === 'step_update' && parsed.step_update?.text_delta) {
              writer.send({
                type: 'text_delta',
                content: parsed.step_update.text_delta,
              });
            } else if (parsed.event === 'result' && parsed.result?.response) {
              writer.send({
                type: 'text',
                content: parsed.result.response,
              });
            }
          } catch {
            writer.send({
              type: 'text_delta',
              content: str,
            });
          }
        }
      });

      proc.on('close', (code) => {
        this.activeProcesses.delete(sessionId);
        if (code === 0) {
          resolve({ success: true, output: stdoutAcc });
        } else {
          resolve({ success: false, exitCode: code, output: stdoutAcc });
        }
      });

      proc.on('error', (err) => {
        this.activeProcesses.delete(sessionId);
        reject(err);
      });
    });
  }

  async abort(sessionId: string): Promise<boolean> {
    const port = getPluginPort(this.pluginName);
    if (port && isPluginRunning(this.pluginName)) {
      try {
        const payload = JSON.stringify({ sessionId });
        await new Promise((resolve, reject) => {
          const req = http.request(
            {
              hostname: '127.0.0.1',
              port,
              path: '/abort',
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              },
              timeout: 3000,
            },
            (res) => {
              res.resume();
              resolve(true);
            },
          );
          req.on('error', reject);
          req.write(payload);
          req.end();
        });
        return true;
      } catch {
        // Fall through
      }
    }

    const proc = this.activeProcesses.get(sessionId);
    if (proc) {
      proc.kill('SIGTERM');
      this.activeProcesses.delete(sessionId);
      return true;
    }
    return false;
  }
}

export class PluginAgentModels implements IProviderModels {
  constructor(
    private pluginName: string,
    private manifest: PluginAgentManifest,
  ) {}

  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    const port = getPluginPort(this.pluginName);
    if (port && isPluginRunning(this.pluginName)) {
      try {
        const res = await new Promise<{ models?: any[] }>((resolve, reject) => {
          const req = http.request(
            {
              hostname: '127.0.0.1',
              port,
              path: '/models',
              method: 'GET',
              timeout: 3000,
            },
            (r) => {
              let d = '';
              r.on('data', (chunk) => (d += chunk));
              r.on('end', () => {
                try {
                  resolve(JSON.parse(d));
                } catch {
                  resolve({});
                }
              });
            },
          );
          req.on('error', reject);
          req.end();
        });

        if (Array.isArray(res.models) && res.models.length > 0) {
          const defaultModel = res.models[0].value || res.models[0].id || String(res.models[0]);
          return {
            DEFAULT: defaultModel,
            OPTIONS: res.models.map((m) =>
              typeof m === 'string'
                ? { value: m, label: m }
                : { value: m.value || m.id, label: m.label || m.name || m.value },
            ),
          };
        }
      } catch {
        // Fall back to manifest
      }
    }

    const declared = this.manifest.agent?.models || [
      { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { value: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash' },
    ];

    const defaultModel =
      this.manifest.agent?.defaultModel ||
      (typeof declared[0] === 'string' ? (declared[0] as string) : (declared[0] as ProviderModelOption).value);

    return {
      DEFAULT: defaultModel,
      OPTIONS: declared.map((m) =>
        typeof m === 'string'
          ? { value: m, label: m }
          : { value: m.value, label: m.label || m.value, description: m.description },
      ),
    };
  }

  async getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel> {
    const catalog = await this.getSupportedModels();
    return {
      model: catalog.DEFAULT,
    };
  }
}

export class PluginAgentAuth implements IProviderAuth {
  constructor(
    private providerId: LLMProvider,
    private pluginName: string,
    private manifest: PluginAgentManifest,
  ) {}

  checkInstalled(): CliVersionProbe {
    const binary = this.manifest.agent?.cliName || this.manifest.agent?.binary || 'agy';
    try {
      const probe = spawnSync(binary, ['--version'], { encoding: 'utf-8', timeout: 3000 });
      const installed = probe.status === 0;
      const version = installed ? probe.stdout.trim().split('\n')[0] : null;
      return {
        installed,
        exitCode: probe.status,
        version,
      };
    } catch {
      return {
        installed: false,
        exitCode: null,
        version: null,
      };
    }
  }

  async getStatus(): Promise<ProviderAuthStatus> {
    const port = getPluginPort(this.pluginName);
    if (port && isPluginRunning(this.pluginName)) {
      try {
        const res = await new Promise<{ installed?: boolean; isReady?: boolean; version?: string }>(
          (resolve, reject) => {
            const req = http.request(
              {
                hostname: '127.0.0.1',
                port,
                path: '/status',
                method: 'GET',
                timeout: 3000,
              },
              (r) => {
                let d = '';
                r.on('data', (c) => (d += c));
                r.on('end', () => {
                  try {
                    resolve(JSON.parse(d));
                  } catch {
                    resolve({});
                  }
                });
              },
            );
            req.on('error', reject);
            req.end();
          },
        );

        const isInstalled = res.installed ?? res.isReady ?? true;
        return {
          installed: isInstalled,
          provider: this.providerId,
          installedVersion: res.version || '1.0.0',
          authenticated: isInstalled,
          email: null,
          method: 'plugin',
        };
      } catch {
        // Probe CLI directly
      }
    }

    const probe = this.checkInstalled();
    return {
      installed: probe.installed,
      provider: this.providerId,
      installedVersion: probe.version,
      authenticated: probe.installed,
      email: null,
      method: 'cli',
    };
  }
}

export class PluginAgentSessions implements IProviderSessions {
  constructor(
    private providerId: LLMProvider,
    private pluginName: string,
  ) {}

  normalizeMessage(raw: unknown, sessionId: string | null): NormalizedMessage[] {
    const ts = new Date().toISOString();
    const sid = sessionId || '';

    if (raw && typeof raw === 'object' && 'role' in raw && 'content' in raw) {
      const msg = raw as any;
      return [
        {
          id: msg.id || `msg-${Date.now()}`,
          sessionId: sid,
          provider: this.providerId,
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          timestamp: msg.timestamp || ts,
          kind: 'text',
        },
      ];
    }

    return [
      {
        id: `msg-${Date.now()}`,
        sessionId: sid,
        provider: this.providerId,
        role: 'assistant',
        content: typeof raw === 'string' ? raw : JSON.stringify(raw),
        timestamp: ts,
        kind: 'text',
      },
    ];
  }

  async fetchHistory(sessionId: string, options?: FetchHistoryOptions): Promise<FetchHistoryResult> {
    const port = getPluginPort(this.pluginName);
    if (port && isPluginRunning(this.pluginName)) {
      try {
        const res = await new Promise<{ session?: { messages?: any[] } }>((resolve, reject) => {
          const req = http.request(
            {
              hostname: '127.0.0.1',
              port,
              path: `/sessions/${sessionId}`,
              method: 'GET',
              timeout: 3000,
            },
            (r) => {
              let d = '';
              r.on('data', (c) => (d += c));
              r.on('end', () => {
                try {
                  resolve(JSON.parse(d));
                } catch {
                  resolve({});
                }
              });
            },
          );
          req.on('error', reject);
          req.end();
        });

        if (Array.isArray(res.session?.messages)) {
          const messages = res.session!.messages.flatMap((m) => this.normalizeMessage(m, sessionId));
          return {
            messages,
            total: messages.length,
            hasMore: false,
            offset: options?.offset ?? 0,
            limit: options?.limit ?? null,
          };
        }
      } catch {
        // Fall through
      }
    }
    return {
      messages: [],
      total: 0,
      hasMore: false,
      offset: options?.offset ?? 0,
      limit: options?.limit ?? null,
    };
  }
}

export class PluginAgentSessionSynchronizer implements IProviderSessionSynchronizer {
  constructor(
    private providerId: LLMProvider,
    private pluginName: string,
    private manifest: PluginAgentManifest,
  ) {}

  async synchronize(since?: Date): Promise<number> {
    let synchronized = 0;
    const port = getPluginPort(this.pluginName);

    // 1. Fetch sessions from plugin server if available
    if (port && isPluginRunning(this.pluginName)) {
      try {
        const res = await new Promise<{ sessions?: any[] }>((resolve, reject) => {
          const req = http.request(
            {
              hostname: '127.0.0.1',
              port,
              path: '/sessions',
              method: 'GET',
              timeout: 3000,
            },
            (r) => {
              let d = '';
              r.on('data', (c) => (d += c));
              r.on('end', () => {
                try {
                  resolve(JSON.parse(d));
                } catch {
                  resolve({});
                }
              });
            },
          );
          req.on('error', reject);
          req.end();
        });

        if (Array.isArray(res.sessions)) {
          for (const s of res.sessions) {
            const sid = s.id || s.sessionId || s.conversationId;
            if (!sid) continue;
            const projectPath = s.projectPath || process.cwd();
            const title = s.title || s.customName || s.summary || `Session ${sid.slice(0, 8)}`;
            const updatedAt = s.updatedAt || new Date().toISOString();
            const createdAt = s.createdAt || updatedAt;

            sessionsDb.createSession(
              sid,
              this.providerId,
              projectPath,
              title,
              createdAt,
              updatedAt,
              s.jsonlPath || null,
            );
            synchronized++;
          }
        }
      } catch (err: any) {
        console.warn(`[PluginAgentSessionSynchronizer] Error synchronizing from plugin server: ${err.message}`);
      }
    }

    // 2. Scan watchPaths if declared
    const watchPaths = this.getWatchPaths();
    for (const wp of watchPaths) {
      if (!fs.existsSync(wp.rootPath)) continue;
      try {
        const files = fs.readdirSync(wp.rootPath);
        for (const f of files) {
          if (!f.endsWith('.json') && !f.endsWith('.jsonl')) continue;
          const fullPath = path.join(wp.rootPath, f);
          const stat = fs.statSync(fullPath);
          if (since && stat.mtime <= since) continue;

          const baseName = path.basename(f, path.extname(f));
          sessionsDb.createSession(
            baseName,
            this.providerId,
            process.cwd(),
            baseName,
            stat.birthtime.toISOString(),
            stat.mtime.toISOString(),
            fullPath,
          );
          synchronized++;
        }
      } catch {
        // Ignore read errors
      }
    }

    return synchronized;
  }

  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!fs.existsSync(filePath)) return null;
    try {
      const stat = fs.statSync(filePath);
      const baseName = path.basename(filePath, path.extname(filePath));
      const sid = sessionsDb.createSession(
        baseName,
        this.providerId,
        process.cwd(),
        baseName,
        stat.birthtime.toISOString(),
        stat.mtime.toISOString(),
        filePath,
      );
      return sid || baseName;
    } catch {
      return null;
    }
  }

  getWatchPaths(): Array<{ rootPath: string }> {
    const rawPaths = this.manifest.agent?.watchPaths || [];
    const result: Array<{ rootPath: string }> = [];

    for (const raw of rawPaths) {
      let resolved = raw.replace(/^~(?=$|\/|\\)/, os.homedir());
      if (!path.isAbsolute(resolved)) {
        resolved = path.join(os.homedir(), resolved);
      }
      result.push({ rootPath: resolved });
    }

    if (result.length === 0 && (this.providerId === 'agy' || this.pluginName.includes('agy'))) {
      result.push({
        rootPath: path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain'),
      });
    }

    return result;
  }
}

/**
 * Concrete provider instance dynamically created for an agent plugin.
 */
export class PluginAgentProvider implements IProvider {
  readonly id: LLMProvider;
  readonly isPlugin = true;
  readonly displayName: string;
  readonly runtime: IProviderRuntime;
  readonly models: IProviderModels;
  readonly mcp: IProviderMcp;
  readonly auth: IProviderAuth;
  readonly skills: IProviderSkills;
  readonly sessions: IProviderSessions;
  readonly sessionSynchronizer: IProviderSessionSynchronizer;

  constructor(
    readonly manifest: PluginAgentManifest,
    readonly pluginDir: string,
  ) {
    const rawId =
      manifest.agent?.id ||
      manifest.agent?.providerId ||
      manifest.name.replace(/^cloudcli-plugin-/, '');

    this.id = rawId as LLMProvider;
    this.displayName = manifest.displayName || manifest.agent?.displayName || manifest.name;

    this.runtime = new PluginAgentRuntime(manifest.name, manifest);
    this.models = new PluginAgentModels(manifest.name, manifest);
    this.auth = new PluginAgentAuth(this.id, manifest.name, manifest);
    this.sessions = new PluginAgentSessions(this.id, manifest.name);
    this.sessionSynchronizer = new PluginAgentSessionSynchronizer(this.id, manifest.name, manifest);
    this.mcp = new NoopMcpProvider(this.id);
    this.skills = new NoopSkillsProvider(this.id);
  }

  getWatchPaths(): Array<{ rootPath: string }> {
    return (this.sessionSynchronizer as any).getWatchPaths?.() || [];
  }
}
