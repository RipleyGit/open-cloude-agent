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
    const binary =
      this.manifest.agent?.cliName ||
      this.manifest.agent?.binary ||
      this.manifest.name.replace(/^cloudcli-plugin-/, '').replace(/^cloude-agent-/, '');
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
    const binary = this.manifest.agent?.cliName || this.manifest.agent?.binary || this.providerId;
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

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

interface DiscoveredTranscript {
  sessionId: string;
  transcriptPath: string;
}

function extractTranscriptMeta(
  filePath: string,
  fallbackId: string,
): {
  title?: string;
  projectPath?: string;
  createdAt?: string;
  updatedAt?: string;
} {
  try {
    const stat = fs.statSync(filePath);
    const result: { title?: string; projectPath?: string; createdAt?: string; updatedAt?: string } = {
      createdAt: stat.birthtime.toISOString(),
      updatedAt: stat.mtime.toISOString(),
    };

    let fd: number | null = null;
    let chunk = '';
    try {
      fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(32768);
      const bytesRead = fs.readSync(fd, buffer, 0, 32768, 0);
      chunk = buffer.toString('utf8', 0, bytesRead);
    } finally {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch { /* ignore */ }
      }
    }

    const lines = chunk.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = tryParseJson(trimmed) as any;
      if (!parsed || typeof parsed !== 'object') continue;

      // 1. Antigravity CLI format: type === 'USER_INPUT'
      if (parsed.type === 'USER_INPUT' && parsed.content) {
        const raw = String(parsed.content);
        const userReqMatch = raw.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
        const rawText = userReqMatch ? userReqMatch[1] : raw;
        const cleanText = rawText.replace(/<[^>]+>/g, '').trim().replace(/\s+/g, ' ');
        if (cleanText && !result.title) {
          result.title = cleanText.length > 60 ? cleanText.slice(0, 60) + '...' : cleanText;
        }
        if (parsed.created_at) {
          result.createdAt = new Date(parsed.created_at).toISOString();
        }
      }

      // Check for workspace / cwd in content or payload
      if (parsed.content && typeof parsed.content === 'string') {
        const wsMatch = parsed.content.match(/(?:Active Workspaces:|Command Working Directory:)\s*([^\r\n<]+)/i);
        if (wsMatch && wsMatch[1]) {
          const candidate = wsMatch[1].trim().replace(/^[-*]\s*/, '');
          if (fs.existsSync(candidate)) {
            result.projectPath = candidate;
          }
        }
      }

      // 2. Claude format: type === 'user' or message.role === 'user'
      if (parsed.message?.role === 'user' || parsed.type === 'user' || parsed.role === 'user') {
        const content = parsed.message?.content || parsed.content;
        const text =
          typeof content === 'string'
            ? content
            : Array.isArray(content)
              ? content.map((c: any) => c.text || '').join(' ')
              : '';
        const cleanText = text.trim().replace(/\s+/g, ' ');
        if (cleanText && !result.title) {
          result.title = cleanText.length > 60 ? cleanText.slice(0, 60) + '...' : cleanText;
        }
      }

      // 3. Codex format: payload.cwd / payload.id / thread_name
      if (parsed.payload) {
        if (parsed.payload.cwd && fs.existsSync(parsed.payload.cwd)) {
          result.projectPath = parsed.payload.cwd;
        }
        if (parsed.payload.thread_name && !result.title) {
          result.title = parsed.payload.thread_name;
        }
      }

      if (parsed.cwd && fs.existsSync(parsed.cwd)) {
        result.projectPath = parsed.cwd;
      }

      if (result.title && result.projectPath) {
        break;
      }
    }

    return result;
  } catch {
    return {};
  }
}

