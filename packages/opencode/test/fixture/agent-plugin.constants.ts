// Separate file because every export in `agent-plugin.ts` must be a function.
export const PLUGIN_AGENT = {
  name: "plugin_added",
  description: "Added by a plugin via the config hook",
  mode: "subagent",
} as const
