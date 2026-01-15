import { createMemo, onMount } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import type { Part, Message, AssistantMessage, ToolPart, FilePart } from "@opencode-ai/sdk/v2"
import { Locale } from "@/util/locale"
import { DialogMessage } from "./dialog-message"
import { useDialog } from "../../ui/dialog"
import type { PromptInfo } from "../../component/prompt/history"
import { Token } from "@/util/token"
import { useTheme } from "@tui/context/theme"
import { useSDK } from "@tui/context/sdk"
import fs from "fs"
import path from "path"
import { produce } from "solid-js/store"
import { Binary } from "@opencode-ai/util/binary"
import { Global } from "@/global"

function formatTokenCount(tokens: number): string {
  return tokens.toString().padStart(7)
}

function getMessageTokens(message: Message, parts: Part[], isCompaction: boolean = false): number {
  if (message.role === "assistant") {
    const assistantMsg = message as AssistantMessage
    let total = 0

    // Calculate tokens for this message turn only (not cumulative)
    if (assistantMsg.tokens) {
      const input = assistantMsg.tokens.input || 0
      const output = assistantMsg.tokens.output || 0
      const cacheWrite = assistantMsg.tokens.cache?.write || 0
      const reasoning = assistantMsg.tokens.reasoning || 0

      // Exclude cacheRead as it represents cumulative context, not this message's cost
      total = input + output + cacheWrite + reasoning
    } else {
      // Fall back to aggregating from step-finish parts
      for (const part of parts) {
        if (part.type === "step-finish" && (part as any).tokens) {
          const tokens = (part as any).tokens
          total += tokens.input + tokens.output + (tokens.reasoning || 0)
        }
      }
    }

    // Add tool output tokens (not included in message.tokens)
    for (const part of parts) {
      if (part.type === "tool") {
        const toolPart = part as ToolPart
        const state = toolPart.state as any
        if (state?.output) {
          const output = typeof state.output === "string" ? state.output : JSON.stringify(state.output)
          total += Token.estimate(output)
        }
      }
    }

    return total
  }

  // User message - estimate from parts
  let estimate = 0
  for (const part of parts) {
    if (part.type === "text" && !part.synthetic && !part.ignored) {
      estimate += Token.estimate(part.text)
    }
    if (part.type === "file") {
      const filePart = part as FilePart
      if (filePart.source?.text?.value) {
        estimate += Token.estimate(filePart.source.text.value)
      } else if (filePart.mime.startsWith("image/")) {
        estimate += Token.estimateImage(filePart.url)
      }
    }
  }
  return estimate
}

function getMessageSummary(parts: Part[]): string {
  const textPart = parts.find((x) => x.type === "text" && !x.synthetic && !x.ignored)
  if (textPart && textPart.type === "text") {
    return textPart.text.replace(/\n/g, " ")
  }

  const toolParts = parts.filter((x) => x.type === "tool") as ToolPart[]
  if (toolParts.length > 0) {
    const tools = toolParts.map((p) => p.tool).join(", ")
    return `[${tools}]`
  }

  const fileParts = parts.filter((x) => x.type === "file") as FilePart[]
  if (fileParts.length > 0) {
    const files = fileParts.map((p) => p.filename || "file").join(", ")
    return `[files: ${files}]`
  }

  return "[no content]"
}

