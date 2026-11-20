import { describe, expect, test } from "bun:test"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Tool } from "@opencode/schema/tool"
import { Widget } from "@opencode/schema/widget"
import { builtins, program, version } from "@opencode/widget"
import { Cause, Deferred, Effect, Exit, Fiber, Queue } from "effect"
import WidgetsPlugin, { RATE_LIMIT, WidgetTools } from "../src/index.js"
import { make } from "./fake.js"
import { WidgetLint } from "../src/lint.js"

const sessionID = Session.ID.make("ses_widget_test")
const messageID = SessionMessage.ID.make("msg_widget_assistant")
const confirm = builtins.find((template) => template.name === "confirm")!
const confirmData = { title: "Ship it?", message: "Deploys main." }

const pickerSource = `function view(state, data) {
  return ui.column({}, data.items.map((item) => ui.button(item, item)))
}
function update(state, event) { return submit({ picked: event.id }, state) }`
const pickerSchema = {
  type: "object",
  properties: { items: { type: "array", items: { type: "string" }, minItems: 1 } },
  required: ["items"],
} as const

const run = <A, E>(body: (fake: Effect.Success<typeof make>) => Effect.Effect<A, E>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fake = yield* make
      yield* WidgetsPlugin.effect(fake.context)
      return yield* body(fake)
    }).pipe(Effect.scoped),
  )

let calls = 0
const context = (overrides: Partial<Tool.Context> = {}): Tool.Context => ({
  sessionID,
  agent: Agent.ID.make("build"),
  messageID,
  id: Tool.CallID.make(`call_${++calls}`),
  progress: () => Effect.void,
  ...overrides,
})

const execute = (fake: Effect.Success<typeof make>, name: string, input: unknown, at = context()) =>
  fake.tools.get(name)!.execute(input, at).pipe(Effect.exit)

const failure = <A, E>(exit: Exit.Exit<A, E>) => (Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined)

const states = (fake: Effect.Success<typeof make>) => fake.call<ReadonlyArray<Widget.State>>("states", { sessionID })

describe("widget tool", () => {
  test("posts an open widget state for the tool call and publishes it", () =>
    run((fake) =>
      Effect.gen(function* () {
        const at = context()
        const result = yield* execute(fake, "widget", { template: "confirm", data: confirmData, title: "Deploy" }, at)

        expect(result).toEqual(
          Exit.succeed({
            content: WidgetTools.shownText("Deploy"),
            metadata: { template: { name: "confirm", version: confirm.version } },
          }),
        )
        const expected = {
          sessionID,
          messageID,
          callID: at.id,
          template: { name: "confirm", version: confirm.version },
          title: "Deploy",
          status: "open",
          wait: false,
        }
        expect(yield* states(fake)).toMatchObject([expected])
        expect(fake.events).toMatchObject([{ name: "changed", data: { sessionID, state: expected } }])
        expect(fake.asserted).toEqual([{ action: "widget", resources: ["confirm"] }])
        // The built-in version the widget uses is stored, so it stays retrievable after a release changes it.
        expect(fake.storage.has(`template:confirm:${confirm.version}`)).toBe(true)
      }),
    ))

  test("returns data that misses the template's schema to the model without posting", () =>
    run((fake) =>
      Effect.gen(function* () {
        const result = yield* execute(fake, "widget", { template: "confirm", data: { title: "Ship it?" } })

        expect(failure(result)).toEqual(
          new Tool.Error({ message: 'Invalid data for widget template "confirm": /message: is required' }),
        )
        expect(yield* states(fake)).toEqual([])
        expect(yield* execute(fake, "widget", { template: "nope", data: {} }).pipe(Effect.map(Exit.isFailure))).toBe(
          true,
        )
      }),
    ))
})

