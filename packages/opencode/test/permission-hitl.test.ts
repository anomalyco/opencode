import { describe, expect, test } from "bun:test"
import { Effect, Exit, Fiber, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { SessionID } from "@opencode-ai/schema/session-id"
import { Permission } from "../src/permission"
import { Hitl } from "../src/permission/hitl"
import { Risk } from "../src/permission/risk"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "./lib/effect"
import { provideTmpdirInstance } from "./fixture/fixture"

const it = testEffect(Layer.mergeAll(LayerNode.compile(Permission.node), LayerNode.compile(CrossSpawnSpawner.node)))

const sessionID = SessionID.make("ses_hitl")

const ALLOW: PermissionV1.Ruleset = [{ permission: "*", pattern: "*", action: "allow" }]

function request(
  permission: string,
  patterns: string[],
  options?: { command?: string; ruleset?: PermissionV1.Ruleset; hitl?: Hitl.Context },
): Permission.AskInput {
  return {
    sessionID,
    permission,
    patterns,
    metadata: options?.command ? { command: options.command } : {},
    always: patterns,
    ruleset: options?.ruleset ?? ALLOW,
    ...(options?.hitl ? { hitl: options.hitl } : {}),
  }
}

describe("Risk.classify", () => {
  test("classifies operations by side effect", () => {
    expect(Risk.classify("read")).toBe("readonly")
    expect(Risk.classify("glob")).toBe("readonly")
    expect(Risk.classify("grep")).toBe("readonly")
    expect(Risk.classify("lsp")).toBe("readonly")
    expect(Risk.classify("websearch")).toBe("readonly")
    expect(Risk.classify("webfetch")).toBe("routine")
    expect(Risk.classify("task")).toBe("routine")
    expect(Risk.classify("todowrite")).toBe("routine")
    expect(Risk.classify("edit")).toBe("moderate")
    expect(Risk.classify("external_directory")).toBe("moderate")
    expect(Risk.classify("mcp:server:tool")).toBe("moderate")
    expect(Risk.classify("workflow_tool_approval")).toBe("moderate")
  })

  test("detects destructive commands", () => {
    expect(Risk.classify("bash", "rm -rf dist")).toBe("destructive")
    expect(Risk.classify("bash", "sudo ls")).toBe("destructive")
    expect(Risk.classify("bash", "npm publish")).toBe("destructive")
    expect(Risk.classify("bash", "drop table users")).toBe("destructive")
    expect(Risk.classify("bash", "git push origin main --force")).toBe("destructive")
    expect(Risk.classify("bash", "git push -f")).toBe("destructive")
    expect(Risk.classify("bash", "git reset --hard HEAD~1")).toBe("destructive")
    expect(Risk.classify("bash", "git clean -fd")).toBe("destructive")
    expect(Risk.classify("bash", "git branch -D stale")).toBe("destructive")
    expect(Risk.classify("bash", "git stash drop stash@{0}")).toBe("destructive")
    expect(Risk.classify("bash", "terraform destroy")).toBe("destructive")
    expect(Risk.classify("bash", "ls && rm -rf out")).toBe("destructive")
    expect(Risk.classify("bash", "cd build; rm -rf .")).toBe("destructive")
  })

  test("classifies routine and readonly commands", () => {
    expect(Risk.classify("bash", "git status")).toBe("readonly")
    expect(Risk.classify("bash", "git log --oneline -5")).toBe("readonly")
    expect(Risk.classify("bash", "ls -la")).toBe("readonly")
    expect(Risk.classify("bash", "grep -rn TODO src")).toBe("readonly")
    expect(Risk.classify("bash", "git push origin main")).toBe("routine")
    expect(Risk.classify("bash", "git checkout main")).toBe("routine")
    expect(Risk.classify("bash", "npm install")).toBe("routine")
    expect(Risk.classify("bash", "bun run build")).toBe("routine")
    expect(Risk.classify("bash", "mkdir out")).toBe("routine")
    expect(Risk.classify("bash", "cargo build")).toBe("routine")
  })

  test("defaults unknown and redirected commands to moderate", () => {
    expect(Risk.classify("bash", "")).toBe("moderate")
    expect(Risk.classify("bash", "node script.js")).toBe("moderate")
    expect(Risk.classify("bash", "git rebase -i main")).toBe("moderate")
    expect(Risk.classify("bash", "cat notes.txt > backup.txt")).toBe("moderate")
    expect(Risk.classify("bash", "echo hi >> log.txt")).toBe("moderate")
  })
})

describe("Hitl.evaluate", () => {
  const edit: Hitl.Context = {
    operation: "edit",
    pattern: "/repo/src/index.ts",
    tool: "edit",
    agent: "build",
    provider: "anthropic",
    workspace: "/repo",
  }
  const read: Hitl.Context = {
    operation: "read",
    pattern: "/repo/README.md",
    tool: "read",
    agent: "build",
    provider: "anthropic",
    workspace: "/repo",
  }
  const bashRm: Hitl.Context = {
    operation: "bash",
    pattern: "rm -rf dist",
    command: "rm -rf dist",
    tool: "bash",
    agent: "build",
    provider: "anthropic",
    workspace: "/repo",
  }
  const bashLs: Hitl.Context = { ...bashRm, pattern: "ls", command: "ls" }
  const task: Hitl.Context = { ...edit, operation: "task", pattern: "explore", tool: "task" }

  test("without configuration nothing is confirmed", () => {
    expect(Hitl.evaluate(undefined, bashRm)).toBe("allow")
    expect(Hitl.evaluate({}, bashRm)).toBe("allow")
    expect(Hitl.evaluate({ level: "AUTO" }, bashRm)).toBe("allow")
  })

  test("SAFE confirms only destructive operations", () => {
    expect(Hitl.evaluate({ level: "SAFE" }, bashRm)).toBe("ask")
    expect(Hitl.evaluate({ level: "SAFE" }, edit)).toBe("allow")
    expect(Hitl.evaluate({ level: "SAFE" }, read)).toBe("allow")
  })

  test("BALANCED confirms moderate and destructive operations", () => {
    expect(Hitl.evaluate({ level: "BALANCED" }, edit)).toBe("ask")
    expect(Hitl.evaluate({ level: "BALANCED" }, bashRm)).toBe("ask")
    expect(Hitl.evaluate({ level: "BALANCED" }, task)).toBe("allow")
    expect(Hitl.evaluate({ level: "BALANCED" }, read)).toBe("allow")
  })

  test("STRICT confirms everything except readonly operations", () => {
    expect(Hitl.evaluate({ level: "STRICT" }, task)).toBe("ask")
    expect(Hitl.evaluate({ level: "STRICT" }, edit)).toBe("ask")
    expect(
      Hitl.evaluate({ level: "STRICT" }, { ...bashRm, pattern: "node script.js", command: "node script.js" }),
    ).toBe("ask")
    expect(Hitl.evaluate({ level: "STRICT" }, bashLs)).toBe("allow")
    expect(Hitl.evaluate({ level: "STRICT" }, read)).toBe("allow")
  })

  test("CUSTOM follows only the configured policy", () => {
    expect(Hitl.evaluate({ level: "CUSTOM" }, edit)).toBe("allow")
    expect(Hitl.evaluate({ level: "CUSTOM", policy: [{ operation: "edit", action: "ask" }] }, edit)).toBe("ask")
    expect(Hitl.evaluate({ level: "CUSTOM", policy: [{ operation: "edit", action: "ask" }] }, read)).toBe("allow")
  })

  test("policy rules take precedence over the level threshold", () => {
    expect(Hitl.evaluate({ level: "AUTO", policy: [{ operation: "edit", action: "ask" }] }, edit)).toBe("ask")
    expect(Hitl.evaluate({ level: "SAFE", policy: [{ operation: "bash", action: "ask" }] }, bashRm)).toBe("ask")
    expect(Hitl.evaluate({ level: "BALANCED", policy: [{ risk: "moderate", action: "allow" }] }, edit)).toBe("allow")
  })

  test("the last matching rule wins", () => {
    expect(
      Hitl.evaluate(
        {
          level: "BALANCED",
          policy: [
            { operation: "edit", action: "allow" },
            { operation: "edit", action: "ask" },
          ],
        },
        edit,
      ),
    ).toBe("ask")
    expect(
      Hitl.evaluate(
        {
          level: "STRICT",
          policy: [
            { operation: "edit", action: "ask" },
            { operation: "edit", action: "allow" },
          ],
        },
        edit,
      ),
    ).toBe("allow")
  })

  test("matches the tool dimension", () => {
    const policy = [{ tool: "bash", action: "ask" as const }]
    expect(Hitl.evaluate({ level: "AUTO", policy }, bashRm)).toBe("ask")
    expect(Hitl.evaluate({ level: "AUTO", policy }, edit)).toBe("allow")
  })

  test("matches the file dimension", () => {
    const policy = [{ file: "*.env", action: "ask" as const }]
    expect(Hitl.evaluate({ level: "AUTO", policy }, { operation: "read", pattern: "/repo/.env" })).toBe("ask")
    expect(Hitl.evaluate({ level: "AUTO", policy }, { operation: "read", pattern: "/repo/app.ts" })).toBe("allow")
  })

  test("matches the directory dimension", () => {
    const policy = [{ directory: "/repo/dist", action: "ask" as const }]
    expect(Hitl.evaluate({ level: "AUTO", policy }, { operation: "edit", pattern: "/repo/dist/out.js" })).toBe("ask")
    expect(Hitl.evaluate({ level: "AUTO", policy }, { operation: "edit", pattern: "/repo/dist" })).toBe("ask")
    expect(Hitl.evaluate({ level: "AUTO", policy }, { operation: "edit", pattern: "/repo/src/a.ts" })).toBe("allow")
  })

  test("matches the command dimension", () => {
    const policy = [{ command: "rm *", action: "ask" as const }]
    expect(Hitl.evaluate({ level: "AUTO", policy }, bashRm)).toBe("ask")
    expect(Hitl.evaluate({ level: "AUTO", policy }, bashLs)).toBe("allow")
  })

  test("matches the agent dimension", () => {
    const policy = [{ agent: "plan*", action: "ask" as const }]
    expect(Hitl.evaluate({ level: "AUTO", policy }, edit)).toBe("allow")
    expect(Hitl.evaluate({ level: "AUTO", policy }, { ...edit, agent: "planner" })).toBe("ask")
  })

  test("matches the provider dimension", () => {
    const policy = [{ provider: "openai*", action: "ask" as const }]
    expect(Hitl.evaluate({ level: "AUTO", policy }, edit)).toBe("allow")
    expect(Hitl.evaluate({ level: "AUTO", policy }, { ...edit, provider: "openai" })).toBe("ask")
  })

  test("matches the workspace dimension", () => {
    const policy = [{ workspace: "/repo", action: "ask" as const }]
    expect(Hitl.evaluate({ level: "AUTO", policy }, edit)).toBe("ask")
    expect(Hitl.evaluate({ level: "AUTO", policy }, { ...edit, workspace: "/other" })).toBe("allow")
  })

  test("matches the operation dimension", () => {
    const policy = [{ operation: "webfetch", action: "ask" as const }]
    expect(Hitl.evaluate({ level: "AUTO", policy }, edit)).toBe("allow")
    expect(Hitl.evaluate({ level: "AUTO", policy }, { operation: "webfetch", pattern: "https://example.com" })).toBe(
      "ask",
    )
  })

  test("matches the risk dimension", () => {
    const policy = [{ risk: "destructive" as const, action: "ask" as const }]
    expect(Hitl.evaluate({ level: "AUTO", policy }, edit)).toBe("allow")
    expect(Hitl.evaluate({ level: "AUTO", policy }, bashRm)).toBe("ask")
  })

  test("a rule with a dimension missing from the context never matches", () => {
    expect(Hitl.evaluate({ level: "AUTO", policy: [{ agent: "*", action: "ask" }] }, { operation: "edit" })).toBe(
      "allow",
    )
  })
})

describe("Permission.ask human-in-the-loop", () => {
  it.live("adds no confirmation without configuration", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        yield* awaitWithTimeout(
          permission.ask(request("edit", ["/repo/src/a.ts"])),
          "ask should not wait",
          "30 seconds",
        )
        // Destructive commands now confirm through the always-on guard even
        // with no HITL configuration; see permission-actions.test.ts. A
        // benign command still resolves without any confirmation here.
        yield* awaitWithTimeout(
          permission.ask(request("bash", ["bun run build"], { command: "bun run build" })),
          "ask should not wait",
          "30 seconds",
        )
      }),
    ),
  )

  it.live("BALANCED confirms moderate operations the ruleset allows", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const permission = yield* Permission.Service
          // Warm the instance and config state so the forked ask publishes
          // within the poll window on cold starts.
          yield* awaitWithTimeout(
            permission.ask(request("read", ["/repo/README.md"])),
            "warmup ask should not wait",
            "30 seconds",
          )
          const fiber = yield* permission.ask(request("edit", ["/repo/src/a.ts"])).pipe(Effect.forkChild)
          const pending = yield* pollWithTimeout(
            Effect.gen(function* () {
              const list = yield* permission.list()
              return list.find((item) => item.permission === "edit")
            }),
            "pending confirmation not published",
            "15 seconds",
          )
          yield* permission.reply({ requestID: pending.id, reply: "once" })
          yield* awaitWithTimeout(Fiber.join(fiber), "ask should finish after the reply")
        }),
      { config: { human_in_the_loop: { level: "BALANCED" } } },
    ),
  )

  it.live("SAFE confirms destructive commands but not edits", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const permission = yield* Permission.Service
          yield* awaitWithTimeout(
            permission.ask(request("edit", ["/repo/src/a.ts"])),
            "edit should not confirm",
            "30 seconds",
          )
          const fiber = yield* permission
            .ask(request("bash", ["rm -rf dist"], { command: "rm -rf dist", hitl: { tool: "bash" } }))
            .pipe(Effect.forkChild)
          const pending = yield* pollWithTimeout(
            Effect.gen(function* () {
              const list = yield* permission.list()
              return list.find((item) => item.permission === "bash")
            }),
            "destructive command not confirmed",
            "15 seconds",
          )
          yield* permission.reply({ requestID: pending.id, reply: "once" })
          yield* awaitWithTimeout(Fiber.join(fiber), "ask should finish after the reply")
        }),
      { config: { human_in_the_loop: { level: "SAFE" } } },
    ),
  )

  it.live("an always approval suppresses later confirmations", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const permission = yield* Permission.Service
          yield* awaitWithTimeout(
            permission.ask(request("read", ["/repo/README.md"])),
            "warmup ask should not wait",
            "30 seconds",
          )
          const fiber = yield* permission.ask(request("edit", ["/repo/src/a.ts"])).pipe(Effect.forkChild)
          const pending = yield* pollWithTimeout(
            Effect.gen(function* () {
              const list = yield* permission.list()
              return list.find((item) => item.permission === "edit")
            }),
            "pending confirmation not published",
            "15 seconds",
          )
          yield* permission.reply({ requestID: pending.id, reply: "always" })
          yield* awaitWithTimeout(Fiber.join(fiber), "ask should finish after the reply")
          yield* awaitWithTimeout(
            permission.ask(request("edit", ["/repo/src/a.ts"])),
            "second ask should be pre-approved",
            "30 seconds",
          )
        }),
      { config: { human_in_the_loop: { level: "BALANCED" } } },
    ),
  )

  it.live("a deny rule still wins at any level", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const permission = yield* Permission.Service
          const exit = yield* Effect.exit(
            permission.ask(
              request("edit", ["/repo/src/a.ts"], {
                ruleset: [{ permission: "edit", pattern: "*", action: "deny" }],
              }),
            ),
          )
          expect(Exit.isSuccess(exit)).toBe(false)
        }),
      { config: { human_in_the_loop: { level: "STRICT" } } },
    ),
  )
})
