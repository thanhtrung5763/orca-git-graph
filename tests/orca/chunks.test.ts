import { describe, expect, it } from "vitest";

import { createChunkStore } from "@/orca/worker/chunks";

function collect(store: ReturnType<typeof createChunkStore>, answer: unknown): unknown {
  const { id, parts } = (answer as { chunked: { id: string; parts: number } }).chunked;
  const pieces = Array.from({ length: parts }, (_, part) => store.take(id, part));
  return JSON.parse(pieces.join(""));
}

describe("createChunkStore", () => {
  it("sends a small answer as it is", () => {
    const store = createChunkStore();
    expect(store.wrap({ a: 1 })).toEqual({ data: { a: 1 } });
    expect(store.size).toBe(0);
  });

  it("splits a large answer into parts that join back to it", () => {
    const store = createChunkStore();
    const value = { text: "é𝒳".repeat(400_000), n: [1, 2, 3] };

    const answer = store.wrap(value);

    expect(answer).toHaveProperty("chunked.parts");
    expect((answer as { chunked: { parts: number } }).chunked.parts).toBeGreaterThan(1);
    expect(collect(store, answer)).toEqual(value);
  });

  it("drops a stored answer once every part has been taken", () => {
    const store = createChunkStore();
    const answer = store.wrap({ text: "x".repeat(900_000) });
    expect(store.size).toBe(1);

    collect(store, answer);

    expect(store.size).toBe(0);
  });

  it("refuses an unknown or already taken part", () => {
    const store = createChunkStore();
    const answer = store.wrap({ text: "x".repeat(900_000) }) as { chunked: { id: string } };

    expect(() => store.take("nope", 0)).toThrow(/expired/);
    expect(() => store.take(answer.chunked.id, 99)).toThrow(/expired/);
  });

  it("forgets answers nobody fetched", () => {
    let now = 1_000;
    const store = createChunkStore(() => now);
    const stale = store.wrap({ text: "x".repeat(900_000) }) as { chunked: { id: string } };

    now += 61_000;
    store.wrap({ text: "y".repeat(900_000) });

    expect(store.size).toBe(1);
    expect(() => store.take(stale.chunked.id, 0)).toThrow(/expired/);
  });
});
