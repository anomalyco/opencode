import matter from "gray-matter"
import z from "zod"
import { Tool } from "@/tool/shared/tool"
import { Filesystem } from "@/util/filesystem"
import { file, pretty, title } from "./common"

const DESCRIPTION = `Read Markdown structurally by outline, section, search, or frontmatter.

Use this when heading-aware extraction is better than raw line reads.`

type Meta = {
  headings: number
  mode: string
  heading?: string
  line?: number
  matches?: number
}

const parameters = z
  .object({
    filePath: z.string().describe("Absolute or relative path to a Markdown file."),
    mode: z
      .enum(["outline", "section", "search", "frontmatter"])
      .optional()
      .describe(
        "Markdown query mode. Defaults to section when heading is set, search when pattern is set, frontmatter when pointer is set, or outline otherwise.",
      ),
    heading: z.string().optional().describe("Heading text to extract in section mode."),
    occurrence: z.coerce
      .number()
      .int()
      .min(1)
      .default(1)
      .describe("Which matching heading occurrence to use when the same heading appears multiple times."),
    pattern: z.string().optional().describe("Search pattern for heading search mode."),
    match: z.enum(["literal", "regex"]).default("literal").describe("How to interpret the search pattern."),
    case_sensitive: z.boolean().default(false).describe("Whether heading search should be case sensitive."),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .default(50)
      .describe("Maximum number of headings or matches to return."),
    max_level: z.coerce.number().int().min(1).max(6).optional().describe("Optional maximum heading level filter."),
    pointer: z.string().optional().describe("Optional JSON Pointer path into frontmatter in frontmatter mode."),
  })
  .superRefine((input, ctx) => {
    const mode =
      input.mode ?? (input.heading ? "section" : input.pattern ? "search" : input.pointer ? "frontmatter" : "outline")
    if (mode === "section" && !input.heading) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "heading is required when mode is section",
        path: ["heading"],
      })
    }
    if (mode === "search" && !input.pattern) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "pattern is required when mode is search",
        path: ["pattern"],
      })
    }
  })

type Head = {
  text: string
  norm: string
  level: number
  line: number
  path: string[]
}

function norm(text: string) {
  return text
    .trim()
    .replace(/\{#.*\}$/, "")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
}

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
  for (const item of ptr(pointer)) {
    if (Array.isArray(cur)) {
      const idx = Number(item)
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length)
        throw new Error(`Array index out of range at /${item}`)
      cur = cur[idx]
      continue
    }
    if (cur && typeof cur === "object") {
      if (!(item in cur)) throw new Error(`Missing key '${item}' in frontmatter`)
      cur = (cur as Record<string, unknown>)[item]
      continue
    }
    throw new Error(`Cannot descend into ${typeof cur}`)
  }
  return cur
}

function compile(input: { pattern: string; match: "literal" | "regex"; case_sensitive: boolean }) {
  const source = input.match === "literal" ? input.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : input.pattern
  return new RegExp(source, input.case_sensitive ? "" : "i")
}

function heads(text: string) {
  const rows = text.split(/\r?\n/)
  const out: Head[] = []
  let fence = ""
  let front = rows[0]?.trim() === "---"
  const stack: string[] = []

  for (const [idx, raw] of rows.entries()) {
    const line = raw.trimStart()

    if (front) {
      if (idx > 0 && line === "---") front = false
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
    stack.splice(head[1].length - 1)
    stack[head[1].length - 1] = head[2].trim()
    out.push({
      text: head[2].trim(),
      norm: norm(head[2]),
      level: head[1].length,
      line: idx + 1,
      path: stack.filter(Boolean),
    })
  }

  return {
    rows,
    out,
  }
}

export const MarkdownReadTool = Tool.define<typeof parameters, Meta>("markdown_read", {
  description: DESCRIPTION,
  parameters,
  async execute(input, ctx) {
    const filePath = await file(input.filePath, ctx)
    const text = await Filesystem.readText(filePath)
    const data = heads(text)
    const mode =
      input.mode ?? (input.heading ? "section" : input.pattern ? "search" : input.pointer ? "frontmatter" : "outline")

    if (mode === "frontmatter") {
      const md = matter(text)
      const value = input.pointer ? at(md.data, input.pointer) : md.data
      return {
        title: title(filePath),
        metadata: {
          headings: data.out.length,
          mode,
        },
        output: pretty({
          filePath,
          frontmatter: value,
          pointer: input.pointer ?? null,
        }),
      }
    }

    if (mode === "outline") {
      const out = data.out.filter((item) => !input.max_level || item.level <= input.max_level).slice(0, input.limit)
      return {
        title: title(filePath),
        metadata: {
          headings: data.out.length,
          mode,
          matches: out.length,
        },
        output: pretty({
          filePath,
          headings: out.map((item) => ({ line: item.line, level: item.level, text: item.text, path: item.path })),
          truncated: out.length < data.out.filter((item) => !input.max_level || item.level <= input.max_level).length,
        }),
      }
    }

    if (mode === "search") {
      const reg = compile({ pattern: input.pattern!, match: input.match, case_sensitive: input.case_sensitive })
      const out = data.out
        .filter((item) => (!input.max_level || item.level <= input.max_level) && reg.test(item.text))
        .slice(0, input.limit)
      return {
        title: title(filePath),
        metadata: {
          headings: data.out.length,
          mode,
          matches: out.length,
        },
        output: pretty({
          filePath,
          pattern: input.pattern,
          matches: out.map((item) => ({ line: item.line, level: item.level, text: item.text, path: item.path })),
        }),
      }
    }

    const wanted = norm(input.heading!)
    const picks = data.out.filter((item) => item.norm === wanted)
    const head = picks[input.occurrence - 1]

    if (!head) {
      throw new Error(
        `Heading not found: ${input.heading}. Available headings: ${data.out
          .slice(0, 30)
          .map((item) => item.text)
          .join(", ")}`,
      )
    }

    const start = head.line - 1
    const next = data.out.find((item) => item.line > head.line && item.level <= head.level)
    const end = next ? next.line - 1 : data.rows.length

    return {
      title: title(filePath),
      metadata: {
        headings: data.out.length,
        mode,
        heading: head.text,
        line: head.line,
        matches: picks.length,
      },
      output: pretty({
        filePath,
        heading: head.text,
        line: head.line,
        level: head.level,
        path: head.path,
        children: data.out
          .filter((item) => item.line > head.line && item.line < end + 1 && item.level > head.level)
          .map((item) => ({ line: item.line, level: item.level, text: item.text, path: item.path })),
        section: data.rows.slice(start, end).join("\n"),
      }),
    }
  },
})
