import { batch } from "@preact/signals";

import type { ResponseMessage } from "@/types";
import { SHOW_ALL_BRANCHES } from "@/webview/constants";
import { closeCommitDetails } from "@/webview/lib/actions";
import {
  commitHead,
  commitList,
  expandedCommit,
  focusedCommit,
  moreCommitsAvailable,
  selectedBranch,
  selectedRepo,
  uncommittedChanges
} from "@/webview/lib/stores";

type LoadCommitsMessage = Extract<ResponseMessage, { command: "loadCommits" }>;

export function handleLoadCommits(msg: LoadCommitsMessage) {
  const branch = selectedBranch.value;
  const requested = branch === SHOW_ALL_BRANCHES ? "" : branch;

  if (msg.repo !== selectedRepo.value || msg.branchName !== requested) {
    return;
  }

  batch(() => {
    commitList.value = msg.commits;
    commitHead.value = msg.head;
    moreCommitsAvailable.value = msg.moreCommitsAvailable;
    uncommittedChanges.value = msg.uncommittedChanges;

    const focused = focusedCommit.value;
    if (focused !== null && !msg.commits.some((commit) => commit.hash === focused)) {
      focusedCommit.value = null;
    }

    const expanded = expandedCommit.value;
    if (expanded !== null && !msg.commits.some((commit) => commit.hash === expanded)) {
      closeCommitDetails();
    }
  });
}
