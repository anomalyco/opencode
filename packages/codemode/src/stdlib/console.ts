import { containsOpaqueReference, containsRuntimeReference, isRuntimeReference } from "../interpreter/references.js"
import { copyIn, copyOut } from "../tool-runtime.js"
import {
  isSandboxValue,
  SandboxDate,
  SandboxMap,
  SandboxPromise,
  SandboxRegExp,
  SandboxSet,
  SandboxURL,
  SandboxURLSearchParams,
} from "../values.js"
import { boundedData, coerceToString } from "./value.js"

export const consoleMethods = new Set(["log", "info", "debug", "warn", "error", "dir", "table"])

const MAX_CONSOLE_DEPTH = 32

export const formatConsoleMessage = (name: string, args: Array<unknown>): string => {
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
  if (value instanceof SandboxPromise) return "[Promise (await it to get its value)]"
  if (value instanceof SandboxDate) return coerceToString(value)
  if (value instanceof SandboxRegExp) return coerceToString(value)
  if (value instanceof SandboxURL) return coerceToString(value)
  if (value instanceof SandboxURLSearchParams) return coerceToString(value)
  if (depth > MAX_CONSOLE_DEPTH) return "..."
  if (seen.has(value)) return "[Circular]"
  if (value instanceof SandboxMap) {
    seen.add(value)
    try {
      const entries = Array.from(value.map.entries(), ([key, item]): Array<unknown> => [key, item])
      return `Map(${value.map.size}) ${formatConsoleValue(entries, seen, depth + 1)}`
    } finally {
      seen.delete(value)
    }
  }
  if (value instanceof SandboxSet) {
    seen.add(value)
    try {
      return `Set(${value.set.size}) ${formatConsoleValue(Array.from(value.set.values()), seen, depth + 1)}`
    } finally {
      seen.delete(value)
    }
  }
  if (isRuntimeReference(value)) return "[CodeMode reference]"
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => formatConsoleValue(item, seen, depth + 1)).join(",")}]`
    }
    return `{${Object.entries(value)
      .map(([key, item]) => `${JSON.stringify(key)}:${formatConsoleValue(item, seen, depth + 1)}`)
      .join(",")}}`
  } finally {
    seen.delete(value)
  }
}

const formatConsoleTable = (value: unknown, columnsArgument: unknown): string => {
  if (value === undefined) return "undefined"
  if (containsOpaqueReference(value)) return "[CodeMode reference]"
  const data = boundedData(value, "console.table argument")
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
  const columns = copyOut(copyIn(value, "console.table columns"), true)
  return Array.isArray(columns) ? columns.map((column) => String(column)) : undefined
}

const consoleTableRows = (
  data: unknown,
  columns: ReadonlyArray<string> | undefined,
): Array<{ readonly index: string; readonly values: Record<string, unknown> }> => {
  if (Array.isArray(data)) {
    return data.map((item, index) => ({ index: String(index), values: consoleTableValues(item, columns) }))
  }
  if (data !== null && typeof data === "object" && !isSandboxValue(data)) {
    return Object.entries(data).map(([index, item]) => ({ index, values: consoleTableValues(item, columns) }))
  }
  return [{ index: "0", values: { Value: data } }]
}

const consoleTableValues = (value: unknown, columns: ReadonlyArray<string> | undefined): Record<string, unknown> => {
  if (value !== null && typeof value === "object" && !Array.isArray(value) && !isSandboxValue(value)) {
    const source = value as Record<string, unknown>
    if (columns !== undefined) return Object.fromEntries(columns.map((column) => [column, source[column]]))
    return Object.fromEntries(Object.entries(source))
  }
  return { Value: value }
}

const formatConsoleTableCell = (value: unknown): string => {
  if (value === undefined) return ""
  if (typeof value === "string") return value
  return formatConsoleValue(value, new Set(), 0)
}
