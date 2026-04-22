import matter from "gray-matter"
import z from "zod"
import type { Tool } from "@/tool/shared/tool"
import { at, arr, drop, load, obj, put, save } from "./common"

export const frontmatterEditParameters = z
  .object({
    filePath: z.string().describe("Absolute or relative path to a Markdown file."),
    pointer: z.string().optional().describe("JSON Pointer path within the frontmatter, such as /title or /owner/team."),
    action: z
      .enum(["set", "delete", "merge", "append", "prepend", "insert", "replace", "create"])
      .describe("Frontmatter edit operation to perform."),
    value: z.unknown().optional().describe("Value to write when action is set."),
    index: z.coerce.number().int().min(0).optional().describe("Array index to use when action is insert."),
  })
  .superRefine((input, ctx) => {
    if (["set", "merge", "append", "prepend", "insert", "replace", "create"].includes(input.action) && input.value === undefined) {
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

export async function executeFrontmatterEdit(input: z.infer<typeof frontmatterEditParameters>, ctx: Tool.Context) {
  const doc = await load(input.filePath, ctx)
  const md = matter(doc.text)
  const data = structuredClone(md.data)
  const action = input.action === "replace" || input.action === "create" ? "set" : input.action

  if (action === "delete") {
    at(data, input.pointer)
    drop(data, input.pointer)
    return save(doc.file, matter.stringify(md.content, data), ctx, `Deleted frontmatter at ${input.pointer ?? "/"}.`)
  }

  if (action === "set") {
    put(data, input.pointer, input.value)
    return save(doc.file, matter.stringify(md.content, data), ctx, `Updated frontmatter at ${input.pointer ?? "/"}.`)
  }

  if (action === "merge") {
    if (!obj(input.value)) throw new Error("merge requires an object value")
    let hit: unknown
    try {
      hit = input.pointer ? at(data, input.pointer) : data
    } catch {
      hit = undefined
    }
    if (hit === undefined) {
      put(data, input.pointer, input.value)
      return save(doc.file, matter.stringify(md.content, data), ctx, `Merged frontmatter at ${input.pointer ?? "/"}.`)
    }
    if (!obj(hit)) throw new Error(`Target at ${input.pointer ?? "/"} is not an object`)
    Object.assign(hit, input.value as Record<string, unknown>)
    return save(doc.file, matter.stringify(md.content, data), ctx, `Merged frontmatter at ${input.pointer ?? "/"}.`)
  }

  let hit: unknown
  try {
    hit = input.pointer ? at(data, input.pointer) : data
  } catch {
    hit = undefined
  }
  if (hit === undefined) {
    put(data, input.pointer, [])
    hit = input.pointer ? at(data, input.pointer) : data
  }
  const list = arr({ root: hit }, "/root")
  const idx = action === "append" ? list.length : action === "prepend" ? 0 : input.index!
  if (idx > list.length) throw new Error(`Array index out of range at ${input.pointer ?? "/"}`)
  list.splice(idx, 0, input.value)
  return save(
    doc.file,
    matter.stringify(md.content, data),
    ctx,
    `${action}ed frontmatter at ${input.pointer ?? "/"}.`,
  )
}
