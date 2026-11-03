import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';
import { readFileTimestamps } from '@/shared/utils.js';

const PROVIDER = 'agy' as const;

type ConversationSummaryRow = {
  conversation_id: string;
  title: string | null;
  preview: string | null;
  workspace_uris: string | null;
  last_modified_time: string | null;
};

/**
 * Session indexing adapter for Antigravity CLI (`agy`).
 * Used by AgyProvider to scan ~/.gemini/antigravity-cli/brain and index sessions into CloudCLI SQLite.
 */
export class AgySessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly appDataDir = path.join(os.homedir(), '.gemini', 'antigravity-cli');
  private readonly brainDir = path.join(this.appDataDir, 'brain');
  private readonly summariesDbPath = path.join(this.appDataDir, 'conversation_summaries.db');

  async synchronize(since?: Date): Promise<number> {
    let indexedCount = 0;

    // 1. Try reading fast summaries database if available
    if (fs.existsSync(this.summariesDbPath)) {
      try {
        const db = new Database(this.summariesDbPath, { readonly: true });
        const rows = db.prepare(`
          SELECT conversation_id, title, preview, workspace_uris, last_modified_time
          FROM conversation_summaries
        `).all() as ConversationSummaryRow[];
        db.close();

        for (const row of rows) {
          const conversationId = row.conversation_id;
          if (!conversationId) continue;

          const transcriptPath = path.join(
            this.brainDir,
            conversationId,
            '.system_generated',
            'logs',
            'transcript.jsonl',
          );

          if (!fs.existsSync(transcriptPath)) {
            continue;
          }

          let projectPath = process.cwd();
          if (row.workspace_uris) {
            try {
              const uris = JSON.parse(row.workspace_uris) as string[];
              if (uris[0]) {
                projectPath = uris[0].startsWith('file://') ? fileURLToPath(uris[0]) : uris[0];
              }
            } catch {
              // Ignore URI parse failures
            }
          }

          const sessionName = (row.title && row.title.trim())
            || (row.preview && row.preview.trim())
            || 'Antigravity Session';

          const timestamps = await readFileTimestamps(transcriptPath);
          if (since && timestamps.updatedAt && new Date(timestamps.updatedAt) < since) {
            continue;
          }

          sessionsDb.createSession(
            conversationId,
            PROVIDER,
            projectPath,
            sessionName,
            timestamps.createdAt,
            timestamps.updatedAt,
            transcriptPath,
          );
          indexedCount++;
        }

        return indexedCount;
      } catch (err: unknown) {
        console.warn('[AgySessionSynchronizer] Error reading conversation_summaries.db:', err);
      }
    }

    // 2. Fallback: Directory walk through brain/
    if (fs.existsSync(this.brainDir)) {
      try {
        const entries = await fs.promises.readdir(this.brainDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const conversationId = entry.name;
          const transcriptPath = path.join(
            this.brainDir,
            conversationId,
            '.system_generated',
            'logs',
            'transcript.jsonl',
          );

          if (!fs.existsSync(transcriptPath)) continue;

          const timestamps = await readFileTimestamps(transcriptPath);
          if (since && timestamps.updatedAt && new Date(timestamps.updatedAt) < since) {
            continue;
          }

          sessionsDb.createSession(
            conversationId,
            PROVIDER,
            process.cwd(),
            'Antigravity Session',
            timestamps.createdAt,
            timestamps.updatedAt,
            transcriptPath,
          );
          indexedCount++;
        }
      } catch (err: unknown) {
        console.warn('[AgySessionSynchronizer] Error walking brain directory:', err);
      }
    }

    return indexedCount;
  }

  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!filePath.endsWith('transcript.jsonl')) {
      return null;
    }

    const match = filePath.match(/brain[/\\]([^/\\]+)[/\\]\.system_generated[/\\]logs[/\\]transcript\.jsonl$/);
    if (!match || !match[1]) {
      return null;
    }

    const conversationId = match[1];
    const timestamps = await readFileTimestamps(filePath);

    sessionsDb.createSession(
      conversationId,
      PROVIDER,
      process.cwd(),
      'Antigravity Session',
      timestamps.createdAt,
      timestamps.updatedAt,
      filePath,
    );

    return conversationId;
  }
}
