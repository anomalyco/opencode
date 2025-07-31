import { z } from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./bash.txt"
import { App } from "../app/app"
import { Permission } from "../permission"
import { Config } from "../config/config"

// import Parser from "tree-sitter"
// import Bash from "tree-sitter-bash"
// import { Config } from "../config/config"

const MAX_OUTPUT_LENGTH = 30000
const DEFAULT_TIMEOUT = 1 * 60 * 1000
const MAX_TIMEOUT = 10 * 60 * 1000

// const parser = new Parser()
// parser.setLanguage(Bash.language as any)

export const BashTool = Tool.define("bash", {
  description: DESCRIPTION,
  parameters: z.object({
    command: z.string().describe("The command to execute"),
    timeout: z.number().describe("Optional timeout in milliseconds").optional(),
    description: z
      .string()
      .describe(
        "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
      ),
  }),
  async execute(params, ctx) {
    const timeout = Math.min(params.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT)
    const app = App.info()
    /*
    const _cfg = await Config.get()
    const tree = parser.parse(params.command)
    const permissions = (() => {
      const value = cfg.permission?.bash
      if (!value)
        return {
          "*": "allow",
        }
      if (typeof value === "string")
        return {
          "*": value,
        }
      return value
    })()

    let needsAsk = false
    for (const node of tree.rootNode.descendantsOfType("command")) {
      const command = []
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (!child) continue
        if (
          child.type !== "command_name" &&
          child.type !== "word" &&
          child.type !== "string" &&
          child.type !== "raw_string" &&
          child.type !== "concatenation"
        ) {
          continue
        }
        command.push(child.text)
      }

      // not an exhaustive list, but covers most common cases
      if (["cd", "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown"].includes(command[0])) {
        for (const arg of command.slice(1)) {
          if (arg.startsWith("-")) continue
          const resolved = path.resolve(app.path.cwd, arg)
          if (!Filesystem.contains(app.path.cwd, resolved)) {
            throw new Error(
              `This command references paths outside of ${app.path.cwd} so it is not allowed to be executed.`,
            )
          }
        }
      }

      // always allow cd if it passes above check
      if (!needsAsk && command[0] !== "cd") {
        const ask = (() => {
          for (const [pattern, value] of Object.entries(permissions)) {
            if (new Bun.Glob(pattern).match(node.text)) {
              return value
            }
          }
          return "ask"
        })()
        if (ask === "ask") needsAsk = true
      }
    }

    if (needsAsk) {
      await Permission.ask({
        id: "bash",
        sessionID: ctx.sessionID,
        messageID: ctx.messageID,
        toolCallID: ctx.toolCallID,
        title: params.command,
        metadata: {
          command: params.command,
        },
      })
    }
    */

    const cfg = await Config.get()
    if (cfg.permission?.bash === "ask")
      await Permission.ask({
        type: "bash",
        pattern: params.command.split(" ").slice(0, 2).join(" ").trim(),
        sessionID: ctx.sessionID,
        messageID: ctx.messageID,
        callID: ctx.toolCallID,
        title: "Run this command: " + params.command,
        metadata: {
          command: params.command,
          description: params.description,
          timeout: params.timeout,
        },
      })

    const process = Bun.spawn({
      cmd: ["bash", "-c", params.command],
      cwd: app.path.cwd,
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
