import { select } from "@clack/prompts"
import { EOL } from "os"
import { UI } from "../../opencode/src/cli/ui"
import { Command } from "../../opencode/src/command"

export type ForkRunState = {
  error?: string
  awaitLoop?: boolean
}

export type ForkRunEventResult = {
  handled?: boolean
  stop?: boolean
}

export type ForkRunSessionInput = {
  title?: string
  permission?: Array<{
    permission: string
    action: "ask" | "allow" | "deny"
    pattern: string
  }>
}

type ForkRunEventContext = {
  args: Record<string, any>
  sessionID?: string
  sdk: any
  state: ForkRunState
}

type ForkRunSessionContext = {
  mode: "attach" | "local"
  args: Record<string, any>
  message: string
  title?: string
  rules: unknown
}

const TOOL: Record<string, [string, string]> = {
  todowrite: ["Todo", UI.Style.TEXT_WARNING_BOLD],
  todoread: ["Todo", UI.Style.TEXT_WARNING_BOLD],
  bash: ["Bash", UI.Style.TEXT_DANGER_BOLD],
  edit: ["Edit", UI.Style.TEXT_SUCCESS_BOLD],
  glob: ["Glob", UI.Style.TEXT_INFO_BOLD],
  grep: ["Grep", UI.Style.TEXT_INFO_BOLD],
  list: ["List", UI.Style.TEXT_INFO_BOLD],
  read: ["Read", UI.Style.TEXT_HIGHLIGHT_BOLD],
  write: ["Write", UI.Style.TEXT_SUCCESS_BOLD],
  websearch: ["Search", UI.Style.TEXT_DIM_BOLD],
}

export function createForkRunState(): ForkRunState {
  return {
    awaitLoop: true,
  }
}

export async function handleForkRunEvent(
  event: any,
  ctx: ForkRunEventContext,
): Promise<ForkRunEventResult | undefined> {
  if (!event?.type) return undefined

  const { args, sessionID, sdk, state } = ctx
  const format = args.format ?? "default"

  const outputJsonEvent = (type: string, data: any) => {
    if (format === "json") {
      process.stdout.write(JSON.stringify({ type, timestamp: Date.now(), sessionID, ...data }) + EOL)
      return true
    }
    return false
  }

  const printEvent = (color: string, type: string, title: string) => {
    UI.println(
      color + "|",
      UI.Style.TEXT_NORMAL + UI.Style.TEXT_DIM + ` ${type.padEnd(7, " ")}`,
      "",
      UI.Style.TEXT_NORMAL + title,
    )
  }

  if (event.type === "message.updated") {
    return { handled: true }
  }

  if (event.type === "message.part.updated") {
    const part = event.properties?.part
    if (!part || part.sessionID !== sessionID) return { handled: true }

    if (part.type === "tool" && part.state.status === "completed") {
      if (outputJsonEvent("tool_use", { part })) return { handled: true }
      const [tool, color] = TOOL[part.tool] ?? [part.tool, UI.Style.TEXT_INFO_BOLD]
      const title =
        part.state.title ||
        (part.state.input && typeof part.state.input === "object" && Object.keys(part.state.input).length > 0
          ? JSON.stringify(part.state.input)
          : "Unknown")
      printEvent(color, tool, title)
      if (part.tool === "bash" && part.state.output?.trim()) {
        UI.println()
        UI.println(part.state.output)
      }
    }

    if (part.type === "step-start") {
      if (outputJsonEvent("step_start", { part })) return { handled: true }
    }

    if (part.type === "step-finish") {
      if (outputJsonEvent("step_finish", { part })) return { handled: true }
    }

    if (part.type === "text" && part.time?.end) {
      if (outputJsonEvent("text", { part })) return { handled: true }
      const isPiped = !process.stdout.isTTY
      if (!isPiped) UI.println()
      process.stdout.write((isPiped ? part.text : UI.markdown(part.text)) + EOL)
      if (!isPiped) UI.println()
    }

    return { handled: true }
  }

  if (event.type === "session.error") {
    const props = event.properties
    if (props?.sessionID !== sessionID || !props?.error) return { handled: true }
    let err = String(props.error.name)
    if ("data" in props.error && props.error.data && "message" in props.error.data) {
      err = String(props.error.data.message)
    }
    state.error = state.error ? state.error + EOL + err : err
    if (outputJsonEvent("error", { error: props.error })) return { handled: true }
    UI.error(err)
    return { handled: true }
  }

  if (event.type === "session.idle" && event.properties?.sessionID === sessionID) {
    return { handled: true, stop: true }
  }

  if (event.type === "session.status") {
    return { handled: true }
  }

  if (event.type === "permission.asked") {
    const permission = event.properties
    if (permission?.sessionID !== sessionID) return { handled: true }
    const result = await select({
      message: `Permission required: ${permission.permission} (${permission.patterns?.join(", ") ?? ""})`,
      options: [
        { value: "once", label: "Allow once" },
        { value: "always", label: "Always allow: " + (permission.always ?? []).join(", ") },
        { value: "reject", label: "Reject" },
      ],
      initialValue: "once",
    }).catch(() => "reject")
    const response = (result.toString().includes("cancel") ? "reject" : result) as "once" | "always" | "reject"
    await sdk.permission.respond({
      sessionID,
      permissionID: permission.id,
      response,
    })
    return { handled: true }
  }

  return undefined
}

export function resolveForkRunSessionCreateInput(ctx: ForkRunSessionContext): ForkRunSessionInput | undefined {
  const title = ctx.title
  const questionRule: NonNullable<ForkRunSessionInput["permission"]> = [
    {
      permission: "question",
      action: "deny",
      pattern: "*",
    },
  ]

  if (ctx.mode === "attach") {
    return title ? { title, permission: questionRule } : { permission: questionRule }
  }

  if (ctx.mode === "local") {
    return title ? { title } : {}
  }

  return undefined
}

export async function validateForkRunCommand(command?: string): Promise<string | undefined> {
  if (!command) return undefined
  const exists = await Command.get(command)
  if (!exists) return `Command "${command}" not found`
  return undefined
}