function findTranscriptsInWatchPath(watchRoot: string): DiscoveredTranscript[] {
  const results: DiscoveredTranscript[] = [];
  if (!fs.existsSync(watchRoot)) return results;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(watchRoot, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(watchRoot, entry.name);

    // Case 1: Direct JSONL file: e.g. <watchRoot>/<sessionId>.jsonl
    if (entry.isFile()) {
      if (entry.name.endsWith('.jsonl') || entry.name.endsWith('.json')) {
        const sessionId = path.basename(entry.name, path.extname(entry.name));
        results.push({ sessionId, transcriptPath: fullPath });
      }
      continue;
    }

    // Case 2: Subdirectory: e.g. <watchRoot>/<sessionId>/
    if (entry.isDirectory()) {
      const sessionId = entry.name;

      // Antigravity CLI structure: <sessionId>/.system_generated/logs/transcript.jsonl
      const agyTranscript = path.join(fullPath, '.system_generated', 'logs', 'transcript.jsonl');
      if (fs.existsSync(agyTranscript)) {
        results.push({ sessionId, transcriptPath: agyTranscript });
        continue;
      }

      // Standard nested transcript: <sessionId>/transcript.jsonl
      const standardTranscript = path.join(fullPath, 'transcript.jsonl');
      if (fs.existsSync(standardTranscript)) {
        results.push({ sessionId, transcriptPath: standardTranscript });
        continue;
      }

      // <sessionId>/session.jsonl
      const sessionJsonl = path.join(fullPath, 'session.jsonl');
      if (fs.existsSync(sessionJsonl)) {
        results.push({ sessionId, transcriptPath: sessionJsonl });
        continue;
      }

      // Check one level deeper for transcript files
      try {
        const subEntries = fs.readdirSync(fullPath, { withFileTypes: true });
        for (const sub of subEntries) {
          if (sub.isFile() && (sub.name.endsWith('.jsonl') || sub.name.endsWith('.json'))) {
            const subId = path.basename(sub.name, path.extname(sub.name));
            results.push({ sessionId: subId, transcriptPath: path.join(fullPath, sub.name) });
          } else if (sub.isDirectory()) {
            const nestedAgy = path.join(fullPath, sub.name, '.system_generated', 'logs', 'transcript.jsonl');
            if (fs.existsSync(nestedAgy)) {
              results.push({ sessionId: sub.name, transcriptPath: nestedAgy });
            } else {
              const nestedTranscript = path.join(fullPath, sub.name, 'transcript.jsonl');
              if (fs.existsSync(nestedTranscript)) {
                results.push({ sessionId: sub.name, transcriptPath: nestedTranscript });
              }
            }
          }
        }
      } catch {
        // Ignore read errors
      }
    }
  }

  return results;
}

export class PluginAgentSessions implements IProviderSessions {
  constructor(
    private providerId: LLMProvider,
    private pluginName: string,
    private getWatchPaths?: () => Array<{ rootPath: string }>,
  ) {}

