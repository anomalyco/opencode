import { TextAttributes, ScrollBoxRenderable } from "@opentui/core"
import { useDialog, type DialogContext } from "./dialog"
import { createStore } from "solid-js/store"
import { For, createMemo, onMount, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useKeyboard } from "@opentui/solid"
import { Locale } from "@/util/locale"
import type { AssistantMessage, UserMessage, Part, TextPart } from "@opencode-ai/sdk/v2"

// Internal representation of a single message with its metadata and content parts
type Message = {
  info: AssistantMessage | UserMessage
  parts: (Part | TextPart)[]
}

// Display option for each message in the checklist
type Option = {
  id: string
  title: string
  footerNode: any
}

export type DialogCopyMessagesProps = {
  messages: Message[]
  onConfirm: (selected: Message[]) => void
  onCancel?: () => void
}

export function DialogCopyMessages(props: DialogCopyMessagesProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [store, setStore] = createStore({
    selected: new Set<string>(), // Set of currently selected message IDs
    scrollIndex: 0, // Index of currently highlighted item in the list
    warningNoMessagesSelected: false, // Show warning when confirm is pressed with no selection
  })

  let scroll: ScrollBoxRenderable | undefined

  // Set dialog to large size
  onMount(() => {
    dialog.setSize("large")
  })

  // Transform raw messages into display-friendly options
  const options = createMemo(() =>
    props.messages.map((msg, i) => {
      // Extract text content: filter out synthetic parts, and limit to first 60 chars
      const textContent = msg.parts
        .filter((p): p is TextPart => p.type === "text" && !p.synthetic)
        .map((p) => p.text)
        .join("")
        .slice(0, 60)

      const isAssistant = msg.info.role === "assistant"

      // Get source identifier with color (model name for assistant, "user" for user messages)
      const modelName = isAssistant ? (msg.info as AssistantMessage).modelID : "user"
      const modelColor = isAssistant ? theme.primary : theme.secondary

      // Calculate execution duration for assistant messages
      const duration = isAssistant
        ? Locale.duration(
            (msg.info as AssistantMessage).time.completed
              ? (msg.info as AssistantMessage).time.completed! - (msg.info as AssistantMessage).time.created
              : 0,
          )
        : ""

      // Show absolute timestamp for user messages
      const userTimestamp = !isAssistant ? new Date(msg.info.time.created).toLocaleTimeString() : ""

      return {
        id: msg.info.id,
        title: textContent || "(empty)",
        footerNode: (
          <text fg={theme.textMuted}>
            <span style={{ fg: modelColor }}>{modelName}</span>
            {duration && <span>{` · ${duration}`}</span>}
            {userTimestamp && <span>{` · ${userTimestamp}`}</span>}
          </text>
        ),
      }
    }),
  )

  // Flat list of all options (no grouping)
  const flatOptions = createMemo((): Option[] => options())

  // Toggle selection state for a message
  function toggle(id: string) {
    const newSelected = new Set(store.selected)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setStore("selected", newSelected)
  }

  // Navigate through list with wrapping (loops to end when at start and vice versa)
  function move(offset: number) {
    const opts = flatOptions()
    let next = store.scrollIndex + offset
    if (next < 0) next = opts.length - 1 // Wrap to end
    if (next >= opts.length) next = 0 // Wrap to start
    setStore("scrollIndex", next)
    scrollToActive()
  }

  // Scroll to keep active item visible
  function scrollToActive() {
    if (!scroll) return
    const children = scroll.getChildren()
    if (children.length === 0) return
    const target = children[store.scrollIndex]
    if (!target) return
    const y = target.y - scroll.y
    // Keep item visible: scroll down if item is below viewport, up if above
    if (y >= scroll.height) {
      scroll.scrollBy(y - scroll.height + 1)
    } else if (y < 0) {
      scroll.scrollBy(y)
    }
  }

  // Confirm selection: filter messages by selected IDs and invoke callback
  function confirm() {
    const selected = props.messages.filter((m) => store.selected.has(m.info.id))
    props.onConfirm(selected)
  }

  // Show warning and auto-dismiss after 2 seconds
  function showwarningNoMessagesSelected() {
    setStore("warningNoMessagesSelected", true)
    setTimeout(() => setStore("warningNoMessagesSelected", false), 2000)
  }

  // Handle keyboard input for navigation and actions
  useKeyboard((evt) => {
    if (evt.name === "up") move(-1) // Navigate up
    if (evt.name === "down") move(1) // Navigate down
    if (evt.name === "space") {
      // Toggle selection of currently highlighted item
      const opt = flatOptions()[store.scrollIndex]
      if (opt) toggle(opt.id)
      evt.preventDefault()
    }
    if (evt.name === "return") {
      // Confirm and copy selected messages (only if at least one is selected)
      if (store.selected.size > 0) confirm()
      else showwarningNoMessagesSelected()
    }
    if (evt.name === "a" && evt.ctrl) {
      // Select all messages (Ctrl+A)
      const allIds = new Set(flatOptions().map((o) => o.id))
      setStore("selected", allIds)
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      {/* Header with title and close hint */}
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Copy Messages
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      {/* Status line showing selection count or warning message */}
      <Show
        when={!store.warningNoMessagesSelected}
        fallback={<text fg={theme.warning || theme.text}>Please select at least one message</text>}
      >
        <text fg={theme.textMuted}>Select messages to copy ({store.selected.size} selected)</text>
      </Show>

      {/* Scrollable list of messages */}
      <scrollbox maxHeight={15} scrollbarOptions={{ visible: false }} ref={(r: ScrollBoxRenderable) => (scroll = r)}>
        <For each={flatOptions()}>
          {(opt, i) => {
            const msgIndex = createMemo(() => props.messages.findIndex((m) => m.info.id === opt.id))
            const isSelected = createMemo(() => store.selected.has(opt.id))
            const isActive = createMemo(() => msgIndex() === store.scrollIndex)

            return (
              <box
                flexDirection="row"
                gap={2}
                paddingLeft={1}
                paddingRight={1}
                // Highlight active row with background color
                backgroundColor={isActive() ? theme.backgroundElement : undefined}
                // Click to toggle selection
                onMouseUp={() => toggle(opt.id)}
                // Hover to change active item
                onMouseOver={() => setStore("scrollIndex", msgIndex())}
              >
                {/* Checkbox indicator */}
                <text fg={isSelected() ? theme.primary : theme.textMuted}>{isSelected() ? "[x]" : "[ ]"}</text>
                {/* Message preview (title) */}
                <text fg={isActive() ? theme.text : theme.textMuted} flexGrow={1} overflow="hidden">
                  {opt.title}
                </text>
                {/* Model/duration info */}
                <box width={20}>{opt.footerNode}</box>
              </box>
            )
          }}
        </For>
      </scrollbox>

      {/* Keyboard shortcuts legend */}
      <box flexDirection="row" gap={2}>
        <text fg={theme.textMuted}>
          <span style={{ fg: theme.text }}>space</span> toggle
        </text>
        <text fg={theme.textMuted}>
          <span style={{ fg: theme.text }}>ctrl+a</span> all
        </text>
        <text fg={theme.textMuted}>
          <span style={{ fg: theme.text }}>return</span> copy
        </text>
      </box>
    </box>
  )
}

// Static helper method to show this dialog and get selected messages
// Returns: Promise resolving to selected messages array or null if cancelled
DialogCopyMessages.show = (dialog: DialogContext, messages: Message[]): Promise<Message[] | null> => {
  return new Promise((resolve) => {
    dialog.replace(
      () => (
        <DialogCopyMessages
          messages={messages}
          onConfirm={(selected) => resolve(selected)} // Resolve with selected messages
          onCancel={() => resolve(null)} // Resolve with null on cancel
        />
      ),
      () => resolve(null), // Close callback: resolve with null
    )
  })
}
