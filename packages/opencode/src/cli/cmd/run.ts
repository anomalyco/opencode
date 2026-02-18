import type { Argv } from "yargs"
import path from "path"
import { pathToFileURL } from "bun"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { Flag } from "../../flag/flag"
import { bootstrap } from "../bootstrap"
import { EOL } from "os"
import { Provider } from "../../provider/provider"
import { Agent } from "../../agent/agent"
import { PermissionNext } from "../../permission/next"
import { Session } from "../../session"
import { SessionPrompt } from "../../session/prompt"
import { MessageV2 } from "../../session/message-v2"
import { SessionStatus } from "../../session/status"
import { Bus } from "../../bus"
import { Tool } from "../../tool/tool"
import { GlobTool } from "../../tool/glob"
import { GrepTool } from "../../tool/grep"
import { ListTool } from "../../tool/ls"
import { ReadTool } from "../../tool/read"
import { WebFetchTool } from "../../tool/webfetch"
import { EditTool } from "../../tool/edit"
import { WriteTool } from "../../tool/write"
import { CodeSearchTool } from "../../tool/codesearch"
import { WebSearchTool } from "../../tool/websearch"
import { TaskTool } from "../../tool/task"
import { SkillTool } from "../../tool/skill"
import { BashTool } from "../../tool/bash"
import { TodoWriteTool } from "../../tool/todo"
import { Locale } from "../../util/locale"
import { Config } from "../../config/config"

type ToolPart = MessageV2.ToolPart

type ToolProps<T extends Tool.Info> = {
  input: Tool.InferParameters<T>
  metadata: Tool.InferMetadata<T>
  part: ToolPart
}

function props<T extends Tool.Info>(part: ToolPart): ToolProps<T> {
  const state = part.state
  return {
    input: state.input as Tool.InferParameters<T>,
    metadata: ("metadata" in state ? state.metadata : {}) as Tool.InferMetadata<T>,
    part,
  }
}

type Inline = {
  icon: string
  title: string
  description?: string
}

function inline(info: Inline) {
  const suffix = info.description ? UI.Style.TEXT_DIM + ` ${info.description}` + UI.Style.TEXT_NORMAL : ""
  UI.println(UI.Style.TEXT_NORMAL + info.icon, UI.Style.TEXT_NORMAL + info.title + suffix)
}

function block(info: Inline, output?: string) {
  UI.empty()
  inline(info)
  if (!output?.trim()) return
  UI.println(output)
  UI.empty()
}

function fallback(part: ToolPart) {
  const state = part.state
  const input = "input" in state ? state.input : undefined
  const title =
    ("title" in state && state.title ? state.title : undefined) ||
    (input && typeof input === "object" && Object.keys(input).length > 0 ? JSON.stringify(input) : "Unknown")
  inline({
    icon: "⚙",
    title: `${part.tool} ${title}`,
  })
}

function glob(info: ToolProps<typeof GlobTool>) {
  const root = info.input.path ?? ""
  const title = `Glob "${info.input.pattern}"`
  const suffix = root ? `in ${normalizePath(root)}` : ""
  const num = info.metadata.count
  const description =
    num === undefined ? suffix : `${suffix}${suffix ? " · " : ""}${num} ${num === 1 ? "match" : "matches"}`
  inline({
    icon: "✱",
    title,
    ...(description && { description }),
  })
}

function grep(info: ToolProps<typeof GrepTool>) {
  const root = info.input.path ?? ""
  const title = `Grep "${info.input.pattern}"`
  const suffix = root ? `in ${normalizePath(root)}` : ""
  const num = info.metadata.matches
  const description =
    num === undefined ? suffix : `${suffix}${suffix ? " · " : ""}${num} ${num === 1 ? "match" : "matches"}`
  inline({
    icon: "✱",
    title,
    ...(description && { description }),
  })
}

function list(info: ToolProps<typeof ListTool>) {
  const dir = info.input.path ? normalizePath(info.input.path) : ""
  inline({
    icon: "→",
    title: dir ? `List ${dir}` : "List",
  })
}

