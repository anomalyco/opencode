export * as WidgetTools from "./tools.js"

import { Widget } from "@opencode/schema/widget"
import { optional } from "@opencode/schema/schema"
import { Schema } from "effect"

export const name = "widget"
export const widgetTemplateName = "widget_template"

export const description = `Show the user an interactive widget inline in the conversation: choices with images, forms, confirmations, charts and diagrams, canvas drawings (2D or GPU shaders), or live programs such as games and timers. The answer arrives as your next message.

Built-ins (schemas via widget_template "list"): suggestions, form, confirm, chart, backdrop, and diagrams (pie, scatter, histogram, area, heatmap, treemap, sankey, graph, tree, timeline, funnel, radar, gauge, boxplot, flowchart, sequence, table). Load the "widgets" skill before writing your own widget template.

- \`data\` is a JSON object matching the widget template's schema; fix errors and call again. Never invent image URLs.
- To change a widget you showed (a fix, new data, the next step), post the new one with \`replaces\` set to the old call ID from its result: the old one closes as superseded.
- By default the call returns at once: end your turn and don't repeat the question in text. With \`wait: true\` it blocks and returns the answer (a dismissal is an error); only for short decisions you need this turn.
- The server doesn't run widget templates: a program error arrives as "Widget ... failed on <client>: ..." (for widget templates saved in this session, or when the user asks you to fix it); fix the widget template and show it again.`

export const widgetTemplateDescription = `List, read, save and edit widget templates for the widget tool.

- "list": every widget template with its description and data schema. "get": one widget template with its source (built-ins are real examples to copy).
- "save": name, description, data (JSON Schema), source, example (checked against data), mode "live" for a long-running main. Saving a name again makes a new version; built-in names can't be overwritten. The source is parsed and linted, never run: errors in running it come back from clients as messages.
- "edit": name and edits [{ oldText, newText }] applied to the latest source (each oldText must match exactly once), optionally description, data and example (required when data changes); saves a new version. Prefer it over resending the whole source. To start from a built-in or another widget template, add from: "<widget template>" and a new name.
- Edit or save over an existing widget template only when the user asks or you created it in this session; otherwise copy it with from under a new name.

Load the "widgets" skill for handlers, the step ABI, the live API, nodes and canvases (2D drawing and WGSL).`

export const skillDescription =
  "Use when showing the user an interactive widget with the widget tool or writing a widget template: what widgets can do (choices, forms, charts and diagrams, canvas (2D or GPU), live programs and games, full screen), the built-ins, and the widget template contracts."

export const Input = Schema.Struct({
  widgetTemplate: Schema.String.annotate({
    description: 'Widget template name, such as "suggestions", "form" or "confirm"',
  }),
  // An object schema, not `Schema.Json`: models often send `data` as a JSON string, and the input repair only
  // parses it back when the schema says object.
  data: Schema.Record(Schema.String, Schema.Json).annotate({
    description: "Data for the widget template (a JSON object, not a string), matching its JSON Schema",
  }),
  title: Schema.String.pipe(optional).annotate({ description: "Short title of the widget, used in the transcript" }),
  replaces: Schema.String.pipe(optional).annotate({
    description:
      "Call ID of an earlier widget in this session that this one replaces (it closes as superseded). Use it when iterating on the same widget",
  }),
  wait: Schema.Boolean.pipe(optional).annotate({
    description:
      "Wait for the user's answer and return it as this tool's result (default false). Use for short decisions you need to continue this turn.",
  }),
})

export const WidgetTemplateInput = Schema.Struct({
  action: Schema.Literals(["list", "get", "save", "edit"]),
  name: Schema.String.pipe(optional).annotate({ description: "Widget template name, for get, save and edit" }),
  description: Schema.String.pipe(optional).annotate({
    description: "One line describing the widget template, for save (and edit, to change it)",
  }),
  data: Widget.DataSchema.pipe(optional).annotate({
    description: 'JSON Schema (type "object") of the data the widget template takes, for save (and edit, to change it)',
  }),
  from: Schema.String.pipe(optional).annotate({
    description: "For edit: the widget template to copy and edit under the new `name` (e.g. a built-in)",
  }),
  edits: Schema.Array(Schema.Struct({ oldText: Schema.String, newText: Schema.String }))
    .pipe(optional)
    .annotate({
      description:
        "For edit: exact-text replacements applied in order; each oldText must match the source exactly once",
    }),
  source: Schema.String.pipe(optional).annotate({ description: "The widget template source, for save" }),
  mode: Widget.Mode.pipe(optional).annotate({
    description:
      'For save: "step" (default) for init/view widget templates with handlers on nodes, "live" for a long-running async main(data) (games, timers, animations)',
  }),
  capabilities: Widget.Capabilities.pipe(optional).annotate({
    description:
      'For save, live widget templates only: what the widget may use, e.g. { https: { hosts: ["api.github.com"] } } for widget.fetch (declare the fewest hosts it needs), { storage: {} } for widget.storage',
  }),
  example: Schema.Record(Schema.String, Schema.Json).pipe(optional).annotate({
    description: "Example data (a JSON object) to test the widget template with, for save (and edit when data changes)",
  }),
})

export const shownText = (title: string, callID: string) =>
  `Widget "${title}" is shown to the user (call ID ${callID}, for replaces). Their response arrives as the next message; end your turn now unless there is unrelated work to do.`
