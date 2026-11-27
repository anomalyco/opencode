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
const confirm = builtins.find((widgetTemplate) => widgetTemplate.name === "confirm")!
const confirmData = { title: "Ship it?", message: "Deploys main." }

const pickerSource = `function view(state, data) {
  return ui.column({}, data.items.map((item) => ui.button(item, { onPress: () => submit({ picked: item }) })))
}`
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
        const result = yield* execute(
          fake,
          "widget",
          { widgetTemplate: "confirm", data: confirmData, title: "Deploy" },
          at,
        )

        expect(result).toEqual(
          Exit.succeed({
            content: WidgetTools.shownText("Deploy", at.id),
            metadata: { widgetTemplate: { name: "confirm", version: confirm.version } },
          }),
        )
        const expected = {
          sessionID,
          messageID,
          callID: at.id,
          widgetTemplate: { name: "confirm", version: confirm.version },
          title: "Deploy",
          status: "open",
          wait: false,
        }
        expect(yield* states(fake)).toMatchObject([expected])
        expect(fake.events).toMatchObject([{ name: "changed", data: { sessionID, state: expected } }])
        expect(fake.asserted).toEqual([{ action: "widget", resources: ["confirm"] }])
        // The built-in version the widget uses is stored, so it stays retrievable after a release changes it.
        expect(fake.storage.has(`widget_template:confirm:${confirm.version}`)).toBe(true)
      }),
    ))

  test("returns data that misses the widget template's schema to the model without posting", () =>
    run((fake) =>
      Effect.gen(function* () {
        const result = yield* execute(fake, "widget", { widgetTemplate: "confirm", data: { title: "Ship it?" } })

        expect(failure(result)).toEqual(
          new Tool.Error({ message: 'Invalid data for widget template "confirm": /message: is required' }),
        )
        expect(yield* states(fake)).toEqual([])
        expect(
          yield* execute(fake, "widget", { widgetTemplate: "nope", data: {} }).pipe(Effect.map(Exit.isFailure)),
        ).toBe(true)
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
        const listed = yield* fake.call<ReadonlyArray<Widget.Summary>>("widgetTemplates", {})
        expect(listed.map((widgetTemplate) => widgetTemplate.name)).toEqual(
          [...builtins.map((widgetTemplate) => widgetTemplate.name), "picker"].toSorted(),
        )
        expect(listed.find((widgetTemplate) => widgetTemplate.name === "picker")).toEqual({
          name: "picker",
          version: second,
          description: "Pick one",
          data: pickerSchema,
          mode: "step",
          builtin: false,
        })

        expect(failure(yield* save({ name: "form" }))).toEqual(
          new Tool.Error({
            message: 'Invalid widget template "form": built-in widget templates cannot be overwritten',
          }),
        )
        expect(yield* save({ example: { items: [] } }).pipe(Effect.map(Exit.isFailure))).toBe(true)
        expect(
          yield* fake.call("program", { name: "picker", version: "0000000000000000" }).pipe(Effect.flip),
        ).toMatchObject({ type: "not_found" })
      }),
    ))
})

test("the widget template tool says when to change an existing widget template and when to copy it", () =>
  run((fake) =>
    Effect.sync(() => {
      expect(fake.tools.get("widget_template")!.description).toContain(
        "Edit or save over an existing widget template only when the user asks or you created it in this session; otherwise copy it with from under a new name.",
      )
    }),
  ))