function read(info: ToolProps<typeof ReadTool>) {
  const file = normalizePath(info.input.filePath)
  const pairs = Object.entries(info.input).filter(([key, value]) => {
    if (key === "filePath") return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  const description = pairs.length ? `[${pairs.map(([key, value]) => `${key}=${value}`).join(", ")}]` : undefined
  inline({
    icon: "→",
    title: `Read ${file}`,
    ...(description && { description }),
  })
}

function write(info: ToolProps<typeof WriteTool>) {
  block(
    {
      icon: "←",
      title: `Write ${normalizePath(info.input.filePath)}`,
    },
    info.part.state.status === "completed" ? info.part.state.output : undefined,
  )
}

function webfetch(info: ToolProps<typeof WebFetchTool>) {
  inline({
    icon: "%",
    title: `WebFetch ${info.input.url}`,
  })
}

function edit(info: ToolProps<typeof EditTool>) {
  const title = normalizePath(info.input.filePath)
  const diff = info.metadata.diff
  block(
    {
      icon: "←",
      title: `Edit ${title}`,
    },
    diff,
  )
}

function codesearch(info: ToolProps<typeof CodeSearchTool>) {
  inline({
    icon: "◇",
    title: `Exa Code Search "${info.input.query}"`,
  })
}

function websearch(info: ToolProps<typeof WebSearchTool>) {
  inline({
    icon: "◈",
    title: `Exa Web Search "${info.input.query}"`,
  })
}

function task(info: ToolProps<typeof TaskTool>) {
  const agent = Locale.titlecase(info.input.subagent_type)
  const desc = info.input.description
  const started = info.part.state.status === "running"
  const name = desc ?? `${agent} Task`
  inline({
    icon: started ? "•" : "✓",
    title: name,
    description: desc ? `${agent} Agent` : undefined,
  })
}

function skill(info: ToolProps<typeof SkillTool>) {
  inline({
    icon: "→",
    title: `Skill "${info.input.name}"`,
  })
}

function bash(info: ToolProps<typeof BashTool>) {
  const output = info.part.state.status === "completed" ? info.part.state.output?.trim() : undefined
  block(
    {
      icon: "$",
      title: `${info.input.command}`,
    },
    output,
  )
}

function todo(info: ToolProps<typeof TodoWriteTool>) {
  block(
    {
      icon: "#",
      title: "Todos",
    },
    info.input.todos.map((item) => `${item.status === "completed" ? "[x]" : "[ ]"} ${item.content}`).join("\n"),
  )
}

function normalizePath(input?: string) {
  if (!input) return ""
  if (path.isAbsolute(input)) return path.relative(process.cwd(), input) || "."
  return input
}

function tool(part: ToolPart) {
  try {
    if (part.tool === "bash") return bash(props<typeof BashTool>(part))
    if (part.tool === "glob") return glob(props<typeof GlobTool>(part))
    if (part.tool === "grep") return grep(props<typeof GrepTool>(part))
    if (part.tool === "list") return list(props<typeof ListTool>(part))
    if (part.tool === "read") return read(props<typeof ReadTool>(part))
    if (part.tool === "write") return write(props<typeof WriteTool>(part))
    if (part.tool === "webfetch") return webfetch(props<typeof WebFetchTool>(part))
    if (part.tool === "edit") return edit(props<typeof EditTool>(part))
    if (part.tool === "codesearch") return codesearch(props<typeof CodeSearchTool>(part))
    if (part.tool === "websearch") return websearch(props<typeof WebSearchTool>(part))
    if (part.tool === "task") return task(props<typeof TaskTool>(part))
    if (part.tool === "todowrite") return todo(props<typeof TodoWriteTool>(part))
    if (part.tool === "skill") return skill(props<typeof SkillTool>(part))
    return fallback(part)
  } catch {
    return fallback(part)
  }
}

export const RunCommand = cmd({
  command: "run [message..]",
  describe: "run opencode with a message",
  builder: (yargs: Argv) => {
    return yargs
      .positional("message", {
        describe: "message to send",
        type: "string",
        array: true,
        default: [],
      })
      .option("command", {
        describe: "the command to run, use message for args",
        type: "string",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        describe: "session id to continue",
        type: "string",
      })
      .option("fork", {
        describe: "fork the session before continuing (requires --continue or --session)",
        type: "boolean",
      })
      .option("share", {
        type: "boolean",
        describe: "share the session",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("format", {
        type: "string",
        choices: ["default", "json"],
        default: "default",
        describe: "format: default (formatted) or json (raw JSON events)",
      })
      .option("file", {
        alias: ["f"],
        type: "string",
        array: true,
        describe: "file(s) to attach to message",
      })
      .option("title", {
        type: "string",
        describe: "title for the session (uses truncated prompt if no value provided)",
      })
      .option("dir", {
        type: "string",
        describe: "directory to run in",
      })
      .option("variant", {
        type: "string",
        describe: "model variant (provider-specific reasoning effort, e.g., high, max, minimal)",
      })
      .option("thinking", {
        type: "boolean",
        describe: "show thinking blocks",
        default: false,
      })
  },
  handler: async (args) => {
    let message = [...args.message, ...(args["--"] || [])]
      .map((arg) => (arg.includes(" ") ? `"${arg.replace(/"/g, '\\"')}"` : arg))
      .join(" ")

    if (args.dir) {
      try {
        process.chdir(args.dir)
      } catch {
        UI.error("Failed to change directory to " + args.dir)
        process.exit(1)
      }
    }

    const files: { type: "file"; url: string; filename: string; mime: string }[] = []
    if (args.file) {
      const list = Array.isArray(args.file) ? args.file : [args.file]
      for (const filePath of list) {
        const resolvedPath = path.resolve(process.cwd(), filePath)
        const file = Bun.file(resolvedPath)
        const stats = await file.stat().catch(() => {})
        if (!stats || !(await file.exists())) {
          UI.error(`File not found: ${filePath}`)
          process.exit(1)
        }
        const mime = stats.isDirectory() ? "application/x-directory" : "text/plain"
        files.push({
          type: "file",
          url: pathToFileURL(resolvedPath).href,
          filename: path.basename(resolvedPath),
          mime,
        })
      }
    }

    if (!process.stdin.isTTY) message += "\n" + (await Bun.stdin.text())

    if (message.trim().length === 0 && !args.command) {
      UI.error("You must provide a message or a command")
      process.exit(1)
    }

    if (args.fork && !args.continue && !args.session) {
      UI.error("--fork requires --continue or --session")
      process.exit(1)
    }

    const rules: PermissionNext.Ruleset = [
      { permission: "question", action: "deny", pattern: "*" },
      { permission: "plan_enter", action: "deny", pattern: "*" },
      { permission: "plan_exit", action: "deny", pattern: "*" },
    ]

    function title() {
      if (args.title === undefined) return
      if (args.title !== "") return args.title
      return message.slice(0, 50) + (message.length > 50 ? "..." : "")
    }

    await bootstrap(process.cwd(), async () => {
      const agent = await (async () => {
        if (!args.agent) return undefined
        const entry = await Agent.get(args.agent)
        if (!entry) {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `agent "${args.agent}" not found. Falling back to default agent`,
          )
          return undefined
        }
        if (entry.mode === "subagent") {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `agent "${args.agent}" is a subagent, not a primary agent. Falling back to default agent`,
          )
          return undefined
        }
        return args.agent
      })()

      let sessionID: string
      if (args.continue) {
        const sessions: Session.Info[] = []
        for (const s of Session.list({ roots: true, limit: 1 })) sessions.push(s)
        const base = sessions[0]
        if (!base) {
          UI.error("No session to continue")
          process.exit(1)
        }
        sessionID = args.fork ? (await Session.fork({ sessionID: base.id })).id : base.id
      } else if (args.session) {
        const base = await Session.get(args.session)
        if (!base) {
          UI.error("Session not found")
          process.exit(1)
        }
        sessionID = args.fork ? (await Session.fork({ sessionID: base.id })).id : base.id
      } else {
        const session = await Session.create({ title: title(), permission: rules })
        sessionID = session.id
      }

      const cfg = await Config.get()
      if (cfg?.share === "auto" || Flag.OPENCODE_AUTO_SHARE || args.share) {
        const res = await Session.share(sessionID).catch((error) => {
          if (error instanceof Error && error.message.includes("disabled")) {
            UI.println(UI.Style.TEXT_DANGER_BOLD + "!  " + error.message)
          }
          return undefined
        })
        if (res?.url) UI.println(UI.Style.TEXT_INFO_BOLD + "~  " + res.url)
      }

      const toggles = new Map<string, boolean>()
      let error: string | undefined
      let started = false

      const unsubMsg = Bus.subscribe(MessageV2.Event.Updated, (evt) => {
        if (evt.properties.info.sessionID !== sessionID) return
        if (evt.properties.info.role !== "assistant") return
        if (args.format === "json" || started) return
        started = true
        const info = evt.properties.info as MessageV2.Assistant
        UI.empty()
        UI.println(`> ${info.agent} · ${info.modelID}`)
        UI.empty()
      })

      const unsubPart = Bus.subscribe(MessageV2.Event.PartUpdated, (evt) => {
        const part = evt.properties.part
        if (part.sessionID !== sessionID) return

        if (part.type === "tool" && part.state.status === "completed") {
          if (args.format === "json") {
            process.stdout.write(JSON.stringify({ type: "tool_use", timestamp: Date.now(), sessionID, part }) + EOL)
            return
          }
          tool(part)
        }

        if (part.type === "tool" && part.tool === "task" && part.state.status === "running") {
          if (toggles.get(part.id)) return
          if (args.format !== "json") task(props<typeof TaskTool>(part))
          toggles.set(part.id, true)
        }

        if (part.type === "text" && part.time?.end) {
          const text = part.text.trim()
          if (!text) return
          if (args.format === "json") {
            process.stdout.write(JSON.stringify({ type: "text", timestamp: Date.now(), sessionID, part }) + EOL)
            return
          }
          if (!process.stdout.isTTY) process.stdout.write(text + EOL)
          else {
            UI.empty()
            UI.println(text)
            UI.empty()
          }
        }

        if (part.type === "reasoning" && part.time?.end && args.thinking) {
          const text = part.text.trim()
          if (!text) return
          const line = `Thinking: ${text}`
          if (process.stdout.isTTY) {
            UI.empty()
            UI.println(`${UI.Style.TEXT_DIM}\u001b[3m${line}\u001b[0m${UI.Style.TEXT_NORMAL}`)
            UI.empty()
          } else process.stdout.write(line + EOL)
        }
      })

      const unsubError = Bus.subscribe(Session.Event.Error, (evt) => {
        if (evt.properties.sessionID && evt.properties.sessionID !== sessionID) return
        const err = evt.properties.error
        const msg =
          err && typeof err === "object" && "data" in err && err.data && "message" in err.data
            ? String((err.data as { message: string }).message)
            : String(err?.name ?? err)
        error = error ? error + EOL + msg : msg
        if (args.format === "json") {
          process.stdout.write(JSON.stringify({ type: "error", timestamp: Date.now(), error: err }) + EOL)
          return
        }
        UI.error(msg)
      })

      const unsubPermission = Bus.subscribe(PermissionNext.Event.Asked, (evt) => {
        if (evt.properties.sessionID !== sessionID) return
        if (args.format !== "json") {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL +
              `permission requested: ${evt.properties.permission} (${evt.properties.patterns.join(", ")}); auto-rejecting`,
          )
        }
        PermissionNext.reply({ requestID: evt.properties.id, reply: "reject" })
      })

      let unsubStatus: () => void
      const idlePromise = new Promise<void>((resolve) => {
        unsubStatus = Bus.subscribe(SessionStatus.Event.Status, (evt) => {
          if (evt.properties.sessionID === sessionID && evt.properties.status.type === "idle") {
            unsubStatus()
            resolve()
          }
        })
      })

      const runPromise = (async () => {
        if (args.command) {
          await SessionPrompt.command({
            sessionID,
            agent,
            model: args.model,
            command: args.command,
            arguments: message,
            variant: args.variant,
          })
        } else {
          const model = args.model ? Provider.parseModel(args.model) : undefined
          await SessionPrompt.prompt({
            sessionID,
            agent,
            model,
            variant: args.variant,
            parts: [...files, { type: "text", text: message }],
          })
        }
      })()

      await Promise.all([runPromise, idlePromise])

      unsubMsg()
      unsubPart()
      unsubError()
      unsubPermission()

      if (error) process.exit(1)
    })
  },
})
