import { describe, expect, it } from "vitest";

import { findRepoForWorkspace } from "@/orca/panel/focusRepo";
import type { GitRepo } from "@/types";

function repo(path: string): GitRepo {
  return { name: path.split("/").pop() ?? path, path };
}

describe("findRepoForWorkspace", () => {
  it("finds the workspace's own repository", () => {
    expect(findRepoForWorkspace("/work/app", [repo("/work/other"), repo("/work/app")])).toBe(
      "/work/app"
    );
  });

  it("compares paths written with either slash and a trailing one", () => {
    expect(findRepoForWorkspace("C:\\work\\app\\", [repo("C:/work/app")])).toBe("C:/work/app");
  });

  it("takes the closest repository when the workspace holds several", () => {
    const repos = [repo("/work/app/deep/nested"), repo("/work/app/zeta"), repo("/work/app/alpha")];

    expect(findRepoForWorkspace("/work/app", repos)).toBe("/work/app/alpha");
  });

  it("does not take a sibling that only starts with the same letters", () => {
    expect(findRepoForWorkspace("/work/app", [repo("/work/application")])).toBeUndefined();
  });

  it("finds nothing when the workspace holds no repository", () => {
    expect(findRepoForWorkspace("/work/notes", [repo("/work/app")])).toBeUndefined();
    expect(findRepoForWorkspace("/", [])).toBeUndefined();
  });
});
