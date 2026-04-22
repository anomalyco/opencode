import type { ToolCallContent, ToolKind } from "@agentclientprotocol/sdk"
import { ParseCommand } from "./parse-command"

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
  title?: string
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/^mcp__acp__/, "")
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.substring(0, max - 3) + "..." : str
}

function markdownEscape(text: string): string {
  let fence = "```"
  for (const match of text.matchAll(/^`{3,}/gm)) {
    while (match[0].length >= fence.length) fence += "`"
  }
  return fence + "\n" + text + (text.endsWith("\n") ? "" : "\n") + fence
}

function textContent(text: string): ToolCallContent {
  return { type: "content", content: { type: "text", text } }
}

function diffContent(path: string, oldText: string | null, newText: string): ToolCallContent {
  return { type: "diff", path, oldText, newText }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : ""
}

function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined
}

function getFilePath(input: Record<string, unknown>): string {
  return str(input.filePath ?? input.file_path ?? input.filepath ?? input.path)
}

function getOldString(input: Record<string, unknown>): string {
  return str(input.oldString ?? input.old_string)
}

function getNewString(input: Record<string, unknown>): string {
  return str(input.newString ?? input.new_string ?? input.content ?? input.new_content)
}

function getCommand(input: Record<string, unknown>): string {
  return str(input.command ?? input.cmd)
}

function getDescription(input: Record<string, unknown>): string {
  return str(input.description ?? input.desc)
}

function getPattern(input: Record<string, unknown>): string {
  return str(input.pattern ?? input.filePattern ?? input.glob)
}

function getQuery(input: Record<string, unknown>): string {
  return str(input.query ?? input.q)
}

function getUrl(input: Record<string, unknown>): string {
  return str(input.url ?? input.uri)
}

function getDiff(input: Record<string, unknown>): string {
  return str(input.diff ?? input.patch ?? input.unifiedDiff)
}

import { resolve } from "path"

function abs(p: string): string {
  return p && !p.startsWith("/") ? resolve(p) : p
}

