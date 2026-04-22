import path from "path"
import z from "zod"
import { BlobReader, ZipReader } from "@zip.js/zip.js"
import { Tool } from "@/tool/shared/tool"
import { Process } from "@/util/process"
import { file, pretty, title } from "./common"

const DESCRIPTION = `List archive entries from supported archive formats without extracting them.

Supported formats include .zip, .jar, .war, .tar, .tgz, and .tar.gz. Results can be filtered with a pattern and limited in count.`

function kind(file: string) {
  const lower = file.toLowerCase()
  if ([".zip", ".jar", ".war"].some((item) => lower.endsWith(item))) return "zip"
  if ([".tar", ".tgz", ".tar.gz"].some((item) => lower.endsWith(item))) return "tar"
  throw new Error("archive_list supports .zip, .jar, .war, .tar, .tgz, and .tar.gz files")
}

function compile(input: { pattern?: string; match: "literal" | "regex"; case_sensitive: boolean }) {
  if (!input.pattern) return
  const source = input.match === "literal" ? input.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : input.pattern
  return new RegExp(source, input.case_sensitive ? "" : "i")
}

export const ArchiveListTool = Tool.define("archive_list", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("Absolute or relative path to an archive file."),
    pattern: z.string().optional().describe("Optional entry filter pattern."),
    match: z.enum(["literal", "regex"]).default("literal").describe("How to interpret the pattern filter."),
    case_sensitive: z.boolean().default(false).describe("Whether archive entry filtering should be case sensitive."),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(200)
      .describe("Maximum number of archive entries to return."),
  }),
  async execute(input, ctx) {
    const filePath = await file(input.filePath, ctx)
    const type = kind(filePath)
    const reg = compile(input)
    const names =
      type === "zip"
        ? await (async () => {
            const zip = new ZipReader(new BlobReader(new Blob([await Bun.file(filePath).arrayBuffer()])))
            try {
              return (await zip.getEntries()).map((item) => item.filename)
            } finally {
              await zip.close()
            }
          })()
        : await (async () => {
            const out = await Process.text(["tar", "-tf", filePath], { abort: ctx.abort, nothrow: true })
            if (out.code !== 0) throw new Error(`Failed to inspect tar archive: ${filePath}`)
            return out.text.split(/\r?\n/).filter(Boolean)
          })()
    const list = reg ? names.filter((item) => reg.test(item)) : names
    const out = list.slice(0, input.limit)
    return {
      title: title(filePath),
      metadata: {
        format: type,
        count: out.length,
        truncated: out.length < list.length,
      },
      output: pretty({
        filePath,
        format: type,
        total: list.length,
        truncated: out.length < list.length,
        entries: out,
      }),
    }
  },
})