export function DialogTimeline(props: {
  sessionID: string
  onMove: (messageID: string) => void
  setPrompt?: (prompt: PromptInfo) => void
}) {
  const syncCtx = useSync()
  const sync = syncCtx.data
  const setStore = syncCtx.set
  const dialog = useDialog()
  const { theme } = useTheme()
  const sdk = useSDK()

  onMount(() => {
    dialog.setSize("large")
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const messages = sync.message[props.sessionID] ?? []
    const result = [] as DialogSelectOption<string>[]

    for (const message of messages) {
      const parts = sync.part[message.id] ?? []

      // Check if this is a compaction summary message
      const isCompactionSummary = message.role === "assistant" && (message as AssistantMessage).summary === true

      // Get the token count for this specific message (delta only, not cumulative)
      const messageTokens = getMessageTokens(message, parts, isCompactionSummary)

      // Display the tokens directly (no cumulative calculation needed)
      const delta = messageTokens

      const formatted = formatTokenCount(delta)

      // Token count color based on thresholds (cold to hot gradient)
      // Using delta for color coding
      let tokenColor = theme.textMuted // grey < 1k
      if (delta >= 20000) {
        tokenColor = theme.error // red 20k+
      } else if (delta >= 10000) {
        tokenColor = theme.warning // orange 10k+
      } else if (delta >= 5000) {
        tokenColor = theme.accent // purple 5k+
      } else if (delta >= 2000) {
        tokenColor = theme.secondary // blue 2k+
      } else if (delta >= 1000) {
        tokenColor = theme.info // cyan 1k+
      }

      const summary = getMessageSummary(parts)

      // Debug: Extract token breakdown for assistant messages
      let tokenDebug = ""
      if (message.role === "assistant") {
        const assistantMsg = message as AssistantMessage
        if (assistantMsg.tokens) {
          const input = assistantMsg.tokens.input || 0
          const output = assistantMsg.tokens.output || 0
          const cacheRead = assistantMsg.tokens.cache?.read || 0
          const cacheWrite = assistantMsg.tokens.cache?.write || 0
          const reasoning = assistantMsg.tokens.reasoning || 0
          tokenDebug = `(${input}/${output}/${cacheRead}/${cacheWrite}/${reasoning}) `
        }
      }

      const prefix = isCompactionSummary ? "[compaction] " : message.role === "assistant" ? "agent: " : ""
      const title = tokenDebug + prefix + summary

      const gutter = <text fg={tokenColor}>[{formatted}]</text>

      // Normal assistant messages use textMuted for title
      const isAssistant = message.role === "assistant" && !isCompactionSummary

      result.push({
        title,
        gutter: isCompactionSummary ? <text fg={theme.success}>[{formatted}]</text> : gutter,
        value: message.id,
        footer: Locale.time(message.time.created),
        titleColor: isCompactionSummary ? theme.success : isAssistant ? theme.textMuted : undefined,
        footerColor: isCompactionSummary ? theme.success : undefined,
        bg: isCompactionSummary ? theme.success : undefined,
        onSelect: (dialog) => {
          dialog.replace(() => (
            <DialogMessage messageID={message.id} sessionID={props.sessionID} setPrompt={props.setPrompt} />
          ))
        },
      })
    }

    result.reverse()
    return result
  })

  const handleDelete = async (messageID: string) => {
    try {
      const storageBase = path.join(Global.Path.data, "storage")

      // Delete message file
      const messagePath = path.join(storageBase, "message", props.sessionID, `${messageID}.json`)
      if (fs.existsSync(messagePath)) {
        fs.unlinkSync(messagePath)
      }

      // Delete all part files
      const partsDir = path.join(storageBase, "part", messageID)
      if (fs.existsSync(partsDir)) {
        const partFiles = fs.readdirSync(partsDir)
        for (const file of partFiles) {
          fs.unlinkSync(path.join(partsDir, file))
        }
        fs.rmdirSync(partsDir)
      }

      // Invalidate session cache by setting the flag in storage
      const sessionPath = path.join(
        storageBase,
        "session",
        "project_" + sync.session.find((s) => s.id === props.sessionID)?.projectID || "",
        `${props.sessionID}.json`,
      )
      if (fs.existsSync(sessionPath)) {
        const sessionData = JSON.parse(fs.readFileSync(sessionPath, "utf-8"))
        sessionData.cacheInvalidated = true
        fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2))
      }

      // Update the UI store to remove the message
      const messages = sync.message[props.sessionID]
      const result = Binary.search(messages, messageID, (m) => m.id)
      if (result.found) {
        setStore(
          "message",
          props.sessionID,
          produce((draft) => {
            draft.splice(result.index, 1)
          }),
        )
      }

      // Also remove parts from UI
      setStore("part", messageID, [])

      // Update session in UI store to reflect cache invalidation
      const sessionIndex = sync.session.findIndex((s) => s.id === props.sessionID)
      if (sessionIndex >= 0) {
        setStore("session", sessionIndex, "cacheInvalidated", true)
      }
    } catch (error) {
      // Silent fail
    }
  }

  return (
    <DialogSelect
      onMove={(option) => props.onMove(option.value)}
      title="Timeline"
      options={options()}
      keybind={[
        {
          keybind: { name: "delete", ctrl: false, meta: false, shift: false, leader: false },
          title: "Delete",
          onTrigger: (option) => {
            handleDelete(option.value)
          },
        },
      ]}
    />
  )
}