describe("widget templates", () => {
  test("stores immutable versions, makes the newest save the latest, and protects built-ins", () =>
    run((fake) =>
      Effect.gen(function* () {
        const save = (input: Record<string, unknown>) =>
          execute(fake, "widget_template", {
            action: "save",
            name: "picker",
            description: "Pick one",
            data: pickerSchema,
            source: pickerSource,
            example: { items: ["a"] },
            ...input,
          })
        const first = version(pickerSource, pickerSchema)
        expect(yield* save({})).toMatchObject(Exit.succeed({ metadata: { name: "picker", version: first } }))
        const changed = pickerSource.replace("ui.column({}", "ui.row({ wrap: true }")
        const second = version(changed, pickerSchema)
        yield* save({ source: changed })

        expect(yield* fake.call("program", { name: "picker" })).toMatchObject({
          version: second,
          program: program(changed),
          builtin: false,
        })
        expect(yield* fake.call("program", { name: "picker", version: first })).toMatchObject({ source: pickerSource })
        const listed = yield* fake.call<ReadonlyArray<Widget.Summary>>("templates", {})
        expect(listed.map((template) => template.name)).toEqual(
          [...builtins.map((template) => template.name), "picker"].toSorted(),
        )
        expect(listed.find((template) => template.name === "picker")).toEqual({
          name: "picker",
          version: second,
          description: "Pick one",
          data: pickerSchema,
          mode: "step",
          builtin: false,
        })

        expect(failure(yield* save({ name: "form" }))).toEqual(
          new Tool.Error({ message: 'Invalid widget template "form": built-in templates cannot be overwritten' }),
        )
        expect(yield* save({ example: { items: [] } }).pipe(Effect.map(Exit.isFailure))).toBe(true)
        expect(
          yield* fake.call("program", { name: "picker", version: "0000000000000000" }).pipe(Effect.flip),
        ).toMatchObject({ type: "not_found" })
      }),
    ))
})

describe("live templates", () => {
  const liveSource = `async function main(data) {
  while (true) {
    const event = await widget.event()
    if (event.id === "stop") return widget.submit({ stopped: true })
  }
  throw new Error("never runs on the server")
}`

  test("stores the mode as part of the version and only lints live programs", () =>
    run((fake) =>
      Effect.gen(function* () {
        const save = (input: Record<string, unknown>) =>
          execute(fake, "widget_template", {
            action: "save",
            name: "ticker",
            description: "Ticks",
            data: pickerSchema,
            source: liveSource,
            example: { items: ["a"] },
            mode: "live",
            ...input,
          })

        const saved = yield* save({})
        expect(saved).toMatchObject(Exit.succeed({ metadata: { name: "ticker" } }))
        const live = yield* fake.call<Widget.Program>("program", { name: "ticker" })
        expect(live).toMatchObject({ mode: "live", source: liveSource })
        expect(live.version).not.toBe(version(liveSource, pickerSchema))
        expect(
          (yield* fake.call<ReadonlyArray<Widget.Summary>>("templates", {})).find((item) => item.name === "ticker"),
        ).toMatchObject({ mode: "live" })

        const broken = yield* save({ name: "broken", source: "async function main(data) { let = }" })
        expect(String(failure(broken))).toContain('Invalid widget template "broken": line 1, col 35: SyntaxError')

        // The widget tool validates the data and posts without running main.
        expect(yield* execute(fake, "widget", { template: "ticker", data: { items: ["x"] } })).toMatchObject(
          Exit.succeed({ metadata: { template: { name: "ticker", version: live.version } } }),
        )
        expect(failure(yield* execute(fake, "widget", { template: "ticker", data: { items: [] } }))).toBeInstanceOf(
          Tool.Error,
        )
      }),
    ))
})

test("the skill's examples pass the lint", async () => {
  const content = await Effect.runPromise(
    Effect.gen(function* () {
      const fake = yield* make
      yield* WidgetsPlugin.effect(fake.context)
      return fake.skills[0]!.content
    }).pipe(Effect.scoped),
  )
  const blocks = [...content.matchAll(/```js\n([\s\S]*?)\n```/g)].map((match) => match[1]!)
  expect(blocks).toHaveLength(2)
  expect(WidgetLint.lint(blocks[0]!, "step")).toEqual([])
  expect(WidgetLint.lint(blocks[1]!, "live")).toEqual([])
})

// The runtime's diagram examples, loaded by path because they sit outside this package's sources.
const fixture = new URL("../../widget/test/fixtures/diagrams.ts", import.meta.url).href
const { examples }: { examples: Record<string, unknown> } = await import(fixture)

test("every diagram built-in posts with its example data and is listed in the skill", () =>
  run((fake) =>
    Effect.gen(function* () {
      for (const [name, data] of Object.entries(examples)) {
        const result = yield* execute(fake, "widget", { template: name, data })
        expect([name, Exit.isSuccess(result) ? "ok" : String(failure(result))]).toEqual([name, "ok"])
        expect(fake.skills[0]!.content).toContain("`" + name + "`")
      }
    }),
  ))

