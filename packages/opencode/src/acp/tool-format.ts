import { isAbsolute, resolve } from "path"
import type { ToolCallContent, ToolKind } from "@agentclientprotocol/sdk"

export interface ToolCallInfo {
  title: string
  kind: ToolKind
  content: ToolCallContent[]
  locations: { path: string; line?: number }[]
  rawInput: unknown
}

export interface ToolResultInfo {
  content: ToolCallContent[]
  rawOutput: unknown
}

type ToolResultAttachment = { mime: string; url: string } & Record<string, unknown>

interface ToolResultOptions {
  metadata?: unknown
  attachments?: ToolResultAttachment[]
}

const FENCE_RE = /^`{3,}/gm

function normalize(name: string): string {
  return name.toLowerCase().replace(/^mcp__acp__/, "")
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.substring(0, max - 3) + "..." : str
}

export function fenceWith(text: string, lang: string): string {
  if (!text) return text
  let fence = "```"
  for (const match of text.matchAll(FENCE_RE)) {
    while (match[0].length >= fence.length) fence += "`"
  }
  const trimmed = text.replace(/\n+$/, "")
  return `${fence}${lang}\n${trimmed}\n${fence}`
}

function textContent(text: string): ToolCallContent {
  return { type: "content", content: { type: "text", text } }
}

function diffContent(path: string, oldText: string | null, newText: string): ToolCallContent {
  return { type: "diff", path, oldText, newText }
}

function imageContents(attachments: ToolResultAttachment[] | undefined): ToolCallContent[] {
  return (attachments ?? []).flatMap((attachment): ToolCallContent[] => {
    const match = attachment.url.match(/^data:([^;,]+)(?:;[^,]*)*;base64,(.*)$/)
    const mime = match?.[1] ?? attachment.mime
    if (!mime.startsWith("image/")) return []
    const data = match?.[2]
    if (data === undefined) return []
    return [
      {
        type: "content",
        content: {
          type: "image",
          mimeType: mime,
          data,
        },
      },
    ]
  })
}

function withImages(content: ToolCallContent[], options?: ToolResultOptions): ToolCallContent[] {
  const images = imageContents(options?.attachments)
  if (!images.length) return content
  return [...content, ...images]
}

