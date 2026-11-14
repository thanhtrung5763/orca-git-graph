// Ambient declarations for the panel frame. Orca's frame shell defines `window.orca` before any
// plugin script runs.
interface Window {
  orca: import("./orca-api").OrcaFrameApi;
}
