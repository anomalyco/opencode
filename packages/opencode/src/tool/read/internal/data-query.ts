import path from "path"
import { pathToFileURL } from "url"
import z from "zod"
import { parse as parseJsonc, printParseErrorCode, type ParseError as JsoncParseError } from "jsonc-parser"
import { Tool } from "@/tool/shared/tool"
import { Filesystem } from "@/util/filesystem"
import { file, pretty, title } from "./common"

const DESCRIPTION = `Read structured data files such as JSON, JSONC, or TOML using summary, pointer lookup, key listing, entry listing, slices, or searches.

Use this when line-based file reads are too noisy and you want structure-aware access instead.`

function ptr(input?: string) {
  if (!input) return []
  if (input === "") return []
  if (!input.startsWith("/")) throw new Error("pointer must start with '/' and use JSON Pointer syntax")
  return input
    .split("/")
    .slice(1)
    .map((item) => item.replaceAll("~1", "/").replaceAll("~0", "~"))
}

function at(root: unknown, pointer?: string) {
  let cur = root
  let seen = ""

  for (const item of ptr(pointer)) {
    seen += `/${item}`

    if (Array.isArray(cur)) {
      const idx = Number(item)
      if (!Number.isInteger(idx)) throw new Error(`Pointer segment '${item}' is not a valid array index at ${seen}`)
      if (idx < 0 || idx >= cur.length) throw new Error(`Array index out of range at ${seen}`)
      cur = cur[idx]
      continue
    }

    if (cur && typeof cur === "object") {
      if (!(item in cur)) throw new Error(`Missing key '${item}' at ${seen}`)
      cur = (cur as Record<string, unknown>)[item]
      continue
    }

    throw new Error(`Cannot descend into ${typeof cur} at ${seen}`)
  }

  return cur
}

function kind(value: unknown) {
  if (Array.isArray(value)) return "array"
  if (value === null) return "null"
  return typeof value === "object" ? "object" : typeof value
}

function brief(value: unknown): unknown {
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      sample: value.slice(0, 5).map(brief),
      truncated: value.length > 5,
    }
  }

  if (value && typeof value === "object") {
    const keys = Object.keys(value)
    return {
      type: "object",
      size: keys.length,
      keys: keys.slice(0, 10),
      truncated: keys.length > 10,
    }
  }

  return value
}

function spot(text: string, errors: JsoncParseError[]) {
  const rows = text.split("\n")
  return errors
    .map((item) => {
      const part = text.slice(0, item.offset).split("\n")
      const row = part.length
      const col = part.at(-1)!.length + 1
      const line = rows[row - 1]
      const head = `${printParseErrorCode(item.error)} at line ${row}, column ${col}`
      if (!line) return head
      return `${head}\n  ${line}\n  ${" ".repeat(Math.max(col - 1, 0))}^`
    })
    .join("\n")
}

async function load(filePath: string) {
  const ext = path.extname(filePath).toLowerCase()
  if (!ext || ![".json", ".jsonc", ".toml"].includes(ext)) {
    throw new Error(
      `data_query supports only .json, .jsonc, and .toml files (received ${ext || "no extension"} at ${filePath}); use inspect(action=file) for code or text files`,
    )
  }

  if (ext === ".toml") {
    const mod = await import(pathToFileURL(filePath).href, { with: { type: "toml" } })
    return {
      kind: "toml",
      data: mod.default as unknown,
    }
  }

  const text = await Filesystem.readText(filePath)
  const errs: JsoncParseError[] = []
  const data = parseJsonc(text, errs, { allowTrailingComma: true })
  if (errs.length) {
    throw new Error(`Failed to parse structured data in ${filePath}\n${spot(text, errs)}`)
  }

  return {
    kind: ext === ".json" ? "json" : "jsonc",
    data,
  }
}

function sum(data: unknown) {
  if (Array.isArray(data)) {
    return {
      type: "array",
      length: data.length,
      sample: data.slice(0, 10),
      truncated: data.length > 10,
    }
  }

  if (data && typeof data === "object") {
    const keys = Object.keys(data)
    return {
      type: "object",
      keys: keys.slice(0, 100),
      truncated: keys.length > 100,
      size: keys.length,
    }
  }

  return {
    type: data === null ? "null" : typeof data,
    value: data,
  }
}

function list(data: unknown, offset: number, limit: number) {
  if (Array.isArray(data)) {
    const slice = data.slice(offset, offset + limit)
    return {
      type: "array",
      total: data.length,
      offset,
      limit,
      truncated: offset + limit < data.length,
      items: slice.map((value, index) => ({
        index: offset + index,
        summary: brief(value),
      })),
    }
  }

  if (data && typeof data === "object") {
    const entries = Object.entries(data)
    const slice = entries.slice(offset, offset + limit)
    return {
      type: "object",
      total: entries.length,
      offset,
      limit,
      truncated: offset + limit < entries.length,
      entries: slice.map(([key, value]) => ({
        key,
        summary: brief(value),
      })),
    }
  }

  throw new Error("Target is neither an array nor an object")
}

