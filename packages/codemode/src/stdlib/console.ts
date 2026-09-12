import { toData, toProgram } from "../data.js"
import { HostNamespace, sync } from "../interpreter/host.js"
import { get, ownEntries, ProgramArray, ProgramObject } from "../interpreter/objects.js"
import { containsOpaqueReference, containsRuntimeReference, isRuntimeReference } from "../interpreter/references.js"
import { Values } from "../values.js"
import { coerceToString } from "./value.js"

const consoleMethods = ["log", "info", "debug", "warn", "error", "dir", "table"]

/** Captured console: every method appends one formatted line to `logs`. */
export const consoleGlobal = (logs: Array<string>) =>
  new HostNamespace(
    "console",
    Object.fromEntries(
      consoleMethods.map((name) => [
        name,
        sync(`console.${name}`, (args) => {
          logs.push(formatConsoleMessage(name, args))
          return undefined
        }),
      ]),
    ),
  )

const MAX_CONSOLE_DEPTH = 32

const formatConsoleMessage = (name: string, args: Array<unknown>): string => {
  if (name === "dir") return args.length === 0 ? "undefined" : formatConsoleArgument(args[0])
  if (name === "table") return formatConsoleTable(args[0], args[1])
  const prefix = name === "warn" ? "[warn] " : name === "error" ? "[error] " : name === "debug" ? "[debug] " : ""
  return `${prefix}${args.map((arg) => formatConsoleArgument(arg)).join(" ")}`
}

const formatConsoleArgument = (value: unknown): string => {
  if (value === undefined) return "undefined"
  if (typeof value === "string") return value
  return formatConsoleValue(value, new Set(), 0)
}

const formatConsoleValue = (value: unknown, seen: Set<object>, depth: number): string => {
  if (value === null || value === undefined) return "null"
  if (typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (typeof value !== "object") return String(value)
  if (value instanceof Values.Promise) return "[Promise (await it to get its value)]"
  if (value instanceof Values.Date) return coerceToString(value)
  if (value instanceof Values.RegExp) return coerceToString(value)
  if (value instanceof Values.URL) return coerceToString(value)
  if (value instanceof Values.URLSearchParams) return coerceToString(value)
  if (depth > MAX_CONSOLE_DEPTH) return "..."
  if (seen.has(value)) return "[Circular]"
  if (value instanceof Values.Map) {
    seen.add(value)
    try {
      const entries = Array.from(value.map.entries(), ([key, item]) => new ProgramArray([key, item]))
      return `Map(${value.map.size}) ${formatConsoleValue(new ProgramArray(entries), seen, depth + 1)}`
    } finally {
      seen.delete(value)
    }
  }
  if (value instanceof Values.Set) {
    seen.add(value)
    try {
      return `Set(${value.set.size}) ${formatConsoleValue(new ProgramArray([...value.set.values()]), seen, depth + 1)}`
    } finally {
      seen.delete(value)
    }
  }
  if (isRuntimeReference(value)) return "[opaque reference]"
  seen.add(value)
  try {
    if (value instanceof ProgramArray) {
      return `[${value.items.map((item) => formatConsoleValue(item, seen, depth + 1)).join(",")}]`
    }
    if (!(value instanceof ProgramObject)) return "[object Object]"
    return `{${ownEntries(value)
      .map(([key, item]) => `${JSON.stringify(key)}:${formatConsoleValue(item, seen, depth + 1)}`)
      .join(",")}}`
  } finally {
    seen.delete(value)
  }
}

const formatConsoleTable = (value: unknown, columnsArgument: unknown): string => {
  if (value === undefined) return "undefined"
  if (containsOpaqueReference(value)) return "[opaque reference]"
  const data = toProgram(value, "console.table argument")
  const columns = consoleTableColumns(columnsArgument)
  const rows = consoleTableRows(data, columns)
  const keys = columns ?? Array.from(new Set(rows.flatMap((row) => Object.keys(row.values))))
  const header = ["(index)", ...keys].join("\t")
  return [
    header,
    ...rows.map((row) => [row.index, ...keys.map((key) => formatConsoleTableCell(row.values[key]))].join("\t")),
  ].join("\n")
}

const consoleTableColumns = (value: unknown): ReadonlyArray<string> | undefined => {
  if (value === undefined) return undefined
  if (containsRuntimeReference(value)) return undefined
  const columns = toData(value, "console.table columns", "result")
  return Array.isArray(columns) ? columns.map((column) => String(column)) : undefined
}

const consoleTableRows = (
  data: unknown,
  columns: ReadonlyArray<string> | undefined,
): Array<{ readonly index: string; readonly values: Record<string, unknown> }> => {
  if (data instanceof ProgramArray) {
    return data.items.map((item, index) => ({ index: String(index), values: consoleTableValues(item, columns) }))
  }
  if (data instanceof ProgramObject) {
    return ownEntries(data).map(([index, item]) => ({ index, values: consoleTableValues(item, columns) }))
  }
  return [{ index: "0", values: { Value: data } }]
}

const consoleTableValues = (value: unknown, columns: ReadonlyArray<string> | undefined): Record<string, unknown> => {
  if (value instanceof ProgramObject && !(value instanceof ProgramArray)) {
    if (columns !== undefined) return Object.fromEntries(columns.map((column) => [column, get(value, column)]))
    return Object.fromEntries(ownEntries(value))
  }
  return { Value: value }
}

const formatConsoleTableCell = (value: unknown): string => {
  if (value === undefined) return ""
  if (typeof value === "string") return value
  return formatConsoleValue(value, new Set(), 0)
}
