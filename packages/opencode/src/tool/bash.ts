import { z } from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./bash.txt"
import { App } from "../app/app"

const MAX_OUTPUT_LENGTH = 30000
const DEFAULT_TIMEOUT = 1 * 60 * 1000
const MAX_TIMEOUT = 10 * 60 * 1000

function isBackgroundCommand(command: string): boolean {
  const trimmed = command.trim()

  // Simple tokenizer to handle quotes and escapes
  const tokens = []
  let current = ""
  let inSingleQuote = false
  let inDoubleQuote = false
  let escaped = false

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i]

    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === "\\") {
      escaped = true
      current += char
      continue
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      current += char
      continue
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      current += char
      continue
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (char === " " || char === "\t") {
        if (current) {
          tokens.push(current)
          current = ""
        }
        continue
      }
    }

    current += char
  }

  if (current) {
    tokens.push(current)
  }

  // Check for disown which modifies background job behavior
  if (tokens.includes("disown")) {
    return true
  }

  // Check if the command ends with a background operator
  const lastToken = tokens[tokens.length - 1]

  // Case 1: Last token is just "&" (like "sleep 2 && touch file &")
  if (lastToken === "&") {
    return true
  }

  // Case 2: Last token ends with "&" (like "sleep 10&" or "command&")
  if (lastToken && lastToken.endsWith("&") && !lastToken.endsWith("&&") && !lastToken.endsWith("\\&")) {
    return true
  }

  // Case 3: Check for mixed commands with background processes in the middle
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i]
    if ((token.endsWith("&") && !token.endsWith("&&") && !token.endsWith("\\&")) || token === "&") {
      // Has background processes but not at the end - mixed command
      // Treat as foreground to preserve output from final commands
      return false
    }
  }

  return false
}

export const BashTool = Tool.define({
  id: "bash",
  description: DESCRIPTION,
  parameters: z.object({
    command: z.string().describe("The command to execute"),
    timeout: z.number().min(0).max(MAX_TIMEOUT).describe("Optional timeout in milliseconds").optional(),
    description: z
      .string()
      .describe(
        "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
      ),
  }),
  async execute(params, ctx) {
    const timeout = Math.min(params.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT)

    // Detect background commands to prevent file descriptor inheritance
    const isBackground = isBackgroundCommand(params.command)

    const process = Bun.spawn({
      cmd: ["bash", "-c", params.command],
      cwd: App.info().path.cwd,
      maxBuffer: MAX_OUTPUT_LENGTH,
      signal: ctx.abort,
      timeout: timeout,
      // For background commands, ignore output to prevent file descriptor inheritance
      stdout: isBackground ? "ignore" : "pipe",
      stderr: isBackground ? "ignore" : "pipe",
    })
    await process.exited

    // Handle output based on whether this is a background command
    const stdout = isBackground ? "" : await new Response(process.stdout).text()
    const stderr = isBackground ? "" : await new Response(process.stderr).text()

    return {
      title: params.command,
      metadata: {
        stderr,
        stdout,
        exit: process.exitCode,
        description: params.description,
      },
      output: [`<stdout>`, stdout ?? "", `</stdout>`, `<stderr>`, stderr ?? "", `</stderr>`].join("\n"),
    }
  },
})
