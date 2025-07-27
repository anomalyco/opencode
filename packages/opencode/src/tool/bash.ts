import { z } from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./bash.txt"
import { App } from "../app/app"

const MAX_OUTPUT_LENGTH = 30000
const DEFAULT_TIMEOUT = 1 * 60 * 1000
const MAX_TIMEOUT = 10 * 60 * 1000

export const BashTool = Tool.define("bash", {
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