export function toolCallFromPart(tool: string, input: Record<string, unknown>): ToolCallInfo {
  const name = normalize(tool)

  switch (name) {
    case "bash":
    case "shell":
    case "terminal": {
      const command = getCommand(input)
      const description = getDescription(input)
      const cwd = str(input.cwd ?? input.workdir ?? input.workingDir ?? input.directory)
      const result = ParseCommand.format(command, description, cwd)
      return {
        title: result.title,
        kind: result.kind,
        content: [],
        locations: result.locations,
        rawInput: input,
      }
    }

    case "bashoutput": {
      return {
        title: "Tail Logs",
        kind: "execute",
        content: [],
        locations: [],
        rawInput: input,
      }
    }

    case "read":
    case "view": {
      const filePath = getFilePath(input)
      const offset = num(input.offset) ?? num(input.line) ?? 0
      const limit = num(input.limit) ?? 0
      let suffix = ""
      if (limit) {
        suffix = ` (${offset + 1} - ${offset + limit})`
      } else if (offset) {
        suffix = ` (from line ${offset + 1})`
      }
      return {
        title: filePath ? `Read ${filePath}${suffix}` : "Read File",
        kind: "read",
        content: [],
        locations: filePath ? [{ path: abs(filePath), ...(offset ? { line: offset + 1 } : {}) }] : [],
        rawInput: input,
      }
    }

    case "list":
    case "ls": {
      const path = str(input.path)
      return {
        title: path ? `List \`${path}\`` : "List directory",
        kind: "read",
        content: [],
        locations: path ? [{ path: abs(path) }] : [],
        rawInput: input,
      }
    }

    case "edit":
    case "str_replace": {
      const filePath = getFilePath(input)
      const oldString = getOldString(input)
      const newString = getNewString(input)
      return {
        title: filePath ? `Edit \`${filePath}\`` : "Edit",
        kind: "edit",
        content: filePath ? [diffContent(abs(filePath), oldString, newString)] : [],
        locations: filePath ? [{ path: abs(filePath) }] : [],
        rawInput: input,
      }
    }

    case "patch": {
      const filePath = getFilePath(input)
      const patchText = getDiff(input)
      return {
        title: filePath ? `Patch \`${filePath}\`` : "Patch",
        kind: "edit",
        content: patchText ? [textContent(patchText)] : [],
        locations: filePath ? [{ path: abs(filePath) }] : [],
        rawInput: input,
      }
    }

    case "write":
    case "create": {
      const filePath = getFilePath(input)
      const content = getNewString(input)
      return {
        title: filePath ? `Write ${filePath}` : "Write",
        kind: "edit",
        content: filePath ? [diffContent(abs(filePath), null, content)] : [],
        locations: filePath ? [{ path: abs(filePath) }] : [],
        rawInput: input,
      }
    }

    case "glob":
    case "find": {
      const path = str(input.path)
      const pattern = getPattern(input)
      let label = "Find"
      if (path) label += ` \`${path}\``
      if (pattern) label += ` \`${pattern}\``
      return {
        title: label,
        kind: "search",
        content: [],
        locations: path ? [{ path: abs(path) }] : [],
        rawInput: input,
      }
    }

    case "grep":
    case "search": {
      const pattern = getPattern(input)
      const path = str(input.path)
      let label = "grep"
      if (pattern) label += ` "${truncate(pattern, 30)}"`
      if (path) label += ` ${path}`
      return {
        title: label,
        kind: "search",
        content: [],
        locations: path ? [{ path: abs(path) }] : [],
        rawInput: input,
      }
    }

    case "webfetch":
    case "fetch": {
      const url = getUrl(input)
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
      const query = getQuery(input)
      return {
        title: query ? `"${truncate(query, 40)}"` : "Search",
        kind: "fetch",
        content: [],
        locations: [],
        rawInput: input,
      }
    }

    case "task": {
      const description = getDescription(input)
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
      const filePath = getFilePath(input)
      const patchText = getDiff(input)
      return {
        title: filePath ? `Apply Patch \`${filePath}\`` : "Apply Patch",
        kind: "edit",
        content: patchText ? [textContent(patchText)] : [],
        locations: filePath ? [{ path: abs(filePath) }] : [],
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
      const name = str(input.name)
      return {
        title: name ? `Skill: ${name}` : "Skill",
        kind: "other",
        content: [],
        locations: [],
        rawInput: input,
      }
    }

    case "question": {
      const question = getQuery(input) || str(input.question)
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
      const query = getQuery(input)
      return {
        title: query ? `Search: ${truncate(query, 30)}` : "Code Search",
        kind: "search",
        content: [],
        locations: [],
        rawInput: input,
      }
    }

    default: {
      const description = getDescription(input)
      const command = getCommand(input)
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
): ToolResultInfo {
  const name = normalize(tool)
  const displayText = isError ? markdownEscape(output) : output
  const content: ToolCallContent[] = [textContent(displayText)]

  switch (name) {
    case "bash":
    case "shell":
    case "terminal": {
      return {
        content,
        rawOutput: isError ? { stderr: output } : { stdout: output },
      }
    }

    case "edit":
    case "str_replace": {
      const filePath = getFilePath(input)
      const oldString = getOldString(input)
      const newString = getNewString(input)
      if (filePath && !isError) {
        content.push(diffContent(abs(filePath), oldString, newString))
      }
      return {
        content,
        rawOutput: { stdout: output },
      }
    }

    case "patch":
    case "apply_patch": {
      const filePath = getFilePath(input)
      const patchText = getDiff(input)
      if (filePath && patchText && !isError) {
        content.push(textContent(patchText))
      }
      return {
        content,
        rawOutput: { stdout: output },
      }
    }

    case "write":
    case "create": {
      const filePath = getFilePath(input)
      const fileContent = getNewString(input)
      if (filePath && !isError) {
        content.push(diffContent(abs(filePath), null, fileContent))
      }
      return {
        content,
        rawOutput: { stdout: output },
      }
    }

    default: {
      return {
        content,
        rawOutput: isError ? { stderr: output } : { stdout: output },
      }
    }
  }
}