function rawOutputWithOptions(rawOutput: unknown, options?: ToolResultOptions): unknown {
  if (options?.metadata === undefined && !options?.attachments?.length) return rawOutput
  return {
    ...((rawOutput !== null && typeof rawOutput === "object" && !Array.isArray(rawOutput)
      ? rawOutput
      : { value: rawOutput }) as Record<string, unknown>),
    ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
    ...(options.attachments?.length ? { attachments: options.attachments } : {}),
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : ""
}

type ReadTruncation =
  | { kind: "end"; total: number }
  | { kind: "more"; from: number; to: number; total: number; next: number }
  | { kind: "cut"; from: number; to: number; maxBytes: string; next: number }
  | { kind: "dir_partial"; shown: number; total: number; next: number }
  | { kind: "dir_full"; total: number }

interface ParsedReadOutput {
  path: string
  type: "file" | "directory"
  content: string
  truncation?: ReadTruncation
  systemReminder?: string
}

const FILE_FOOTER_END = /\n\n\(End of file - total (\d+) lines\)$/
const FILE_FOOTER_MORE = /\n\n\(Showing lines (\d+)-(\d+) of (\d+)\. Use offset=(\d+) to continue\.\)$/
const FILE_FOOTER_CUT = /\n\n\(Output capped at (.+?)\. Showing lines (\d+)-(\d+)\. Use offset=(\d+) to continue\.\)$/
const DIR_FOOTER_PARTIAL = /\n\(Showing (\d+) of (\d+) entries\. Use 'offset' parameter to read beyond entry (\d+)\)$/
const DIR_FOOTER_FULL = /\n\((\d+) entries\)$/
const SYSTEM_REMINDER_RE = /^\n\n<system-reminder>\n([\s\S]*)\n<\/system-reminder>$/

interface ParsedSkillOutput {
  name: string
  markdown: string
  baseDir: string
  files: string[]
}

interface ParsedTaskOutput {
  taskId: string
  result: string
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function parseSkillOutput(output: string): ParsedSkillOutput | null {
  try {
    const open = output.match(/^<skill_content name="([^"]*)">\n/)
    if (!open) return null
    const name = open[1]
    const close = "\n</skill_content>"
    if (!output.endsWith(close)) return null
    const body = output.slice(open[0].length, output.length - close.length)

    const headerRe = new RegExp(`^# Skill: ${escapeRegExp(name)}\\n\\n`)
    const header = body.match(headerRe)
    if (!header) return null
    const afterHeader = body.slice(header[0].length)

    const skillFilesOpen = "\n\n<skill_files>\n"
    const skillFilesClose = "\n</skill_files>"
    const openIdx = afterHeader.lastIndexOf(skillFilesOpen)
    if (openIdx < 0) return null
    if (!afterHeader.endsWith(skillFilesClose)) return null
    const preFiles = afterHeader.slice(0, openIdx)
    const filesBlock = afterHeader.slice(openIdx + skillFilesOpen.length, afterHeader.length - skillFilesClose.length)

    const preambleRe =
      /\n\nBase directory for this skill: (\S+)\nRelative paths in this skill \(e\.g\., scripts\/, reference\/\) are relative to this base directory\.\nNote: file list is sampled\.$/
    const preamble = preFiles.match(preambleRe)
    if (!preamble) return null
    const markdown = preFiles.slice(0, preFiles.length - preamble[0].length)
    const baseDir = preamble[1]

    let files: string[] = []
    if (filesBlock !== "") {
      files = filesBlock.split("\n").map((line) => {
        const m = line.match(/^<file>(.*)<\/file>$/)
        if (!m) throw new Error("bad file line")
        return m[1]
      })
    }

    return { name, markdown, baseDir, files }
  } catch {
    return null
  }
}

export function parseTaskOutput(output: string): ParsedTaskOutput | null {
  try {
    const m = output.match(
      /^task_id: (\S+) \(for resuming to continue this task if needed\)\n\n<task_result>\n([\s\S]*)\n<\/task_result>$/,
    )
    if (!m) return null
    return { taskId: m[1], result: m[2] }
  } catch {
    return null
  }
}

export function parseReadOutput(output: string): ParsedReadOutput | null {
  try {
    const envelope = output.match(/^<path>([^\n]*)<\/path>\n<type>(file|directory)<\/type>\n/)
    if (!envelope) return null
    const path = envelope[1]
    const type = envelope[2] as "file" | "directory"
    const afterEnvelope = output.slice(envelope[0].length)

    const openTag = type === "file" ? "<content>\n" : "<entries>\n"
    const closeTag = type === "file" ? "\n</content>" : "\n</entries>"
    if (!afterEnvelope.startsWith(openTag)) return null
    const bodyStart = openTag.length
    const closeIdx = afterEnvelope.lastIndexOf(closeTag)
    if (closeIdx < bodyStart) return null

    const body = afterEnvelope.slice(bodyStart, closeIdx)
    const afterClose = afterEnvelope.slice(closeIdx + closeTag.length)

    let systemReminder: string | undefined
    if (afterClose.length > 0) {
      const sr = afterClose.match(SYSTEM_REMINDER_RE)
      if (!sr) return null
      systemReminder = sr[1]
    }

    let truncation: ReadTruncation | undefined
    let content = body
    if (type === "file") {
      const end = body.match(FILE_FOOTER_END)
      const more = body.match(FILE_FOOTER_MORE)
      const cut = body.match(FILE_FOOTER_CUT)
      if (end) {
        content = body.slice(0, body.length - end[0].length)
        truncation = { kind: "end", total: Number(end[1]) }
      } else if (more) {
        content = body.slice(0, body.length - more[0].length)
        truncation = {
          kind: "more",
          from: Number(more[1]),
          to: Number(more[2]),
          total: Number(more[3]),
          next: Number(more[4]),
        }
      } else if (cut) {
        content = body.slice(0, body.length - cut[0].length)
        truncation = {
          kind: "cut",
          maxBytes: cut[1],
          from: Number(cut[2]),
          to: Number(cut[3]),
          next: Number(cut[4]),
        }
      }
    } else {
      const partial = body.match(DIR_FOOTER_PARTIAL)
      const full = body.match(DIR_FOOTER_FULL)
      if (partial) {
        content = body.slice(0, body.length - partial[0].length)
        truncation = {
          kind: "dir_partial",
          shown: Number(partial[1]),
          total: Number(partial[2]),
          next: Number(partial[3]),
        }
      } else if (full) {
        content = body.slice(0, body.length - full[0].length)
        truncation = { kind: "dir_full", total: Number(full[1]) }
      }
    }

    const result: ParsedReadOutput = { path, type, content }
    if (truncation) result.truncation = truncation
    if (systemReminder !== undefined) result.systemReminder = systemReminder
    return result
  } catch {
    return null
  }
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined
}

function abs(p: string, cwd: string): string {
  return p && !isAbsolute(p) ? resolve(cwd, p) : p
}

export function toolCallFromPart(tool: string, input: Record<string, unknown>, cwd: string): ToolCallInfo {
  const name = normalize(tool)

  switch (name) {
    case "bash": {
      const command = str(input.command)
      const description = str(input.description)
      const workdir = str(input.workdir)
      const resolvedWorkdir = workdir ? abs(workdir, cwd) : cwd
      return {
        title: description || command || "Terminal",
        kind: "other",
        content: [],
        locations: [{ path: resolvedWorkdir }],
        rawInput: workdir ? input : { ...input, cwd },
      }
    }

    case "read": {
      const filePath = str(input.filePath)
      const offset = num(input.offset) ?? 1
      const limit = num(input.limit) ?? 0
      const hasMeaningfulOffset = offset > 1
      const rangeStart = Math.max(offset, 1)
      let suffix = ""
      if (limit) {
        suffix = ` (${rangeStart} - ${rangeStart + limit - 1})`
      } else if (hasMeaningfulOffset) {
        suffix = ` (from line ${offset})`
      }
      return {
        title: filePath ? `Read ${filePath}${suffix}` : "Read File",
        kind: "read",
        content: [],
        locations: filePath ? [{ path: abs(filePath, cwd), ...(hasMeaningfulOffset ? { line: offset } : {}) }] : [],
        rawInput: input,
      }
    }

    case "list": {
      const path = str(input.path)
      return {
        title: path ? `List \`${path}\`` : "List directory",
        kind: "read",
        content: [],
        locations: path ? [{ path: abs(path, cwd) }] : [],
        rawInput: input,
      }
    }

    case "edit": {
      const filePath = str(input.filePath)
      const oldString = str(input.oldString)
      const newString = str(input.newString)
      return {
        title: filePath ? `Edit \`${filePath}\`` : "Edit",
        kind: "edit",
        content: filePath ? [diffContent(abs(filePath, cwd), oldString, newString)] : [],
        locations: filePath ? [{ path: abs(filePath, cwd) }] : [],
        rawInput: input,
      }
    }

    case "write": {
      const filePath = str(input.filePath)
      const content = str(input.content)
      return {
        title: filePath ? `Write ${filePath}` : "Write",
        kind: "edit",
        content: filePath ? [diffContent(abs(filePath, cwd), null, content)] : [],
        locations: filePath ? [{ path: abs(filePath, cwd) }] : [],
        rawInput: input,
      }
    }

    case "glob": {
      const path = str(input.path)
      const pattern = str(input.pattern)
      let label = "Find"
      if (path) label += ` \`${path}\``
      if (pattern) label += ` \`${pattern}\``
      return {
        title: label,
        kind: "search",
        content: [],
        locations: path ? [{ path: abs(path, cwd) }] : [],
        rawInput: input,
      }
    }

    case "grep": {
      const pattern = str(input.pattern)
      const path = str(input.path)
      let label = "grep"
      if (pattern) label += ` "${truncate(pattern, 30)}"`
      if (path) label += ` ${path}`
      return {
        title: label,
        kind: "search",
        content: [],
        locations: path ? [{ path: abs(path, cwd) }] : [],
        rawInput: input,
      }
    }

    case "webfetch": {
      const url = str(input.url)
      const prompt = str(input.prompt)
      return {
        title: url ? `Fetch ${truncate(url, 40)}` : "Fetch",
        kind: "fetch",
        content: prompt ? [textContent(prompt)] : [],
        locations: [],
        rawInput: input,
      }
    }

    case "websearch": {
      const query = str(input.query)
      return {
        title: query ? `"${truncate(query, 40)}"` : "Search",
        kind: "fetch",
        content: [],
        locations: [],
        rawInput: input,
      }
    }

    case "task": {
      const description = str(input.description)
      const prompt = str(input.prompt)
      return {
        title: description || "Task",
        kind: "think",
        content: prompt ? [textContent(prompt)] : [],
        locations: [],
        rawInput: input,
      }
    }

    case "todowrite":
    case "todoread": {
      return {
        title: "Update TODOs",
        kind: "think",
        content: [],
        locations: [],
        rawInput: input,
      }
    }

    case "plan_exit": {
      return {
        title: "Exit Plan Mode",
        kind: "switch_mode",
        content: [],
        locations: [],
        rawInput: input,
      }
    }

    case "plan_enter": {
      return {
        title: "Enter Plan Mode",
        kind: "switch_mode",
        content: [],
        locations: [],
        rawInput: input,
      }
    }

    case "apply_patch": {
      const patchText = str(input.patchText)
      return {
        title: "Apply Patch",
        kind: "edit",
        content: patchText ? [textContent(patchText)] : [],
        locations: [],
        rawInput: input,
      }
    }

    case "multiedit": {
      return {
        title: "Multi Edit",
        kind: "edit",
        content: [],
        locations: [],
        rawInput: input,
      }
    }

    case "batch": {
      return {
        title: "Batch",
        kind: "other",
        content: [],
        locations: [],
        rawInput: input,
      }
    }

    case "skill": {
      const skillName = str(input.name)
      return {
        title: skillName ? `Skill: ${skillName}` : "Skill",
        kind: "other",
        content: [],
        locations: [],
        rawInput: input,
      }
    }

    case "question": {
      const question = str(input.question) || str(input.query)
      return {
        title: question ? truncate(question, 40) : "Question",
        kind: "other",
        content: [],
        locations: [],
        rawInput: input,
      }
    }

    case "lsp": {
      return {
        title: "LSP",
        kind: "other",
        content: [],
        locations: [],
        rawInput: input,
      }
    }

    case "codesearch": {
      const query = str(input.query)
      return {
        title: query ? `Search: ${truncate(query, 30)}` : "Code Search",
        kind: "search",
        content: [],
        locations: [],
        rawInput: input,
      }
    }

    default: {
      const description = str(input.description)
      const command = str(input.command)
      const title = description || command || tool
      return {
        title: truncate(title, 50),
        kind: "other",
        content: [],
        locations: [],
        rawInput: input,
      }
    }
  }
}

export function toolResultFromPart(
  tool: string,
  input: Record<string, unknown>,
  output: string,
  isError: boolean,
  cwd: string,
  options?: ToolResultOptions,
): ToolResultInfo {
  const name = normalize(tool)

  if (name === "bash") {
    const text = fenceWith(output, isError ? "" : "sh")
    return {
      content: withImages([textContent(text)], options),
      rawOutput: rawOutputWithOptions(isError ? { stderr: output } : { stdout: output }, options),
    }
  }

  const content: ToolCallContent[] = [textContent(fenceWith(output, ""))]

  switch (name) {
    case "read":
    case "list": {
      if (isError) {
        return { content: withImages(content, options), rawOutput: rawOutputWithOptions({ stderr: output }, options) }
      }
      const parsed = parseReadOutput(output)
      return {
        content: withImages([], options),
        rawOutput: rawOutputWithOptions(parsed ?? { stdout: output }, options),
      }
    }

    case "skill": {
      if (isError) {
        return { content: withImages(content, options), rawOutput: rawOutputWithOptions({ stderr: output }, options) }
      }
      const parsed = parseSkillOutput(output)
      return {
        content: withImages([], options),
        rawOutput: rawOutputWithOptions(parsed ?? { stdout: output }, options),
      }
    }

    case "task": {
      if (isError) {
        return { content: withImages(content, options), rawOutput: rawOutputWithOptions({ stderr: output }, options) }
      }
      const parsed = parseTaskOutput(output)
      return {
        content: withImages([], options),
        rawOutput: rawOutputWithOptions(parsed ?? { stdout: output }, options),
      }
    }

    case "edit": {
      const filePath = str(input.filePath)
      const oldString = str(input.oldString)
      const newString = str(input.newString)
      if (filePath && !isError) {
        content.push(diffContent(abs(filePath, cwd), oldString, newString))
      }
      return {
        content: withImages(content, options),
        rawOutput: rawOutputWithOptions(isError ? { stderr: output } : { stdout: output }, options),
      }
    }

    case "apply_patch": {
      const patchText = str(input.patchText)
      if (isError) {
        return { content: withImages(content, options), rawOutput: rawOutputWithOptions({ stderr: output }, options) }
      }
      const successContent: ToolCallContent[] = patchText ? [textContent(fenceWith(patchText, "diff"))] : []
      return {
        content: withImages(successContent, options),
        rawOutput: rawOutputWithOptions({ stdout: output }, options),
      }
    }

    case "write": {
      const filePath = str(input.filePath)
      const fileContent = str(input.content)
      if (filePath && !isError) {
        content.push(diffContent(abs(filePath, cwd), null, fileContent))
      }
      return {
        content: withImages(content, options),
        rawOutput: rawOutputWithOptions(isError ? { stderr: output } : { stdout: output }, options),
      }
    }

    default: {
      return {
        content: withImages(content, options),
        rawOutput: rawOutputWithOptions(isError ? { stderr: output } : { stdout: output }, options),
      }
    }
  }
}

export function permissionDisplayInfo(
  permission: string,
  metadata: Record<string, unknown>,
  cwd: string,
): ToolCallInfo {
  const name = normalize(permission)
  switch (name) {
    case "edit":
    case "write":
    case "apply_patch": {
      const filepath = str(metadata.filepath)
      const diff = str(metadata.diff)
      return {
        title: filepath ? `Edit ${filepath}` : "Edit",
        kind: "edit",
        content: diff ? [textContent(diff)] : [],
        locations: filepath ? [{ path: abs(filepath, cwd) }] : [],
        rawInput: metadata,
      }
    }
    case "bash": {
      const command = str(metadata.command)
      const description = str(metadata.description)
      return {
        title: description || command || "Terminal",
        kind: "execute",
        content: [],
        locations: [],
        rawInput: metadata,
      }
    }
    case "webfetch": {
      const url = str(metadata.url)
      return {
        title: url ? `Fetch ${truncate(url, 40)}` : "Fetch",
        kind: "fetch",
        content: [],
        locations: [],
        rawInput: metadata,
      }
    }
    case "websearch": {
      const query = str(metadata.query)
      return {
        title: query ? `"${truncate(query, 40)}"` : "Search",
        kind: "fetch",
        content: [],
        locations: [],
        rawInput: metadata,
      }
    }
    case "task": {
      const description = str(metadata.description)
      return {
        title: description || "Task",
        kind: "think",
        content: [],
        locations: [],
        rawInput: metadata,
      }
    }
    case "skill": {
      const skillName = str(metadata.name)
      return {
        title: skillName ? `Skill: ${skillName}` : "Skill",
        kind: "other",
        content: [],
        locations: [],
        rawInput: metadata,
      }
    }
    default: {
      return {
        title: permission || "Permission",
        kind: "other",
        content: [],
        locations: [],
        rawInput: metadata,
      }
    }
  }
}
