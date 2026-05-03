import { createInterface } from "readline/promises"
import { EOL } from "os"
import path from "path"
import { UI } from "../ui"
import { bootstrap } from "../bootstrap"
import { createOpencodeClient, type OpencodeClient, type ToolPart } from "@opencode-ai/sdk/v2"
import { Server } from "../../server/server"
import { Provider } from "../../provider/provider"
import { Tool } from "@/tool/tool"
import { GlobTool } from "../../tool/glob"
import { GrepTool } from "../../tool/grep"
import { ReadTool } from "../../tool/read"
import { WebFetchTool } from "../../tool/webfetch"
import { EditTool } from "../../tool/edit"
import { WriteTool } from "../../tool/write"
import { WebSearchTool } from "../../tool/websearch"
import { TaskTool } from "../../tool/task"
import { SkillTool } from "../../tool/skill"
import { ShellTool } from "../../tool/shell"
import { ShellID } from "../../tool/shell/id"
import { TodoWriteTool } from "../../tool/todo"
import { Locale } from "@/util/locale"

type ToolProps<T> = {
  input: Tool.InferParameters<T>
  metadata: Tool.InferMetadata<T>
  part: ToolPart
}

function props<T>(part: ToolPart): ToolProps<T> {
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

function websearch(info: ToolProps<typeof WebSearchTool>) {
  inline({
    icon: "◈",
    title: `Exa Web Search "${info.input.query}"`,
  })
}

function task(info: ToolProps<typeof TaskTool>) {
  const input = info.part.state.input
  const status = info.part.state.status
  const subagent =
    typeof input.subagent_type === "string" && input.subagent_type.trim().length > 0 ? input.subagent_type : "unknown"
  const agent = Locale.titlecase(subagent)
  const desc =
    typeof input.description === "string" && input.description.trim().length > 0 ? input.description : undefined
  const icon = status === "error" ? "✗" : status === "running" ? "•" : "✓"
  const name = desc ?? `${agent} Task`
  inline({
    icon,
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

function shell(info: ToolProps<typeof ShellTool>) {
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

function renderTool(part: ToolPart) {
  try {
    if (part.tool === ShellID.ToolID) return shell(props<typeof ShellTool>(part))
    if (part.tool === "glob") return glob(props<typeof GlobTool>(part))
    if (part.tool === "grep") return grep(props<typeof GrepTool>(part))
    if (part.tool === "read") return read(props<typeof ReadTool>(part))
    if (part.tool === "write") return write(props<typeof WriteTool>(part))
    if (part.tool === "webfetch") return webfetch(props<typeof WebFetchTool>(part))
    if (part.tool === "edit") return edit(props<typeof EditTool>(part))
    if (part.tool === "websearch") return websearch(props<typeof WebSearchTool>(part))
    if (part.tool === "task") return task(props<typeof TaskTool>(part))
    if (part.tool === "todowrite") return todo(props<typeof TodoWriteTool>(part))
    if (part.tool === "skill") return skill(props<typeof SkillTool>(part))
    return fallback(part)
  } catch {
    return fallback(part)
  }
}

export type ReplOptions = {
  directory: string
  agent?: string
  model?: string
  variant?: string
  continueLast?: boolean
  sessionID?: string
  initialPrompt?: string
  thinking?: boolean
}

export async function repl(opts: ReplOptions): Promise<void> {
  await bootstrap(opts.directory, async () => {
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      return Server.Default().app.fetch(request)
    }) as typeof globalThis.fetch
    const sdk = createOpencodeClient({ baseUrl: "http://opencode.internal", fetch: fetchFn })

    const sessionID = await initSession(sdk, opts)
    if (!sessionID) {
      UI.error("Failed to initialize session")
      process.exitCode = 1
      return
    }

    if (process.stdout.isTTY) {
      process.stdout.write(
        UI.Style.TEXT_DIM +
          `opencode · session ${sessionID.slice(-6)} · ctrl+d to exit · :q or /exit to quit` +
          UI.Style.TEXT_NORMAL +
          EOL,
      )
      process.stdout.write(EOL)
    }

    if (opts.initialPrompt && opts.initialPrompt.trim().length > 0) {
      await turn(sdk, sessionID, opts, opts.initialPrompt.trim())
    }

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: process.stdout.isTTY === true,
    })

    while (true) {
      const line = await rl.question(UI.Style.TEXT_HIGHLIGHT_BOLD + "» " + UI.Style.TEXT_NORMAL).catch(() => undefined)
      if (line === undefined) break
      const trimmed = line.trim()
      if (!trimmed) continue
      if (trimmed === ":q" || trimmed === "/exit" || trimmed === "/quit") break

      await turn(sdk, sessionID, opts, trimmed).catch((e) => {
        UI.error(e instanceof Error ? e.message : String(e))
      })
    }
    rl.close()
    if (process.stdout.isTTY) process.stdout.write(EOL)
  })
}

async function initSession(sdk: OpencodeClient, opts: ReplOptions): Promise<string | undefined> {
  if (opts.sessionID) return opts.sessionID
  if (opts.continueLast) {
    const list = await sdk.session.list()
    const last = list.data?.find((s) => !s.parentID)
    if (last) return last.id
  }
  const result = await sdk.session.create({})
  return result.data?.id
}

async function turn(sdk: OpencodeClient, sessionID: string, opts: ReplOptions, message: string): Promise<void> {
  const events = await sdk.event.subscribe()

  const consume = (async () => {
    const toggles = new Map<string, boolean>()
    for await (const event of events.stream) {
      if (event.type === "message.part.updated") {
        const part = event.properties.part
        if (part.sessionID !== sessionID) continue

        if (part.type === "tool" && (part.state.status === "completed" || part.state.status === "error")) {
          if (part.state.status === "completed") {
            renderTool(part)
            continue
          }
          inline({ icon: "✗", title: `${part.tool} failed` })
          UI.error(part.state.error)
        }

        if (part.type === "tool" && part.tool === "task" && part.state.status === "running") {
          if (toggles.get(part.id) === true) continue
          task(props<typeof TaskTool>(part))
          toggles.set(part.id, true)
        }

        if (part.type === "text" && part.time?.end) {
          const text = part.text.trim()
          if (!text) continue
          UI.empty()
          UI.println(text)
          UI.empty()
        }

        if (part.type === "reasoning" && part.time?.end && opts.thinking) {
          const text = part.text.trim()
          if (!text) continue
          UI.empty()
          UI.println(`${UI.Style.TEXT_DIM}[3mThinking: ${text}[0m${UI.Style.TEXT_NORMAL}`)
          UI.empty()
        }
      }

      if (event.type === "session.error") {
        const props = event.properties
        if (props.sessionID !== sessionID || !props.error) continue
        let err = String(props.error.name)
        if ("data" in props.error && props.error.data && "message" in props.error.data) {
          err = String(props.error.data.message)
        }
        UI.error(err)
      }

      if (
        event.type === "session.status" &&
        event.properties.sessionID === sessionID &&
        event.properties.status.type === "idle"
      ) {
        return
      }

      if (event.type === "permission.asked") {
        const permission = event.properties
        if (permission.sessionID !== sessionID) continue
        await sdk.permission.reply({
          requestID: permission.id,
          reply: "once",
        })
      }
    }
  })()

  const model = opts.model ? Provider.parseModel(opts.model) : undefined
  await sdk.session
    .prompt({
      sessionID,
      agent: opts.agent,
      model,
      variant: opts.variant,
      parts: [{ type: "text", text: message }],
    })
    .catch((e) => {
      UI.error(e instanceof Error ? e.message : String(e))
    })

  await consume
}
