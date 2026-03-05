import { batch } from "solid-js"
import type { AssistantMessage, UserMessage } from "@opencode-ai/sdk/v2"

type SessionMessage =
  | Pick<UserMessage, "id" | "role" | "time">
  | Pick<AssistantMessage, "id" | "role" | "parentID" | "time" | "error">

const isAbortedAssistant = (
  message: SessionMessage,
): message is SessionMessage & { role: "assistant"; parentID: string } =>
  message.role === "assistant" && message.error?.name === "MessageAbortedError"

export const focusTerminalById = (id: string) => {
  const wrapper = document.getElementById(`terminal-wrapper-${id}`)
  const terminal = wrapper?.querySelector('[data-component="terminal"]')
  if (!(terminal instanceof HTMLElement)) return false

  const textarea = terminal.querySelector("textarea")
  if (textarea instanceof HTMLTextAreaElement) {
    textarea.focus()
    return true
  }

  terminal.focus()
  terminal.dispatchEvent(
    typeof PointerEvent === "function"
      ? new PointerEvent("pointerdown", { bubbles: true, cancelable: true })
      : new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
  )
  return true
}

export const createOpenReviewFile = (input: {
  showAllFiles: () => void
  tabForPath: (path: string) => string
  openTab: (tab: string) => void
  setActive: (tab: string) => void
  loadFile: (path: string) => any | Promise<void>
}) => {
  return (path: string) => {
    batch(() => {
      input.showAllFiles()
      const maybePromise = input.loadFile(path)
      const open = () => {
        const tab = input.tabForPath(path)
        input.openTab(tab)
        input.setActive(tab)
      }
      if (maybePromise instanceof Promise) maybePromise.then(open)
      else open()
    })
  }
}

export const createOpenSessionFileTab = (input: {
  normalizeTab: (tab: string) => string
  openTab: (tab: string) => void
  pathFromTab: (tab: string) => string | undefined
  loadFile: (path: string) => void
  openReviewPanel: () => void
  setActive: (tab: string) => void
}) => {
  return (value: string) => {
    const next = input.normalizeTab(value)
    input.openTab(next)

    const path = input.pathFromTab(next)
    if (!path) return

    input.loadFile(path)
    input.openReviewPanel()
    input.setActive(next)
  }
}

export const getTabReorderIndex = (tabs: readonly string[], from: string, to: string) => {
  const fromIndex = tabs.indexOf(from)
  const toIndex = tabs.indexOf(to)
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return undefined
  return toIndex
}

export const interruptedMessageIDs = (messages: SessionMessage[]) => {
  const users = messages.filter((message): message is SessionMessage & { role: "user" } => message.role === "user")
  const assisted = new Set(
    messages.flatMap((message) => (message.role === "assistant" && message.parentID ? [message.parentID] : [])),
  )
  const interrupted = new Set(messages.flatMap((message) => (isAbortedAssistant(message) ? [message.parentID] : [])))

  for (const message of messages) {
    if (!isAbortedAssistant(message)) continue
    const start = message.time?.created
    const end = message.time?.completed
    if (typeof start !== "number" || typeof end !== "number") continue

    users
      .filter((user) => user.time?.created !== undefined && user.time.created >= start && user.time.created <= end)
      .filter((user) => !assisted.has(user.id))
      .forEach((user) => interrupted.add(user.id))
  }

  return interrupted
}