describe("widget template edits", () => {
  const save = (fake: Effect.Success<typeof make>) =>
    execute(fake, "widget_template", {
      action: "save",
      name: "picker",
      description: "Pick one",
      data: pickerSchema,
      source: pickerSource,
      example: { items: ["a"] },
    })
  const edit = (fake: Effect.Success<typeof make>, input: Record<string, unknown>) =>
    execute(fake, "widget_template", { action: "edit", name: "picker", ...input })
  const reason = (exit: Exit.Exit<unknown, unknown>) => (failure(exit) as Tool.Error | undefined)?.message

  test("applies exact replacements to the latest source and saves a new revision with short metadata", () =>
    run((fake) =>
      Effect.gen(function* () {
        expect(yield* save(fake)).toMatchObject(
          Exit.succeed({ metadata: { action: "save", name: "picker", revision: 1, lines: 3 } }),
        )
        const edited = yield* edit(fake, {
          edits: [
            { oldText: "ui.column({}", newText: "ui.row({ wrap: true }" },
            { oldText: "picked: item", newText: "picked: item, at: '$&'" },
          ],
          description: "Pick one, in a row",
        })
        const source = pickerSource
          .replace("ui.column({}", "ui.row({ wrap: true }")
          .replace("picked: item", () => "picked: item, at: '$&'")
        expect(edited).toEqual(
          Exit.succeed({
            content: expect.stringContaining(
              `Edited widget template "picker" version ${version(source, pickerSchema)}`,
            ),
            metadata: { action: "edit", name: "picker", version: version(source, pickerSchema), revision: 2, lines: 3 },
          }),
        )
        expect(yield* fake.call("program", { name: "picker" })).toMatchObject({
          source,
          description: "Pick one, in a row",
        })
        // `get` and `list` carry short metadata too.
        expect(yield* execute(fake, "widget_template", { action: "get", name: "picker" })).toMatchObject(
          Exit.succeed({ metadata: { action: "get", name: "picker", revision: 2, lines: 3 } }),
        )
        expect(yield* execute(fake, "widget_template", { action: "list" })).toMatchObject(
          Exit.succeed({ metadata: { action: "list", count: builtins.length + 1 } }),
        )
        // Saving the first content again promotes it without a new revision.
        expect(yield* save(fake)).toMatchObject(Exit.succeed({ metadata: { revision: 1 } }))
      }),
    ))

  test("explains edits that don't match once, and lints the result", () =>
    run((fake) =>
      Effect.gen(function* () {
        yield* save(fake)
        expect(reason(yield* edit(fake, { edits: [{ oldText: "ui.grid", newText: "x" }] }))).toContain(
          "edit 1: oldText was not found in the source",
        )
        expect(reason(yield* edit(fake, { edits: [{ oldText: "item", newText: "entry" }] }))).toContain(
          "edit 1: oldText matches 4 times; include more surrounding text",
        )
        expect(
          reason(
            yield* edit(fake, {
              edits: [
                { oldText: "ui.column", newText: "ui.row" },
                { oldText: "ui.column", newText: "ui.row" },
              ],
            }),
          ),
        ).toContain('edit 2: oldText was not found in the source of "picker" after the earlier edits')
        expect(reason(yield* edit(fake, { edits: [] }))).toContain("`edits` is empty")
        expect(reason(yield* edit(fake, { edits: [{ oldText: "view", newText: "show" }] }))).toContain(
          "a step widget template must define `function view(state, data)`",
        )
        expect(
          reason(yield* edit(fake, { edits: [{ oldText: "{}", newText: "{ gap: 1 }" }], data: pickerSchema })),
        ).toContain("`example` is required when `data` changes")
        expect(reason(yield* edit(fake, { name: "nope", edits: [{ oldText: "a", newText: "b" }] }))).toContain(
          "Widget template not found: nope",
        )
        expect(reason(yield* execute(fake, "widget_template", { action: "edit", name: "picker" }))).toContain(
          '`edits` is required for action "edit"',
        )
        // Nothing failed was stored.
        expect(yield* fake.call("program", { name: "picker" })).toMatchObject({ source: pickerSource })
      }),
    ))

  test("edits a built-in only as a copy under a new name", () =>
    run((fake) =>
      Effect.gen(function* () {
        expect(
          reason(yield* edit(fake, { name: "confirm", edits: [{ oldText: "Confirm", newText: "Yes" }] })),
        ).toContain(
          'built-in widget templates can\'t be edited; copy it under a new name: { action: "edit", name: "my-confirm", from: "confirm"',
        )
        expect(
          reason(
            yield* edit(fake, {
              name: "confirm",
              from: "confirm",
              edits: [{ oldText: '"Confirm"', newText: '"Yes"' }],
            }),
          ),
        ).toContain("built-in widget templates cannot be overwritten")
        const copied = yield* edit(fake, {
          name: "yes-no",
          from: "confirm",
          edits: [{ oldText: '"Confirm"', newText: '"Yes"' }],
        })
        expect(copied).toMatchObject(Exit.succeed({ metadata: { action: "edit", name: "yes-no", revision: 1 } }))
        expect(yield* fake.call("program", { name: "yes-no" })).toMatchObject({
          source: confirm.source.replace('"Confirm"', '"Yes"'),
          description: confirm.description,
          data: confirm.data,
          builtin: false,
        })
        expect(yield* fake.call("program", { name: "confirm" })).toMatchObject({ source: confirm.source })
      }),
    ))
})

