/**
 * Husk — memory store implementations.
 *
 * Two stores ship in v0.1.0:
 * - InMemoryStore: session-scoped, fast, lost on process exit
 * - FileStore: persistent across sessions, JSONL on disk
 *
 * Both implement the MemoryStore interface from ./types.js. The agent
 * loop doesn't care which one it gets — it just calls read/append/clear.
 *
 * Design choice: separate stores per file but exported from the same
 * module. Users can import what they need: `import { InMemory, File } from
 * '@princetheprogrammerbtw/husk'`.
 */

import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import type { MemoryStore, Message } from './types.js';

// ───────────────────────────────────────────────────────────────────
// In-memory store
// ───────────────────────────────────────────────────────────────────

/**
 * Session-scoped memory. Messages live in a Map in process memory.
 * Fast, zero-dep, but ephemeral — perfect for single-run agents.
 */
export class InMemoryStore implements MemoryStore {
  private readonly sessions: Map<string, Message[]> = new Map();

  async read(sessionId: string): Promise<readonly Message[]> {
    return [...(this.sessions.get(sessionId) ?? [])];
  }

  async append(sessionId: string, message: Message): Promise<void> {
    const list = this.sessions.get(sessionId) ?? [];
    list.push(message);
    this.sessions.set(sessionId, list);
  }

  async clear(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async listSessions(): Promise<readonly string[]> {
    return [...this.sessions.keys()];
  }
}

// ───────────────────────────────────────────────────────────────────
// File-backed store
// ───────────────────────────────────────────────────────────────────

/**
 * Persistent memory backed by a JSONL file. One file per session by
 * default, or a single file with a `__session` field per line if you
 * want a unified log.
 *
 * JSONL is the format because:
 * - Append-only writes are O(1) (no read-modify-write race)
 * - Corruption is line-scoped, not file-scoped
 * - It's grep-friendly for debugging
 */
export interface FileStoreOptions {
  /** Directory where session files live. Default: './.husk/memory'. */
  readonly path?: string;
  /** Use a single file with session markers (default: false, one file per session). */
  readonly unified?: boolean;
}

export class FileStore implements MemoryStore {
  private readonly rootDir: string;
  private readonly unified: boolean;
  private readonly writeLocks: Map<string, Promise<void>> = new Map();

  constructor(options: FileStoreOptions = {}) {
    this.rootDir = options.path ?? './.husk/memory';
    this.unified = options.unified ?? false;
  }

  async read(sessionId: string): Promise<readonly Message[]> {
    const file = this.fileFor(sessionId);
    try {
      const text = await fs.readFile(file, 'utf-8');
      const lines = text.split('\n').filter((line) => line.trim().length > 0);
      const messages: Message[] = [];
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as { session?: string; message: Message };
          if (this.unified && parsed.session && parsed.session !== sessionId) continue;
          messages.push(parsed.message);
        } catch {
          // Skip malformed lines rather than failing the whole read.
          // (A real production system would log this; for v0.1.0 we
          // silently drop the line to keep the agent running.)
        }
      }
      return messages;
    } catch (err) {
      if (isNoEnt(err)) return [];
      throw err;
    }
  }

  async append(sessionId: string, message: Message): Promise<void> {
    // Serialize writes per session to prevent interleaved JSONL corruption.
    const previous = this.writeLocks.get(sessionId) ?? Promise.resolve();
    const next = previous.then(() => this.doAppend(sessionId, message));
    this.writeLocks.set(
      sessionId,
      next.catch(() => undefined),
    );
    return next;
  }

  private async doAppend(sessionId: string, message: Message): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
    const file = this.fileFor(sessionId);
    const entry = this.unified
      ? JSON.stringify({ session: sessionId, message })
      : JSON.stringify({ message });
    await fs.appendFile(file, `${entry}\n`, 'utf-8');
  }

  async clear(sessionId: string): Promise<void> {
    const file = this.fileFor(sessionId);
    try {
      await fs.unlink(file);
    } catch (err) {
      if (!isNoEnt(err)) throw err;
    }
  }

  async listSessions(): Promise<readonly string[]> {
    if (this.unified) {
      // For unified mode, scan the file and collect unique session ids.
      const file = join(this.rootDir, 'unified.jsonl');
      try {
        const text = await fs.readFile(file, 'utf-8');
        const ids = new Set<string>();
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line) as { session?: string };
            if (parsed.session) ids.add(parsed.session);
          } catch {
            // skip malformed
          }
        }
        return [...ids];
      } catch (err) {
        if (isNoEnt(err)) return [];
        throw err;
      }
    }
    try {
      const entries = await fs.readdir(this.rootDir);
      return entries
        .filter((e: string) => e.endsWith('.jsonl'))
        .map((e: string) => e.replace(/\.jsonl$/, ''));
    } catch (err) {
      if (isNoEnt(err)) return [];
      throw err;
    }
  }

  private fileFor(sessionId: string): string {
    if (this.unified) return join(this.rootDir, 'unified.jsonl');
    return join(this.rootDir, `${sanitize(sessionId)}.jsonl`);
  }
}

function isNoEnt(err: unknown): boolean {
  return Boolean(
    err && typeof err === 'object' && 'code' in err && (err as { code: unknown }).code === 'ENOENT',
  );
}

function sanitize(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

// Re-export for the no-op case where dirname is unused in some builds.
// (Keeps tree-shakers honest about which Node APIs we actually use.)
void dirname;