  normalizeMessage(raw: unknown, sessionId: string | null): NormalizedMessage[] {
    const ts = new Date().toISOString();
    const sid = sessionId || '';

    if (!raw || typeof raw !== 'object') {
      return [
        {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          sessionId: sid,
          provider: this.providerId,
          role: 'assistant',
          content: typeof raw === 'string' ? raw : String(raw),
          text: typeof raw === 'string' ? raw : String(raw),
          timestamp: ts,
          kind: 'text',
        },
      ];
    }

    const item = raw as any;
    const msgTs = item.created_at || item.timestamp || ts;
    const baseId = item.id || (item.step_index !== undefined ? `step-${item.step_index}` : `msg-${Date.now()}`);

    // Case 1: Antigravity / AGY step format
    if (item.type === 'USER_INPUT' || item.source === 'USER_EXPLICIT') {
      const rawContent = String(item.content || '');
      const userReqMatch = rawContent.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
      const cleanContent = userReqMatch ? userReqMatch[1].trim() : rawContent;
      return [
        {
          id: `${baseId}-user`,
          sessionId: sid,
          provider: this.providerId,
          role: 'user',
          kind: 'text',
          content: cleanContent,
          text: cleanContent,
          timestamp: msgTs,
        },
      ];
    }

    if (item.type === 'PLANNER_RESPONSE' || (item.source === 'MODEL' && (item.thinking || item.tool_calls))) {
      const messages: NormalizedMessage[] = [];

      // Thinking content
      if (item.thinking && typeof item.thinking === 'string' && item.thinking.trim()) {
        messages.push({
          id: `${baseId}-thinking`,
          sessionId: sid,
          provider: this.providerId,
          role: 'assistant',
          kind: 'thinking',
          content: item.thinking.trim(),
          text: item.thinking.trim(),
          timestamp: msgTs,
        });
      }

      // Tool calls
      if (Array.isArray(item.tool_calls)) {
        for (let i = 0; i < item.tool_calls.length; i++) {
          const tool = item.tool_calls[i];
          const toolName = tool.name || tool.function?.name || 'tool';
          const toolArgs = tool.args || tool.function?.arguments || {};
          messages.push({
            id: `${baseId}-tool-${i}`,
            sessionId: sid,
            provider: this.providerId,
            role: 'assistant',
            kind: 'tool_use',
            toolName,
            toolInput: typeof toolArgs === 'string' ? (tryParseJson(toolArgs) ?? toolArgs) : toolArgs,
            toolId: tool.id || `${baseId}-call-${i}`,
            timestamp: msgTs,
          });
        }
      }

      // Assistant prose content
      if (item.content && typeof item.content === 'string' && item.content.trim()) {
        messages.push({
          id: `${baseId}-text`,
          sessionId: sid,
          provider: this.providerId,
          role: 'assistant',
          kind: 'text',
          content: item.content,
          text: item.content,
          timestamp: msgTs,
        });
      }

      if (messages.length > 0) return messages;
    }

    if (item.type === 'GENERIC' && item.source === 'MODEL') {
      // Tool output / execution result
      return [
        {
          id: `${baseId}-result`,
          sessionId: sid,
          provider: this.providerId,
          role: 'user',
          kind: 'tool_result',
          content: typeof item.content === 'string' ? item.content : JSON.stringify(item.content),
          toolResult: {
            content: typeof item.content === 'string' ? item.content : JSON.stringify(item.content),
            isError: item.status === 'ERROR',
          },
          timestamp: msgTs,
        },
      ];
    }

    // Case 2: Standard { role, content } or Claude/Codex message structure
    const role = item.role || item.message?.role;
    const content = item.content || item.message?.content;
    if (role && content !== undefined) {
      if (typeof content === 'string') {
        return [
          {
            id: baseId,
            sessionId: sid,
            provider: this.providerId,
            role: role === 'user' ? 'user' : 'assistant',
            kind: item.kind || 'text',
            content,
            text: content,
            timestamp: msgTs,
          },
        ];
      }
      if (Array.isArray(content)) {
        const msgs: NormalizedMessage[] = [];
        for (let i = 0; i < content.length; i++) {
          const part = content[i];
          if (part.type === 'text') {
            msgs.push({
              id: `${baseId}-${i}`,
              sessionId: sid,
              provider: this.providerId,
              role: role === 'user' ? 'user' : 'assistant',
              kind: 'text',
              content: part.text,
              text: part.text,
              timestamp: msgTs,
            });
          } else if (part.type === 'tool_use') {
            msgs.push({
              id: `${baseId}-${i}`,
              sessionId: sid,
              provider: this.providerId,
              role: 'assistant',
              kind: 'tool_use',
              toolName: part.name,
              toolInput: part.input,
              toolId: part.id,
              timestamp: msgTs,
            });
          } else if (part.type === 'tool_result') {
            msgs.push({
              id: `${baseId}-${i}`,
              sessionId: sid,
              provider: this.providerId,
              role: 'user',
              kind: 'tool_result',
              content: typeof part.content === 'string' ? part.content : JSON.stringify(part.content),
              toolResult: { content: typeof part.content === 'string' ? part.content : JSON.stringify(part.content) },
              toolId: part.tool_use_id,
              timestamp: msgTs,
            });
          }
        }
        if (msgs.length > 0) return msgs;
      }
    }

    // Fallback
    return [
      {
        id: baseId,
        sessionId: sid,
        provider: this.providerId,
        role: item.role === 'user' ? 'user' : 'assistant',
        kind: item.kind || 'text',
        content: typeof item.content === 'string' ? item.content : JSON.stringify(item),
        text: typeof item.content === 'string' ? item.content : JSON.stringify(item),
        timestamp: msgTs,
      },
    ];
  }

  async fetchHistory(sessionId: string, options?: FetchHistoryOptions): Promise<FetchHistoryResult> {
    const limit = options?.limit ?? null;
    const offset = options?.offset ?? 0;

    // 1. Check if the session is recorded in sessionsDb with a jsonl_path
    let jsonlPath: string | null = null;
    const dbSession =
      sessionsDb.getSessionById(sessionId) ??
      sessionsDb.getSessionByProviderSessionId(sessionId);

    if (dbSession?.jsonl_path && fs.existsSync(dbSession.jsonl_path)) {
      jsonlPath = dbSession.jsonl_path;
    }

    // 2. If not found in DB row, scan declared watchPaths for this sessionId
    if (!jsonlPath && this.getWatchPaths) {
      const watchPaths = this.getWatchPaths();
      for (const wp of watchPaths) {
        const root = wp.rootPath;
        if (!fs.existsSync(root)) continue;
        const candidates = [
          path.join(root, sessionId, '.system_generated', 'logs', 'transcript.jsonl'),
          path.join(root, sessionId, 'transcript.jsonl'),
          path.join(root, sessionId, 'session.jsonl'),
          path.join(root, `${sessionId}.jsonl`),
        ];
        for (const cand of candidates) {
          if (fs.existsSync(cand)) {
            jsonlPath = cand;
            break;
          }
        }
        if (jsonlPath) break;
      }
    }

    // 3. If transcript file found on disk, read and normalize lines
    if (jsonlPath && fs.existsSync(jsonlPath)) {
      try {
        const fileContent = fs.readFileSync(jsonlPath, 'utf8');
        const lines = fileContent.split('\n');
        const allMessages: NormalizedMessage[] = [];

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const parsed = tryParseJson(trimmed);
          if (parsed) {
            const normalized = this.normalizeMessage(parsed, sessionId);
            allMessages.push(...normalized);
          }
        }

        const total = allMessages.length;
        const start = Math.max(0, offset);
        const end = limit !== null ? start + limit : total;
        const page = allMessages.slice(start, end);
        const hasMore = end < total;

        return {
          messages: page,
          total,
          hasMore,
          offset,
          limit,
        };
      } catch (err: any) {
        console.warn(`[PluginAgentSessions] Failed to read transcript from ${jsonlPath}: ${err.message}`);
      }
    }

