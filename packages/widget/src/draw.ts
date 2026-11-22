import { type Command, MAX_COMMANDS, type Segment } from "./node.js"

// The draw output's checks (specs/v2/widgets.md, Canvas, Draw command checks), the same in every host: a draw's
// commands as they crossed, to the commands clients get, or the exact failure.

const TOKENS = new Set(["text", "muted", "accent", "bg", "surface", "border", "success", "warning", "error"])
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const WEIGHTS = new Set([400, 500, 600, 700])
const ALIGNS = new Set(["left", "center", "right"])
const CAPS = new Set(["butt", "round"])
// A path segment's verb and its number of coordinates.
const SEGMENTS: Record<string, number> = { M: 2, L: 2, Q: 4, C: 6, Z: 0 }

class Invalid extends Error {}

type Item = Record<string, unknown>

const isObject = (value: unknown): value is Item => typeof value === "object" && value !== null && !Array.isArray(value)
const fail = (reason: string): never => {
  throw new Invalid(reason)
}
const finite = (value: unknown, what: string) =>
  typeof value === "number" && Number.isFinite(value) ? value : fail(`${what} must be a finite number`)
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const color = (value: unknown) =>
  typeof value === "string" && (TOKENS.has(value) || HEX.test(value)) ? value : fail("not a color")
// An object's field, `undefined` when it is absent or undefined; `null` is a value (and wrong wherever it goes).
const field = (item: Item, name: string) => (Object.hasOwn(item, name) ? item[name] : undefined)

/** The commands clients get from a draw's `commands`, or the failure's message. */
export function checkDraw(
  commands: unknown,
): { readonly commands: ReadonlyArray<Command> } | { readonly error: string } {
  if (!Array.isArray(commands)) return { error: "draw commands must be a list" }
  if (commands.length > MAX_COMMANDS)
    return { error: `${commands.length} draw commands is over the budget of ${MAX_COMMANDS} per frame` }
  const out: Command[] = []
  for (let index = 0; index < commands.length; index++) {
    try {
      out.push(command(commands[index]))
    } catch (error) {
      if (error instanceof Invalid) return { error: `draw command ${index}: ${error.message}` }
      throw error
    }
  }
  return { commands: out }
}

function command(value: unknown): Command {
  if (!Array.isArray(value)) return fail("a command is an array")
  const op = value[0]
  if (typeof op !== "string") return fail("a command starts with its name")
  const at = (index: number) => (index < value.length ? value[index] : fail(`"${op}" is missing argument ${index}`))
  const n = (index: number) => finite(at(index), `"${op}" argument ${index}`)
  // A command takes `count` arguments after its name; `optional` of them may be left off.
  const size = (count: number, optional = 0) => {
    if (value.length > count + 1) fail(`"${op}" has more than ${count} arguments`)
    if (value.length < count + 1 - optional) at(value.length)
  }
  switch (op) {
    case "save":
    case "restore":
      size(0)
      return [op]
    case "translate":
    case "scale":
      size(2)
      return [op, n(1), n(2)]
    case "rotate":
      size(1)
      return ["rotate", n(1)]
    case "alpha":
      size(1)
      return ["alpha", clamp(n(1), 0, 1)]
    case "rect":
      size(5)
      return ["rect", n(1), n(2), n(3), n(4), paint(at(5))]
    case "rrect":
      size(6)
      return ["rrect", n(1), n(2), n(3), n(4), n(5), paint(at(6))]
    case "circle":
      size(4)
      return ["circle", n(1), n(2), n(3), paint(at(4))]
    case "line":
      size(5)
      return ["line", n(1), n(2), n(3), n(4), paint(at(5))]
    case "path": {
      size(2)
      const segments = at(1)
      if (!Array.isArray(segments)) return fail(`"path" takes a list of segments`)
      return ["path", segments.map(segment) as unknown as ReadonlyArray<Segment>, paint(at(2))]
    }
    case "text": {
      size(4, 1)
      const [x, y, text] = [n(1), n(2), at(3)]
      if (typeof text !== "string") return fail(`"text" argument 3 must be a string`)
      return ["text", x, y, text, style(value[4])]
    }
    case "image": {
      size(5)
      const src = at(1)
      if (typeof src !== "string") return fail(`"image" takes a src`)
      return ["image", src, n(2), n(3), n(4), n(5)]
    }
    default:
      return fail(`unknown draw command "${op}"`)
  }
}

function segment(value: unknown) {
  if (!Array.isArray(value)) return fail("a path segment is an array")
  const verb = value[0]
  const count =
    typeof verb === "string" && Object.hasOwn(SEGMENTS, verb) ? SEGMENTS[verb]! : fail("unknown path segment")
  if (value.length !== count + 1) fail(`a "${verb}" path segment takes ${count} coordinates`)
  return [verb, ...value.slice(1).map((coordinate) => finite(coordinate, "a path coordinate"))]
}

function paint(value: unknown) {
  if (!isObject(value)) return fail("a paint is an object")
  const out: Record<string, unknown> = {}
  const fill = field(value, "fill")
  if (fill !== undefined) out.fill = isObject(fill) ? gradient(fill) : color(fill)
  const stroke = field(value, "stroke")
  if (stroke !== undefined) out.stroke = color(stroke)
  const width = field(value, "width")
  if (width !== undefined) out.width = Math.max(0, finite(width, "a stroke's width"))
  const cap = field(value, "cap")
  if (cap !== undefined)
    out.cap = typeof cap === "string" && CAPS.has(cap) ? cap : fail(`a stroke's cap must be "butt" or "round"`)
  return out
}

function gradient(value: Item) {
  const coordinates = (name: string, count: number) => {
    const list = field(value, name)
    if (list === undefined) return undefined
    if (!Array.isArray(list) || list.length !== count) return fail(`a ${name} gradient takes ${count} numbers`)
    return list.map((item) => finite(item, name))
  }
  const [linear, radial] = [coordinates("linear", 4), coordinates("radial", 3)]
  if (linear === undefined && radial === undefined) fail("a gradient needs linear or radial")
  const stops = field(value, "stops")
  if (!Array.isArray(stops)) return fail("a gradient needs stops")
  const checked = stops.map((stop) =>
    Array.isArray(stop) && stop.length === 2
      ? [clamp(finite(stop[0], "a stop's offset"), 0, 1), color(stop[1])]
      : fail("a stop is [offset, color]"),
  )
  return linear !== undefined ? { linear, stops: checked } : { radial, stops: checked }
}

// A text's style: absent, undefined or `null` (as an array item JSON writes undefined) is `{}`.
function style(value: unknown) {
  if (value === undefined || value === null) return {}
  if (!isObject(value)) return fail("a text style is an object")
  const out: Record<string, unknown> = {}
  const size = field(value, "size")
  if (size !== undefined) out.size = clamp(finite(size, "a text size"), 1, 512)
  const weight = field(value, "weight")
  if (weight !== undefined)
    out.weight =
      typeof weight === "number" && WEIGHTS.has(weight) ? weight : fail("a text weight must be 400, 500, 600 or 700")
  const align = field(value, "align")
  if (align !== undefined)
    out.align =
      typeof align === "string" && ALIGNS.has(align) ? align : fail(`a text align must be "left", "center" or "right"`)
  const textColor = field(value, "color")
  if (textColor !== undefined) out.color = color(textColor)
  const mono = field(value, "mono")
  if (mono !== undefined) out.mono = typeof mono === "boolean" ? mono : fail("a text mono must be true or false")
  return out
}