test("the built-in minigame is a live template end to end", () =>
  run((fake) =>
    Effect.gen(function* () {
      const minigame = builtins.find((template) => template.name === "minigame")!
      expect(
        (yield* fake.call<ReadonlyArray<Widget.Summary>>("templates", {})).find((item) => item.name === "minigame"),
      ).toMatchObject({ mode: "live", version: minigame.version, builtin: true })
      expect(yield* fake.call<Widget.Program>("program", { name: "minigame" })).toMatchObject({
        mode: "live",
        program: program(minigame.source),
      })
      // Posting only validates the data and compiles the program; `main` runs on the user's device.
      expect(
        yield* execute(fake, "widget", { template: "minigame", data: { title: "Tap the dots", seconds: 10 } }),
      ).toMatchObject(Exit.succeed({ metadata: { template: { name: "minigame", version: minigame.version } } }))
    }),
  ))

describe("capabilities", () => {
  const source = `async function main(data) {
  const response = await widget.fetch("https://api.github.com/zen")
  widget.render(ui.text(await response.text()))
}`
  const save = (fake: Effect.Success<typeof make>, input: Record<string, unknown>) =>
    execute(fake, "widget_template", {
      action: "save",
      name: "zen",
      description: "GitHub zen",
      data: pickerSchema,
      source,
      example: { items: ["a"] },
      mode: "live",
      ...input,
    })

  test("stores a live template's capabilities in its version, summary, program and widget states", () =>
    run((fake) =>
      Effect.gen(function* () {
        const capabilities = { https: { hosts: ["api.github.com", "*.githubusercontent.com"] } }
        yield* save(fake, {})
        const bare = yield* fake.call<Widget.Program>("program", { name: "zen" })
        yield* save(fake, { capabilities })
        const granted = yield* fake.call<Widget.Program>("program", { name: "zen" })

        expect(bare.capabilities).toBeUndefined()
        expect(granted).toMatchObject({ capabilities })
        expect(granted.version).not.toBe(bare.version)
        expect(
          (yield* fake.call<ReadonlyArray<Widget.Summary>>("templates", {})).find((item) => item.name === "zen"),
        ).toMatchObject({ capabilities })
        yield* execute(fake, "widget", { template: "zen", data: { items: ["x"] } })
        expect((yield* states(fake))[0]).toMatchObject({ capabilities })
      }),
    ))

  test("rejects capabilities on step templates and host lists that are not host names", () =>
    run((fake) =>
      Effect.gen(function* () {
        const reason = (input: Record<string, unknown>) =>
          save(fake, input).pipe(Effect.map((exit) => String(failure(exit))))

        expect(
          yield* reason({ mode: "step", source: pickerSource, capabilities: { https: { hosts: ["api.github.com"] } } }),
        ).toContain("only live templates can declare capabilities")
        expect(yield* reason({ capabilities: { https: { hosts: ["https://api.github.com/"] } } })).toContain(
          "is not a host name",
        )
        expect(yield* reason({ capabilities: { https: { hosts: [] } } })).toContain("lists no hosts")
        expect(Exit.isSuccess(yield* save(fake, { capabilities: { https: { hosts: ["*"] } } }))).toBe(true)
        // Local hosts and ports are valid declarations; only a client's dev mode lets them through.
        expect(
          Exit.isSuccess(
            yield* save(fake, { capabilities: { https: { hosts: ["localhost:4097", "127.0.0.1", "*.local"] } } }),
          ),
        ).toBe(true)
        expect(yield* reason({ capabilities: { https: { hosts: ["localhost:port"] } } })).toContain(
          "is not a host name",
        )
      }),
    ))
})

