import { describe, expect, spyOn } from "bun:test"
import { DateTime, Effect, Layer, Stream } from "effect"
import { Agent } from "@opencode/core/agent"
import { Automation } from "@opencode/core/automation"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Flag } from "@opencode/core/flag"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { AutomationTools } from "@opencode/core/tool/plugin/automation"
import { Document, Info, type Entry } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import type { CommandDefinition } from "@opencode/plugin/effect/command"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { codeModeListings, executeTool, registerToolPlugin, toolIdentity, toolNodeReplacements } from "./lib/tool"

const sessionID = Session.ID.make("ses_automation_tool_test")
const otherSessionID = Session.ID.make("ses_automation_tool_other")
const projects: Record<string, Project.ID> = {
  [sessionID]: Project.ID.make("prj_one"),
  [otherSessionID]: Project.ID.make("prj_two"),
}
const now = DateTime.makeUnsafe("2026-10-27T13:00:00Z")
const names = [
  "automation_create",
  "automation_list",
  "automation_pause",
  "automation_resume",
  "automation_delete",
].map((name) => `shuvcode.${name}`)

const it = testEffect(AppNodeBuilder.build(Tool.node, toolNodeReplacements()))

/** An in-memory Automation service. The real one is covered in automation.test.ts; this exercises the tool layer. */
const memory = () => {
  const rows = new Map<Automation.ID, Automation.Info>()
  const flag = { enabled: true }
  const find = (id: Automation.ID): Effect.Effect<Automation.Info, Automation.NotFoundError> => {
    const info = rows.get(id)
    return info ? Effect.succeed(info) : Effect.fail(new Automation.NotFoundError({ automationID: id }))
  }
  const update = (id: Automation.ID, status: Automation.Info["status"]) =>
    find(id).pipe(
      Effect.map((info) => {
        const next = { ...info, status }
        rows.set(id, next)
        return next
      }),
    )
  const service = Automation.Service.of({
    create: (input) =>
      Effect.sync(() => {
        const info: Automation.Info = {
          id: Automation.ID.make(`aut_${rows.size + 1}`),
          name: input.name,
          projectID: projects[input.sessionID!]!,
          sessionID: input.sessionID,
          directory: "/project",
          trigger: input.trigger,
          tz: "America/New_York",
          action:
            input.action.type === "prompt"
              ? { ...input.action, to: input.action.to ?? { session: input.sessionID! } }
              : input.action,
          status: "active",
          ...(input.trigger.type === "event" ? {} : { nextDueAt: DateTime.add(now, { minutes: 20 }) }),
          runCount: 0,
          time: { created: now, updated: now },
        }
        rows.set(info.id, info)
        return info
      }),
    list: (input) => Effect.sync(() => [...rows.values()].filter((info) => info.projectID === input?.projectID)),
    get: find,
    pause: (id) => update(id, "paused"),
    resume: (id) => update(id, "active"),
    remove: (id) => find(id).pipe(Effect.map(() => void rows.delete(id))),
    enabled: () => Effect.sync(() => flag.enabled),
    tick: Effect.void,
    run: Effect.never,
  })
  return { rows, flag, service }
}

const sessions = Layer.succeed(Session.Service, {
  get: (id: Session.ID) =>
    Effect.succeed({ id, projectID: projects[id]!, location: { directory: AbsolutePath.make("/project") } }),
} as unknown as Session.Interface)

const setup = (experimental: ConfigExperimental.Info | undefined) =>
  Effect.gen(function* () {
    const automations = memory()
    const commands: CommandDefinition[] = []
    const prompts: unknown[] = []
    yield* registerToolPlugin(AutomationTools.Plugin, {
      event: { subscribe: () => Stream.never },
      command: {
        list: () => Effect.die("unused command.list"),
        reload: () => Effect.void,
        transform: (callback) =>
          Effect.sync(() => {
            callback({ add: (definition) => commands.push(definition) })
            return { dispose: Effect.void }
          }),
      },
      session: { prompt: (input) => Effect.sync(() => prompts.push(input)).pipe(Effect.as(undefined as never)) },
    }).pipe(
      Effect.provide(Flag.testLayer([document(experimental)])),
      Effect.provide(Layer.succeed(Automation.Service, automations.service)),
      Effect.provide(sessions),
      Effect.provide(permissionLayer({ assert: () => Effect.void })),
    )
    return { registry: yield* Tool.Service, ...automations, commands, prompts }
  })

