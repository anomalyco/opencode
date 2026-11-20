export * as WidgetTools from "./tools.js"

import { Widget } from "@opencode/schema/widget"
import { optional } from "@opencode/schema/schema"
import { Schema } from "effect"

export const name = "widget"
export const templateName = "widget_template"

export const description = `Show the user an interactive widget inline in the conversation: choices with images, forms, confirmations, charts and diagrams, canvas drawings, GPU shaders, or live programs such as games and timers. The answer arrives as your next message.

Built-ins (schemas via widget_template "list"): suggestions, form, confirm, chart, backdrop, minigame, and diagrams (pie, scatter, histogram, area, heatmap, treemap, sankey, graph, tree, timeline, funnel, radar, gauge, boxplot, flowchart, sequence, table). Load the "widgets" skill before writing your own template.

- \`data\` is a JSON object matching the template's schema; fix errors and call again. Never invent image URLs.
- By default the call returns at once: end your turn and don't repeat the question in text. With \`wait: true\` it blocks and returns the answer (a dismissal is an error); only for short decisions you need this turn.
- The server doesn't run templates: a client's runtime error arrives as "Widget ... failed on <client>: ..."; fix the template and show it again.`

export const templateDescription = `List, read and save widget templates for the widget tool.

- "list": every template with its description and data schema. "get": one template with its source (built-ins are real examples to copy).
- "save": name, description, data (JSON Schema), source, example (checked against data), mode "live" for a long-running main. Saving a name again makes a new version; built-in names can't be overwritten. The source is parsed and linted, never run: errors in running it come back from clients as messages.

Load the "widgets" skill for the step ABI, the live API, nodes, drawing and shaders.`

export const skillDescription =
  "Use when showing the user an interactive widget with the widget tool or writing a widget template: what widgets can do (choices, forms, charts and diagrams, canvas, GPU shaders, live programs and games, full screen), the built-ins, and the template contracts."

export const Input = Schema.Struct({
  template: Schema.String.annotate({ description: 'Template name, such as "suggestions", "form" or "confirm"' }),
  // An object schema, not `Schema.Json`: models often send `data` as a JSON string, and the input repair only
  // parses it back when the schema says object.
  data: Schema.Record(Schema.String, Schema.Json).annotate({
    description: "Data for the template (a JSON object, not a string), matching its JSON Schema",
  }),
  title: Schema.String.pipe(optional).annotate({ description: "Short title of the widget, used in the transcript" }),
  wait: Schema.Boolean.pipe(optional).annotate({
    description:
      "Wait for the user's answer and return it as this tool's result (default false). Use for short decisions you need to continue this turn.",
  }),
})

export const TemplateInput = Schema.Struct({
  action: Schema.Literals(["list", "get", "save"]),
  name: Schema.String.pipe(optional).annotate({ description: "Template name, for get and save" }),
  description: Schema.String.pipe(optional).annotate({ description: "One line describing the template, for save" }),
  data: Widget.DataSchema.pipe(optional).annotate({
    description: 'JSON Schema (type "object") of the data the template takes, for save',
  }),
  source: Schema.String.pipe(optional).annotate({ description: "The template source, for save" }),
  mode: Widget.Mode.pipe(optional).annotate({
    description:
      'For save: "step" (default) for init/view/update templates, "live" for a long-running async main(data) (games, timers, animations)',
  }),
  capabilities: Widget.Capabilities.pipe(optional).annotate({
    description:
      'For save, live templates only: what the widget may use, e.g. { https: { hosts: ["api.github.com"] } } for widget.fetch. Declare the fewest hosts it needs',
  }),
  example: Schema.Record(Schema.String, Schema.Json)
    .pipe(optional)
    .annotate({ description: "Example data (a JSON object) to test the template with, for save" }),
})

export const shownText = (title: string) =>
  `Widget "${title}" is shown to the user. Their response arrives as the next message; end your turn now unless there is unrelated work to do.`