    // 4. Fallback: Query plugin server if active
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
          const total = messages.length;
          const start = Math.max(0, offset);
          const end = limit !== null ? start + limit : total;
          return {
            messages: messages.slice(start, end),
            total,
            hasMore: end < total,
            offset,
            limit,
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
      offset,
      limit,
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

    // If this provider has 0 indexed sessions in DB, do a full initial scan (ignore `since`)
    const existingSessions = (sessionsDb as any).getSessionsByProvider
      ? (sessionsDb as any).getSessionsByProvider(this.providerId)
      : [];
    const effectiveSince = existingSessions.length === 0 ? undefined : since;

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

    // 2. Deep-scan watchPaths if declared
    const watchPaths = this.getWatchPaths();
    for (const wp of watchPaths) {
      if (!fs.existsSync(wp.rootPath)) continue;
      const discovered = findTranscriptsInWatchPath(wp.rootPath);
      for (const item of discovered) {
        try {
          const stat = fs.statSync(item.transcriptPath);
          if (effectiveSince && stat.mtime <= effectiveSince) continue;

          const meta = extractTranscriptMeta(item.transcriptPath, item.sessionId);
          const projectPath = meta.projectPath || process.cwd();
          const title = meta.title || `Session ${item.sessionId.slice(0, 8)}`;
          const createdAt = meta.createdAt || stat.birthtime.toISOString();
          const updatedAt = meta.updatedAt || stat.mtime.toISOString();

          sessionsDb.createSession(
            item.sessionId,
            this.providerId,
            projectPath,
            title,
            createdAt,
            updatedAt,
            item.transcriptPath,
          );
          synchronized++;
        } catch {
          // Ignore individual file errors
        }
      }
    }

    return synchronized;
  }

  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!fs.existsSync(filePath)) return null;
    try {
      const stat = fs.statSync(filePath);
      let sessionId = path.basename(filePath, path.extname(filePath));

      if (filePath.endsWith(path.join('.system_generated', 'logs', 'transcript.jsonl'))) {
        const parts = filePath.split(path.sep);
        const idx = parts.lastIndexOf('.system_generated');
        if (idx > 0) {
          sessionId = parts[idx - 1];
        }
      } else if (path.basename(filePath) === 'transcript.jsonl' || path.basename(filePath) === 'session.jsonl') {
        sessionId = path.basename(path.dirname(filePath));
      }

      const meta = extractTranscriptMeta(filePath, sessionId);
      const projectPath = meta.projectPath || process.cwd();
      const title = meta.title || `Session ${sessionId.slice(0, 8)}`;
      const createdAt = meta.createdAt || stat.birthtime.toISOString();
      const updatedAt = meta.updatedAt || stat.mtime.toISOString();

      const sid = sessionsDb.createSession(
        sessionId,
        this.providerId,
        projectPath,
        title,
        createdAt,
        updatedAt,
        filePath,
      );
      return sid || sessionId;
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
    this.sessionSynchronizer = new PluginAgentSessionSynchronizer(this.id, manifest.name, manifest);
    this.sessions = new PluginAgentSessions(
      this.id,
      manifest.name,
      () => this.getWatchPaths(),
    );
    this.mcp = new NoopMcpProvider(this.id);
    this.skills = new NoopSkillsProvider(this.id);
  }

  getWatchPaths(): Array<{ rootPath: string }> {
    return (this.sessionSynchronizer as any).getWatchPaths?.() || [];
  }
}
