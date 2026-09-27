import { type Method, methods } from "../interpreter/native.js"
import { entries, get, Arr, Obj, type Value } from "../interpreter/objects.js"
import { ToolReference } from "../tool-runtime.js"
import { containsOpaqueReference } from "../interpreter/references.js"
import type { Interpreter } from "../interpreter/interpreter.js"

const consoleMethods = ["log", "info", "debug", "warn", "error", "dir", "table"]

/** Captured console: every method appends one formatted line to `logs`. */
export const consoleGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const console = new Obj(builtins.Object)
  methods(
    builtins,
    console,
    consoleMethods.map(
      (name): Method => [
        name,
        0,
        (_, args) => {
          ctx.logs.push(formatConsoleMessage(name, args))
          return undefined
        },
      ],
    ),
  )
  return console
}

const MAX_CONSOLE_DEPTH = 32

const formatConsoleMessage = (name: string, args: Array<Value>): string => {
  if (name === "dir") return args.length === 0 ? "undefined" : formatValue(args[0])
  if (name === "table") return formatConsoleTable(args[0], args[1])
  const prefix = name === "warn" ? "[warn] " : name === "error" ? "[error] " : name === "debug" ? "[debug] " : ""
  return `${prefix}${args.map((arg) => formatValue(arg)).join(" ")}`
}

/** One value as `console.log` shows it. */
export const formatValue = (value: Value): string => {
  if (value === undefined) return "undefined"
  if (typeof value === "string") return value
  return formatConsoleValue(value, new Set(), 0)
}

const formatConsoleValue = (value: Value, seen: Set<object>, depth: number): string => {
  if (value === null || value === undefined) return "null"
  if (typeof value === "string") return JSON.stringify(value)
  if (!(value instanceof Obj)) return value instanceof ToolReference ? "[opaque reference]" : String(value)
  if (depth > MAX_CONSOLE_DEPTH) return "..."
  if (seen.has(value)) return "[Circular]"
  seen.add(value)
  try {
    return value.inspect((item) => formatConsoleValue(item, seen, depth + 1))
  } finally {
    seen.delete(value)
  }
}

const formatConsoleTable = (value: Value, columnsArgument: Value): string => {
  if (value === undefined) return "undefined"
  if (containsOpaqueReference(value)) return "[opaque reference]"
  const columns = columnsArgument instanceof Arr ? columnsArgument.items.map(String) : undefined
  const rows = consoleTableRows(value, columns)
  const keys = columns ?? Array.from(new Set(rows.flatMap((row) => Object.keys(row.values))))
  const header = ["(index)", ...keys].join("\t")
  return [
    header,
    ...rows.map((row) => [row.index, ...keys.map((key) => formatConsoleTableCell(row.values[key]))].join("\t")),
  ].join("\n")
}

const consoleTableRows = (
  data: Value,
  columns: ReadonlyArray<string> | undefined,
): Array<{ readonly index: string; readonly values: Record<string, Value> }> => {
  if (data instanceof Arr) {
    return data.items.map((item, index) => ({ index: String(index), values: consoleTableValues(item, columns) }))
  }
  if (data instanceof Obj) {
    return entries(data).map(([index, item]) => ({ index, values: consoleTableValues(item, columns) }))
  }
  return [{ index: "0", values: { Value: data } }]
}

const consoleTableValues = (value: Value, columns: ReadonlyArray<string> | undefined): Record<string, Value> => {
  if (value instanceof Obj && !(value instanceof Arr)) {
    if (columns !== undefined) return Object.fromEntries(columns.map((column) => [column, get(value, column)]))
    return Object.fromEntries(entries(value))
  }
  return { Value: value }
}

const formatConsoleTableCell = (value: Value): string => {
  if (value === undefined) return ""
  if (typeof value === "string") return value
  return formatConsoleValue(value, new Set(), 0)
}
