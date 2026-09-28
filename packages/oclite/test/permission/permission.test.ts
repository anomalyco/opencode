import { describe, expect, test } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import {
  Asker,
  type AskRequest,
  type AgentDef,
  type PermissionMode,
  Permission,
  type SessionRecord,
} from "../../src/contract"
import { cliRules } from "../../src/config/config"
import { evaluate, fromConfig } from "../../src/forked/permission-rules"
import { bashPattern } from "../../src/permission/permission"
import { agent, config, permissionLayers, scriptedAsker } from "../tools/harness"

const cwd = "/tmp/oclite-permission"

function setup(
  input: {
    cfg?: Parameters<typeof config>[1]
    asker?: Layer.Layer<Asker>
    records?: Map<string, SessionRecord[]>
  } = {},
) {
  const records = input.records ?? new Map<string, SessionRecord[]>()
  const layer = permissionLayers(config(cwd, input.cfg), { asker: input.asker, records })
  const run = <A, E>(body: (permission: typeof Permission.Service) => Effect.Effect<A, E>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const permission = yield* Permission
        return yield* body(permission)
      }).pipe(Effect.provide(layer)),
    )
  // `run` builds a fresh layer each call, so state (always, denials) is checked within one `run`.
  const check = (
    permission: typeof Permission.Service,
    tool: string,
    pattern: string,
    options: {
      def?: AgentDef
      mode?: PermissionMode
      mcpReadOnly?: string[]
      always?: string[]
      session?: string
    } = {},
  ) =>
    permission
      .check({
        session_id: options.session ?? "ses_a",
        agent: "build",
        ruleset: permission.ruleset({
          agent: options.def ?? agent(),
          mode: options.mode ?? "default",
          mcpReadOnly: options.mcpReadOnly ?? [],
        }),
        tool,
        patterns: [pattern],
        always: options.always,
        summary: `${tool} ${pattern}`,
      })
      .pipe(
        Effect.exit,
        Effect.map((exit) =>
          Exit.isSuccess(exit) ? "allow" : exit.cause.toString().includes("Denied") ? "deny" : "reject",
        ),
      )
  return { run, check, records }
}

describe("rules", () => {
  test("evaluate: the last matching rule wins; no match asks", () => {
    const rules = fromConfig({ bash: { "*": "ask", "git *": "allow", "git push *": "deny" } })
    expect(evaluate("bash", "git status", rules).action).toBe("allow")
    expect(evaluate("bash", "git push origin", rules).action).toBe("deny")
    expect(evaluate("bash", "rm x", rules).action).toBe("ask")
    expect(evaluate("webfetch", "x", []).action).toBe("ask")
  })

  test("bash patterns: metacharacters make a command <complex>", () => {
    expect(bashPattern("git status")).toBe("git status")
    for (const command of ["git status; rm -rf x", "a && b", "a | b", "a > f", "echo $(id)", "echo `id`", "a\nb"])
      expect(bashPattern(command)).toBe("<complex>")
  })
})

describe("modes and composition", () => {
  test("defaults: reads allowed, edits and bash asked (headless → rejected), .env reads guarded", async () => {
    const { run, check } = setup()
    expect(
      await run((permission) =>
        Effect.all([
          check(permission, "read", "/tmp/oclite-permission/a.ts"),
          check(permission, "edit", "a.ts"),
          check(permission, "bash", "ls"),
          check(permission, "read", "/tmp/oclite-permission/.env"),
          check(permission, "read", "/tmp/oclite-permission/.env.example"),
        ]),
      ),
    ).toEqual(["allow", "reject", "reject", "reject", "allow"])
  })

  test("acceptEdits allows edit/write; plan behaves as read_only", async () => {
    const { run, check } = setup()
    expect(
      await run((permission) =>
        Effect.all([
          check(permission, "edit", "a.ts", { mode: "acceptEdits" }),
          check(permission, "write", "a.ts", { mode: "acceptEdits" }),
          check(permission, "bash", "ls", { mode: "acceptEdits" }),
          check(permission, "edit", "a.ts", { mode: "plan" }),
          check(permission, "bash", "git status -s", { mode: "plan" }),
        ]),
      ),
    ).toEqual(["allow", "allow", "reject", "deny", "allow"])
  })

  test("bypassPermissions allows everything but keeps the .env guard and CLI/parent denies", async () => {
    const { run, check } = setup({ cfg: { cliRules: cliRules(["bash(rm *)"], "deny") } })
    const parent = [{ permission: "webfetch", pattern: "*", action: "deny" as const }]
    expect(
      await run((permission) =>
        Effect.all([
          check(permission, "bash", "curl x", { mode: "bypassPermissions" }),
          check(permission, "bash", "rm -rf x", { mode: "bypassPermissions" }),
          check(permission, "read", "/x/.env", { mode: "bypassPermissions" }),
          permission
            .check({
              session_id: "ses_a",
              agent: "code",
              ruleset: permission.ruleset({
                agent: agent({ name: "code" }),
                mode: "bypassPermissions",
                parent,
                mcpReadOnly: [],
              }),
              tool: "webfetch",
              patterns: ["https://x"],
              summary: "webfetch",
            })
            .pipe(
              Effect.exit,
              Effect.map((exit) => (Exit.isSuccess(exit) ? "allow" : "deny")),
            ),
        ]),
      ),
    ).toEqual(["allow", "deny", "reject", "deny"])
  })

  test("--allowed-tools bash(git *) allows git; deny beats allow", async () => {
    const { run, check } = setup({
      cfg: { cliRules: [...cliRules(["bash(git *)"], "allow"), ...cliRules(["Bash(git push:*)"], "deny")] },
    })
    expect(
      await run((permission) =>
        Effect.all([
          check(permission, "bash", "git status"),
          check(permission, "bash", "git push origin"),
          check(permission, "bash", bashPattern("git status; rm -rf x")),
        ]),
      ),
    ).toEqual(["allow", "deny", "reject"])
  })

  test("read_only denies edit/write/mcp and complex bash, allows readOnlyHint MCP tools", async () => {
    const { run, check } = setup()
    const ro = { def: agent({ name: "explore", read_only: true }), mcpReadOnly: ["mcp__fixture__lookup"] }
    expect(
      await run((permission) =>
        Effect.all([
          check(permission, "edit", "a.ts", ro),
          check(permission, "write", "a.ts", ro),
          check(permission, "mcp__fixture__write_file", "*", ro),
          check(permission, "mcp__fixture__lookup", "*", ro),
          check(permission, "bash", "git log -1", ro),
          check(permission, "bash", bashPattern("git status; rm -rf x"), ro),
          check(permission, "bash", "rm -rf x", ro),
        ]),
      ),
    ).toEqual(["deny", "deny", "deny", "allow", "allow", "deny", "deny"])
  })
})

