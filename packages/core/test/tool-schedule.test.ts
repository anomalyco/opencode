import { describe, expect } from "bun:test"
import { DateTime, Effect, Layer, Stream } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Config } from "@opencode/core/config"
import { Image } from "@opencode/core/image"
import { Permission } from "@opencode/core/permission"
import { Schedule } from "@opencode/core/schedule"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { ScheduleTools } from "@opencode/core/tool/plugin/schedule"
import { Document, Info, type Entry } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import type { CommandDefinition } from "@opencode/plugin/effect/command"
import { testEffect } from "./lib/effect"
import { imagePassthrough } from "./lib/image"
import { permissionLayer } from "./lib/permission"
import { codeModeListings, executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const sessionID = Session.ID.make("ses_schedule_tool_test")
const otherSessionID = Session.ID.make("ses_schedule_tool_other")
const now = DateTime.makeUnsafe("2026-10-27T13:00:00Z")
const names = [
  "schedule_create",
  "schedule_list",
  "schedule_pause",
  "schedule_resume",
  "schedule_delete",
  "schedule_result",
  "schedule_inbox",
  "schedule_runs",
  "schedule_dismiss",
].map((name) => `opencode.${name}`)

const it = testEffect(
  AppNodeBuilder.build(Tool.node, [Image.node.replace(imagePassthrough), Permission.node.replace(permissionLayer())]),
)

/** An in-memory Schedule service. The real one is covered in schedule.test.ts; this exercises the tool layer. */
const memory = () => {
  const rows = new Map<Schedule.ID, Schedule.Info>()
  const runRows = new Map<Schedule.RunID, Schedule.Run>()
  const flag = { enabled: true }
  const find = (id: Schedule.ID): Effect.Effect<Schedule.Info, Schedule.NotFoundError> => {
    const info = rows.get(id)
    return info ? Effect.succeed(info) : Effect.fail(new Schedule.NotFoundError({ scheduleID: id }))
  }
  const update = (id: Schedule.ID, status: Schedule.Info["status"]) =>
    find(id).pipe(
      Effect.map((info) => {
        const next = { ...info, status }
        rows.set(id, next)
        return next
      }),
    )
  const service = Schedule.Service.of({
    create: (input) =>
      Effect.sync(() => {
        const info: Schedule.Info = {
          id: Schedule.ID.make(`sch_${rows.size + 1}`),
          sessionID: input.sessionID,
          name: input.name,
          when: input.when ?? { type: "every", every: "30 seconds" },
          tz: "America/New_York",
          if: input.if,
          until: input.until,
          action: input.action,
          status: "active",
          nextDueAt: DateTime.add(now, { minutes: 20 }),
          runCount: 0,
          time: { created: now, updated: now },
        }
        rows.set(info.id, info)
        return info
      }),
    list: (input) => Effect.sync(() => [...rows.values()].filter((info) => info.sessionID === input?.sessionID)),
    get: find,
    pause: (id) => update(id, "paused"),
    resume: (id) => update(id, "active"),
    remove: (id) => find(id).pipe(Effect.map(() => void rows.delete(id))),
    runs: (input) =>
      Effect.sync(() =>
        [...runRows.values()]
          .filter(
            (item) =>
              (input?.scheduleID === undefined || item.scheduleID === input.scheduleID) &&
              (input?.sessionID === undefined || item.ownerSessionID === input.sessionID),
          )
          .slice(0, input?.limit ?? 50),
      ),
    inbox: (input) =>
      Effect.sync(() =>
        [...runRows.values()]
          .filter(
            (item) =>
              (item.attention === "ready" || item.attention === "needs_you") &&
              (input?.includeRead === true || item.readAt === undefined) &&
              (input?.sessionID === undefined || item.ownerSessionID === input.sessionID),
          )
          .slice(0, input?.limit ?? 50),
      ),
    getRun: (runID) => {
      const found = runRows.get(runID)
      return found ? Effect.succeed(found) : Effect.fail(new Schedule.RunNotFoundError({ runID }))
    },
    markRead: (runID) => {
      const found = runRows.get(runID)
      if (!found) return Effect.fail(new Schedule.RunNotFoundError({ runID }))
      const next = { ...found, readAt: found.readAt ?? now }
      runRows.set(runID, next)
      return Effect.succeed(next)
    },
    reportResult: (callerSessionID, input) => {
      const active = [...runRows.values()].find(
        (item) => item.sessionID === callerSessionID && item.status === "running",
      )
      if (!active)
        return Effect.fail(
          new Schedule.InvalidError({ reason: "schedule_result can only be called during an active scheduled run" }),
        )
      const next: Schedule.Run = {
        ...active,
        attention: input.attention,
        summary: input.summary,
      }
      runRows.set(active.id, next)
      return Effect.succeed(next)
    },
    enabled: () => Effect.sync(() => flag.enabled),
    tick: Effect.void,
    run: Effect.never,
  })
  return { rows, runRows, flag, service }
}

const setup = (experimental: ConfigExperimental.Info | undefined) =>
  Effect.gen(function* () {
    const schedules = memory()
    const commands: CommandDefinition[] = []
    const prompts: unknown[] = []
    yield* registerToolPlugin(ScheduleTools.Plugin, {
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
      Effect.provide(Layer.mock(Config.Service)({ entries: () => Effect.succeed([document(experimental)]) })),
      Effect.provide(Layer.succeed(Schedule.Service, schedules.service)),
      Effect.provide(permissionLayer({ assert: () => Effect.void })),
    )
    return {
      registry: yield* Tool.Service,
      rows: schedules.rows,
      runRows: schedules.runRows,
      flag: schedules.flag,
      commands,
      prompts,
    }
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
      input: { code: `return await tools.opencode.${name}(${JSON.stringify(input)})` },
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
        call: { type: "tool-call", id: `call-direct-${name}`, name: `opencode_${name}`, input },
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

describe("ScheduleTools", () => {
  it.effect("are absent unless experimental.schedules is enabled", () =>
    Effect.gen(function* () {
      expect(yield* paths((yield* setup(undefined)).registry)).not.toContain(names[0])
      const off = yield* setup(new ConfigExperimental.Info({ schedules: false }))
      expect(yield* paths(off.registry)).not.toContain(names[0])
      expect(off.commands).toEqual([])
      const on = yield* setup(new ConfigExperimental.Info({ schedules: true }))
      expect(yield* paths(on.registry)).toEqual(expect.arrayContaining(names))
      expect(on.commands.map((command) => command.name)).toEqual(["schedule"])
    }),
  )

  it.effect("creates, lists, pauses, resumes and deletes this session's schedules", () =>
    Effect.gen(function* () {
      const { registry, rows } = yield* setup(new ConfigExperimental.Info({ schedules: true }))

      expect(
        yield* run(registry, "schedule_create", {
          name: "build",
          when: { in: "20 minutes" },
          prompt: "check the build",
        }),
      ).toMatchObject({
        id: "sch_1",
        name: "build",
        when: { type: "in", in: "20 minutes" },
        prompt: "check the build",
        status: "active",
        nextDueAt: "2026-10-27T09:20:00.000-04:00",
      })
      expect([...rows.values()][0]).toMatchObject({ sessionID, action: { type: "prompt", prompt: "check the build" } })

      expect(yield* run(registry, "schedule_list", {})).toMatchObject({
        schedules: [{ id: "sch_1", status: "active" }],
      })
      expect(yield* run(registry, "schedule_pause", { id: "sch_1" })).toMatchObject({ status: "paused" })
      expect(yield* run(registry, "schedule_resume", { id: "sch_1" })).toMatchObject({ status: "active" })
      expect(yield* run(registry, "schedule_delete", { id: "sch_1" })).toEqual({ id: "sch_1", removed: true })
      expect(rows.size).toBe(0)
    }),
  )

  it.effect("/schedule hands the request to the model with the schedule instructions", () =>
    Effect.gen(function* () {
      const { commands, prompts } = yield* setup(new ConfigExperimental.Info({ schedules: true }))
      yield* commands[0]!
        .execute({
          sessionID,
          prompt: { text: "  every morning at 9 check CI  " },
          delivery: "steer",
        })
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
      const { registry, rows, flag } = yield* setup(new ConfigExperimental.Info({ schedules: true }))
      yield* run(registry, "schedule_create", { when: { every: "1 hour" }, prompt: "ping" })
      flag.enabled = false

      for (const [name, input] of [
        ["schedule_list", {}],
        ["schedule_pause", { id: "sch_1" }],
        ["schedule_resume", { id: "sch_1" }],
        ["schedule_delete", { id: "sch_1" }],
      ] as const) {
        expect(yield* call(registry, name, input)).toMatchObject({
          content: [{ type: "text", text: expect.stringContaining("Scheduled tasks are disabled") }],
          metadata: { error: true },
        })
      }
      expect(rows.get(Schedule.ID.make("sch_1"))).toMatchObject({ status: "active" })
    }),
  )

  it.effect("rejects a when with more than one trigger instead of keeping the first", () =>
    Effect.gen(function* () {
      const { registry, rows } = yield* setup(new ConfigExperimental.Info({ schedules: true }))
      expect(
        yield* call(registry, "schedule_create", { when: { in: "5 minutes", every: "1 hour" }, prompt: "ping" }),
      ).toMatchObject({ metadata: { error: true } })
      expect(rows.size).toBe(0)
    }),
  )

  it.effect("puts each schedule's id, trigger, status, next run and prompt in the text without Code Mode", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup(new ConfigExperimental.Info({ schedules: true }))
      expect(
        yield* direct(registry, "schedule_create", { name: "ci", when: { every: "1 hour" }, prompt: "check CI" }),
      ).toBe(
        'Scheduled: sch_1 "ci": every 1 hour (America/New_York), active, next 2026-10-27T09:20:00.000-04:00, prompt: "check CI"',
      )
      yield* direct(registry, "schedule_create", { when: { cron: "0 9 * * 1-5" }, prompt: "x".repeat(100) })
      yield* direct(registry, "schedule_pause", { id: "sch_2" })
      const list = yield* direct(registry, "schedule_list", {})
      expect(list?.split("\n").slice(1)).toEqual([
        'sch_1 "ci": every 1 hour (America/New_York), active, next 2026-10-27T09:20:00.000-04:00, prompt: "check CI"',
        `sch_2: cron "0 9 * * 1-5" (America/New_York), paused, next 2026-10-27T09:20:00.000-04:00, prompt: "${"x".repeat(79)}…"`,
      ])
      expect(list).toStartWith("Now: ")
    }),
  )

  it.effect("treats another session's schedule as missing", () =>
    Effect.gen(function* () {
      const { registry, rows } = yield* setup(new ConfigExperimental.Info({ schedules: true }))
      yield* run(registry, "schedule_create", { when: { every: "1 hour" }, prompt: "ping" }, otherSessionID)

      expect(yield* run(registry, "schedule_list", {})).toMatchObject({ schedules: [] })
      for (const name of ["schedule_pause", "schedule_resume", "schedule_delete"]) {
        expect(yield* call(registry, name, { id: "sch_1" })).toMatchObject({
          content: [{ type: "text", text: expect.stringContaining("Schedule not found: sch_1") }],
          metadata: { error: true },
        })
      }
      expect(rows.get(Schedule.ID.make("sch_1"))).toMatchObject({ status: "active", sessionID: otherSessionID })
    }),
  )

  it.effect("creates until schedules with optional when and formats check conditions", () =>
    Effect.gen(function* () {
      const { registry, rows } = yield* setup(new ConfigExperimental.Info({ schedules: true }))
      const created = yield* run(registry, "schedule_create", {
        until: { run: "gh pr checks 59962" },
        prompt: "CI passed",
      })
      expect(created).toMatchObject({
        id: "sch_1",
        when: { type: "every", every: "30 seconds" },
        until: { type: "shell", run: "gh pr checks 59962" },
      })
      expect(rows.get(Schedule.ID.make("sch_1"))?.until).toEqual({
        type: "shell",
        run: "gh pr checks 59962",
      })
      expect(
        yield* direct(registry, "schedule_create", {
          when: { every: "2 minutes" },
          if: { run: "git status -s", changes: true },
          prompt: "working tree changed",
        }),
      ).toContain('if "git status -s", active')
      expect(
        yield* direct(registry, "schedule_create", {
          until: { code: "return (await tools.slack.read_thread({})).ok" },
          prompt: "thread ok",
        }),
      ).toContain('until code "return (await tools.slack.read_thread({})).ok", active')
      expect(
        yield* call(registry, "schedule_create", {
          until: { run: "true", code: "return true" },
          prompt: "both",
        }),
      ).toMatchObject({ metadata: { error: true } })
    }),
  )

  it.effect("supports subagent, dedicated, command, shell and code actions and rejects invalid combinations cleanly", () =>
    Effect.gen(function* () {
      const { registry, rows } = yield* setup(new ConfigExperimental.Info({ schedules: true }))

      const subagent = yield* run(registry, "schedule_create", {
        name: "triage",
        when: { every: "1 hour" },
        prompt: "triage issues",
        target: "subagent",
        agent: "explore",
        deliver: "silent",
      })
      expect(subagent).toMatchObject({
        action: { type: "subagent", prompt: "triage issues", agent: "explore", deliver: "silent" },
      })

      const command = yield* direct(registry, "schedule_create", {
        when: { cron: "0 9 * * 1-5" },
        command: "/morning-brief",
        arguments: "team",
      })
      expect(command).toContain('command (subagent): "/morning-brief team"')

      const shell = yield* direct(registry, "schedule_create", {
        when: { in: "10 minutes" },
        run: "git fetch origin",
      })
      expect(shell).toContain('run: "git fetch origin"')

      const code = yield* direct(registry, "schedule_create", {
        when: { in: "15 minutes" },
        code: "await tools.slack.read_thread({}); return 'ok'",
      })
      expect(code).toContain("code: \"await tools.slack.read_thread({}); return 'ok'\"")
      expect(rows.size).toBe(4)

      for (const bad of [
        { when: { in: "5 minutes" } },
        { when: { in: "5 minutes" }, prompt: "a", run: "b" },
        { when: { in: "5 minutes" }, prompt: "a", deliver: "silent" },
        { when: { in: "5 minutes" }, prompt: "a", deliver: "inbox" },
        { when: { in: "5 minutes" }, command: "brief", target: "same", deliver: "silent" },
        { when: { in: "5 minutes" }, command: "brief", target: "same", deliver: "inbox" },
        { when: { in: "5 minutes" }, run: "ls", arguments: "extra" },
        { when: { in: "5 minutes" }, prompt: "a", agent: "explore" },
      ]) {
        expect(yield* call(registry, "schedule_create", bad)).toMatchObject({ metadata: { error: true } })
      }
      expect(rows.size).toBe(4)
    }),
  )

  it.effect("manages inbox, run history, dismissal, and schedule_result scoped to this session", () =>
    Effect.gen(function* () {
      const { registry, runRows } = yield* setup(new ConfigExperimental.Info({ schedules: true }))
      yield* run(registry, "schedule_create", {
        name: "monitor",
        when: { every: "15 minutes" },
        prompt: "check deploy",
        target: "subagent",
        deliver: "inbox",
      })
      const runID = Schedule.RunID.make("srun_1")
      const otherRunID = Schedule.RunID.make("srun_2")
      const subagentSessionID = Session.ID.make("ses_subagent_1")
      runRows.set(runID, {
        id: runID,
        scheduleID: Schedule.ID.make("sch_1"),
        scheduleName: "monitor",
        ownerSessionID: sessionID,
        sessionID: subagentSessionID,
        run: 1,
        status: "running",
        attention: "quiet",
        startedAt: now,
      })
      runRows.set(otherRunID, {
        id: otherRunID,
        scheduleID: Schedule.ID.make("sch_9"),
        scheduleName: "other",
        ownerSessionID: otherSessionID,
        run: 1,
        status: "completed",
        attention: "needs_you",
        summary: "other session item",
        startedAt: now,
        completedAt: now,
      })

      // Calling schedule_result outside an active run fails cleanly.
      expect(yield* call(registry, "schedule_result", { attention: "quiet" })).toMatchObject({
        metadata: { error: true },
      })

      // Calling schedule_result inside the scheduled subagent updates the run.
      expect(
        yield* run(
          registry,
          "schedule_result",
          { attention: "needs_you", summary: "Approve rollout?" },
          subagentSessionID,
        ),
      ).toMatchObject({
        id: "srun_1",
        attention: "needs_you",
        summary: "Approve rollout?",
      })
      runRows.set(runID, {
        ...runRows.get(runID)!,
        status: "completed",
        completedAt: now,
      })

      expect(yield* run(registry, "schedule_inbox", {})).toMatchObject({
        runs: [{ id: "srun_1", attention: "needs_you", summary: "Approve rollout?" }],
      })
      expect(yield* run(registry, "schedule_runs", { id: "sch_1" })).toMatchObject({
        runs: [{ id: "srun_1", status: "completed" }],
      })

      // Cannot dismiss another session's run.
      expect(yield* call(registry, "schedule_dismiss", { runID: "srun_2" })).toMatchObject({
        metadata: { error: true },
      })
      expect(yield* run(registry, "schedule_dismiss", { runID: "srun_1" })).toMatchObject({
        id: "srun_1",
        readAt: expect.any(String),
      })
      expect(yield* run(registry, "schedule_inbox", {})).toEqual({ runs: [] })
      expect(yield* run(registry, "schedule_inbox", { includeRead: true })).toMatchObject({
        runs: [{ id: "srun_1" }],
      })
    }),
  )
})

function document(experimental: ConfigExperimental.Info | undefined): Entry {
  return new Document({ type: "document", info: new Info(experimental ? { experimental } : {}) })
}
