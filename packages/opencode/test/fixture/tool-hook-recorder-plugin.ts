import { calls } from "./tool-hook-recorder"

// A real v1 server plugin, loaded by opencode's actual PluginLoader through
// a `file://` specifier (see test/fixture/agent-plugin.ts for the same
// loading pattern). This mirrors the reproduction plugin from
// https://github.com/anomalyco/opencode/issues/5894 as closely as possible:
// a plugin registering `tool.execute.before` / `tool.execute.after` and
// recording every tool call it sees, including ones made by a subagent.
export default async () => ({
  "tool.execute.before": async (input: { tool: string; sessionID: string }) => {
    calls.push({ hook: "before", tool: input.tool, sessionID: input.sessionID })
  },
  "tool.execute.after": async (input: { tool: string; sessionID: string }) => {
    calls.push({ hook: "after", tool: input.tool, sessionID: input.sessionID })
  },
})
