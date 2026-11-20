import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { builtins, program, version } from "@opencode/widget"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Flag } from "@opencode/core/flag"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Permission } from "@opencode/core/permission"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionStore } from "@opencode/core/session/store"
import { Tool } from "@opencode/core/tool"
import { WidgetTools } from "@opencode/core/tool/plugin/widget"
import { Widget } from "@opencode/core/widget"
import { WidgetTemplateTable } from "@opencode/core/widget/sql"
import { SessionMessage } from "@opencode/core/session/message"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { globalProjectNode } from "./lib/project"
import { executeTool, registerToolPlugin, toolIdentity, toolNodeReplacements } from "./lib/tool"
import { promptLocationNode } from "./fixture/prompt-location"

const assertions: Permission.AssertInput[] = []
const permission = permissionLayer({ assert: (input) => Effect.sync(() => assertions.push(input)) })

const widgetToolNode = makeLocationNode({
  name: "test/widget-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(WidgetTools.Plugin)),
  deps: [Tool.node, Permission.node, Widget.node, Flag.node],
})

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      Session.node,
      Widget.node,
      Tool.node,
      widgetToolNode,
    ]),
    [
      ...toolNodeReplacements(permission),
      Bus.node.replace(Bus.configured({ persist: true })),
      Project.node.replace(globalProjectNode),
      LocationServiceMap.node.replace(promptLocationNode),
      SessionExecution.node.replace(SessionExecution.noopLayer),
      Flag.node.replace(Flag.testLayer([], { overrides: "widgets" })),
    ],
  ),
)

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

const pickerSource = `function init(data) { return { picked: null } }
function view(state, data) {
  return ui.column({}, data.items.map((item) => ui.button(item, item)))
}
function update(state, event) { return submit({ picked: event.id }, state) }`

const pickerSchema = {
  type: "object",
  properties: { items: { type: "array", items: { type: "string" }, minItems: 1 } },
  required: ["items"],
} as const

const save = (input: Partial<Widget.SaveInput> = {}) =>
  Effect.gen(function* () {
    const widgets = yield* Widget.Service
    return yield* widgets.save({
      name: "picker",
      description: "Pick one item",
      data: pickerSchema,
      source: pickerSource,
      example: { items: ["a", "b"] },
      ...input,
    })
  })

describe("Widget templates", () => {
  it.effect("serves built-ins at their content-addressed version with the full program", () =>
    Effect.gen(function* () {
      const widgets = yield* Widget.Service
      const suggestions = builtins.find((template) => template.name === "suggestions")!

      const latest = yield* widgets.latest("suggestions")
      expect(latest).toMatchObject({ name: "suggestions", version: suggestions.version, builtin: true })
      expect(yield* widgets.get("suggestions", suggestions.version)).toEqual(latest)
      expect(Widget.toProgram(latest).program).toBe(program(suggestions.source))
      expect((yield* widgets.list()).map((template) => template.name)).toEqual(["confirm", "form", "suggestions"])
      expect(yield* widgets.list()).not.toContainEqual(expect.objectContaining({ source: expect.anything() }))
    }),
  )

  it.effect("stores immutable versions and makes the newest save the latest", () =>
    Effect.gen(function* () {
      const widgets = yield* Widget.Service

      const first = yield* save()
      expect(first).toMatchObject({ name: "picker", builtin: false, version: version(pickerSource, pickerSchema) })
      const changed = pickerSource.replace("ui.column({}", "ui.row({ wrap: true }")
      const second = yield* save({ source: changed })
      expect(second.version).not.toBe(first.version)

      expect((yield* widgets.latest("picker")).version).toBe(second.version)
      expect((yield* widgets.get("picker", first.version)).source).toBe(pickerSource)
      expect((yield* widgets.list()).filter((template) => template.name === "picker")).toEqual([
        { name: "picker", version: second.version, description: "Pick one item", data: pickerSchema, builtin: false },
      ])

      // Saving content that already exists promotes that version again instead of copying it.
      expect((yield* save()).version).toBe(first.version)
      expect((yield* widgets.latest("picker")).version).toBe(first.version)
    }),
  )

  it.effect("rejects built-in names, examples that miss the schema and broken programs", () =>
    Effect.gen(function* () {
      const widgets = yield* Widget.Service
      const reason = (input: Partial<Widget.SaveInput>) =>
        save(input).pipe(
          Effect.flip,
          Effect.map((error) => error.reason),
        )

      expect(yield* reason({ name: "form" })).toBe("built-in templates cannot be overwritten")
      expect(yield* reason({ name: "Bad Name" })).toContain("lowercase")
      expect(yield* reason({ example: { items: [] } })).toStartWith("example: /items")
      expect(yield* reason({ source: "function view() { throw new Error('boom') }" })).toContain("boom")
      expect(yield* widgets.latest("picker").pipe(Effect.flip)).toEqual(
        new Widget.TemplateNotFoundError({ name: "picker" }),
      )
    }),
  )
})