describe("asking", () => {
  test("headless: an ask is rejected at once and counted; permission records are written", async () => {
    const { run, check, records } = setup()
    const started = Date.now()
    const result = await run((permission) =>
      Effect.gen(function* () {
        const outcome = yield* check(permission, "bash", "make")
        return { outcome, denials: yield* permission.denials("ses_a") }
      }),
    )
    expect(result).toEqual({ outcome: "reject", denials: 1 })
    expect(Date.now() - started).toBeLessThan(1000)
    expect(records.get("ses_a")).toMatchObject([
      { type: "permission", tool: "bash", decision: "ask", reply: "reject", via: "headless" },
    ])
  })

  test("always is remembered for the session, persisted, and reapplied on resume", async () => {
    const seen: AskRequest[] = []
    const { run, check, records } = setup({ asker: scriptedAsker(["always"], seen) })
    expect(
      await run((permission) =>
        Effect.all([
          check(permission, "bash", "npm test", { always: ["npm *"] }),
          check(permission, "bash", "npm run build", { always: ["npm *"] }),
          check(permission, "bash", "npm test", { always: ["npm *"], session: "ses_other" }),
        ]),
      ),
    ).toEqual(["allow", "allow", "reject"])
    expect(seen.map((request) => request.session_id)).toEqual(["ses_a", "ses_other"])
    expect(records.get("ses_a")?.[0]).toMatchObject({
      decision: "ask",
      reply: "always",
      via: "repl",
      always: ["npm *"],
    })

    // A new process (fresh layer) resuming ses_a rebuilds the rule from the permission record: no ask.
    const resumed: AskRequest[] = []
    const again = setup({ asker: scriptedAsker([], resumed), records })
    expect(await again.run((permission) => again.check(permission, "bash", "npm ci"))).toBe("allow")
    expect(resumed).toEqual([])
  })

  test("always never overrides a deny", async () => {
    const { run, check } = setup({
      asker: scriptedAsker(["always"]),
      cfg: { cliRules: cliRules(["bash(npm publish*)"], "deny") },
    })
    expect(
      await run((permission) =>
        Effect.all([
          check(permission, "bash", "npm test", { always: ["npm *"] }),
          check(permission, "bash", "npm publish"),
        ]),
      ),
    ).toEqual(["allow", "deny"])
  })

  test("an asker that never answers is cut off at permission_timeout_ms and treated as reject", async () => {
    const never = Layer.succeed(Asker, { ask: () => Effect.never })
    const { run, check, records } = setup({ asker: never, cfg: { permission_timeout_ms: 50 } })
    expect(await run((permission) => check(permission, "bash", "make"))).toBe("reject")
    expect(records.get("ses_a")?.[0]).toMatchObject({ reply: "reject", via: "timeout" })
  })

  test("asks are serialized: a second ask waits for the first and sees its always", async () => {
    const seen: AskRequest[] = []
    const slow = Layer.succeed(Asker, {
      ask: (request: AskRequest) =>
        Effect.sync(() => seen.push(request)).pipe(Effect.andThen(Effect.sleep(50)), Effect.as("always" as const)),
    })
    const { run, check } = setup({ asker: slow })
    const results = await run((permission) =>
      Effect.all(
        [
          check(permission, "bash", "npm test", { always: ["npm *"] }),
          check(permission, "bash", "npm test", { always: ["npm *"] }),
        ],
        {
          concurrency: "unbounded",
        },
      ),
    )
    expect(results).toEqual(["allow", "allow"])
    expect(seen).toHaveLength(1)
  })
})
