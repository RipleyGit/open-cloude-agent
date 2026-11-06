import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import { prepareTranscriptMessages } from '@/shared/message-unification.js';
import type {
  AnyRecord,
  FetchHistoryOptions,
  FetchHistoryResult,
  NormalizedMessage,
} from '@/shared/types.js';
import { sliceTailPage } from '@/shared/utils.js';

const PROVIDER = 'agy' as const;

export type AgyFetchHistoryOptions = FetchHistoryOptions & {
  transcriptPath?: string;
};

/**
 * Session transcript reader and message normalizer for Antigravity CLI (`agy`).
 * Used by AgyProvider to transform raw transcript records into normalized messages.
 */
export class AgySessionsProvider implements IProviderSessions {
  normalizeMessage(raw: unknown, sessionId: string | null): NormalizedMessage[] {
    const ts = new Date().toISOString();
    const sid = sessionId || '';

    if (!raw || typeof raw !== 'object') {
      const content = typeof raw === 'string' ? raw : String(raw);
      return [
        {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          sessionId: sid,
          provider: PROVIDER,
          role: 'assistant',
          content,
          text: content,
          timestamp: ts,
          kind: 'text',
        },
      ];
    }

    const item = raw as AnyRecord;
    const msgTs = (typeof item.created_at === 'string' && item.created_at)
      || (typeof item.timestamp === 'string' && item.timestamp)
      || ts;
    const baseId = typeof item.id === 'string' && item.id
      ? item.id
      : item.step_index !== undefined
        ? `step-${item.step_index}`
        : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // 1. User turn
    if (item.type === 'USER_INPUT' || item.source === 'USER_EXPLICIT') {
      const rawContent = String(item.content ?? '');
      const userReqMatch = rawContent.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
      const cleanContent = userReqMatch ? userReqMatch[1].trim() : rawContent;

      return [
        {
          id: `${baseId}-user`,
          sessionId: sid,
          provider: PROVIDER,
          role: 'user',
          kind: 'text',
          content: cleanContent,
          text: cleanContent,
          timestamp: msgTs,
        },
      ];
    }

    // 2. Model / Planner response
    if (item.type === 'PLANNER_RESPONSE') {
      const messages: NormalizedMessage[] = [];

      // Extended thinking
      if (typeof item.thinking === 'string' && item.thinking.trim().length > 0) {
        messages.push({
          id: `${baseId}-thinking`,
          sessionId: sid,
          provider: PROVIDER,
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
          const tool = item.tool_calls[i] as AnyRecord;
          const toolName = (typeof tool.name === 'string' && tool.name)
            || (typeof tool.function === 'object' && typeof (tool.function as AnyRecord)?.name === 'string' && (tool.function as AnyRecord).name)
            || 'tool';
          const toolArgs = tool.args ?? (typeof tool.function === 'object' ? (tool.function as AnyRecord)?.arguments : undefined) ?? {};
          const serializedArgs = typeof toolArgs === 'string' ? toolArgs : JSON.stringify(toolArgs, null, 2);
          const toolId = String(tool.id || `${baseId}-tool-${i}`);

          messages.push({
            id: `${baseId}-tool-${i}`,
            toolId,
            sessionId: sid,
            provider: PROVIDER,
            role: 'assistant',
            kind: 'tool_use',
            content: serializedArgs,
            text: serializedArgs,
            toolName: String(toolName),
            toolInput: toolArgs,
            timestamp: msgTs,
          });
        }
      }

      // Final / main text content
      if (typeof item.content === 'string' && item.content.trim().length > 0) {
        messages.push({
          id: `${baseId}-text`,
          sessionId: sid,
          provider: PROVIDER,
          role: 'assistant',
          kind: 'text',
          content: item.content,
          text: item.content,
          timestamp: msgTs,
        });
      }

      return messages;
    }

    // 3. Tool execution output / Generic step
    if (item.type === 'GENERIC') {
      const text = typeof item.content === 'string' ? item.content : String(item.content ?? '');
      const isError = item.status === 'ERROR' || /Command exited with code [1-9]|Encountered error/i.test(text);
      return [
        {
          id: `${baseId}-result`,
          sessionId: sid,
          provider: PROVIDER,
          role: 'assistant',
          kind: 'tool_result',
          content: text,
          text,
          isError,
          timestamp: msgTs,
        },
      ];
    }

    // 4. Compaction checkpoint
    if (item.type === 'CHECKPOINT') {
      const text = typeof item.content === 'string' ? item.content : String(item.content ?? '');
      return [
        {
          id: `${baseId}-checkpoint`,
          sessionId: sid,
          provider: PROVIDER,
          role: 'assistant',
          kind: 'text',
          content: text,
          text,
          isCompactSummary: true,
          timestamp: msgTs,
        },
      ];
    }

    // 5. System message
    if (item.type === 'SYSTEM_MESSAGE') {
      const text = typeof item.content === 'string' ? item.content : String(item.content ?? '');
      return [
        {
          id: `${baseId}-system`,
          sessionId: sid,
          provider: PROVIDER,
          role: 'assistant',
          kind: 'text',
          content: text,
          text,
          timestamp: msgTs,
        },
      ];
    }

    // 6. Fallback model content
    if (item.source === 'MODEL' && typeof item.content === 'string' && item.content.trim().length > 0) {
      return [
        {
          id: `${baseId}-text`,
          sessionId: sid,
          provider: PROVIDER,
          role: 'assistant',
          kind: 'text',
          content: item.content,
          text: item.content,
          timestamp: msgTs,
        },
      ];
    }

    return [];
  }

  async fetchHistory(sessionId: string, options?: AgyFetchHistoryOptions): Promise<FetchHistoryResult> {
    const limit = options?.limit ?? null;
    const offset = options?.offset ?? 0;

    let transcriptPath = (options as AnyRecord | undefined)?.transcriptPath as string | undefined;

    if (!transcriptPath || !fs.existsSync(transcriptPath)) {
      try {
        const session = sessionsDb.getSessionById(sessionId)
          ?? sessionsDb.getSessionByProviderSessionId(sessionId);
        const providerSessionId = session?.provider_session_id ?? sessionId;

        transcriptPath = session?.jsonl_path ?? undefined;
        if (!transcriptPath || !fs.existsSync(transcriptPath)) {
          const candidatePath = path.join(
            os.homedir(),
            '.gemini',
            'antigravity-cli',
            'brain',
            providerSessionId,
            '.system_generated',
            'logs',
            'transcript.jsonl',
          );
          if (fs.existsSync(candidatePath)) {
            transcriptPath = candidatePath;
          }
        }
      } catch {
        // sessionsDb may be uninitialized in isolated testing environments
      }
    }

    if (!transcriptPath || !fs.existsSync(transcriptPath)) {
      return {
        messages: [],
        total: 0,
        hasMore: false,
        offset,
        limit,
      };
    }

    const allMessages: NormalizedMessage[] = [];
    let lastToolId: string | null = null;
    try {
      const stream = fs.createReadStream(transcriptPath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          const normalized = this.normalizeMessage(parsed, sessionId);

          for (const msg of normalized) {
            if (msg.kind === 'tool_use' && msg.toolId) {
              lastToolId = msg.toolId;
            } else if (msg.kind === 'tool_result') {
              if (lastToolId) {
                msg.toolId = lastToolId;
                lastToolId = null;
              }
            } else if (msg.kind === 'text' && msg.role === 'user') {
              lastToolId = null;
            }
          }

          allMessages.push(...normalized);
        } catch {
          // Ignore invalid JSON line in transcript
        }
      }
    } catch (err: unknown) {
      console.warn(`[AgySessionsProvider] Failed to read transcript from ${transcriptPath}:`, err);
    }

    // Pair tool results to tool_use messages
    const toolResultMap = new Map<string, NormalizedMessage>();
    for (const msg of allMessages) {
      if (msg.kind === 'tool_result' && msg.toolId) {
        toolResultMap.set(msg.toolId, msg);
      }
    }
    for (const msg of allMessages) {
      if (msg.kind === 'tool_use' && msg.toolId && toolResultMap.has(msg.toolId)) {
        const toolResult = toolResultMap.get(msg.toolId);
        if (toolResult) {
          msg.toolResult = {
            content: toolResult.content,
            isError: toolResult.isError,
          };
        }
      }
    }

    // Filter out paired tool_result rows and cap oversized outputs to protect main thread rendering
    const transcript = prepareTranscriptMessages(allMessages);
    const total = transcript.length;
    const { page, hasMore } = sliceTailPage(transcript, limit, offset);

    return {
      messages: page,
      total,
      hasMore,
      offset,
      limit,
    };
  }
}