describe("widget answers", () => {
  const show = (fake: Effect.Success<typeof make>) =>
    Effect.gen(function* () {
      const at = context()
      yield* execute(fake, "widget", { template: "confirm", data: confirmData, title: "Deploy" }, at)
      return { sessionID, messageID, callID: at.id }
    })

  test("records one response, tells the model with a waking synthetic message, and rejects a second", () =>
    run((fake) =>
      Effect.gen(function* () {
        const call = yield* show(fake)

        const state = yield* fake.call<Widget.State>("respond", { ...call, response: { value: { confirmed: true } } })

        expect(state).toMatchObject({ status: "submitted", response: { confirmed: true } })
        expect(state.time.responded).toBeNumber()
        expect(fake.synthetic).toEqual([
          {
            sessionID,
            text: 'User responded to widget "Deploy": {"confirmed":true}',
            description: 'Responded to "Deploy"',
            metadata: { widget: { messageID, callID: call.callID, kind: "response" } },
            resume: true,
          },
        ])
        expect(fake.events.at(-1)).toMatchObject({ name: "changed", data: { state: { status: "submitted" } } })
        expect(yield* fake.call("respond", { ...call, response: { dismiss: true } }).pipe(Effect.flip)).toMatchObject({
          type: "closed",
          data: { status: "submitted" },
        })
        expect(
          yield* fake
            .call("respond", { ...call, callID: "call_missing", response: { dismiss: true } })
            .pipe(Effect.flip),
        ).toMatchObject({ type: "not_found" })
        expect(fake.synthetic).toHaveLength(1)
      }),
    ))

  test("sends messages while the widget stays open, with or without a wake, until it is answered", () =>
    run((fake) =>
      Effect.gen(function* () {
        const call = yield* show(fake)

        yield* fake.call("send", { ...call, value: { step: 1 }, wake: false })
        yield* fake.call("send", { ...call, value: "ready" })
        expect(fake.synthetic).toEqual([
          expect.objectContaining({
            text: 'Widget "Deploy" sent: {"step":1}',
            description: 'Deploy: {"step":1}',
            metadata: { widget: { messageID, callID: call.callID, kind: "message" } },
            resume: false,
          }),
          expect.objectContaining({
            text: 'Widget "Deploy" sent: "ready"',
            description: "Deploy: ready",
            resume: true,
          }),
        ])
        expect((yield* states(fake))[0]?.status).toBe("open")

        yield* Effect.forEach(Array.from({ length: RATE_LIMIT - 2 }), () => fake.call("send", { ...call, value: 1 }))
        expect(yield* fake.call("send", { ...call, value: 1 }).pipe(Effect.flip)).toMatchObject({
          type: "rate_limited",
        })

        yield* fake.call("respond", { ...call, response: { dismiss: true } })
        expect(yield* fake.call("send", { ...call, value: "late" }).pipe(Effect.flip)).toMatchObject({
          type: "closed",
          data: { status: "dismissed" },
        })
      }),
    ))

  test("removes a deleted session's widgets", () =>
    run((fake) =>
      Effect.gen(function* () {
        yield* show(fake)
        yield* Queue.offer(fake.published, { type: "session.deleted", data: { sessionID } })
        for (let turn = 0; turn < 100 && (yield* states(fake)).length > 0; turn++) yield* Effect.yieldNow
        expect(yield* states(fake)).toEqual([])
      }),
    ))

  test("sets permission defaults for the built-in agents", () =>
    run((fake) =>
      Effect.sync(() => {
        expect(fake.permissions.get("build")).toEqual([
          { action: "widget", resource: "*", effect: "allow" },
          { action: "widget_template", resource: "*", effect: "allow" },
        ])
        expect(fake.permissions.get("plan")).toEqual([{ action: "widget", resource: "*", effect: "allow" }])
        expect(fake.permissions.get("general")).toEqual([{ action: "widget", resource: "*", effect: "deny" }])
        expect(fake.skills.map((skill) => String(skill.id))).toEqual(["widgets"])
      }),
    ))
})

test("the respond input decodes a dismissal as a dismissal, as the RPC route parses it", async () => {
  const call = { sessionID, messageID, callID: "call_1" }
  const validate = (input: unknown) => Widget.Definition.methods.respond.input["~standard"].validate(input)
  expect(await validate({ ...call, response: { dismiss: true } })).toEqual({
    value: { ...call, response: { dismiss: true } },
  })
  expect(await validate({ ...call, response: { value: null } })).toEqual({
    value: { ...call, response: { value: null } },
  })
})

