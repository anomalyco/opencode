import { Session } from "@opencode/schema/session"
import { createStore } from "solid-js/store"
import { Show, createMemo } from "solid-js"
import type { SessionInbox } from "@opencode/schema/session-inbox"
import type { PromptInfo } from "../../prompt/history"
import { useTheme } from "../../context/theme"
import { useConfig } from "../../config"
import { SPINNER_FRAMES } from "../spinner"

export type PendingCommand = {
  readonly id: string
  readonly sessionID: Session.ID
  readonly name: string
  readonly arguments?: string
  readonly delivery: SessionInbox.Delivery
  readonly files?: PromptInfo["files"]
  readonly agents?: PromptInfo["agents"]
  readonly skills?: PromptInfo["skills"]
}

const [store, setStore] = createStore<Record<Session.ID, PendingCommand[]>>({})

let nextId = 0
function createCommandId() {
  return `pending-command-${Date.now()}-${++nextId}`
}

export const PendingCommands = {
  list(sessionID: Session.ID | undefined): readonly PendingCommand[] {
    if (!sessionID) return []
    return store[sessionID] ?? []
  },
  add(input: Omit<PendingCommand, "id"> & { id?: string }): PendingCommand {
    const command: PendingCommand = {
      id: input.id ?? createCommandId(),
      sessionID: input.sessionID,
      name: input.name,
      arguments: input.arguments,
      delivery: input.delivery,
      files: input.files,
      agents: input.agents,
      skills: input.skills,
    }
    setStore(input.sessionID, (prev = []) => [...prev, command])
    return command
  },
  remove(id: string, sessionID?: Session.ID) {
    if (sessionID) {
      setStore(sessionID, (prev = []) => prev.filter((item) => item.id !== id))
      return
    }
    for (const key of Object.keys(store).map((key) => Session.ID.make(key, { disableChecks: true }))) {
      if (store[key]?.some((item) => item.id === id)) {
        setStore(key, (prev = []) => prev.filter((item) => item.id !== id))
      }
    }
  },
  clear(sessionID?: Session.ID) {
    if (sessionID) {
      setStore(sessionID, [])
      return
    }
    for (const key of Object.keys(store).map((key) => Session.ID.make(key, { disableChecks: true }))) {
      setStore(key, [])
    }
  },
}

export function formatPendingCommandText(command: PendingCommand, moreCount = 0): string {
  const parts = [`Resolving /${command.name}`]
  if (command.arguments) parts.push(command.arguments)
  if (command.delivery === "queue") parts.push("(queue)")
  if (moreCount > 0) parts.push(`(+${moreCount} more)`)
  return parts.join(" ") + "…"
}

export function PromptPendingCommands(props: { commands: readonly PendingCommand[] }) {
  const theme = useTheme()
  const config = useConfig().data
  const first = createMemo(() => props.commands[0])
  const moreCount = createMemo(() => Math.max(0, props.commands.length - 1))
  const text = createMemo(() => {
    const cmd = first()
    if (!cmd) return ""
    return formatPendingCommandText(cmd, moreCount())
  })
  const color = () => theme.text.feedback.info.base

  return (
    <Show when={first()}>
      <box flexDirection="row" gap={1} flexShrink={1} minWidth={0} height={1}>
        <box flexShrink={0}>
          <Show when={config.animations ?? true} fallback={<text fg={color()}>⋯</text>}>
            <spinner frames={SPINNER_FRAMES} interval={80} color={color()} />
          </Show>
        </box>
        <text fg={color()} wrapMode="none" truncate flexShrink={1} minWidth={0}>
          {text()}
        </text>
      </box>
    </Show>
  )
}
