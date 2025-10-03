import z from "zod/v4"

import { Tool } from "./tool"
import DESCRIPTION from "./bash.txt"
import { Permission } from "../permission"
import { lazy } from "../util/lazy"
import { Log } from "../util/log"
import { Wildcard } from "../util/wildcard"
import { $ } from "bun"
import { Instance } from "../project/instance"
import { Agent } from "../agent/agent"
import { measure } from "./telemetry"
import { guard } from "./workspace"

const MAX_OUTPUT_LENGTH = 30_000
const DEFAULT_TIMEOUT = 1 * 60 * 1000
const MAX_TIMEOUT = 10 * 60 * 1000

const log = Log.create({ service: "bash-tool" })

const parser = lazy(async () => {
  try {
    const { default: Parser } = await import("tree-sitter")
    const Bash = await import("tree-sitter-bash")
    const p = new Parser()
    p.setLanguage(Bash.language as any)
    return p
  } catch (e) {
    const { default: Parser } = await import("web-tree-sitter")
    const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, { with: { type: "wasm" } })
    await Parser.init({
      locateFile() {
        return treeWasm
      },
    })
    const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
      with: { type: "wasm" },
    })
    const bashLanguage = await Parser.Language.load(bashWasm)
    const p = new Parser()
    p.setLanguage(bashLanguage)
    return p
  }
})

const parameters = z.object({
  command: z.string().describe("The command to execute"),
  timeout: z.number().describe("Optional timeout in milliseconds").optional(),
  description: z
    .string()
    .describe(
      "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
    ),
})

type BashMetadata = {
  output: string
  exit?: number
  description: string
}

export const BashTool = Tool.define<typeof parameters, BashMetadata>("bash", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    const extra = { description: params.description }
    return measure({
      id: "bash",
      ctx,
      params,
      extra,
      async run() {
        const timeout = Math.min(params.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT)
        const tree = await parser().then((p) => p.parse(params.command))
        const permissions = await Agent.get(ctx.agent).then((x) => x.permission.bash)

        const askPatterns = new Set<string>()
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
          if (resolved)
            guard(resolved, {
              message: `This command references paths outside of ${Instance.directory} so it is not allowed to be executed.`,
            })
        }
      }

      // always allow cd if it passes above check
      if (command[0] !== "cd") {
        const action = Wildcard.all(node.text, permissions)
        if (action === "deny") {
          throw new Error(
            `The user has specifically restricted access to this command, you are not allowed to execute it. Here is the configuration: ${JSON.stringify(permissions)}`,
          )
        }
        if (action === "ask") {
          const pattern = (() => {
            let head = ""
            let sub: string | undefined
            for (let i = 0; i < node.childCount; i++) {
              const child = node.child(i)
              if (!child) continue
              if (child.type === "command_name") {
                if (!head) {
                  head = child.text
                }
                continue
              }
              if (!sub && child.type === "word") {
                if (!child.text.startsWith("-")) sub = child.text
              }
            }
            if (!head) return
            return sub ? `${head} ${sub} *` : `${head} *`
          })()
          if (pattern) {
            askPatterns.add(pattern)
          }
        }
      }
    }

        if (askPatterns.size > 0) {
      const patterns = Array.from(askPatterns)
      await Permission.ask({
        type: "bash",
        pattern: patterns,
        sessionID: ctx.sessionID,
        messageID: ctx.messageID,
        callID: ctx.callID,
        title: params.command,
        metadata: {
          command: params.command,
          patterns,
        },
      })
    }

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeout)
        const signal = AbortSignal.any([ctx.abort, controller.signal])
        const shell = process.env["SHELL"] || "/bin/sh"
        const proc = Bun.spawn([shell, "-lc", params.command], {
          cwd: Instance.directory,
          stdout: "pipe",
          stderr: "pipe",
          signal,
        })

        const state = { output: "" }
        const decoder = () => new TextDecoder()
        const pump = async (stream: ReadableStream<Uint8Array> | undefined) => {
          if (!stream) return
          const textDecoder = decoder()
          await stream.pipeTo(
            new WritableStream<Uint8Array>({
              write(chunk) {
                const text = textDecoder.decode(chunk, { stream: true })
                if (!text) return
                state.output += text
                ctx.metadata({
                  metadata: {
                    output: state.output,
                    description: params.description,
                  },
                })
              },
            }),
          )
        }

        ctx.metadata({
          metadata: {
            output: "",
            description: params.description,
          },
        })

        await Promise.all([pump(proc.stdout), pump(proc.stderr)])
        const exit = await proc.exited
        clearTimeout(timer)

        ctx.metadata({
          metadata: {
            output: state.output,
            exit,
            description: params.description,
          },
        })

        let finalOutput = state.output
        if (finalOutput.length > MAX_OUTPUT_LENGTH) {
          finalOutput = finalOutput.slice(0, MAX_OUTPUT_LENGTH)
          finalOutput += "\n\n(Output was truncated due to length limit)"
        }

        return {
          title: params.command,
          metadata: {
            output: finalOutput,
            exit,
            description: params.description,
          },
          output: finalOutput,
        }
      },
    })
  },
})
