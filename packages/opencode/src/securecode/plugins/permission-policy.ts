// securecode permission-policy plugin.
//
// opencode's built-in agents (notably `build`) ship `"*": "allow"` in their
// permission defaults (see packages/opencode/src/agent/agent.ts), so during
// interactive (TUI) use every tool that does not have a more specific rule
// — bash, edit, write, task, webfetch, websearch, … — runs without ever
// stopping at the approval prompt.
//
// securecode raises a floor: a tool only bypasses the approval prompt when
// the USER has explicitly written an `allow` rule for it in their own config
// file (`opencode.json`). The agent's wildcard `"*": "allow"` is not enough
// on its own — the user has to opt in. `EXEMPT_PERMISSIONS` below carves
// out two groups that bypass this rule: (a) internal-mechanics keys
// (`todowrite`, `lsp`, `external_directory`) where the user did not
// initiate the action, and (b) local read-only access (`read`, `grep`,
// `glob`) whose blast radius is already capped by Layer 2's filesystem
// sandbox — prompting for in-workdir reads would bury the user without
// adding safety.
//
// Mechanism: the `permission.ask` hook receives a (tool, pattern) pair
// together with the action that the agent+session ruleset resolved to. When
// that action is `allow`, the plugin re-evaluates the same (tool, pattern)
// against ONLY the user's own config rules (fetched via the SDK). If the
// user's config explicitly allowed it, the allow stays. Otherwise the status
// is raised to `ask`.
//
// Design rationale (see PR #157 discussion):
//   - The policy applies to every permission key that goes through the
//     `permission.ask` hook, EXCEPT a small `EXEMPT_PERMISSIONS` set for
//     internal mechanics (the LLM-private todo list, LSP queries, the
//     securecode-internal external-directory whitelist) where prompting the
//     user would be confusing because the user did not initiate the action.
//   - What is NOT hardcoded is which specific commands or paths a user
//     wants to allow without prompting — that is the user's decision via
//     their config (`opencode.json`'s `permission` section).
//   - `deny` and `ask` are never relaxed; only `allow` is raised. Per-session
//     "Always allow" approvals are evaluated AFTER this hook by the
//     Permission service (see permission/index.ts:251-256), so a human who
//     picks "always" during the session is still honored. What this plugin
//     blocks is pre-disabling the gate from a place the user did not
//     explicitly write — namely the agent's wildcard default.

import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import * as Log from "@opencode-ai/core/util/log"
import { Permission } from "@/permission"
import type { ConfigPermission } from "@/config/permission"

const log = Log.create({ service: "securecode.permission-policy" })

/**
 * Permission keys exempted from the "user must explicitly allow" rule.
 *
 * Two groups, kept in one set because the enforcement logic is identical
 * (skip the allow → ask escalation).
 *
 * Group A — internal mechanics where the user did not initiate the action,
 * so a prompt would be confusing:
 *   - `todowrite`  — the LLM-private todo list maintained automatically
 *     across a session; the user does not invoke it directly.
 *   - `lsp`        — LSP queries (definition jump, completion, …) the agent
 *     performs while working; not something the user opts in to per-call.
 *   - `external_directory` — the agent's whitelist of opencode-internal
 *     paths (`Truncate.GLOB`, `/tmp/opencode-*`, skill directories, …) is
 *     itself agent-default, and asking the user about those paths would be
 *     confusing. The deny/ask side of the same key still works as usual
 *     because this plugin never relaxes deny/ask, only raises `allow`.
 *
 * Group B — local read-only file access that Layer 2 (the OS sandbox)
 * already confines to the working directory and a minimal set of OS paths.
 * Confirming every read inside the workdir buries the user in prompts for
 * no real safety benefit, since the sandbox blocks anything outside that
 * boundary regardless of what Layer 1 decides:
 *   - `read`  — file read
 *   - `grep`  — content search
 *   - `glob`  — path-pattern listing
 *
 * Mutation tools (`edit`, `write` → permission key `edit`), shell (`bash`),
 * sub-agent dispatch (`task`), and outbound network (`webfetch`,
 * `websearch`) are intentionally NOT in this set: those either modify state
 * or reach out beyond the sandbox file boundary, so user opt-in still
 * applies.
 */
