// Mirrors the values applied by `agent-plugin.ts` so the test can assert
// against the same literals. Kept in a separate file because every export in
// `agent-plugin.ts` must be a plugin function (the loader throws otherwise).
export const PLUGIN_AGENT = {
  name: "plugin_added",
  description: "Added by a plugin via the config hook",
  mode: "subagent",
} as const
