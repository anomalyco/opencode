import z from "zod"
import type { Tool } from "@/tool/shared/tool"
import { load, save } from "./common"

type Head = {
  text: string
  norm: string
  level: number
  line: number
}

function norm(text: string) {
  return text
    .trim()
    .replace(/\{#.*\}$/, "")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
}

function heads(text: string) {
  const rows = text.split(/\r?\n/)
  const out: Head[] = []
  let fence = ""
  let front = rows[0]?.trim() === "---"
  let skip = 0

  for (const [idx, raw] of rows.entries()) {
    const line = raw.trimStart()

    if (front) {
      if (idx > 0 && line === "---") {
        front = false
        skip = idx + 1
      }
      continue
    }

    const hit = line.match(/^(```+|~~~+)/)
    if (hit) {
      const mark = hit[1]
      if (!fence) {
        fence = mark[0]
        continue
      }
      if (fence === mark[0]) {
        fence = ""
        continue
      }
    }

    if (fence) continue

    const head = raw.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (!head) continue
    out.push({
      text: head[2].trim(),
      norm: norm(head[2]),
      level: head[1].length,
      line: idx + 1,
    })
  }

  return {
    rows,
    out,
    skip,
  }
}

function body(text: string) {
  const clean = text.replace(/^\n+/, "").replace(/\s+$/, "")
  return clean ? `\n\n${clean}\n` : "\n"
}

export const markdownEditParameters = z
  .object({
    filePath: z.string().describe("Absolute or relative path to a Markdown file."),
    heading: z.string().describe("Heading text to target."),
    content: z.string().optional().describe("Markdown content for the section body."),
    action: z
      .enum(["replace", "append", "prepend", "delete", "create"])
      .default("replace")
      .describe("Section edit operation to perform."),
    create: z
      .boolean()
      .optional()
      .describe("Create the section when action is replace, append, or prepend and the heading does not exist."),
    position: z
      .enum(["end", "start", "before", "after"])
      .default("end")
      .describe("Where to place a newly created section."),
    anchor: z.string().optional().describe("Anchor heading used when position is before or after."),
    level: z.coerce
      .number()
      .int()
      .min(1)
      .max(6)
      .default(2)
      .describe("Heading level to use when creating a new section."),
    occurrence: z.coerce.number().int().min(1).default(1).describe("Which matching heading occurrence to update."),
    anchor_occurrence: z.coerce
      .number()
      .int()
      .min(1)
      .default(1)
      .describe("Which matching anchor occurrence to use when creating relative to another heading."),
  })
  .superRefine((input, ctx) => {
    if (["replace", "append", "prepend", "create"].includes(input.action) && input.content === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `content is required when action is ${input.action}`,
        path: ["content"],
      })
    }
    if (["before", "after"].includes(input.position) && !input.anchor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "anchor is required when position is before or after",
        path: ["anchor"],
      })
    }
  })

export async function executeMarkdownEdit(input: z.infer<typeof markdownEditParameters>, ctx: Tool.Context) {
  const doc = await load(input.filePath, ctx)
  const data = heads(doc.text)
  const wanted = norm(input.heading)
  const picks = data.out.filter((item) => item.norm === wanted)
  const hit = picks[input.occurrence - 1]

  if (!hit) {
    if (!(input.action === "create" || input.create)) {
      throw new Error(
        `Heading not found: ${input.heading}. Available headings: ${data.out
          .slice(0, 30)
          .map((item) => item.text)
          .join(", ")}`,
      )
    }

    const head = `${"#".repeat(input.level)} ${input.heading}`
    const section = `${head}${body(input.content ?? "")}`.replace(/\n$/, "")
    let next = doc.text.trimEnd()
    if (input.position === "start") {
      const before = data.rows.slice(0, data.skip).join("\n")
      const after = data.rows.slice(data.skip).join("\n").trimStart()
      next = [before, section, after].filter(Boolean).join("\n\n")
    }
    if (input.position === "end") {
      next = next ? `${next}\n\n${section}` : section
    }
    if (input.position === "before" || input.position === "after") {
      const anchor = data.out.filter((item) => item.norm === norm(input.anchor!))[input.anchor_occurrence - 1]
      if (!anchor) throw new Error(`Anchor heading not found: ${input.anchor}`)
      const idx =
        input.position === "before"
          ? anchor.line - 1
          : (data.out.find((item) => item.line > anchor.line && item.level <= anchor.level)?.line ??
              data.rows.length + 1) - 1
      const rows = [...data.rows.slice(0, idx), ...section.split("\n"), "", ...data.rows.slice(idx)]
      next = rows.join("\n").replace(/\n{3,}/g, "\n\n")
    }
    return save(doc.file, next, ctx, `Created Markdown section '${input.heading}'.`)
  }

  if (input.action === "create") {
    throw new Error(`Heading already exists: ${hit.text}`)
  }

  const start = hit.line - 1
  const next = data.out.find((item) => item.line > hit.line && item.level <= hit.level)
  const end = next ? next.line - 1 : data.rows.length
  const head = data.rows[start]
  const cur = data.rows.slice(start, end).join("\n")
  if (input.action === "delete") {
    const rows = [...data.rows.slice(0, start), ...data.rows.slice(end)]
    return save(
      doc.file,
      rows
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trimEnd() + "\n",
      ctx,
      `Deleted Markdown section '${hit.text}'.`,
    )
  }

  const section =
    input.action === "append"
      ? `${cur.replace(/\s+$/, "")}${body(input.content ?? "")}`
      : input.action === "prepend"
        ? `${head}${body(input.content ?? "").trim()}${cur.slice(head.length).replace(/^\n*/, "\n\n")}`
        : `${head}${body(input.content ?? "")}`

  const rows = [...data.rows.slice(0, start), ...section.replace(/\n$/, "").split("\n"), ...data.rows.slice(end)]
  return save(doc.file, rows.join("\n"), ctx, `Updated Markdown section '${hit.text}'.`)
}
