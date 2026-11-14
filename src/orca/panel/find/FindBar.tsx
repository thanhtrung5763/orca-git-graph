import { useEffect, useRef } from "preact/hooks";

import { moreCommitsAvailable } from "@/webview/lib/stores";

import {
  closeFind,
  findCaseSensitive,
  findFocusRequest,
  findOpen,
  findPosition,
  findQuery,
  findRegex,
  findResult,
  moveFind,
  setFindQuery,
  toggleFindCase,
  toggleFindRegex
} from "./findStore";

function resultText(): string {
  const { indices, invalid } = findResult.value;
  if (findQuery.value.trim() === "") {
    return "";
  }
  if (invalid) {
    return "Invalid expression";
  }
  if (indices.length === 0) {
    return moreCommitsAvailable.value ? "No results so far" : "No results";
  }
  return `${findPosition.value + 1} of ${indices.length}`;
}

function Chevron({ up }: { up: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d={up ? "M4 9.5L8 5.5L12 9.5" : "M4 6.5L8 10.5L12 6.5"}
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/**
 * Search over the commits that are loaded: Ctrl/Cmd+Shift+F. It stays at the top of the panel while
 * the graph scrolls. The matching rows are marked by `highlight.ts`.
 */
export function FindBar() {
  const input = useRef<HTMLInputElement>(null);
  const open = findOpen.value;
  const request = findFocusRequest.value;

  useEffect(() => {
    if (open) {
      input.current?.focus();
      input.current?.select();
    }
  }, [open, request]);

  if (!open) {
    return null;
  }

  const invalid = findResult.value.invalid;
  const hasMore = moreCommitsAvailable.value;

  return (
    <div class="gg-find" role="search">
      <div class="gg-find__field">
        <input
          ref={input}
          type="text"
          class="gg-find__input"
          value={findQuery.value}
          placeholder="Search description, hash, author, branch, date"
          aria-label="Search commits"
          aria-invalid={invalid}
          title={
            hasMore
              ? "Searches the commits loaded so far; load more to search older ones."
              : undefined
          }
          spellcheck={false}
          autocomplete="off"
          onInput={(event) => setFindQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              moveFind(event.shiftKey ? -1 : 1);
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              closeFind();
            }
          }}
        />
      </div>
      <button
        type="button"
        class="gg-find__btn gg-find__btn--text"
        aria-pressed={findCaseSensitive.value}
        title="Match case"
        aria-label="Match case"
        onClick={toggleFindCase}
      >
        Aa
      </button>
      <button
        type="button"
        class="gg-find__btn gg-find__btn--text"
        aria-pressed={findRegex.value}
        title="Use regular expression"
        aria-label="Use regular expression"
        onClick={toggleFindRegex}
      >
        .*
      </button>
      <span class="gg-find__count" aria-live="polite" data-invalid={invalid ? "" : undefined}>
        {resultText()}
      </span>
      <button
        type="button"
        class="gg-find__btn"
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
        disabled={findResult.value.indices.length === 0}
        onClick={() => moveFind(-1)}
      >
        <Chevron up />
      </button>
      <button
        type="button"
        class="gg-find__btn"
        title="Next match (Enter)"
        aria-label="Next match"
        disabled={findResult.value.indices.length === 0}
        onClick={() => moveFind(1)}
      >
        <Chevron up={false} />
      </button>
      <button
        type="button"
        class="gg-find__btn"
        title="Close (Esc)"
        aria-label="Close search"
        onClick={closeFind}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M4.5 4.5L11.5 11.5M11.5 4.5L4.5 11.5"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
