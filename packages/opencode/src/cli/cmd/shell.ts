import type { Argv } from "yargs"
import os from "os"
import path from "path"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { Server } from "../../server/server"
import { Provider } from "../../provider/provider"

function getOsName(): string {
  const platform = process.platform
  if (platform === "linux") {
    return "Linux"
  }
  if (platform === "darwin") {
    return `Darwin/macOS ${os.release().split(".")[0]}`
  }
  if (platform === "win32") {
    return `Windows ${os.release()}`
  }
  return platform
}

function getShellName(): string {
  const shell = process.env.SHELL
  if (shell) {
    return path.basename(shell)
  }
  if (process.platform === "win32") {
    return process.env.COMSPEC ? path.basename(process.env.COMSPEC) : "cmd.exe"
  }
  return "sh"
}

const osName = getOsName()
const shellName = getShellName()

const SHELL_PROMPT = `You are a ${shellName} shell command generator. Output ONLY the command.

NEVER output ls, find, or cat to "check" things first. The user knows their files. Just give the command.

Examples:
User: "convert png to jpg"
You: mogrify -format jpg *.png

User: "delete all node_modules folders"
You: find . -type d -name "node_modules" -exec rm -rf {} +

User: "find large files over 100MB"
You: find . -size +100M

User: "count lines in python files"
You: find . -name "*.py" -exec wc -l {} +

Now output ONLY the command for:`

function cleanOutput(text: string): string {
  let result = text.trim()
  // Remove markdown code blocks if present
  result = result.replace(/^```\w*\n?/gm, "").replace(/```\n?$/gm, "")
  // Remove inline backticks if wrapping entire output
  if (result.startsWith("`") && result.endsWith("`")) {
    result = result.slice(1, -1)
  }
  return result.trim()
}

const DESCRIBE_PROMPT = `Provide a terse, single sentence description of the given shell command.
Describe each argument and option of the command.
Provide short responses in about 80 words.`

// Simple spinner
function startSpinner(msg: string): () => void {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
  let i = 0
  process.stderr.write(UI.Style.TEXT_DIM + msg + UI.Style.TEXT_NORMAL)
  const interval = setInterval(() => {
    process.stderr.write(`\r${UI.Style.TEXT_DIM}${frames[i]} ${msg}${UI.Style.TEXT_NORMAL}`)
    i = (i + 1) % frames.length
  }, 80)
  return () => {
    clearInterval(interval)
    process.stderr.write("\r\x1b[K") // Clear the line
  }
}

// Single keypress without Enter
async function getKeypress(): Promise<string> {
  // Fallback to readline if not a TTY
  if (!process.stdin.isTTY) {
    return UI.input("")
  }
  return new Promise((resolve) => {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.once("data", (data) => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      const key = data.toString().toLowerCase()
      resolve(key)
    })
  })
}

export const ShellCommand = cmd({
  command: "shell <prompt>",
  describe: "generate a shell command from natural language",
  builder: (yargs: Argv) => {
    return yargs
      .positional("prompt", {
        describe: "natural language description of the command",
        type: "string",
        demandOption: true,
      })
      .option("model", {
        alias: "m",
        type: "string",
        describe: "model to use (provider/model format)",
      })
      .option("yes", {
        alias: "y",
        type: "boolean",
        default: false,
        describe: "execute without confirmation",
      })
  },
  handler: async (args) => {
    if (!args.prompt?.trim()) {
      UI.error("You must provide a prompt")
      process.exit(1)
    }

    await bootstrap(process.cwd(), async () => {
      const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        return Server.Default().fetch(request)
      }) as typeof globalThis.fetch

      const sdk = createOpencodeClient({
        baseUrl: "http://opencode.internal",
        fetch: fetchFn,
      })

      const sessionResult = await sdk.session.create({
        title: "shell",
        permission: [{ permission: "*", action: "deny", pattern: "*" }],
      })
      const sessionID = sessionResult.data?.id

      if (!sessionID) {
        UI.error("Failed to create session")
        process.exit(1)
      }

      let command = ""

      const generateCommand = async (promptText: string) => {
        command = ""
        const stopSpinner = startSpinner("Generating...")
        const events = await sdk.event.subscribe()

        const processEvents = (async () => {
          for await (const event of events.stream) {
            if (event.type === "message.part.updated") {
              const part = event.properties.part
              if (part.sessionID !== sessionID) continue
              if (part.type === "text" && part.time?.end) {
                command = cleanOutput(part.text)
              }
            }
            if (
              event.type === "session.status" &&
              event.properties.sessionID === sessionID &&
              event.properties.status.type === "idle"
            ) {
              break
            }
            if (event.type === "session.error") {
              const props = event.properties
              if (props.sessionID !== sessionID) continue
              stopSpinner()
              UI.error(props.error?.name || "Unknown error")
              process.exit(1)
            }
          }
        })().catch((e) => {
          stopSpinner()
          console.error(e)
          process.exit(1)
        })

        await sdk.session.prompt({
          sessionID,
          model: args.model ? Provider.parseModel(args.model) : undefined,
          system: SHELL_PROMPT,
          parts: [{ type: "text", text: promptText }],
        })

        await processEvents
        stopSpinner()
      }

      await generateCommand(args.prompt)

      // Interactive loop
      while (true) {
        UI.empty()
        UI.println(UI.Style.TEXT_HIGHLIGHT + command + UI.Style.TEXT_NORMAL)

        if (args.yes) {
          return executeCommand(command)
        }

        UI.empty()
        process.stderr.write(UI.Style.TEXT_DIM + "[E]xecute, [D]escribe, [C]orrect, [A]bort: " + UI.Style.TEXT_NORMAL)
        const key = await getKeypress()
        process.stderr.write("\n")

        if (key === "e") {
          return executeCommand(command)
        }

        if (key === "d") {
          await describeCommand(command, sdk, sessionID)
          continue
        }

        if (key === "c") {
          process.stderr.write(UI.Style.TEXT_DIM + "Correction: " + UI.Style.TEXT_NORMAL)
          const correction = await UI.input("")
          if (!correction.trim()) continue
          await generateCommand(`The previous command wasn't quite right. ${correction}`)
          continue
        }

        if (key === "a" || key === "\u0003") {
          // 'a' or Ctrl+C
          UI.println(UI.Style.TEXT_DIM + "Aborted." + UI.Style.TEXT_NORMAL)
          return
        }
      }
    })
  },
})

async function executeCommand(command: string) {
  UI.empty()
  const proc = Bun.spawn(["sh", "-c", command], {
    stdout: "inherit",
    stderr: "inherit",
  })
  process.exit(await proc.exited)
}

async function describeCommand(command: string, sdk: any, sessionID: string) {
  UI.empty()
  const stopSpinner = startSpinner("Describing...")
  let description = ""
  const events = await sdk.event.subscribe()

  const processEvents = (async () => {
    for await (const event of events.stream) {
      if (event.type === "message.part.updated") {
        const part = event.properties.part
        if (part.sessionID !== sessionID) continue
        if (part.type === "text" && part.time?.end) {
          description = part.text.trim()
        }
      }
      if (
        event.type === "session.status" &&
        event.properties.sessionID === sessionID &&
        event.properties.status.type === "idle"
      ) {
        break
      }
    }
  })().catch(console.error)

  await sdk.session.prompt({
    sessionID,
    system: DESCRIBE_PROMPT,
    parts: [{ type: "text", text: command }],
  })

  await processEvents
  stopSpinner()
  UI.println(UI.Style.TEXT_DIM + "Description:" + UI.Style.TEXT_NORMAL)
  UI.println(description)
}