import type { JSONSchema } from "./json-schema.js"
import { version } from "./program.js"
import * as source from "./source.js"
import type { WidgetTemplate } from "./widget-template.js"

// The diagram built-ins: canvas widget templates an agent fills with data. Each takes `title` and an optional `choose`, which
// adds a Choose button that submits the selected element.

const string = (description: string): JSONSchema => ({ type: "string", description })
const number = (description: string): JSONSchema => ({ type: "number", description })
const boolean = (description: string): JSONSchema => ({ type: "boolean", description })
const strings = (description: string, extra?: JSONSchema): JSONSchema => ({
  type: "array",
  items: { type: "string" },
  description,
  ...extra,
})
const numbers = (description: string, extra?: JSONSchema): JSONSchema => ({
  type: "array",
  items: { type: "number" },
  description,
  ...extra,
})
const color = (description = "Color (default: a palette starting with the theme accent)"): JSONSchema => ({
  type: "string",
  pattern: "^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$",
  description: `${description}, "#rgb" or "#rrggbb"`,
})
const title = string("Heading of the diagram")
const unit = string('Unit appended to values, such as "%", "ms" or "k users"')
const date = {
  type: ["string", "number"],
  description: 'A date "YYYY-MM-DD", a date and time "YYYY-MM-DDTHH:MM", or a plain number (e.g. a day or week index)',
} satisfies JSONSchema
const choose = (what: string) => boolean(`Show a Choose button that submits ${what} (default false)`)

const object = (properties: Record<string, JSONSchema>, required: ReadonlyArray<string>): JSONSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})

const series = (values: JSONSchema) =>
  object({ label: string("Name of the series"), values, color: color() }, ["label", "values"])

// A node of a nested hierarchy, `depth` levels deep (the schema subset has no `$ref`).
const hierarchy = (depth: number, properties: Record<string, JSONSchema>): JSONSchema =>
  object(
    {
      label: string("Name of the node"),
      ...properties,
      ...(depth > 1
        ? { children: { type: "array", minItems: 1, maxItems: 25, items: hierarchy(depth - 1, properties) } }
        : {}),
    },
    ["label"],
  )

const make = (name: string, description: string, data: JSONSchema): WidgetTemplate => {
  const text = (source as Record<string, string>)[name]
  return { name, version: version(text, data, "step"), description, data, source: text, builtin: true, mode: "step" }
}

