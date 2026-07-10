// Shared in-process recorder used to prove that a *real* file-based plugin
// (loaded through the actual PluginLoader / Plugin.node, not a Layer.mock)
// sees `tool.execute.before` / `tool.execute.after` for tool calls made from
// inside a subagent's own session — the exact repro from
// https://github.com/anomalyco/opencode/issues/5894.
//
// The plugin file (`tool-hook-recorder-plugin.ts`) is loaded by the real
// PluginLoader via a `file://` URL, which resolves to this same module in
// the module cache (same process, same path) — so pushing into `calls` here
// is visible to the test that imports this module directly.
export type RecordedCall = { hook: "before" | "after"; tool: string; sessionID: string }

export const calls: RecordedCall[] = []

export function reset() {
  calls.length = 0
}
