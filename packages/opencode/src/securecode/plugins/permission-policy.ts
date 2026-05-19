// securecode permission-policy plugin.
//
// opencode's `build` agent ships `"*": "allow"` in its permission defaults
// (see packages/opencode/src/agent/agent.ts), so during interactive (TUI)
// use, tools such as `bash` / `edit` / `write` run without ever stopping at
// an approval gate. securecode requires a hard floor: a fixed set of
// side-effecting tools must always reach the approval prompt, and that floor
// must not be removable through a user config file.
//
// This plugin implements that floor via the `permission.ask` hook. The hook
// receives the permission request together with the action that the
// CONFIG-derived ruleset resolved to (allow / deny / ask). For the enforced
// tools, an `allow` is rewritten to `ask`. `deny` is never touched (we only
// raise allow -> ask), and the wiring in session/prompt.ts applies the
// in-session "always allow" approvals AFTER this hook runs, so a human who
// picks "always" during the session is still honored. What is forbidden is
// pre-disabling the gate from a config file.
//
// The enforced-tool list lives here (securecode-owned) rather than in the
// upstream permission/agent code, so the policy stays a securecode concern
// and upstream merge churn is minimized. The hook is registered through the
// INTERNAL_PLUGINS array in packages/opencode/src/plugin/index.ts, the same
// pattern used by overflow-guard and the qwen-* plugins.
//
// See https://github.com/acompany-develop/securecode/issues for the tracking
// issue.

import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "securecode.permission-policy" })

// Permission keys whose approval gate must not be removable via config.
// `task` spawns subagents, `webfetch`/`websearch` reach the network, and
// `bash`/`edit`/`write` mutate the host. Read-only tools (read/grep/glob/list)
// are intentionally excluded.
//
// Note: the `write` tool gates on the `edit` permission key (see
// packages/opencode/src/tool/write.ts), so `edit` already covers it. `write`
// is kept in the set defensively in case a future path gates on a literal
// `write` key.
export const ENFORCED_TOOLS: ReadonlySet<string> = new Set([
  "bash",
  "edit",
  "write",
  "task",
  "webfetch",
  "websearch",
])

// Returns true when a config-derived `allow` for `tool` must be raised to
// `ask`. Exported for unit testing.
export function shouldEnforce(tool: string, configStatus: "ask" | "deny" | "allow"): boolean {
  return configStatus === "allow" && ENFORCED_TOOLS.has(tool)
}

export async function PermissionPolicyPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    "permission.ask": async (input, output) => {
      // `input.type` is the permission key (the tool name for tool gates).
      const tool = input.type
      if (!shouldEnforce(tool, output.status)) return
      output.status = "ask"
      log.info("raised tool permission allow -> ask", { tool, id: input.id })
    },
  }
}
