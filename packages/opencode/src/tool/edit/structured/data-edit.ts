import {
  applyEdits,
  modify,
  parse as parseJsonc,
  printParseErrorCode,
  type ParseError as JsoncParseError,
} from "jsonc-parser"
import z from "zod"
import type { Tool } from "@/tool/shared/tool"
import { at, arr, load, obj, ptr, save } from "./common"

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

function parse(text: string, file: string) {
  const errs: JsoncParseError[] = []
  const data = parseJsonc(text, errs, { allowTrailingComma: true })
  if (errs.length) throw new Error(`Failed to parse structured data in ${file}\n${spot(text, errs)}`)
  return data
}

function path(root: unknown, pointer?: string) {
  let cur = root
  return ptr(pointer).map((item) => {
    if (Array.isArray(cur)) {
      const idx = Number(item)
      if (!Number.isInteger(idx)) throw new Error(`Pointer segment '${item}' is not a valid array index`)
      cur = cur[idx]
      return idx
    }

    if (cur && typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[item]
    }
    return item
  })
}

function patch(text: string, path: (string | number)[], value: unknown) {
  return applyEdits(
    text,
    modify(text, path, value, {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
      },
    }),
  )
}

export const dataEditParameters = z
  .object({
    filePath: z.string().describe("Absolute or relative path to a JSON or JSONC file."),
    pointer: z.string().optional().describe("JSON Pointer path such as /scripts/build or /references/0/path."),
    action: z
      .enum(["set", "delete", "merge", "append", "prepend", "insert"])
      .describe("Structured edit operation to perform."),
    value: z.unknown().optional().describe("Value to write when action is set."),
    index: z.coerce.number().int().min(0).optional().describe("Array index to use when action is insert."),
    create: z.boolean().optional().describe("Create the file with an empty JSON object if it does not exist yet."),
  })
  .superRefine((input, ctx) => {
    if (["set", "merge", "append", "prepend", "insert"].includes(input.action) && input.value === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `value is required when action is ${input.action}`,
        path: ["value"],
      })
    }
    if (input.action === "insert" && input.index === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "index is required when action is insert",
        path: ["index"],
      })
    }
  })

export async function executeDataEdit(input: z.infer<typeof dataEditParameters>, ctx: Tool.Context) {
  const ext = input.filePath.toLowerCase()
  if (!ext.endsWith(".json") && !ext.endsWith(".jsonc")) {
    throw new Error("Structured data edits support only .json and .jsonc files")
  }

  const doc = await load(input.filePath, ctx, input.create ? "{}\n" : undefined)
  const root = parse(doc.text, doc.file)
  if (input.action === "delete" && (!input.pointer || input.pointer === "")) {
    throw new Error("Deleting the document root is not supported")
  }
  const base = path(root, input.pointer)

  if (input.action === "delete") {
    at(root, input.pointer)
    return save(doc.file, patch(doc.text, base, undefined), ctx, `Deleted structured data at ${input.pointer ?? "/"}.`)
  }

  if (input.action === "set") {
    return save(
      doc.file,
      patch(doc.text, base, input.value),
      ctx,
      `Updated structured data at ${input.pointer ?? "/"}.`,
    )
  }

  if (input.action === "merge") {
    if (!obj(input.value)) throw new Error("merge requires an object value")
    let next = doc.text
    let hit: unknown
    try {
      hit = input.pointer ? at(root, input.pointer) : root
    } catch {
      hit = undefined
    }
    if (hit === undefined) {
      return save(
        doc.file,
        patch(doc.text, base, input.value),
        ctx,
        `Merged structured data at ${input.pointer ?? "/"}.`,
      )
    }
    if (!obj(hit)) throw new Error(`Target at ${input.pointer ?? "/"} is not an object`)
    for (const [key, value] of Object.entries(input.value as Record<string, unknown>)) {
      next = patch(next, [...base, key], value)
    }
    return save(doc.file, next, ctx, `Merged structured data at ${input.pointer ?? "/"}.`)
  }

  let next = doc.text
  let data = root
  let hit: unknown
  try {
    hit = input.pointer ? at(data, input.pointer) : data
  } catch {
    hit = undefined
  }
  if (hit === undefined) {
    next = patch(next, base, [])
    data = parse(next, doc.file)
    hit = input.pointer ? at(data, input.pointer) : data
  }
  const list = arr(data, input.pointer)
  const idx = input.action === "append" ? list.length : input.action === "prepend" ? 0 : input.index!
  if (idx > list.length) throw new Error(`Array index out of range at ${input.pointer ?? "/"}`)
  return save(
    doc.file,
    patch(next, [...path(data, input.pointer), idx], input.value),
    ctx,
    `${input.action}ed structured data at ${input.pointer ?? "/"}.`,
  )
}