/** Runs one Code Mode call, the way the model reaches these tools. */
const call = (registry: Tool.Interface, name: string, input: unknown, session = sessionID) =>
  executeTool(registry, {
    sessionID: session,
    ...toolIdentity,
    call: {
      type: "tool-call",
      id: `call-${name}`,
      name: "execute",
      input: { code: `return await tools.shuvcode.${name}(${JSON.stringify(input)})` },
    },
  })
const run = (registry: Tool.Interface, name: string, input: unknown, session = sessionID) =>
  call(registry, name, input, session).pipe(
    Effect.map((result) => JSON.parse(result.content?.[0]?.type === "text" ? result.content[0].text : "")),
  )

/** Calls a tool directly, as a model does when Code Mode is denied, and returns the text it reads. */
const direct = (registry: Tool.Interface, name: string, input: unknown) =>
  registry.snapshot([{ action: "execute", resource: "*", effect: "deny" }]).pipe(
    Effect.flatMap((tools) =>
      tools.execute({
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: `call-direct-${name}`, name: `shuvcode_${name}`, input },
      }),
    ),
    Effect.map((result) => result.content?.map((part) => (part.type === "text" ? part.text : "")).join("")),
    Effect.orDie,
  )

const paths = (registry: Tool.Interface) =>
  registry
    .snapshot()
    .pipe(
      Effect.map((snapshot) =>
        snapshot.codeModeCatalog ? codeModeListings(snapshot.codeModeCatalog).map((tool) => tool.path) : [],
      ),
    )

const on = new ConfigExperimental.Info({ automations: true })