function keys(data: unknown, offset: number, limit: number) {
  if (Array.isArray(data)) {
    const entries = data.map((_, index) => index)
    return {
      type: "array",
      total: entries.length,
      offset,
      limit,
      truncated: offset + limit < entries.length,
      keys: entries.slice(offset, offset + limit),
    }
  }

  if (data && typeof data === "object") {
    const entries = Object.keys(data)
    return {
      type: "object",
      total: entries.length,
      offset,
      limit,
      truncated: offset + limit < entries.length,
      keys: entries.slice(offset, offset + limit),
    }
  }

  throw new Error("Target is neither an array nor an object")
}

function compile(input: { pattern: string; match: "literal" | "regex"; case_sensitive: boolean }) {
  const source = input.match === "literal" ? input.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : input.pattern
  return new RegExp(source, input.case_sensitive ? "" : "i")
}

function search(
  data: unknown,
  input: {
    pattern: string
    match: "literal" | "regex"
    case_sensitive: boolean
    scope: "keys" | "values" | "both"
    limit: number
    pointer?: string
  },
) {
  const reg = compile(input)
  const out: Array<{
    pointer: string
    kind: "key" | "value"
    key?: string
    summary: unknown
  }> = []
  const queue: Array<{ value: unknown; pointer: string }> = [{ value: data, pointer: input.pointer ?? "" }]

  while (queue.length > 0 && out.length < input.limit) {
    const item = queue.shift()!
    if (Array.isArray(item.value)) {
      for (const [index, value] of item.value.entries()) {
        const pointer = `${item.pointer}/${index}`
        if (input.scope !== "keys") {
          const text = typeof value === "string" ? value : JSON.stringify(brief(value))
          if (text && reg.test(text)) {
            out.push({
              pointer,
              kind: "value",
              summary: brief(value),
            })
            if (out.length >= input.limit) break
          }
        }
        if (value && typeof value === "object") queue.push({ value, pointer })
      }
      continue
    }

    if (!item.value || typeof item.value !== "object") continue

    for (const [key, value] of Object.entries(item.value)) {
      const pointer = `${item.pointer}/${key}`
      if (input.scope !== "values" && reg.test(key)) {
        out.push({
          pointer,
          kind: "key",
          key,
          summary: brief(value),
        })
        if (out.length >= input.limit) break
      }

      if (input.scope !== "keys") {
        const text = typeof value === "string" ? value : JSON.stringify(brief(value))
        if (text && reg.test(text)) {
          out.push({
            pointer,
            kind: "value",
            key,
            summary: brief(value),
          })
          if (out.length >= input.limit) break
        }
      }

      if (value && typeof value === "object") queue.push({ value, pointer })
    }
  }

  return {
    pattern: input.pattern,
    scope: input.scope,
    matches: out,
    truncated: out.length >= input.limit,
  }
}

export const DataQueryTool = Tool.define("data_query", {
  description: DESCRIPTION,
  parameters: z
    .object({
      filePath: z
        .string()
        .describe(
          "Absolute or relative path to a structured data file (.json, .jsonc, or .toml). Use inspect(action=file) for code or text files.",
        ),
      pointer: z
        .string()
        .optional()
        .describe("Optional JSON Pointer path used to narrow the target location inside the document."),
      mode: z
        .enum(["summary", "get", "keys", "entries", "slice", "search"])
        .optional()
        .describe(
          "Query mode. Defaults to summary at root, get when pointer is given, or search when pattern is given.",
        ),
      offset: z.coerce.number().int().min(0).default(0).describe("Offset for keys, entries, or array slices."),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(200)
        .default(50)
        .describe("Maximum number of returned items or matches."),
      pattern: z.string().optional().describe("Search pattern for search mode."),
      match: z.enum(["literal", "regex"]).default("literal").describe("How to interpret the search pattern."),
      case_sensitive: z.boolean().default(false).describe("Whether searching should be case sensitive."),
      scope: z
        .enum(["keys", "values", "both"])
        .default("both")
        .describe("Whether search mode should match keys, values, or both."),
    })
    .superRefine((input, ctx) => {
      const mode = input.mode ?? (input.pattern ? "search" : input.pointer ? "get" : "summary")
      if (mode === "search" && !input.pattern) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "pattern is required when mode is search",
          path: ["pattern"],
        })
      }
    }),
  async execute(input, ctx) {
    const filePath = await file(input.filePath, ctx)
    const doc = await load(filePath)
    const mode = input.mode ?? (input.pattern ? "search" : input.pointer ? "get" : "summary")
    const data = input.pointer ? at(doc.data, input.pointer) : doc.data
    if (mode === "slice" && !Array.isArray(data)) throw new Error("slice mode requires the target to be an array")
    const value =
      mode === "summary"
        ? sum(data)
        : mode === "get"
          ? data
          : mode === "keys"
            ? keys(data, input.offset, input.limit)
            : mode === "entries" || mode === "slice"
              ? list(data, input.offset, input.limit)
              : search(data, {
                  pattern: input.pattern!,
                  match: input.match,
                  case_sensitive: input.case_sensitive,
                  scope: input.scope,
                  limit: input.limit,
                  pointer: input.pointer,
                })
    return {
      title: title(filePath),
      metadata: {
        format: doc.kind,
        pointer: input.pointer,
        mode,
      },
      output: pretty({
        format: doc.kind,
        filePath,
        pointer: input.pointer ?? null,
        mode,
        target: kind(data),
        value,
      }),
    }
  },
})
