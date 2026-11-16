// @vitest-environment jsdom

import { h, render } from "preact";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { GitCommitNode } from "@/backend/types";

import { setupWebviewTest } from "@tests/webview/test-utils";

let CommitRow: typeof import("@/webview/components/commit/CommitRow").CommitRow;
let container: HTMLTableSectionElement;

beforeAll(async () => {
  setupWebviewTest();
  ({ CommitRow } = await import("@/webview/components/commit/CommitRow"));
});

afterEach(() => {
  render(null, container);
});

describe("CommitRow", () => {
  it("reserves description space and exposes truncated content", () => {
    const branch = "feature/a-very-long-branch-name";
    const message = "Commit message after the branch label";
    const commit: GitCommitNode = {
      hash: "abc123456789",
      parentHashes: [],
      author: "Author",
      email: "author@example.com",
      date: 0,
      message,
      refs: [{ hash: "abc123456789", name: branch, type: "head" }]
    };
    container = document.createElement("tbody");

    render(
      h(CommitRow, {
        commit,
        isHead: false,
        headBranch: null,
        messages: new Map(),
        colour: undefined,
        expanded: false,
        focused: false,
        headBackground: true,
        onSelect: undefined
      }),
      container
    );

    const description = container.querySelector("td:nth-child(2)");
    const refRegion = description?.querySelector(":scope > div > span:first-child");
    const messageRegion = description?.querySelector(":scope > div > span:last-child");

    expect(refRegion?.classList.contains("max-w-4/5")).toBe(true);
    expect(refRegion?.querySelector("[title]")?.getAttribute("title")).toBe(branch);
    expect(messageRegion?.classList.contains("flex-1")).toBe(true);
    expect(messageRegion?.getAttribute("title")).toBe(message);
    expect(messageRegion?.textContent).toBe(message);
  });

  it("keeps the selected background on the commit last opened, once its details are closed", () => {
    const commit: GitCommitNode = {
      hash: "def123456789",
      parentHashes: [],
      author: "Author",
      email: "author@example.com",
      date: 0,
      message: "Focused",
      refs: []
    };
    container = document.createElement("tbody");

    const draw = (focused: boolean) =>
      render(
        h(CommitRow, {
          commit,
          isHead: false,
          headBranch: null,
          messages: new Map(),
          colour: undefined,
          expanded: false,
          focused,
          headBackground: true,
          onSelect: undefined
        }),
        container as HTMLElement
      );

    draw(true);
    expect(container.querySelector("tr")?.classList.contains("bg-row-selected")).toBe(true);
    draw(false);
    expect(container.querySelector("tr")?.classList.contains("bg-row-selected")).toBe(false);
  });

  it("drops the checked out commit's own background while another commit is focused", () => {
    const commit: GitCommitNode = {
      hash: "head123456789",
      parentHashes: [],
      author: "Author",
      email: "author@example.com",
      date: 0,
      message: "Head",
      refs: []
    };
    container = document.createElement("tbody");

    const draw = (headBackground: boolean) =>
      render(
        h(CommitRow, {
          commit,
          isHead: true,
          headBranch: null,
          messages: new Map(),
          colour: undefined,
          expanded: false,
          focused: false,
          headBackground,
          onSelect: undefined
        }),
        container as HTMLElement
      );

    draw(true);
    expect(container.querySelector("tr")?.classList.contains("bg-row-head")).toBe(true);
    draw(false);
    expect(container.querySelector("tr")?.classList.contains("bg-row-head")).toBe(false);
  });
});
