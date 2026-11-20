export * as WidgetTools from "./widget.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai/effect"
import { Effect, Schema } from "effect"
import { optional } from "@opencode/schema/schema"
import { Flag } from "../../flag.js"
import { Permission } from "../../permission.js"
import { Widget } from "../../widget.js"

export const name = "widget"
export const templateName = "widget_template"

export const description = `Show the user an interactive widget inline in the conversation: option cards with image carousels, a form with text inputs, sliders, checkboxes and selects, or a confirmation. The user's answer arrives as your next message.

Built-in templates (see their data schemas with widget_template action "list"):
- suggestions: 2 or 3 options, each with 1 to 3 images and an optional note; submits { choice, index, note? }.
- form: text, number (slider), boolean (checkbox) and select fields with a submit button; submits { [key]: value }.
- confirm: a yes/no question with markdown details; submits { confirmed }.

Usage notes:
- \`data\` must match the template's JSON Schema; mismatches come back as the tool error.
- Image paths may be https URLs, data: URIs or paths relative to the session directory.
- After the widget is shown, end your turn unless there is unrelated work to do. Do not ask the same thing again in text.
- For a layout no template fits, write one with widget_template.`

export const templateDescription = `List, read and save widget templates for the widget tool.

- action "list": every template with its description and data schema.
- action "get": one template including its source; read "suggestions" or "form" before writing your own and copy their patterns.
- action "save": store a template (name, description, data, source, example). Saving an existing name creates a new version that becomes the latest; built-in names cannot be overwritten. \`example\` is data that is checked against \`data\` and rendered once before the template is stored.

A template's source is confined JavaScript (no imports, timers, randomness or I/O) defining top-level functions:
  function init(data) { return { picked: null } }            // optional, the initial state
  function view(state, data) { return ui.column({}, [...]) } // required, returns the view tree
  function update(state, event, data) {                       // optional, returns the next state
    if (event.id === "choose") return submit({ picked: state.picked }, state)
    return { ...state, picked: event.value }
  }
State and data are plain JSON. update may return submit(value, state) to send \`value\` to you, or dismiss(state).

Node builders (props are optional objects; tone is default|muted|accent|success|warning|error; gap is 0..3):
  ui.column(props, children)  { gap, align: start|center|end|stretch }
  ui.row(props, children)     { gap, align: start|center|end, wrap }
  ui.text(text, props)        { style: title|body|caption|code, tone }
  ui.markdown(text)
  ui.image(src, props)        { alt, aspect }  (aspect = width / height)
  ui.carousel(props, children){ id, index }    one child at a time; with id it sends change with the page index
  ui.card(props, children)    { id, selected } with id it sends press
  ui.button(id, label, props) { variant: primary|secondary|danger, disabled } sends press
  ui.checkbox(id, label, checked, props) sends change with a boolean
  ui.slider(id, { label, value, min, max, step }) sends change with a number
  ui.select(id, [{ value, label, description }], { label, value, multiple }) sends change with a string or string[]
  ui.input(id, value, { label, placeholder, multiline }) sends change with a string
  ui.divider()
Children may contain null or false (for \`cond && node\`) and nested arrays. Events are { id, type: "press" | "change", value? }.`

export const Input = Schema.Struct({
  template: Schema.String.annotate({ description: 'Template name, such as "suggestions", "form" or "confirm"' }),
  // An object schema, not `Schema.Json`: models often send `data` as a JSON string, and the input repair only
  // parses it back when the schema says object.
  data: Schema.Record(Schema.String, Schema.Json).annotate({
    description: "Data for the template (a JSON object, not a string), matching its JSON Schema",
  }),
  title: Schema.String.pipe(optional).annotate({ description: "Short title of the widget, used in the transcript" }),
})

export const TemplateInput = Schema.Struct({
  action: Schema.Literals(["list", "get", "save"]),
  name: Schema.String.pipe(optional).annotate({ description: "Template name, for get and save" }),
  description: Schema.String.pipe(optional).annotate({ description: "One line describing the template, for save" }),
  data: Widget.DataSchema.pipe(optional).annotate({
    description: 'JSON Schema (type "object") of the data the template takes, for save',
  }),
  source: Schema.String.pipe(optional).annotate({ description: "The template source, for save" }),
  example: Schema.Record(Schema.String, Schema.Json)
    .pipe(optional)
    .annotate({ description: "Example data (a JSON object) to test the template with, for save" }),
})

export const shownText = (title: string) =>
  `Widget "${title}" is shown to the user. Their response arrives as the next message; end your turn now unless there is unrelated work to do.`

export const Plugin = {
  id: "opencode.tool.widget",
  effect: Effect.fn("WidgetTools.Plugin")(function* (ctx: Context) {
    const widgets = yield* Widget.Service
    const permission = yield* Permission.Service
    if (!(yield* Flag.enabled("widgets"))) return

    yield* ctx.tool
      .transform((editor) => {
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission
                .assert({ action: name, resources: [input.template], ...Permission.invocation(context) })
                .pipe(Effect.mapError((error) => new ToolFailure({ message: "Permission denied: widget", error })))
              const template = yield* widgets.latest(input.template).pipe(
                Effect.mapError(
                  (error) =>
                    new ToolFailure({
                      message: `${error.message}. Use widget_template with action "list" to see the templates.`,
                    }),
                ),
              )
              yield* widgets
                .check(template, input.data)
                .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
              const message = yield* widgets
                .post({
                  sessionID: context.sessionID,
                  template,
                  data: input.data,
                  title: input.title,
                  tool: { messageID: context.messageID, callID: context.id },
                })
                .pipe(Effect.orDie)
              return {
                content: shownText(input.title ?? template.name),
                metadata: { messageID: message.id, template: { name: template.name, version: template.version } },
              }
            }),
        })
        editor.add({
          name: templateName,
          options: { codemode: false },
          description: templateDescription,
          input: TemplateInput,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission
                .assert({
                  action: templateName,
                  resources: [input.action === "list" ? "*" : (input.name ?? "*")],
                  metadata: { action: input.action },
                  ...Permission.invocation(context),
                })
                .pipe(
                  Effect.mapError((error) => new ToolFailure({ message: "Permission denied: widget_template", error })),
                )
              if (input.action === "list") {
                const list = yield* widgets.list()
                return { content: JSON.stringify(list, null, 2) }
              }
              const required = <A>(field: string, value: A | undefined) =>
                value === undefined
                  ? Effect.fail(new ToolFailure({ message: `\`${field}\` is required for action "${input.action}"` }))
                  : Effect.succeed(value)
              const named = yield* required("name", input.name)
              if (input.action === "get") {
                const template = yield* widgets
                  .latest(named)
                  .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
                return { content: JSON.stringify(template, null, 2) }
              }
              const saved = yield* widgets
                .save({
                  name: named,
                  description: yield* required("description", input.description),
                  data: yield* required("data", input.data),
                  source: yield* required("source", input.source),
                  example: yield* required("example", input.example),
                })
                .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
              return {
                content: `Saved widget template "${saved.name}" version ${saved.version}. Show it with the widget tool.`,
                metadata: { name: saved.name, version: saved.version },
              }
            }),
        })
      })
      .pipe(Effect.orDie)
  }),
}
