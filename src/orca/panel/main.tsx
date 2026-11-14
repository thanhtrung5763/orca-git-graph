import "./theme-bridge.css";
import "./header.css";
import "./responsive.css";
import "./diff/diff.css";
import "./find/find.css";

import { render } from "preact";

// Starts the upstream webview. Its `lib/vscode` import resolves to `./vscode-api` in this build.
// eslint-disable-next-line import/no-unassigned-import
import "@/webview/main";

import { DiffOverlay } from "./diff/DiffOverlay";
import { FindBar } from "./find/FindBar";
import { installFindHighlight } from "./find/highlight";
import { installFindShortcut } from "./find/shortcut";
import { installCommitKeyboardNavigation } from "./keyboard";
import { installPopoverFit } from "./popoverFit";
import { installWorkspaceFocus } from "./workspaceFocus";

installCommitKeyboardNavigation();
installPopoverFit();
installFindShortcut();
installFindHighlight();
installWorkspaceFocus();

// The diff viewer lives beside the webview's own root, so the webview never knows about it.
const root = document.createElement("div");
root.id = "orca-overlay";
document.body.append(root);
render(<DiffOverlay />, root);

// The search bar is the first thing in the page and sticks to its top, so it never covers the toolbar.
const find = document.createElement("div");
find.id = "orca-find";
document.body.prepend(find);
render(<FindBar />, find);
