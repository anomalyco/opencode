import { describe, expect } from "bun:test"
import { ToolFailure } from "@opencode/ai/effect"
import { Effect, Option, Types } from "effect"
import type { ToolHooks } from "@opencode/plugin/effect/tool"
import { Agent } from "@opencode/core/agent"
import { Environment } from "@opencode/core/environment/index"
import { PlanPlugin } from "@opencode/core/plugin/plan"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { Tool } from "@opencode/schema/tool"
import { Global } from "@opencode/util/global"
import path from "path"
import { it } from "../lib/effect"
import { host } from "./host"
import { tmpdir } from "../fixture/tmpdir"

const sessionID = Session.ID.make("ses_plan_test")
const plan = Agent.ID.make("plan")
const data = "/home/plan-test/.local/share/opencode"
const planDirectory = path.join(data, "plan")

/** Runs the plan plugin against stubbed domains, capturing the plan agent and the tool hook. */
const run = Effect.fnUntraced(function* (paths: { readonly home?: string; readonly data?: string } = {}) {
  let toolHook: ((input: ToolHooks["execute.after"]) => Effect.Effect<void>) | undefined
  const defaults = Agent.Info.default(plan)
  const planAgent: Types.DeepMutable<Agent.Info> = {
    ...defaults,
    permissions: [...defaults.permissions],
  }
  const driver = Environment.makeMemoryDriver()
  yield* PlanPlugin.Plugin.effect(
    host({
      agent: {
        get: () => Effect.die("unused agent.get"),
        list: () => Effect.die("unused agent.list"),
        reload: () => Effect.die("unused agent.reload"),
        transform: (callback) => {
          callback({
            list: () => [planAgent],
            get: (id) => (id === plan ? planAgent : undefined),
            default: () => {},
            update: (id, update) => {
              if (id === plan) update(planAgent)
            },
            remove: () => {},
          })
          return Effect.succeed({ dispose: Effect.void })
        },
      },
      tool: {
        transform: () => Effect.die("unused tool.transform"),
        reload: () => Effect.die("unused tool.reload"),
        list: () => Effect.die("unused tool.list"),
        hook: (name, callback) => {
          if (name === "execute.after") {
            // Hook names and callbacks are correlated, but TypeScript does not narrow this generic registration API.
            // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
            toolHook = callback as unknown as (input: ToolHooks["execute.after"]) => Effect.Effect<void>
          }
          return Effect.succeed({ dispose: Effect.void })
        },
      },
    }),
  ).pipe(
    Effect.provideService(Global.Service, Global.Service.of({ ...Global.make(), data, ...paths })),
    Effect.provideService(Environment.Service, Environment.make(Environment.localID, driver)),
  )
  if (!toolHook) return yield* Effect.die("plan plugin did not register a tool hook")
  return { toolHook, files: Environment.makeFiles(driver), planAgent }
})

type ToolErrorEvent = Extract<ToolHooks["execute.after"], { readonly status: "error" }>

const toolError = (tool: "edit" | "write" | "patch", error: Tool.Error): ToolErrorEvent => ({
  tool,
  codemode: false,
  input: {},
  sessionID,
  agent: plan,
  messageID: SessionMessage.ID.make("msg_plan_tool"),
  id: Tool.CallID.make("call_plan_tool"),
  status: "error",
  error,
})

describe("plan plugin instructions", () => {
  it.effect("gives the plan agent its own enter and leave texts without replacing its prompt", () =>
    Effect.gen(function* () {
      const { planAgent } = yield* run()
      expect(planAgent.system).toBeUndefined()
      const instructions = planAgent.instructions
      if (typeof instructions !== "object") return yield* Effect.die("expected selected and unselected instructions")
      expect(instructions.selected).toContain("You are in Plan mode")
      expect(instructions.selected).toContain(
        "Do not create or update plan files unless the user explicitly asks you to",
      )
      expect(instructions.selected).toContain(planDirectory)
      expect(instructions.selected).toContain("Do not modify any other files")
      expect(instructions.unselected).toContain("You are no longer the Plan agent, so you are NO LONGER in Plan mode")
    }),
  )
})

