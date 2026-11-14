import { signal } from "@preact/signals";

import type { DiffPayload } from "@/orca/shared/protocol";

/** The diff the viewer shows, or `null` while it is closed. */
export const openDiff = signal<DiffPayload | null>(null);

export function showDiff(diff: DiffPayload): void {
  openDiff.value = diff;
}

export function closeDiff(): void {
  openDiff.value = null;
}