describe("error reports", () => {
  const show = (fake: Effect.Success<typeof make>) =>
    Effect.gen(function* () {
      const at = context()
      yield* execute(fake, "widget", { template: "confirm", data: confirmData, title: "Deploy" }, at)
      return { sessionID, messageID, callID: at.id }
    })
  const error = { phase: "view", message: "data.items is undefined", line: 3, column: 12 }

  test("delivers a client's runtime error once as a waking message, then drops repeats and floods", () =>
    run((fake) =>
      Effect.gen(function* () {
        const call = yield* show(fake)

        expect(yield* fake.call("report", { ...call, error, client: "android" })).toMatchObject({ status: "open" })
        expect(fake.synthetic).toEqual([
          {
            sessionID,
            text: 'Widget "Deploy" failed on android: view: data.items is undefined (line 3, col 12)',
            description: "Deploy failed on android",
            metadata: { widget: { messageID, callID: call.callID, kind: "error" } },
            resume: true,
          },
        ])
        // The same error from another client, and a new one within the window, are dropped.
        yield* fake.call("report", { ...call, error, client: "tui" })
        yield* fake.call("report", { ...call, error: { phase: "update", message: "boom" }, client: "tui" })
        expect(fake.synthetic).toHaveLength(1)

        yield* fake.call("respond", { ...call, response: { dismiss: true } })
        yield* fake.call("report", { ...call, error: { phase: "draw", message: "late" }, client: "tui" })
        expect(fake.synthetic.map((message) => message.metadata?.widget)).toMatchObject([
          { kind: "error" },
          { kind: "response" },
        ])
        expect(
          yield* fake.call("report", { ...call, callID: "call_missing", error, client: "tui" }).pipe(Effect.flip),
        ).toMatchObject({ type: "not_found" })
      }),
    ))

  test("fails a waiting tool call with the reported error instead of messaging", () =>
    run((fake) =>
      Effect.gen(function* () {
        const at = context()
        const fiber = yield* execute(
          fake,
          "widget",
          {
            template: "confirm",
            data: confirmData,
            title: "Deploy",
            wait: true,
          },
          at,
        ).pipe(Effect.forkChild({ startImmediately: true }))
        while ((yield* states(fake)).length === 0) yield* Effect.yieldNow

        yield* fake.call("report", {
          sessionID,
          messageID,
          callID: at.id,
          error: { phase: "init", message: "boom" },
          client: "rune",
        })

        expect(failure(yield* Fiber.join(fiber))).toEqual(
          new Tool.Error({ message: 'Widget "Deploy" failed on rune: init: boom' }),
        )
        expect(fake.synthetic).toEqual([])
      }),
    ))
})

describe("waiting widget tool", () => {
  const start = (fake: Effect.Success<typeof make>, at = context()) =>
    Effect.gen(function* () {
      const fiber = yield* execute(
        fake,
        "widget",
        {
          template: "confirm",
          data: confirmData,
          title: "Deploy",
          wait: true,
        },
        at,
      ).pipe(Effect.forkChild({ startImmediately: true }))
      while ((yield* states(fake)).length === 0) yield* Effect.yieldNow
      return { fiber, call: { sessionID, messageID, callID: at.id } }
    })

  test("returns the submitted value as the tool result instead of a synthetic message", () =>
    run((fake) =>
      Effect.gen(function* () {
        const { fiber, call } = yield* start(fake)
        expect((yield* states(fake))[0]).toMatchObject({ wait: true, status: "open" })

        yield* fake.call("send", { ...call, value: "progress" })
        yield* fake.call("respond", { ...call, response: { value: { confirmed: true } } })

        expect(yield* Fiber.join(fiber)).toEqual(
          Exit.succeed({
            content: 'User responded to widget "Deploy": {"confirmed":true}',
            metadata: { template: { name: "confirm", version: confirm.version }, response: { confirmed: true } },
          }),
        )
        expect(fake.synthetic.map((message) => message.metadata?.widget)).toMatchObject([{ kind: "message" }])
      }),
    ))

  test("returns a dismissal as a tool error the model continues with", () =>
    run((fake) =>
      Effect.gen(function* () {
        const { fiber, call } = yield* start(fake)
        yield* fake.call("respond", { ...call, response: { dismiss: true } })

        expect(failure(yield* Fiber.join(fiber))).toEqual(
          new Tool.Error({
            message: 'User dismissed widget "Deploy"',
            metadata: { template: { name: "confirm", version: confirm.version } },
          }),
        )
        expect(fake.synthetic).toEqual([])
      }),
    ))

  test("falls back to a waking synthetic message once the waiting call is interrupted or stopped", () =>
    run((fake) =>
      Effect.gen(function* () {
        const interrupted = yield* start(fake)
        yield* Fiber.interrupt(interrupted.fiber)
        yield* fake.call("respond", { ...interrupted.call, response: { value: { confirmed: false } } })
        expect(fake.synthetic).toEqual([
          expect.objectContaining({ text: 'User responded to widget "Deploy": {"confirmed":false}', resume: true }),
        ])

        const cancel = yield* Deferred.make<void>()
        const stopped = yield* start(fake, context({ cancel: Deferred.await(cancel) }))
        yield* Deferred.succeed(cancel, undefined)
        expect(failure(yield* Fiber.join(stopped.fiber))).toEqual(
          new Tool.Error({
            message: 'Stopped waiting for widget "Deploy". It stays open; its answer arrives as a message.',
          }),
        )
        yield* fake.call("respond", { ...stopped.call, response: { dismiss: true } })
        expect(fake.synthetic.at(-1)).toMatchObject({ text: 'User dismissed widget "Deploy"', resume: true })
      }),
    ))
})