describe("plan plugin legacy directory", () => {
  it.effect("moves plans from ~/.opencode/plan into the data directory", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.promise(() => tmpdir())
      yield* Effect.addFinalizer(() => Effect.promise(() => tmp[Symbol.asyncDispose]()))
      const home = path.join(tmp.path, "home")
      const data = path.join(tmp.path, "data")
      yield* Effect.promise(() => Bun.write(path.join(home, ".opencode", "plan", "old.md"), "old plan"))
      yield* run({ home, data })
      expect(yield* Effect.promise(() => Bun.file(path.join(data, "plan", "old.md")).text())).toBe("old plan")
      expect(yield* Effect.promise(() => Bun.file(path.join(home, ".opencode", "plan", "old.md")).exists())).toBe(false)
    }),
  )

  it.effect("leaves both directories alone when the data directory already has plans", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.promise(() => tmpdir())
      yield* Effect.addFinalizer(() => Effect.promise(() => tmp[Symbol.asyncDispose]()))
      const home = path.join(tmp.path, "home")
      const data = path.join(tmp.path, "data")
      yield* Effect.promise(() => Bun.write(path.join(home, ".opencode", "plan", "old.md"), "old plan"))
      yield* Effect.promise(() => Bun.write(path.join(data, "plan", "new.md"), "new plan"))
      yield* run({ home, data })
      expect(yield* Effect.promise(() => Bun.file(path.join(home, ".opencode", "plan", "old.md")).text())).toBe(
        "old plan",
      )
      expect(yield* Effect.promise(() => Bun.file(path.join(data, "plan", "old.md")).exists())).toBe(false)
      expect(yield* Effect.promise(() => Bun.file(path.join(data, "plan", "new.md")).text())).toBe("new plan")
    }),
  )
})

describe("plan plugin mutations", () => {
  it.effect("does not create the Plan directory during activation", () =>
    Effect.gen(function* () {
      const { files } = yield* run()
      expect(Option.isNone(yield* files.stat(planDirectory).pipe(Effect.option))).toBe(true)
    }),
  )

  it.effect("allows edits only inside the Plan directory", () =>
    Effect.gen(function* () {
      const { planAgent } = yield* run()
      expect(Permission.evaluate("edit", path.join(planDirectory, "work.md"), planAgent.permissions).effect).toBe(
        "allow",
      )
      expect(Permission.evaluate("edit", "/workspace/source.ts", planAgent.permissions).effect).toBe("deny")
      expect(Permission.evaluate("edit", "source.ts", planAgent.permissions).effect).toBe("deny")
    }),
  )

  it.effect("allows external directories without asking", () =>
    Effect.gen(function* () {
      const { planAgent } = yield* run()
      expect(
        Permission.evaluate("external_directory", path.join(planDirectory, "*"), planAgent.permissions).effect,
      ).toBe("allow")
      expect(Permission.evaluate("external_directory", "/outside/*", planAgent.permissions).effect).toBe("allow")
    }),
  )

  it.effect("rewrites blocked mutation failures with the Plan directory", () =>
    Effect.gen(function* () {
      const { toolHook } = yield* run()
      for (const tool of ["edit", "write", "patch"] as const) {
        const event = toolError(
          tool,
          new ToolFailure({
            message: "Unable to modify file",
            error: new Permission.BlockedError({
              rules: [],
              permission: "edit",
              resources: ["source.ts"],
            }),
          }),
        )
        yield* toolHook(event)
        expect(event.error.message).toContain("outside the Plan directory")
        expect(event.error.message).toContain(planDirectory)
      }
    }),
  )

  it.effect("preserves mutation failures unrelated to permissions", () =>
    Effect.gen(function* () {
      const { toolHook } = yield* run()
      const error = new ToolFailure({ message: "oldString was not found" })
      const event = toolError("edit", error)
      yield* toolHook(event)
      expect(event.error).toBe(error)
    }),
  )
})