describe("live widget templates", () => {
  const liveSource = `async function main(data) {
  widget.render(ui.button("Stop", { onPress: () => widget.submit({ stopped: true }) }))
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
          (yield* fake.call<ReadonlyArray<Widget.Summary>>("widgetTemplates", {})).find(
            (item) => item.name === "ticker",
          ),
        ).toMatchObject({ mode: "live" })

        const broken = yield* save({ name: "broken", source: "async function main(data) { let = }" })
        expect(String(failure(broken))).toContain('Invalid widget template "broken": line 1, col 35: SyntaxError')

        // The widget tool validates the data and posts without running main.
        expect(yield* execute(fake, "widget", { widgetTemplate: "ticker", data: { items: ["x"] } })).toMatchObject(
          Exit.succeed({ metadata: { widgetTemplate: { name: "ticker", version: live.version } } }),
        )
        expect(
          failure(yield* execute(fake, "widget", { widgetTemplate: "ticker", data: { items: [] } })),
        ).toBeInstanceOf(Tool.Error)
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
        const result = yield* execute(fake, "widget", { widgetTemplate: name, data })
        expect([name, Exit.isSuccess(result) ? "ok" : String(failure(result))]).toEqual([name, "ok"])
        expect(fake.skills[0]!.content).toContain("`" + name + "`")
      }
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

  test("stores a live widget template's capabilities in its version, summary, program and widget states", () =>
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
          (yield* fake.call<ReadonlyArray<Widget.Summary>>("widgetTemplates", {})).find((item) => item.name === "zen"),
        ).toMatchObject({ capabilities })
        yield* execute(fake, "widget", { widgetTemplate: "zen", data: { items: ["x"] } })
        expect((yield* states(fake))[0]).toMatchObject({ capabilities })
      }),
    ))

  test("rejects capabilities on step widget templates and host lists that are not host names", () =>
    run((fake) =>
      Effect.gen(function* () {
        const reason = (input: Record<string, unknown>) =>
          save(fake, input).pipe(Effect.map((exit) => String(failure(exit))))

        expect(
          yield* reason({ mode: "step", source: pickerSource, capabilities: { https: { hosts: ["api.github.com"] } } }),
        ).toContain("only live widget templates can declare capabilities")
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

  test("stores storage with https or on its own, in the version and the widget's state; never on a step template", () =>
    run((fake) =>
      Effect.gen(function* () {
        const capabilities = { https: { hosts: ["api.github.com"] }, storage: {} }
        yield* save(fake, { capabilities })
        const program = yield* fake.call<Widget.Program>("program", { name: "zen" })
        expect(program).toMatchObject({ capabilities })
        expect(Exit.isSuccess(yield* save(fake, { capabilities: { storage: {} } }))).toBe(true)
        expect((yield* fake.call<Widget.Program>("program", { name: "zen" })).version).not.toBe(program.version)
        yield* execute(fake, "widget", { widgetTemplate: "zen", data: { items: ["x"] } })
        expect((yield* states(fake))[0]).toMatchObject({ capabilities: { storage: {} } })
        expect(
          String(failure(yield* save(fake, { mode: "step", source: pickerSource, capabilities: { storage: {} } }))),
        ).toContain("only live widget templates can declare capabilities")
      }),
    ))
})

describe("widget answers", () => {
  const show = (fake: Effect.Success<typeof make>) =>
    Effect.gen(function* () {
      const at = context()
      yield* execute(fake, "widget", { widgetTemplate: "confirm", data: confirmData, title: "Deploy" }, at)
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
  // The picker widget template saved in `origin`, shown in `in` (a Session other than the origin, or the same one).
  const show = (fake: Effect.Success<typeof make>, input: { origin?: string; in?: string; wait?: boolean } = {}) =>
    Effect.gen(function* () {
      const origin = Session.ID.make(input.origin ?? sessionID)
      const shown = Session.ID.make(input.in ?? sessionID)
      yield* execute(
        fake,
        "widget_template",
        {
          action: "save",
          name: "picker",
          description: "Pick one",
          data: pickerSchema,
          source: pickerSource,
          example: { items: ["a"] },
        },
        context({ sessionID: origin }),
      )
      const at = context({ sessionID: shown })
      const posted = execute(
        fake,
        "widget",
        { widgetTemplate: "picker", data: { items: ["a"] }, title: "Pick", wait: input.wait },
        at,
      )
      const fiber = input.wait ? yield* posted.pipe(Effect.forkChild({ startImmediately: true })) : undefined
      if (!fiber) yield* posted
      while ((yield* fake.call<ReadonlyArray<Widget.State>>("states", { sessionID: shown })).length === 0)
        yield* Effect.yieldNow
      return { call: { sessionID: shown, messageID, callID: at.id }, fiber }
    })
  const error = { phase: "view", message: "data.items is undefined", line: 3, column: 12 }

  test("in the widget template's origin Session: recorded, sent once as a waking message, repeats and floods dropped", () =>
    run((fake) =>
      Effect.gen(function* () {
        const { call } = yield* show(fake)

        expect(yield* fake.call("report", { ...call, error, client: "android" })).toMatchObject({
          status: "open",
          failure: { ...error, client: "android", sent: true },
        })
        expect(fake.synthetic).toEqual([
          {
            sessionID,
            text: 'Widget "Pick" failed on android: view: data.items is undefined (line 3, col 12)',
            description: "Pick failed on android",
            metadata: { widget: { messageID, callID: call.callID, kind: "error" } },
            resume: true,
          },
        ])
        // The same error from another client, and a new one within the window, aren't sent; the new one is recorded.
        yield* fake.call("report", { ...call, error, client: "tui" })
        expect(
          yield* fake.call("report", { ...call, error: { phase: "event", message: "boom" }, client: "tui" }),
        ).toMatchObject({ failure: { phase: "event", message: "boom", client: "tui", sent: false } })
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

  test("elsewhere: recorded unsent and not sent, until the user asks, then sent once", () =>
    run((fake) =>
      Effect.gen(function* () {
        const { call } = yield* show(fake, { origin: "ses_author", in: sessionID })

        expect(yield* fake.call("report", { ...call, error, client: "rune" })).toMatchObject({
          failure: { ...error, client: "rune", sent: false },
        })
        expect(fake.synthetic).toEqual([])
        expect((yield* states(fake))[0]).toMatchObject({ status: "open", failure: { sent: false } })

        expect(yield* fake.call("report", { ...call, error, client: "rune", ask: true })).toMatchObject({
          failure: { sent: true },
        })
        expect(fake.synthetic).toEqual([
          expect.objectContaining({
            sessionID,
            text: 'Widget "Pick" failed on rune: view: data.items is undefined (line 3, col 12) The user asked you to fix it.',
            resume: true,
          }),
        ])
        // Asking again, or the same error again, sends nothing more.
        yield* fake.call("report", { ...call, error, client: "rune", ask: true })
        yield* fake.call("report", { ...call, error, client: "ios" })
        expect(fake.synthetic).toHaveLength(1)
      }),
    ))

  test("a built-in never sends on its own", () =>
    run((fake) =>
      Effect.gen(function* () {
        const at = context()
        yield* execute(fake, "widget", { widgetTemplate: "confirm", data: confirmData, title: "Deploy" }, at)
        const call = { sessionID, messageID, callID: at.id }
        expect(yield* fake.call("report", { ...call, error, client: "web" })).toMatchObject({
          failure: { sent: false },
        })
        expect(fake.synthetic).toEqual([])
        yield* fake.call("report", { ...call, error, client: "web", ask: true })
        expect(fake.synthetic).toHaveLength(1)
      }),
    ))

  test("a waiting call fails with the error in the origin Session, and elsewhere only when asked", () =>
    run((fake) =>
      Effect.gen(function* () {
        const own = yield* show(fake, { wait: true })
        yield* fake.call("report", { ...own.call, error: { phase: "init", message: "boom" }, client: "rune" })
        expect(failure(yield* Fiber.join(own.fiber!))).toEqual(
          new Tool.Error({ message: 'Widget "Pick" failed on rune: init: boom' }),
        )

        const other = yield* show(fake, { origin: "ses_author", in: "ses_other", wait: true })
        yield* fake.call("report", { ...other.call, error: { phase: "init", message: "boom" }, client: "rune" })
        expect(other.fiber!.pollUnsafe()).toBeUndefined()
        yield* fake.call("report", {
          ...other.call,
          error: { phase: "init", message: "boom" },
          client: "rune",
          ask: true,
        })
        expect(failure(yield* Fiber.join(other.fiber!))).toEqual(
          new Tool.Error({ message: 'Widget "Pick" failed on rune: init: boom The user asked you to fix it.' }),
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
          widgetTemplate: "confirm",
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
            metadata: { widgetTemplate: { name: "confirm", version: confirm.version }, response: { confirmed: true } },
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
            metadata: { widgetTemplate: { name: "confirm", version: confirm.version } },
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

describe("replacing a widget", () => {
  test("supersedes the old open widget, which can't be answered, and publishes the change", () =>
    run((fake) =>
      Effect.gen(function* () {
        const first = context()
        yield* execute(fake, "widget", { widgetTemplate: "confirm", data: confirmData, title: "Deploy" }, first)
        const second = context()
        const result = yield* execute(
          fake,
          "widget",
          {
            widgetTemplate: "confirm",
            data: { ...confirmData, message: "Deploys main and docs." },
            title: "Deploy",
            replaces: first.id,
          },
          second,
        )
        expect(result).toMatchObject(Exit.succeed({ content: WidgetTools.shownText("Deploy", second.id) }))
        const [old, current] = yield* states(fake)
        expect(old).toMatchObject({
          callID: first.id,
          status: "superseded",
          supersededBy: { messageID, callID: second.id },
          time: { responded: expect.any(Number) },
        })
        expect(current).toMatchObject({ callID: second.id, status: "open" })
        expect(fake.events.map((event) => (event.data as { state: Widget.State }).state)).toMatchObject([
          { callID: first.id, status: "open" },
          { callID: first.id, status: "superseded" },
          { callID: second.id, status: "open" },
        ])
        const call = { sessionID, messageID, callID: first.id }
        expect(yield* fake.call("respond", { ...call, response: { value: true } }).pipe(Effect.flip)).toMatchObject({
          type: "closed",
          data: { status: "superseded" },
        })
        expect(yield* fake.call("send", { ...call, value: 1 }).pipe(Effect.flip)).toMatchObject({ type: "closed" })
        expect(fake.synthetic).toEqual([])
      }),
    ))

  test("refuses an unknown call ID without posting", () =>
    run((fake) =>
      Effect.gen(function* () {
        const result = yield* execute(fake, "widget", {
          widgetTemplate: "confirm",
          data: confirmData,
          replaces: "call_nope",
        })
        expect((failure(result) as Tool.Error).message).toContain('No widget with call ID "call_nope" in this session')
        expect(yield* states(fake)).toEqual([])
      }),
    ))

  test("ends a replaced widget's waiting call as superseded", () =>
    run((fake) =>
      Effect.gen(function* () {
        const first = context()
        const fiber = yield* execute(
          fake,
          "widget",
          { widgetTemplate: "confirm", data: confirmData, title: "Deploy", wait: true },
          first,
        ).pipe(Effect.forkChild({ startImmediately: true }))
        while ((yield* states(fake)).length === 0) yield* Effect.yieldNow
        yield* execute(fake, "widget", {
          widgetTemplate: "confirm",
          data: confirmData,
          title: "Deploy v2",
          replaces: first.id,
        })
        expect(failure(yield* Fiber.join(fiber))).toEqual(
          new Tool.Error({ message: 'Widget "Deploy" was superseded by a newer widget.' }),
        )
        expect((yield* states(fake)).map((state) => state.status)).toEqual(["superseded", "open"])
      }),
    ))
})
