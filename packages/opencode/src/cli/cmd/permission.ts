// Permission inspection and setup — the local equivalent of Claude Code's
// `claude auto-mode config` / `/auto-mode-setup`.
//
//   opencode permission status [--agent <name>] [--json]
//   opencode permission scan [--days N] [--yes]
//
// `status` is pure read/reporting: it shows the effective permission ruleset
// (opencode.json's `permission` block, optionally merged for a named agent)
// plus the loop/backlog authority ceiling (QueueDenyRules), which is always
// display-only here — this file never proposes or writes changes to it.
//
// `scan` mines this project's own session history (the same DB `stats`
// reads) for bash commands that repeatedly hit "ask" under the current
// ruleset, and offers to add `allow` rules for a conservative, fixed list of
// safe/read-only command prefixes. Same spirit as the `fewer-permission-
// prompts` Claude skill, ported to opencode's own permission schema.
import { EOL } from "os"
import { Effect } from "effect"
import { cmd } from "./cmd"
import { effectCmd, fail } from "../effect-cmd"
import { Config } from "@/config/config"
import { Permission } from "@/permission"
import { QueueAuthority } from "@/loop/spec-queue/authority"
import { NotFoundError } from "@/storage/storage"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"

type Rule = PermissionV1.Rule

function formatRuleset(title: string, ruleset: readonly Rule[]): string[] {
  const lines: string[] = [`${title}:`]
  if (ruleset.length === 0) {
    lines.push("  (none)")
    return lines
  }
  const byKind = new Map<string, { pattern: string; action: string }[]>()
  for (const rule of ruleset) {
    const list = byKind.get(rule.permission) ?? []
    list.push({ pattern: rule.pattern, action: rule.action })
    byKind.set(rule.permission, list)
  }
  for (const kind of [...byKind.keys()].sort()) {
    lines.push(`  ${kind}:`)
    for (const { pattern, action } of byKind.get(kind)!) {
      lines.push(`    ${action.padEnd(6)} ${pattern}`)
    }
  }
  return lines
}

const PermissionStatusCommand = effectCmd({
  command: "status",
  describe: "show the effective permission ruleset (global config, and per-agent when --agent is given)",
  builder: (yargs) =>
    yargs
      .option("agent", { type: "string", describe: "show the ruleset as resolved for this agent" })
      .option("json", { type: "boolean", default: false, describe: "machine-readable JSON output" }),
  handler: Effect.fn("Cli.permission.status")(function* (args) {
    const cfg = yield* Config.Service
    const config = yield* cfg.get()
    const configRuleset = Permission.fromConfig(config.permission ?? {})
    const autoMode = config.auto_mode ?? false

    let agentName: string | undefined
    let agentRuleset: Rule[] | undefined
    if (args.agent) {
      const { Agent } = yield* Effect.promise(() => import("@/agent/agent"))
      const info = yield* Agent.Service.use((svc) => svc.get(args.agent!))
      if (!info) return yield* fail(`unknown agent ${JSON.stringify(args.agent)}`)
      agentName = info.name
      agentRuleset = info.permission
    }

    if (args.json) {
      process.stdout.write(
        JSON.stringify(
          {
            auto_mode: autoMode,
            config: configRuleset,
            agent: agentName ? { name: agentName, ruleset: agentRuleset } : undefined,
            queue_deny_rules: QueueAuthority.QueueDenyRules,
          },
          null,
          2,
        ) + EOL,
      )
      return
    }

    const lines: string[] = []
    lines.push(`auto_mode: ${autoMode ? "on" : "off"}`)
    lines.push("")
    lines.push(...formatRuleset("From opencode.json (permission)", configRuleset))
    if (agentName && agentRuleset) {
      lines.push("")
      lines.push(
        ...formatRuleset(`Effective for agent "${agentName}" (defaults + config + agent overrides)`, agentRuleset),
      )
    }
    lines.push("")
    lines.push(
      ...formatRuleset(
        "Loop/backlog authority ceiling — unattended-only, always-on, not overridable " +
          "(loop/spec-queue/authority.ts; read-only here)",
        QueueAuthority.QueueDenyRules,
      ),
    )
    process.stdout.write(lines.join(EOL) + EOL)
  }),
})

// ── scan (setup wizard) ──────────────────────────────────────────────────

// Conservative, fixed candidate list — same spirit as the `fewer-permission-
// prompts` Claude skill's allowlist. Deliberately not a generalized command
// clustering algorithm: a false negative just means the wizard misses a
// pattern the user still has to approve manually; a false positive would
// mean silently widening what auto-approves.
const SAFE_BASH_PREFIXES = [
  "git status",
  "git diff",
  "git log",
  "git branch",
  "git show",
  "ls",
  "cat",
  "rg",
  "grep",
  "find",
  "pwd",
  "echo",
  "which",
  "wc",
  "head",
  "tail",
] as const

const MIN_OCCURRENCES = 3

function matchesQueueDeny(pattern: string): boolean {
  // Conservative overlap check: a candidate is excluded if it or the deny
  // rule's un-wildcarded core text overlap. This errs toward excluding too
  // much rather than proposing an allow rule anywhere near the loop ceiling.
  return QueueAuthority.QueueDenyRules.some((rule) => {
    const core = rule.pattern.replace(/\*/g, "").trim()
    return core.length > 0 && pattern.includes(core)
  })
}