describe("widget tool", () => {
  it.effect("posts an open widget message linked to the tool call", () =>
    Effect.gen(function* () {
      assertions.length = 0
      const sessions = yield* Session.Service
      const registry = yield* Tool.Service
      const session = yield* sessions.create({ location })
      const data = { title: "Ship it?", message: "Deploys **main**." }

      const result = yield* executeTool(registry, {
        sessionID: session.id,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-widget", name: "widget", input: { template: "confirm", data } },
      })

      const messages = yield* sessions.messages({ sessionID: session.id, limit: 10, order: "asc" })
      const widget = messages.find((message) => message.type === "widget")
      const confirm = builtins.find((template) => template.name === "confirm")!
      expect(widget).toMatchObject({
        type: "widget",
        template: { name: "confirm", version: confirm.version },
        data,
        status: "open",
        tool: { messageID: toolIdentity.messageID, callID: "call-widget" },
      })
      expect(result).toMatchObject({
        status: "completed",
        content: [{ type: "text", text: WidgetTools.shownText("confirm") }],
        metadata: { messageID: widget?.id, template: { name: "confirm", version: confirm.version } },
      })
      expect(assertions).toMatchObject([{ sessionID: session.id, action: "widget", resources: ["confirm"] }])
      // The built-in version a message refers to is stored, so it stays retrievable after an upgrade.
      const db = (yield* Database.Service).db
      expect(yield* db.select().from(WidgetTemplateTable).all().pipe(Effect.orDie)).toMatchObject([
        { name: "confirm", version: confirm.version, builtin: true },
      ])
    }),
  )

  it.effect("returns schema mismatches to the model without posting", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const registry = yield* Tool.Service
      const session = yield* sessions.create({ location })

      const result = yield* executeTool(registry, {
        sessionID: session.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-widget-invalid",
          name: "widget",
          input: { template: "confirm", data: { title: "Ship it?" } },
        },
      })

      expect(result).toMatchObject({
        status: "error",
        error: { type: "tool.execution", message: 'Invalid data for widget template "confirm": /message: is required' },
      })
      const messages = yield* sessions.messages({ sessionID: session.id, limit: 10, order: "asc" })
      expect(messages.filter((message) => message.type === "widget")).toEqual([])
    }),
  )

  it.effect("saves a template through widget_template and shows it", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const registry = yield* Tool.Service
      const session = yield* sessions.create({ location })
      const call = (id: string, name: string, input: unknown) =>
        executeTool(registry, { sessionID: session.id, ...toolIdentity, call: { type: "tool-call", id, name, input } })

      const saved = yield* call("call-save", "widget_template", {
        action: "save",
        name: "picker",
        description: "Pick one item",
        data: pickerSchema,
        source: pickerSource,
        example: { items: ["a"] },
      })
      expect(saved).toMatchObject({
        status: "completed",
        metadata: { name: "picker", version: version(pickerSource, pickerSchema) },
      })
      expect(yield* call("call-show", "widget", { template: "picker", data: { items: ["x", "y"] } })).toMatchObject({
        status: "completed",
      })
      expect(yield* call("call-missing", "widget_template", { action: "save", name: "other" })).toMatchObject({
        status: "error",
        error: { message: '`description` is required for action "save"' },
      })
    }),
  )
})

describe("widget responses", () => {
  const post = Effect.gen(function* () {
    const sessions = yield* Session.Service
    const widgets = yield* Widget.Service
    const session = yield* sessions.create({ location })
    const message = yield* widgets.post({
      sessionID: session.id,
      template: yield* widgets.latest("confirm"),
      data: { title: "Ship it?", message: "Deploys main." },
      title: "Deploy",
    })
    return { session, message }
  })

  it.effect("records a submission once and prompts the agent with it", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const widgets = yield* Widget.Service
      const { session, message } = yield* post

      yield* widgets.respond({ sessionID: session.id, messageID: message.id, response: { value: { confirmed: true } } })

      expect(yield* sessions.message({ sessionID: session.id, messageID: message.id })).toMatchObject({
        type: "widget",
        status: "submitted",
        response: { confirmed: true },
        time: { responded: expect.anything() },
      })
      expect(yield* sessions.inbox(session.id)).toMatchObject([
        {
          type: "synthetic",
          payload: {
            text: 'User responded to widget "Deploy": {"confirmed":true}',
            metadata: { widget: { messageID: message.id } },
          },
        },
      ])
      expect(
        yield* widgets
          .respond({ sessionID: session.id, messageID: message.id, response: { dismiss: true } })
          .pipe(Effect.flip),
      ).toEqual(new Widget.AlreadyRespondedError({ sessionID: session.id, messageID: message.id, status: "submitted" }))
      expect(yield* sessions.inbox(session.id)).toHaveLength(1)
    }),
  )

  it.effect("records a dismissal and rejects unknown widgets", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const widgets = yield* Widget.Service
      const { session, message } = yield* post

      yield* widgets.respond({ sessionID: session.id, messageID: message.id, response: { dismiss: true } })

      expect(yield* sessions.message({ sessionID: session.id, messageID: message.id })).toMatchObject({
        status: "dismissed",
      })
      expect(yield* sessions.inbox(session.id)).toMatchObject([{ payload: { text: 'User dismissed widget "Deploy"' } }])
      const other = SessionMessage.ID.create()
      expect(
        yield* widgets
          .respond({ sessionID: session.id, messageID: other, response: { dismiss: true } })
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "Session.MessageNotFoundError", messageID: other })
    }),
  )
})