export const EXEMPT_PERMISSIONS: ReadonlySet<string> = new Set([
  "todowrite",
  "lsp",
  "external_directory",
  "read",
  "grep",
  "glob",
])

/**
 * Built-in skill names that bypass the "user must explicitly allow" rule
 * for the `skill` permission key.
 *
 * These skills are inlined into the binary at build time (see
 * packages/opencode/src/skill/index.ts) and therefore share the same trust
 * boundary as securecode itself — prompting the user for permission to load
 * them would just be noise. User-installed third-party skills (under
 * `.claude/skills/`, `.opencode/skills/`, `~/.config/opencode/skills/`, ...)
 * still go through the normal opt-in flow because their source is not
 * vetted at release time.
 *
 * Exported for unit testing.
 */
export const EXEMPT_BUILTIN_SKILLS: ReadonlySet<string> = new Set([
  "securecode-manual",
])

/**
 * Decide whether to raise `output.status` from `allow` to `ask`.
 *
 * Returns true when ALL of the following hold:
 *   1. The agent/session ruleset resolved this (type, pattern) to `allow`.
 *   2. `type` is NOT in `EXEMPT_PERMISSIONS`.
 *   3. (type, pattern) is NOT an exempt built-in skill load.
 *   4. The USER's own config does not explicitly allow this (type, pattern).
 *
 * Exported for unit testing.
 */
export function shouldEnforce(
  type: string,
  pattern: string,
  configStatus: "ask" | "deny" | "allow",
  userPermission: ConfigPermission.Info,
): boolean {
  if (configStatus !== "allow") return false
  if (EXEMPT_PERMISSIONS.has(type)) return false
  if (type === "skill" && EXEMPT_BUILTIN_SKILLS.has(pattern)) return false
  const userRuleset = Permission.fromConfig(userPermission)
  const userAction = Permission.evaluate(type, pattern, userRuleset).action
  return userAction !== "allow"
}

// Cache TTL for the user config fetch. The hook fires once per (tool, pattern)
// pair, so a busy session can trigger this many times per second; short-lived
// caching keeps the SDK round-trips bounded without breaking "edit opencode.json
// and see it reflected" within a few seconds.
const USER_CONFIG_CACHE_TTL_MS = 5_000

export async function PermissionPolicyPlugin(input: PluginInput): Promise<Hooks> {
  let cached: { permission: ConfigPermission.Info; at: number } | null = null

  const readUserPermission = async (): Promise<ConfigPermission.Info> => {
    if (cached && Date.now() - cached.at < USER_CONFIG_CACHE_TTL_MS) return cached.permission
    try {
      const res = await input.client.config.get({ throwOnError: true })
      const data = (res as { data?: { permission?: ConfigPermission.Info } }).data
      const permission = data?.permission ?? {}
      cached = { permission, at: Date.now() }
      return permission
    } catch (err) {
      // Defensive: on any failure (network, transport, malformed response)
      // fall back to an empty ruleset, which means "user has not opted in".
      // The downstream `shouldEnforce` will then raise the status to `ask`
      // — the safer of the two failure modes. Failures are not cached so the
      // next call retries.
      log.warn("failed to read user config; treating as empty permission", { err: String(err) })
      return {}
    }
  }

  return {
    "permission.ask": async (req, output) => {
      if (output.status !== "allow") return
      const pattern =
        typeof req.pattern === "string"
          ? req.pattern
          : Array.isArray(req.pattern) && req.pattern.length > 0
            ? req.pattern[0]
            : "*"
      const userPermission = await readUserPermission()
      if (!shouldEnforce(req.type, pattern, output.status, userPermission)) return
      output.status = "ask"
      log.info("raised tool permission allow -> ask", {
        tool: req.type,
        pattern,
        id: req.id,
      })
    },
  }
}