export const diagrams: ReadonlyArray<WidgetTemplate> = [
  make(
    "pie",
    "A pie or donut chart of parts of a whole; tap slices to select, legend entries to hide. Choose submits { label, index, value, share }.",
    object(
      {
        title,
        slices: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: object({ label: string("Name of the slice"), value: { type: "number", minimum: 0 }, color: color() }, [
            "label",
            "value",
          ]),
        },
        donut: boolean("Draw a ring with the total in the middle (default false)"),
        unit,
        choose: choose("the selected slice"),
      },
      ["title", "slices"],
    ),
  ),
  make(
    "scatter",
    "A scatter or bubble chart of (x, y[, size]) points in series, with optional trend lines. Choose submits { series, index, x, y, size?, label? }.",
    object(
      {
        title,
        series: {
          type: "array",
          minItems: 1,
          maxItems: 6,
          items: object(
            {
              label: string("Name of the series"),
              points: {
                type: "array",
                minItems: 1,
                maxItems: 200,
                items: object(
                  {
                    x: { type: "number" },
                    y: { type: "number" },
                    size: { type: "number", minimum: 0, description: "Makes it a bubble chart: area ∝ size" },
                    label: string("Name of the point, shown when it is selected"),
                  },
                  ["x", "y"],
                ),
              },
              color: color(),
            },
            ["label", "points"],
          ),
        },
        xLabel: string("Name of the x axis"),
        yLabel: string("Name of the y axis"),
        trend: boolean("Draw a least-squares trend line per series (default false)"),
        choose: choose("the selected point"),
      },
      ["title", "series"],
    ),
  ),
  make(
    "histogram",
    "A histogram of raw numeric values with automatic (or fixed) bins and the median marked. Choose submits { index, from, to, count }.",
    object(
      {
        title,
        values: numbers("The raw values to bin", { minItems: 1, maxItems: 2000 }),
        bins: {
          type: "integer",
          minimum: 1,
          maximum: 60,
          description: "Number of equal bins (default: automatic, nicely rounded)",
        },
        label: string("Name of the x axis"),
        unit,
        color: color("Color of the bars (default: the theme accent)"),
        choose: choose("the selected bin"),
      },
      ["title", "values"],
    ),
  ),
  make(
    "area",
    'A stacked area chart over time: "stacked" totals, "percent" shares or a "stream" graph. Choose submits { series, index, label, value }.',
    object(
      {
        title,
        mode: { enum: ["stacked", "percent", "stream"], description: "How the series stack (default stacked)" },
        series: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: series(
            numbers("One value per time point (negative values count as 0)", { minItems: 2, maxItems: 120 }),
          ),
        },
        labels: strings("Label of each time point (x axis), e.g. months; default 1, 2, 3..."),
        unit,
        choose: choose("the selected series at the selected time"),
      },
      ["title", "series"],
    ),
  ),
  make(
    "heatmap",
    'A heatmap: a "matrix" of rows × columns, or a "calendar" of daily values in week columns; with a color scale legend. Choose submits { row, column, value } or { date, value }.',
    {
      type: "object",
      oneOf: [
        object(
          {
            title,
            layout: { const: "matrix" },
            rows: strings("Row labels", { minItems: 1, maxItems: 30 }),
            columns: strings("Column labels", { minItems: 1, maxItems: 40 }),
            values: {
              type: "array",
              description: "values[row][column]; null for no data. Values below and above zero get a diverging scale",
              items: { type: "array", items: { type: ["number", "null"] } },
            },
            unit,
            color: color("Color of the scale (default: the theme accent)"),
            choose: choose("the selected cell"),
          },
          ["title", "layout", "rows", "columns", "values"],
        ),
        object(
          {
            title,
            layout: { const: "calendar" },
            days: {
              type: "array",
              minItems: 1,
              maxItems: 400,
              description: "Daily values; days in between without an entry show as empty",
              items: object({ date: string('"YYYY-MM-DD"'), value: { type: "number" } }, ["date", "value"]),
            },
            unit,
            color: color("Color of the scale (default: the theme accent)"),
            choose: choose("the selected day"),
          },
          ["title", "layout", "days"],
        ),
      ],
    },
  ),
  make(
    "treemap",
    "A squarified treemap of a hierarchy (up to 4 levels) sized by value; tap to drill in, Back to go up. Choose submits { label, value, path }.",
    object(
      {
        title,
        items: {
          type: "array",
          minItems: 1,
          maxItems: 40,
          description: "Top-level nodes; a node's value defaults to the sum of its children",
          items: hierarchy(4, { value: { type: "number", minimum: 0 }, color: color() }),
        },
        rootLabel: string('Name of the whole (default "All")'),
        unit,
        choose: choose("the selected node"),
      },
      ["title", "items"],
    ),
  ),
  make(
    "sankey",
    "A Sankey diagram of flows between stages (nodes and weighted links); tapping a node traces its flows. Choose submits { kind, ... } for the node or link.",
    object(
      {
        title,
        nodes: {
          type: "array",
          minItems: 2,
          maxItems: 40,
          items: object(
            { id: string("Referenced by links"), label: string("Shown name (default id)"), color: color() },
            ["id"],
          ),
        },
        links: {
          type: "array",
          minItems: 1,
          maxItems: 120,
          description: "Flows; stages follow from the links (sources left, sinks right)",
          items: object(
            { source: string("Node id"), target: string("Node id"), value: { type: "number", minimum: 0 } },
            ["source", "target", "value"],
          ),
        },
        unit,
        choose: choose("the selected node or flow"),
      },
      ["title", "nodes", "links"],
    ),
  ),
  make(
    "graph",
    "A network graph (nodes and edges) with a force layout that settles in; tap a node to highlight its neighbors. Choose submits { id, label, neighbors }.",
    object(
      {
        title,
        nodes: {
          type: "array",
          minItems: 1,
          maxItems: 40,
          items: object(
            {
              id: string("Referenced by edges"),
              label: string("Shown name (default id)"),
              group: string("Nodes in the same group share a color"),
              size: { type: "number", minimum: 0, description: "Scales the node (default: by number of edges)" },
              color: color(),
            },
            ["id"],
          ),
        },
        edges: {
          type: "array",
          maxItems: 100,
          items: object(
            {
              source: string("Node id"),
              target: string("Node id"),
              label: string("Shown on the edge"),
              weight: { type: "number", minimum: 0, description: "Line width, 0.5 to 4 (default 1)" },
            },
            ["source", "target"],
          ),
        },
        directed: boolean("Draw arrows from source to target (default false)"),
        choose: choose("the selected node"),
      },
      ["title", "nodes", "edges"],
    ),
  ),
  make(
    "tree",
    'A hierarchy (up to 6 levels) as a collapsible tree, growing "right" (default) or "down" (org chart). Choose submits { label, path, note? }.',
    object(
      {
        title,
        root: hierarchy(6, {
          note: string("A second line, e.g. a role; shown in down boxes and the caption"),
          color: color(),
        }),
        orientation: {
          enum: ["right", "down"],
          description: "right: left to right (default); down: top down like an org chart",
        },
        expand: {
          type: "integer",
          minimum: 1,
          description: "Levels open at first (default: all up to 40 nodes, else 2)",
        },
        choose: choose("the selected node"),
      },
      ["title", "root"],
    ),
  ),
  make(
    "timeline",
    "A Gantt timeline of tasks with start/end dates (or numbers), optional groups, progress, milestones and a today marker. Choose submits { label, index, start, end, group? }.",
    object(
      {
        title,
        tasks: {
          type: "array",
          minItems: 1,
          maxItems: 40,
          items: object(
            {
              label: string("Name of the task"),
              start: date,
              end: { ...date, description: "Omit for a milestone. A date-only end includes that day" },
              group: string("Tasks with the same group are listed under it"),
              progress: { type: "number", minimum: 0, maximum: 1, description: "Done fraction, 0 to 1" },
              color: color("Color of the bar (default: per group)"),
            },
            ["label", "start"],
          ),
        },
        today: { ...date, description: "Where to draw the today marker (the widget template can't read the clock)" },
        choose: choose("the selected task"),
      },
      ["title", "tasks"],
    ),
  ),
  make(
    "funnel",
    "A conversion funnel of stages with values, showing conversion from the previous and the first stage. Choose submits { label, index, value, ofFirst, ofPrevious }.",
    object(
      {
        title,
        stages: {
          type: "array",
          minItems: 2,
          maxItems: 10,
          items: object({ label: string("Name of the stage"), value: { type: "number", minimum: 0 } }, [
            "label",
            "value",
          ]),
        },
        unit,
        color: color("Color of the bars (default: the theme accent)"),
        choose: choose("the selected stage"),
      },
      ["title", "stages"],
    ),
  ),
  make(
    "radar",
    "A radar (spider) chart comparing series over 3 to 12 axes on one scale. Choose submits { axis, index, values: { [series]: value } }.",
    object(
      {
        title,
        axes: strings("Axis names, clockwise from the top", { minItems: 3, maxItems: 12 }),
        series: {
          type: "array",
          minItems: 1,
          maxItems: 6,
          items: series(numbers("One value per axis", { minItems: 3, maxItems: 12 })),
        },
        max: number("Value at the outer ring (default: the largest value, rounded up)"),
        unit,
        choose: choose("the selected axis"),
      },
      ["title", "axes", "series"],
    ),
  ),
  make(
    "gauge",
    "One to four KPI dials with min/max, threshold bands in success/warning/error tones and an optional target. Choose submits { label, index, value, tone }.",
    object(
      {
        title,
        gauges: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: object(
            {
              label: string("Name of the KPI"),
              value: { type: "number" },
              min: number("Start of the dial (default 0)"),
              max: number("End of the dial"),
              unit,
              target: number("Draws a tick at this value"),
              bands: {
                type: "array",
                maxItems: 6,
                description: "Thresholds: each band runs from the previous band's `to` (or min) up to its `to`",
                items: object(
                  { to: { type: "number" }, tone: { enum: ["success", "warning", "error", "accent", "muted"] } },
                  ["to", "tone"],
                ),
              },
            },
            ["label", "value", "max"],
          ),
        },
        choose: choose("the selected gauge"),
      },
      ["title", "gauges"],
    ),
  ),
  make(
    "boxplot",
    "Box plots comparing distributions of groups, from raw values (quartiles, whiskers, outliers computed) or precomputed stats. Choose submits { label, index, min, q1, median, q3, max, ... }.",
    object(
      {
        title,
        groups: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: {
            ...object(
              {
                label: string("Name of the group"),
                values: numbers("Raw values", { minItems: 1, maxItems: 300 }),
                stats: object(
                  {
                    min: { type: "number" },
                    q1: { type: "number" },
                    median: { type: "number" },
                    q3: { type: "number" },
                    max: { type: "number" },
                    outliers: numbers("Values beyond the whiskers"),
                  },
                  ["min", "q1", "median", "q3", "max"],
                ),
                color: color(),
              },
              ["label"],
            ),
            anyOf: [{ required: ["values"] }, { required: ["stats"] }],
          },
        },
        unit,
        choose: choose("the selected group"),
      },
      ["title", "groups"],
    ),
  ),
  make(
    "flowchart",
    "A flowchart of steps (process, decision, terminal, io) and labeled directed edges, laid out top down automatically. Choose submits { id, label }.",
    object(
      {
        title,
        nodes: {
          type: "array",
          minItems: 1,
          maxItems: 40,
          items: object(
            {
              id: string("Referenced by edges"),
              label: string("Shown text (default id); long labels wrap to two lines"),
              shape: {
                enum: ["process", "decision", "terminal", "io"],
                description: "process: box (default); decision: diamond; terminal: pill (start/end); io: parallelogram",
              },
              color: color("Outline color"),
            },
            ["id"],
          ),
        },
        edges: {
          type: "array",
          maxItems: 80,
          items: object({ from: string("Node id"), to: string("Node id"), label: string('e.g. "yes" / "no"') }, [
            "from",
            "to",
          ]),
        },
        choose: choose("the selected step"),
      },
      ["title", "nodes", "edges"],
    ),
  ),
  make(
    "sequence",
    "A sequence diagram: participants and the messages between them in order (sync, async, reply, self). Choose submits { index, from, to, label }.",
    object(
      {
        title,
        participants: strings("Participant names, left to right", { minItems: 1, maxItems: 8 }),
        messages: {
          type: "array",
          minItems: 1,
          maxItems: 40,
          items: object(
            {
              from: string("Participant name"),
              to: string("Participant name; the same as from for a self call"),
              label: string("The message"),
              kind: {
                enum: ["sync", "async", "reply"],
                description: "sync: filled arrow (default); async: open arrow; reply: dashed",
              },
            },
            ["from", "to", "label"],
          ),
        },
        numbered: boolean("Number the messages (default false)"),
        choose: choose("the selected message"),
      },
      ["title", "participants", "messages"],
    ),
  ),
  make(
    "table",
    "A sortable data table with aligned columns and an optional sparkline per row. Choose submits { index, row: { [column]: cell } }.",
    object(
      {
        title,
        columns: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: object(
            {
              label: string("Column heading; also the key in the submitted row"),
              unit: string('Unit for numbers: "$", "€", "£" and "¥" go first, others after ("%", "ms")'),
              digits: {
                type: "integer",
                minimum: 0,
                maximum: 6,
                description: "Decimals for numbers (default 0 for integers, else 2)",
              },
            },
            ["label"],
          ),
        },
        rows: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          items: object(
            {
              cells: {
                type: "array",
                items: { type: ["string", "number", "null"] },
                description: "One cell per column",
              },
              trend: numbers("Values for the row's sparkline", { minItems: 2, maxItems: 60 }),
            },
            ["cells"],
          ),
        },
        trendLabel: string('Heading of the sparkline column (default "Trend")'),
        color: color("Color of the sparklines (default: the theme accent)"),
        choose: choose("the selected row"),
      },
      ["title", "columns", "rows"],
    ),
  ),
]
