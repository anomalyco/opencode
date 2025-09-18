import { z } from "zod"
import { Tool } from "./tool.js"
import { execFile } from "child_process"
import { promisify } from "util"
import { parse } from "shell-quote"

const pexecFile = promisify(execFile)

export const Bash = Tool(
  "bash",
  "Execute a command in the user's project root. Note: This does not support shell features like pipes, redirection, or command chaining.",
  z.object({
    command: z.string().describe("The command to execute, including arguments."),
  }),
  async function* (params) {
    yield {
      type: "update",
      content: `> ${params.command}`,
    }

    try {
      const parts = parse(params.command)
      if (parts.some((part) => typeof part !== "string")) {
        yield {
          type: "update",
          content: "Error: Shell features like pipes (|), redirection (>), etc. are not supported.",
        }
        return
      }
      const [command, ...args] = parts as string[]

      if (!command) {
        yield {
          type: "update",
          content: "Error: Empty command provided.",
        }
        return
      }

      const result = await pexecFile(command, args, {
        cwd: this.project.paths.root,
        env: {
          ...process.env,
          ...this.project.env,
        },
      })
      yield {
        type: "update",
        content: [result.stdout, result.stderr].join("\n").trim(),
      }
    } catch (e: any) {
      const output = [e.stdout, e.stderr].join("\n").trim()
      yield {
        type: "update",
        content: output || `Error: ${e.message}`,
      }
    }
  },
)
