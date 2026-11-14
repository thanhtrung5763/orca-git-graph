import { randomUUID } from "node:crypto";

import type { Answer } from "@/orca/shared/protocol";

/** Orca answers up to 1 MiB; stay well below it so multi-byte text never tips over. */
const MAX_INLINE_BYTES = 800 * 1024;
/** UTF-16 code units per part: at most 4 bytes each in JSON, so under 1 MiB. */
const PART_CHARS = 200_000;
/** A part nobody asked for within this long is dropped. */
const TTL_MS = 60_000;

type Entry = { parts: string[]; remaining: Set<number>; expires: number };

/**
 * Wraps a worker answer as `{ data }`, or, when its JSON is too large for one answer, stores it
 * and returns `{ chunked }` for the panel to fetch part by part (`gg.fetch`).
 */
export function createChunkStore(now: () => number = Date.now) {
  const entries = new Map<string, Entry>();

  function prune(): void {
    const current = now();
    for (const [id, entry] of entries) {
      if (entry.expires <= current) {
        entries.delete(id);
      }
    }
  }

  return {
    wrap<T>(value: T): Answer<T> {
      const json = JSON.stringify(value);
      if (Buffer.byteLength(json) <= MAX_INLINE_BYTES) {
        return { data: value };
      }

      prune();
      const parts: string[] = [];
      for (let start = 0; start < json.length; start += PART_CHARS) {
        parts.push(json.slice(start, start + PART_CHARS));
      }
      const id = randomUUID();
      entries.set(id, {
        parts,
        remaining: new Set(parts.keys()),
        expires: now() + TTL_MS
      });
      return { chunked: { id, parts: parts.length } };
    },

    /** One part of a stored answer. The answer is dropped once every part has been taken. */
    take(id: string, part: number): string {
      const entry = entries.get(id);
      const chunk = entry?.parts[part];
      if (entry === undefined || chunk === undefined || entry.expires <= now()) {
        entries.delete(id);
        throw new Error("This part of the response has expired. Refresh and try again.");
      }

      entry.remaining.delete(part);
      if (entry.remaining.size === 0) {
        entries.delete(id);
      }
      return chunk;
    },

    get size(): number {
      return entries.size;
    }
  };
}

export type ChunkStore = ReturnType<typeof createChunkStore>;