// Token-wise prefix match, not string prefix: "lsof -i" must not match "ls",
// and a plain-word candidate needs a following space or end-of-string so
// "grep" doesn't also swallow "grepolyte-cli" as a bonus false positive.
function candidatePrefix(command: string): string | undefined {
  const tokens = command.trim().split(/\s+/)
  return SAFE_BASH_PREFIXES.find((prefix) => {
    const prefixTokens = prefix.split(" ")
    return prefixTokens.every((t, i) => tokens[i] === t)
  })
}

const PermissionScanCommand = effectCmd({
  command: "scan",
  describe: "scan session history for repeated permission prompts and draft additive allow rules",
  builder: (yargs) =>
    yargs
      .option("days", { type: "number", describe: "look back N days (default: 30)", default: 30 })
      .option("yes", { type: "boolean", default: false, describe: "write the draft without confirmation" }),
  handler: Effect.fn("Cli.permission.scan")(function* (args) {
    process.stdout.write("Gathering data and drafting a permission ruleset; back soon..." + EOL)

    const { Database } = yield* Effect.promise(() => import("@opencode-ai/core/database/database"))
    const { SessionTable } = yield* Effect.promise(() => import("@opencode-ai/core/session/sql"))
    const { Session } = yield* Effect.promise(() => import("@/session/session"))
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))

    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("no project context")
    const { db } = yield* Database.Service
    const svc = yield* Session.Service

    const cutoff = Date.now() - args.days * 24 * 60 * 60 * 1000
    const rows = yield* db.select().from(SessionTable).all().pipe(Effect.orDie)
    const sessions = rows
      .map((row) => Session.fromRow(row))
      .filter((s) => s.projectID === ctx.project.id && s.time.updated >= cutoff)

    const cfg = yield* Config.Service
    const config = yield* cfg.get()
    const ruleset = Permission.fromConfig(config.permission ?? {})

    const counts = new Map<string, number>()
    for (const session of sessions) {
      const messages = yield* svc
        .messages({ sessionID: session.id })
        .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed([])))
      for (const message of messages) {
        for (const part of message.parts) {
          if (part.type !== "tool" || part.tool !== "bash") continue
          const input = (part.state as { input?: Record<string, unknown> } | undefined)?.input
          const command = typeof input?.command === "string" ? input.command : undefined
          if (!command) continue
          const prefix = candidatePrefix(command)
          if (!prefix) continue
          // No leading `*`: Permission's wildcard patterns are anchored
          // (^...$), so a leading+trailing `*ls*` would match "ls" ANYWHERE
          // in the command — e.g. inside `rm -rf ./ls-backup` — not just as
          // the command name. A trailing-only `*` keeps this an anchored
          // prefix match, mirroring how QueueDenyRules documents the same
          // semantics for deny patterns.
          const pattern = `${prefix}*`
          if (matchesQueueDeny(pattern)) continue
          const evaluated = Permission.evaluate("bash", command, ruleset)
          if (evaluated.action !== "ask") continue
          counts.set(pattern, (counts.get(pattern) ?? 0) + 1)
        }
      }
    }

    const draft = [...counts.entries()]
      .filter(([, count]) => count >= MIN_OCCURRENCES)
      .sort((a, b) => b[1] - a[1])

    if (draft.length === 0) {
      process.stdout.write(`No repeated, currently-asked bash patterns found in the last ${args.days} day(s).` + EOL)
      return
    }

    process.stdout.write(`Draft — ${draft.length} pattern(s) seen ${MIN_OCCURRENCES}+ times, currently asking:` + EOL)
    for (const [pattern, count] of draft) {
      process.stdout.write(`  + bash: "${pattern}" -> allow   (seen ${count}x)` + EOL)
    }

    if (!args.yes) {
      process.stdout.write(EOL + "Re-run with --yes to write this to opencode.json." + EOL)
      return
    }

    const rules: Record<string, "allow"> = {}
    for (const [pattern] of draft) rules[pattern] = "allow"

    // Same target + merge mechanism as the TUI's "Remember" option
    // (routes/session/permission.tsx): updateGlobal deep-merges its patch, so
    // spreading the current global config here is just to satisfy the `Info`
    // parameter type — the actual merge against on-disk state happens inside
    // updateGlobal itself, against a fresh read, not against this snapshot.
    const current = yield* cfg.getGlobal()
    const existingBash = current.permission?.bash
    const existingBashRules = existingBash && typeof existingBash === "object" ? existingBash : {}
    yield* cfg.updateGlobal({
      ...current,
      permission: { ...current.permission, bash: { ...existingBashRules, ...rules } },
    })

    process.stdout.write(EOL + `Saved to opencode.json: added ${draft.length} permission rule(s).` + EOL)
    process.stdout.write("Run `opencode permission status` to see the effective result." + EOL)
  }),
})

export const PermissionCommand = cmd({
  command: "permission",
  describe: "inspect and manage the permission ruleset",
  builder: (yargs) => yargs.command(PermissionStatusCommand).command(PermissionScanCommand).demandCommand(),
  async handler() {},
})
