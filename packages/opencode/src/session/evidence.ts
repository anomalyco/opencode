import { Hash } from "@/util/hash"
import { Locale } from "@/util/locale"
import type { MessageV2 } from "./message-v2"

export namespace Evidence {
  const INPUT_MAX = 240
  const OUTPUT_MAX = 600
  const OUTPUT_LINES = 12
  const HASH_MAX = 12
  const FILE_MAX = 3

  export interface Tool {
    tool: string
    title: string
    input: string
    excerpt: string
    hash: string
    bytes: number
    lines: number
    path?: string
    files?: string[]
  }

  function clip(input: string) {
    return Locale.truncate(input.split("\n").slice(0, OUTPUT_LINES).join("\n"), OUTPUT_MAX)
  }

  function files(input?: MessageV2.ToolStateCompleted["attachments"]) {
    if (!input?.length) return undefined
    const list = input.map((item) => item.filename ?? item.mime)
    if (list.length <= FILE_MAX) return list
    return [...list.slice(0, FILE_MAX), `+${list.length - FILE_MAX} more`]
  }

  function path(input?: MessageV2.ToolStateCompleted["metadata"]) {
    return typeof input?.outputPath === "string" ? input.outputPath : undefined
  }

  export function tool(input: {
    tool: string
    state: Pick<MessageV2.ToolStateCompleted, "title" | "input" | "output" | "metadata" | "attachments">
  }): Tool {
    const data = JSON.stringify(input.state.input)
    return {
      tool: input.tool,
      title: input.state.title,
      input: Locale.truncate(data === undefined ? "{}" : data, INPUT_MAX),
      excerpt: clip(input.state.output),
      hash: Hash.fast(input.state.output).slice(0, HASH_MAX),
      bytes: Buffer.byteLength(input.state.output, "utf-8"),
      lines: input.state.output.split("\n").length,
      path: path(input.state.metadata),
      files: files(input.state.attachments),
    }
  }

  export function isTool(input: unknown): input is Tool {
    if (!input || typeof input !== "object") return false
    return (
      "tool" in input &&
      typeof input.tool === "string" &&
      "title" in input &&
      typeof input.title === "string" &&
      "input" in input &&
      typeof input.input === "string" &&
      "excerpt" in input &&
      typeof input.excerpt === "string" &&
      "hash" in input &&
      typeof input.hash === "string" &&
      "bytes" in input &&
      typeof input.bytes === "number" &&
      "lines" in input &&
      typeof input.lines === "number"
    )
  }

  export function text(input: Tool) {
    return [
      "[Compacted tool result]",
      `tool: ${input.tool}`,
      `title: ${input.title}`,
      `input: ${input.input}`,
      `proof: sha1=${input.hash}, bytes=${input.bytes}, lines=${input.lines}`,
      ...(input.path ? [`path: ${input.path}`] : []),
      ...(input.files?.length ? [`attachments: ${input.files.join(", ")}`] : []),
      "excerpt:",
      input.excerpt,
    ].join("\n")
  }
}
