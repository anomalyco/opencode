export * as CruiseControlPlugin from "./cruise-control"

import path from "path"
import { define } from "./internal"
import { Effect } from "effect"
import { PermissionModule } from "@opencode-ai/schema/permission-module"
import { AgentV2 } from "../agent"
import { Global } from "../global"
import { PermissionV2 } from "../permission"

// Builtin agent id `cruisecontrol` (display: CruiseControl). Distinct from the
// permission-module classifier id `cruise_control` — do not conflate.
const PROMPT_CRUISECONTROL = `You are CruiseControl, KanCode's autonomous execution agent.

Complete the user's software engineering tasks carefully and thoroughly with minimal back-and-forth, while staying safe.

## Operating principles

- Be autonomous on clear tasks: inspect the workspace, make a brief internal plan when useful, execute with tools, and verify outcomes before yielding.
- Prefer safe, reversible tool use. Read and search before editing. Favor targeted edits over broad rewrites.
- Treat destructive or hard-to-undo actions with extra caution (force push, recursive deletes, dropping data, rewriting git history, changing production secrets or infra). When risk is high or intent is ambiguous, ask or choose a safer alternative.
- Explain non-obvious decisions briefly when they matter — why this approach, what you verified, or why you skipped an alternative. Do not narrate routine steps.
- Keep going until the task is done or you are blocked on a decision only the user can make. Do not stop to ask permission for routine safe work.
- Follow project conventions and existing patterns. Match local style; do not introduce unrelated refactors.
- Prefer small, reviewable changes. Run relevant tests or checks when they are available and proportionate.
- Never invent file contents you have not read. Use tools to gather evidence before asserting facts about the codebase.
- Do not commit, push, or create pull requests unless the user explicitly asks.
- Avoid emojis unless the user asks for them.

## Tool use

- Use the tools available to you according to configured permissions.
- Prefer parallel tool calls when exploring independent questions.
- After edits, re-read critical sections when needed to confirm the change landed correctly.
- If a tool fails, diagnose and retry with a corrected approach rather than repeating the same failing call.`

const TRUNCATION_GLOB = path.join(Global.Path.data, "tool-output", "*")

/**
 * V2 built-in plugin that registers the CruiseControl agent.
 * Classifier module registration lives in the V1 opencode cruise-control plugin
 * (permission.registerModule); V2 permission evaluate uses the same module id.
 */
export const Plugin = define({
  id: "cruise-control",
  effect: Effect.fn(function* (ctx) {
    const whitelistedDirs = [
      TRUNCATION_GLOB,
      path.join(Global.Path.tmp, "*"),
      path.join(Global.Path.config, "*"),
      path.join(Global.Path.data, "*"),
      path.join(Global.Path.cache, "*"),
      path.join(Global.Path.state, "*"),
    ]
    const defaults: PermissionV2.Ruleset = [
      { action: "*", resource: "*", effect: "allow" },
      { action: "external_directory", resource: "*", effect: "ask" },
      ...whitelistedDirs.map(
        (resource): PermissionV2.Rule => ({ action: "external_directory", resource, effect: "allow" }),
      ),
      { action: "question", resource: "*", effect: "deny" },
      { action: "plan_enter", resource: "*", effect: "deny" },
      { action: "plan_exit", resource: "*", effect: "deny" },
      { action: "read", resource: "*", effect: "allow" },
      { action: "read", resource: "*.env", effect: "ask" },
      { action: "read", resource: "*.env.*", effect: "ask" },
      { action: "read", resource: "*.env.example", effect: "allow" },
    ]

    yield* ctx.agent.transform((draft) => {
      draft.update(AgentV2.ID.make("cruisecontrol"), (item) => {
        item.description =
          "Autonomous execution agent. Careful tool use; tool permissions go through the cruise_control classifier."
        item.system = PROMPT_CRUISECONTROL
        item.mode = "primary"
        item.permissions.push(
          ...PermissionV2.merge(defaults, [
            { action: "*", resource: "*", effect: "ask", module: PermissionModule.CRUISE_CONTROL },
            { action: "question", resource: "*", effect: "allow" },
            { action: "plan_enter", resource: "*", effect: "allow" },
            // After "*": cruise_control so later rules win for managed app directories.
            ...whitelistedDirs.map(
              (resource): PermissionV2.Rule => ({
                action: "external_directory",
                resource,
                effect: "allow",
              }),
            ),
          ]),
        )
      })
    })
  }),
})
