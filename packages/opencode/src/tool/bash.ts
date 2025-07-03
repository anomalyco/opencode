import { z } from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./bash.txt"
import { App } from "../app/app"

const MAX_OUTPUT_LENGTH = 30000
const BANNED_COMMANDS = [
  "alias",
  "curl",
  "curlie",
  "wget",
  "axel",
  "aria2c",
  "nc",
  "telnet",
  "lynx",
  "w3m",
  "links",
  "httpie",
  "xh",
  "http-prompt",
  "chrome",
  "firefox",
  "safari",
]
const DEFAULT_TIMEOUT = 1 * 60 * 1000
const MAX_TIMEOUT = 10 * 60 * 1000

export const BashTool = Tool.define({
  id: "bash",
  description: DESCRIPTION,
  parameters: z.object({
    command: z.string().describe("The command to execute"),
    timeout: z
      .number()
      .min(0)
      .max(MAX_TIMEOUT)
      .describe("Optional timeout in milliseconds")
      .optional(),
    description: z
      .string()
      .describe(
        "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
      ),
  }),
  async execute(params, ctx) {
    const timeout = Math.min(params.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT)
    if (BANNED_COMMANDS.some((item) => params.command.startsWith(item)))
      throw new Error(`Command '${params.command}' is not allowed`)

    // Check if command requires sudo
    const trimmedCommand = params.command.trim()
    if (trimmedCommand.startsWith("sudo ") || trimmedCommand === "sudo") {
      throw new Error(
        `Sudo commands are not supported as they require interactive password input. ` +
        `Consider alternative approaches that don't require elevated privileges.`
      )
    }
    
    // Also check for sudo after common command separators
    const sudoPatterns = [
      /(?:^|;|&&|\|\|)\s*sudo(?:\s|$)/,  // sudo at start or after ;, &&, ||
      /\|\s*sudo(?:\s|$)/,               // sudo after pipe
    ]
    
    if (sudoPatterns.some(pattern => pattern.test(params.command))) {
      throw new Error(
        `Sudo commands are not supported as they require interactive password input. ` +
        `Consider alternative approaches that don't require elevated privileges.`
      )
    }

    const process = Bun.spawn({
      cmd: ["bash", "-c", params.command],
      cwd: App.info().path.cwd,
      maxBuffer: MAX_OUTPUT_LENGTH,
      signal: ctx.abort,
      timeout: timeout,
      stdout: "pipe",
      stderr: "pipe",
    })
    await process.exited
    const stdout = await new Response(process.stdout).text()
    const stderr = await new Response(process.stderr).text()

    return {
      metadata: {
        stderr,
        stdout,
        exit: process.exitCode,
        description: params.description,
        title: params.command,
      },
      output: [
        `<stdout>`,
        stdout ?? "",
        `</stdout>`,
        `<stderr>`,
        stderr ?? "",
        `</stderr>`,
      ].join("\n"),
    }
  },
})
