/// <reference path="../../markdown.d.ts" />

export * as WidgetTools from "./widget.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai/effect"
import { Effect, Schema } from "effect"
import { optional } from "@opencode/schema/schema"
import { Flag } from "../../flag.js"
import { Permission } from "../../permission.js"
import { Widget } from "../../widget.js"
import { Skill } from "../../skill.js"
import { AbsolutePath } from "../../schema.js"
import skillContent from "../../plugin/skill/widgets.md" with { type: "text" }

export const name = "widget"
export const templateName = "widget_template"

export const description = `Show the user an interactive widget inline in the conversation: option cards with image carousels, a form with text inputs, sliders, checkboxes and selects, a confirmation, or a chart. The user's answer arrives as your next message.

Use it when the user should pick between things they should see, fill several structured inputs at once, or approve something consequential. Load the "widgets" skill for when and how to use it, data examples and writing templates.

Built-in templates (data schemas via widget_template action "list"):
- suggestions: 2 or 3 options, each with 1 to 3 images and an optional note; submits { choice, index, note? }.
- form: text, number (slider), boolean (checkbox) and select fields with a submit button; submits { [key]: value }.
- confirm: a yes/no question with markdown details; submits { confirmed }.
- chart: an animated bar or line chart of number series; submits nothing, or { series, index, value } on a tap with choose: true.
- backdrop: a title and text on an animated shader banner (plasma, aurora or waves); submits nothing.

Usage notes:
- \`data\` is a JSON object (not a string) matching the template's JSON Schema; fix mismatches from the tool error and call again.
- Image paths may be https URLs, data: URIs or paths relative to the session directory. Never invent image URLs.
- Show the widget early instead of researching for many steps first.
- After the widget is shown, end your turn unless there is unrelated work to do. Do not ask the same thing again in text.`

export const templateDescription = `List, read and save widget templates for the widget tool.

- action "list": every template with its description and data schema.
- action "get": one template including its source; read "suggestions" or "form" before writing your own and copy their patterns.
- action "save": store a template (name, description, data, source, example). Saving an existing name creates a new version that becomes the latest; built-in names cannot be overwritten. \`example\` is data that is checked against \`data\` and rendered once before the template is stored.

A template's source is confined JavaScript defining init(data), view(state, data) and update(state, event, data) with the prelude's ui.* node builders, submit(value, state), dismiss(state) and send(value, state, { wake }), plus draw(state, data, frame) for a canvas. Nodes include canvas (2D draw commands) and shader (a WGSL fragment shader). Load the "widgets" skill for the full builder reference before writing one.`

export const skillDescription =
  "Use when showing the user an interactive widget (option cards with images, forms with sliders, checkboxes and selects, confirmations, charts) with the widget tool, or writing a widget template: when a widget beats text, how to fill each built-in template, and the template language with canvas drawing and WGSL shaders."

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

    yield* ctx.skill.transform((editor) => {
      editor.add(
        Skill.Info.make({
          id: Skill.ID.make("widgets"),
          name: Skill.Name.make("Widgets"),
          description: skillDescription,
          path: AbsolutePath.make("skill://widgets/SKILL.md"),
          content: skillContent,
        }),
      )
    })

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
