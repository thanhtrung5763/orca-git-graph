import { describe, expect, it, vi } from "vitest";

import { findWorkspacePathForTerminals } from "@/orca/worker/terminals";

describe("findWorkspacePathForTerminals", () => {
  it("returns the workspace holding a focused terminal", async () => {
    const listTerminals = vi.fn().mockResolvedValue([
      { handle: "term_a", worktreePath: "/work/app" },
      { handle: "term_b", worktreePath: "/work/other" }
    ]);

    expect(await findWorkspacePathForTerminals(["term_b"], listTerminals)).toBe("/work/other");
  });

  it("does not run the CLI when the workspace has no terminals", async () => {
    const listTerminals = vi.fn();

    expect(await findWorkspacePathForTerminals([], listTerminals)).toBeUndefined();
    expect(listTerminals).not.toHaveBeenCalled();
  });

  it("answers nothing when the CLI fails, the terminal is unknown, or it names no path", async () => {
    const failure = vi.fn().mockRejectedValue(new Error("not found"));
    const otherTerminal = vi
      .fn()
      .mockResolvedValue([{ handle: "term_a", worktreePath: "/work/app" }]);
    const noPath = vi.fn().mockResolvedValue([{ handle: "term_a" }]);

    expect(await findWorkspacePathForTerminals(["term_a"], failure)).toBeUndefined();
    expect(await findWorkspacePathForTerminals(["term_b"], otherTerminal)).toBeUndefined();
    expect(await findWorkspacePathForTerminals(["term_a"], noPath)).toBeUndefined();
  });
});
