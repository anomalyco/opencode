import { z } from "zod"
import { exec } from "child_process"
import { text } from "stream/consumers"
import { Tool } from "./tool"
import DESCRIPTION from "./bash.txt"
import { App } from "../app/app"
import { Permission } from "../permission"
import { Config } from "../config/config"
import { Filesystem } from "../util/filesystem"
import { lazy } from "../util/lazy"
import { Log } from "../util/log"
import { Wildcard } from "../util/wildcard"
import { $ } from "bun"

const MAX_OUTPUT_LENGTH = 30000
const DEFAULT_TIMEOUT = 1 * 60 * 1000
const MAX_TIMEOUT = 10 * 60 * 1000

const log = Log.create({ service: "bash-tool" })

const parser = lazy(async () => {
  const { default: Parser } = await import("tree-sitter")
  const Bash = await import("tree-sitter-bash")
  const p = new Parser()
  p.setLanguage(Bash.language as any)
  return p
})

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
    const cfg = await Config.get()
    const tree = await parser().then((p) => p.parse(params.command))
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
          if (arg.startsWith("-") || (command[0] === "chmod" && arg.startsWith("+"))) continue
          const resolved = await $`realpath ${arg}`
            .quiet()
            .nothrow()
            .text()
            .then((x) => x.trim())
          log.info("resolved path", { arg, resolved })
          if (resolved && !Filesystem.contains(app.path.cwd, resolved)) {
            throw new Error(
              `This command references paths outside of ${app.path.cwd} so it is not allowed to be executed.`,
            )
          }
        }
      }

      // always allow cd if it passes above check
      if (!needsAsk && command[0] !== "cd") {
        const action = (() => {
          for (const [pattern, value] of Object.entries(permissions)) {
            const match = Wildcard.match(node.text, pattern)
            log.info("checking", { text: node.text.trim(), pattern, match })
            if (match) return value
          }
          return "ask"
        })()
        if (action === "deny") {
          throw new Error(
            "The user has specifically restricted access to this command, you are not allowed to execute it.",
          )
        }
        if (action === "ask") needsAsk = true
      }
    }

    if (needsAsk) {
      await Permission.ask({
        type: "bash",
        sessionID: ctx.sessionID,
        messageID: ctx.messageID,
        callID: ctx.callID,
        title: params.command,
        metadata: {
          command: params.command,
        },
      })
    }

    const process = exec(params.command, {
      cwd: app.path.cwd,
      signal: ctx.abort,
      maxBuffer: MAX_OUTPUT_LENGTH,
      timeout,
    })

    const stdoutPromise = text(process.stdout!)
    const stderrPromise = text(process.stderr!)

    await new Promise<void>((resolve) => {
      process.on("close", () => {
        resolve()
      })
    })

    const stdout = await stdoutPromise
    const stderr = await stderrPromise

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