describe("AutomationTools", () => {
  it.effect("are absent unless experimental.automations is enabled", () =>
    Effect.gen(function* () {
      expect(yield* paths((yield* setup(undefined)).registry)).not.toContain(names[0])
      const off = yield* setup(new ConfigExperimental.Info({ automations: false }))
      expect(yield* paths(off.registry)).not.toContain(names[0])
      expect(off.commands).toEqual([])
      const enabled = yield* setup(on)
      expect(yield* paths(enabled.registry)).toEqual(expect.arrayContaining(names))
      expect(enabled.commands.map((command) => command.name)).toEqual(["automation"])
    }),
  )

  it.effect("passes the originating tool call to the service when creating an event watch", () =>
    Effect.gen(function* () {
      const { registry, service } = yield* setup(on)
      const create = spyOn(service, "create")
      const request = {
        name: "watch build",
        trigger: { type: "event", server: "ci", event: "build.changed" },
        action: { type: "prompt", prompt: "Check the build" },
      }
      yield* run(registry, "automation_create", request)
      expect(create).toHaveBeenCalledWith(
        { ...request, sessionID },
        {
          sessionID,
          agent: toolIdentity.agent,
          source: { type: "tool", messageID: toolIdentity.messageID, id: expect.any(String) },
        },
      )
    }),
  )

  it.effect("creates, lists, pauses, resumes and deletes this project's automations", () =>
    Effect.gen(function* () {
      const { registry, rows } = yield* setup(on)

      expect(
        yield* run(registry, "automation_create", {
          name: "build",
          trigger: { type: "at", at: "in 20 minutes" },
          action: { type: "prompt", prompt: "check the build" },
        }),
      ).toMatchObject({
        id: "aut_1",
        name: "build",
        trigger: { type: "at", at: "in 20 minutes" },
        action: { type: "prompt", prompt: "check the build", to: { session: sessionID } },
        status: "active",
        nextDueAt: "2026-10-27T09:20:00.000-04:00",
      })
      expect([...rows.values()][0]).toMatchObject({ sessionID })

      expect(yield* run(registry, "automation_list", {})).toMatchObject({
        automations: [{ id: "aut_1", status: "active" }],
      })
      expect(yield* run(registry, "automation_pause", { id: "aut_1" })).toMatchObject({ status: "paused" })
      expect(yield* run(registry, "automation_resume", { id: "aut_1" })).toMatchObject({ status: "active" })
      expect(yield* run(registry, "automation_delete", { id: "aut_1" })).toEqual({ id: "aut_1", removed: true })
      expect(rows.size).toBe(0)
    }),
  )

  it.effect("/automation hands the request to the model with the automation instructions", () =>
    Effect.gen(function* () {
      const { commands, prompts } = yield* setup(on)
      yield* commands[0]!
        .execute({ sessionID, prompt: { text: "  every morning at 9 check CI  " }, delivery: "steer" })
        .pipe(Effect.orDie)
      expect(prompts).toHaveLength(1)
      expect(prompts[0]).toMatchObject({ sessionID, delivery: "steer" })
      const text = (prompts[0] as { text: string }).text
      expect(text).toContain("every morning at 9 check CI")
      expect(text).not.toContain("$ARGUMENTS")
    }),
  )

  it.effect("rechecks the flag on each call, since a request keeps its tools after config reloads", () =>
    Effect.gen(function* () {
      const { registry, rows, flag } = yield* setup(on)
      yield* run(registry, "automation_create", {
        name: "ping",
        trigger: { type: "every", every: "1 hour" },
        action: { type: "prompt", prompt: "ping" },
      })
      flag.enabled = false

      // automation_create checks the flag inside the service, which this in-memory one skips.
      for (const [name, input] of [
        ["automation_list", {}],
        ["automation_pause", { id: "aut_1" }],
        ["automation_resume", { id: "aut_1" }],
        ["automation_delete", { id: "aut_1" }],
      ] as const) {
        expect(yield* call(registry, name, input)).toMatchObject({
          content: [{ type: "text", text: expect.stringContaining("Automations are disabled") }],
          metadata: { error: true },
        })
      }
      expect(rows.get(Automation.ID.make("aut_1"))).toMatchObject({ status: "active" })
    }),
  )

  it.effect("rejects a malformed trigger, target or empty name", () =>
    Effect.gen(function* () {
      const { registry, rows } = yield* setup(on)
      const bad = (input: unknown) => call(registry, "automation_create", input)
      expect(
        yield* bad({ name: "x", trigger: { every: "1 hour" }, action: { type: "prompt", prompt: "ping" } }),
      ).toMatchObject({ metadata: { error: true } })
      expect(
        yield* bad({
          name: "x",
          trigger: { type: "every", every: "1 hour" },
          action: {
            type: "prompt",
            prompt: "ping",
            to: { session: otherSessionID, subagent: Agent.ID.make("general") },
          },
        }),
      ).toMatchObject({ metadata: { error: true } })
      expect(
        yield* bad({
          name: "",
          trigger: { type: "every", every: "1 hour" },
          action: { type: "prompt", prompt: "ping" },
        }),
      ).toMatchObject({ metadata: { error: true } })
      expect(rows.size).toBe(0)
    }),
  )

  it.effect("puts each automation's id, trigger, status, next run and action in the text without Code Mode", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup(on)
      expect(
        yield* direct(registry, "automation_create", {
          name: "ci",
          trigger: { type: "every", every: "1 hour" },
          action: { type: "prompt", prompt: "check CI" },
        }),
      ).toBe(
        `Created: aut_1 "ci": every 1 hour (America/New_York), active, next 2026-10-27T09:20:00.000-04:00, prompt ${sessionID}: "check CI"`,
      )
      yield* direct(registry, "automation_create", {
        name: "watch",
        trigger: { type: "cron", cron: "0 9 * * 1-5" },
        action: { type: "code", code: `\n  const t = await tools.slack.read_thread({})\n  return { state: t }` },
      })
      yield* direct(registry, "automation_pause", { id: "aut_2" })
      const list = yield* direct(registry, "automation_list", {})
      expect(list?.split("\n").slice(1)).toEqual([
        `aut_1 "ci": every 1 hour (America/New_York), active, next 2026-10-27T09:20:00.000-04:00, prompt ${sessionID}: "check CI"`,
        `aut_2 "watch": cron "0 9 * * 1-5" (America/New_York), paused, next 2026-10-27T09:20:00.000-04:00, code: "const t = await tools.slack.read_thread({})"`,
      ])
      expect(list).toStartWith("Now: ")
    }),
  )

  it.effect("treats another project's automation as missing", () =>
    Effect.gen(function* () {
      const { registry, rows } = yield* setup(on)
      yield* run(
        registry,
        "automation_create",
        { name: "ping", trigger: { type: "every", every: "1 hour" }, action: { type: "prompt", prompt: "ping" } },
        otherSessionID,
      )

      expect(yield* run(registry, "automation_list", {})).toMatchObject({ automations: [] })
      for (const name of ["automation_pause", "automation_resume", "automation_delete"]) {
        expect(yield* call(registry, name, { id: "aut_1" })).toMatchObject({
          content: [{ type: "text", text: expect.stringContaining("Automation not found: aut_1") }],
          metadata: { error: true },
        })
      }
      expect(rows.get(Automation.ID.make("aut_1"))).toMatchObject({ status: "active", sessionID: otherSessionID })
    }),
  )
})

function document(experimental: ConfigExperimental.Info | undefined): Entry {
  return new Document({ type: "document", info: new Info(experimental ? { experimental } : {}) })
}
