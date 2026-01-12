import { For, onCleanup, onMount, Show, Match, Switch, createMemo, createEffect, on } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Dynamic } from "solid-js/web"
import { useLocal } from "@/context/local"
import { selectionFromLines, useFile, type SelectedLineRange } from "@/context/file"
import { createStore } from "solid-js/store"
import { PromptInput } from "@/components/prompt-input"
import { SessionContextUsage } from "@/components/session-context-usage"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { DiffChanges } from "@opencode-ai/ui/diff-changes"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Tabs } from "@opencode-ai/ui/tabs"
import { useCodeComponent } from "@opencode-ai/ui/context/code"
import { SessionTurn } from "@opencode-ai/ui/session-turn"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import { SessionReview } from "@opencode-ai/ui/session-review"
import { SessionMessageRail } from "@opencode-ai/ui/session-message-rail"

import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { useSync } from "@/context/sync"
import { useTerminal, type LocalPTY } from "@/context/terminal"
import { useLayout } from "@/context/layout"
import { Terminal } from "@/components/terminal"
import { checksum, base64Encode, base64Decode } from "@opencode-ai/util/encode"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogSelectFile } from "@/components/dialog-select-file"
import { DialogSelectModel } from "@/components/dialog-select-model"
import { DialogSelectMcp } from "@/components/dialog-select-mcp"
import { DialogFork } from "@/components/dialog-fork"
import { useCommand } from "@/context/command"
import { useNavigate, useParams } from "@solidjs/router"
import { UserMessage } from "@opencode-ai/sdk/v2"
import type { FileDiff } from "@opencode-ai/sdk/v2/client"
import { useSDK } from "@/context/sdk"
import { usePrompt } from "@/context/prompt"
import { extractPromptFromParts } from "@/utils/prompt"
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"
import { usePermission } from "@/context/permission"
import { showToast } from "@opencode-ai/ui/toast"
import {
  SessionHeader,
  SessionContextTab,
  SortableTab,
  FileVisual,
  SortableTerminalTab,
  NewSessionView,
} from "@/components/session"
import { usePlatform } from "@/context/platform"
import { navMark, navParams } from "@/utils/perf"
import { same } from "@/utils/same"

type DiffStyle = "unified" | "split"

const handoff = {
  prompt: "",
  terminals: [] as string[],
  files: {} as Record<string, SelectedLineRange | null>,
}

interface SessionReviewTabProps {
  diffs: () => FileDiff[]
  view: () => ReturnType<ReturnType<typeof useLayout>["view"]>
  diffStyle: DiffStyle
  onDiffStyleChange?: (style: DiffStyle) => void
  onViewFile?: (file: string) => void
  classes?: {
    root?: string
    header?: string
    container?: string
  }
}

function SessionReviewTab(props: SessionReviewTabProps) {
  let scroll: HTMLDivElement | undefined
  let frame: number | undefined
  let pending: { x: number; y: number } | undefined

  const restoreScroll = (retries = 0) => {
    const el = scroll
    if (!el) return

    const s = props.view().scroll("review")
    if (!s) return

    // Wait for content to be scrollable - content may not have rendered yet
    if (el.scrollHeight <= el.clientHeight && retries < 10) {
      requestAnimationFrame(() => restoreScroll(retries + 1))
      return
    }

    if (el.scrollTop !== s.y) el.scrollTop = s.y
    if (el.scrollLeft !== s.x) el.scrollLeft = s.x
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    pending = {
      x: event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    }
    if (frame !== undefined) return

    frame = requestAnimationFrame(() => {
      frame = undefined

      const next = pending
      pending = undefined
      if (!next) return

      props.view().setScroll("review", next)
    })
  }

  createEffect(
    on(
      () => props.diffs().length,
      () => {
        requestAnimationFrame(restoreScroll)
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    if (frame === undefined) return
    cancelAnimationFrame(frame)
  })

  return (
    <SessionReview
      scrollRef={(el) => {
        scroll = el
        restoreScroll()
      }}
      onScroll={handleScroll}
      open={props.view().review.open()}
      onOpenChange={props.view().review.setOpen}
      classes={{
        root: props.classes?.root ?? "pb-40",
        header: props.classes?.header ?? "px-6",
        container: props.classes?.container ?? "px-6",
      }}
      diffs={props.diffs()}
      diffStyle={props.diffStyle}
      onDiffStyleChange={props.onDiffStyleChange}
      onViewFile={props.onViewFile}
    />
  )
}

export default function Page() {
  const layout = useLayout()
  const local = useLocal()
  const file = useFile()
  const sync = useSync()
  const terminal = useTerminal()
  const dialog = useDialog()
  const codeComponent = useCodeComponent()
  const command = useCommand()
  const platform = usePlatform()
  const params = useParams()
  const navigate = useNavigate()
  const sdk = useSDK()
  const prompt = usePrompt()
  const permission = usePermission()
  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const tabs = createMemo(() => layout.tabs(sessionKey()))
  const view = createMemo(() => layout.view(sessionKey()))

  if (import.meta.env.DEV) {
    createEffect(
      on(
        () => [params.dir, params.id] as const,
        ([dir, id], prev) => {
          if (!id) return
          navParams({ dir, from: prev?.[1], to: id })
        },
      ),
    )

    createEffect(() => {
      const id = params.id
      if (!id) return
      if (!prompt.ready()) return
      navMark({ dir: params.dir, to: id, name: "storage:prompt-ready" })
    })

    createEffect(() => {
      const id = params.id
      if (!id) return
      if (!terminal.ready()) return
      navMark({ dir: params.dir, to: id, name: "storage:terminal-ready" })
    })

    createEffect(() => {
      const id = params.id
      if (!id) return
      if (!file.ready()) return
      navMark({ dir: params.dir, to: id, name: "storage:file-view-ready" })
    })

    createEffect(() => {
      const id = params.id
      if (!id) return
      if (sync.data.message[id] === undefined) return
      navMark({ dir: params.dir, to: id, name: "session:data-ready" })
    })
  }

  const isDesktop = createMediaQuery("(min-width: 768px)")

  function normalizeTab(tab: string) {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }

  function normalizeTabs(list: string[]) {
    const seen = new Set<string>()
    const next: string[] = []
    for (const item of list) {
      const value = normalizeTab(item)
      if (seen.has(value)) continue
      seen.add(value)
      next.push(value)
    }
    return next
  }

  const openTab = (value: string) => {
    const next = normalizeTab(value)
    tabs().open(next)

    const path = file.pathFromTab(next)
    if (path) file.load(path)
  }

  createEffect(() => {
    const active = tabs().active()
    if (!active) return

    const path = file.pathFromTab(active)
    if (path) file.load(path)
  })

  createEffect(() => {
    const current = tabs().all()
    if (current.length === 0) return

    const next = normalizeTabs(current)
    if (same(current, next)) return

    tabs().setAll(next)

    const active = tabs().active()
    if (!active) return
    if (!active.startsWith("file://")) return

    const normalized = normalizeTab(active)
    if (active === normalized) return
    tabs().setActive(normalized)
  })

  const info = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))
  const reviewCount = createMemo(() => info()?.summary?.files ?? 0)
  const hasReview = createMemo(() => reviewCount() > 0)
  const revertMessageID = createMemo(() => info()?.revert?.messageID)
  const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))
  const messagesReady = createMemo(() => {
    const id = params.id
    if (!id) return true
    return sync.data.message[id] !== undefined
  })
  const historyMore = createMemo(() => {
    const id = params.id
    if (!id) return false
    return sync.session.history.more(id)
  })
  const historyLoading = createMemo(() => {
    const id = params.id
    if (!id) return false
    return sync.session.history.loading(id)
  })
  const emptyUserMessages: UserMessage[] = []
  const userMessages = createMemo(() => messages().filter((m) => m.role === "user") as UserMessage[], emptyUserMessages)
  const visibleUserMessages = createMemo(() => {
    const revert = revertMessageID()
    if (!revert) return userMessages()
    return userMessages().filter((m) => m.id < revert)
  }, emptyUserMessages)
  const lastUserMessage = createMemo(() => visibleUserMessages().at(-1))

  createEffect(
    on(
      () => lastUserMessage()?.id,
      () => {
        const msg = lastUserMessage()
        if (!msg) return
        if (msg.agent) local.agent.set(msg.agent)
        if (msg.model) local.model.set(msg.model)
      },
    ),
  )

  const [store, setStore] = createStore({
    activeDraggable: undefined as string | undefined,
    activeTerminalDraggable: undefined as string | undefined,
    expanded: {} as Record<string, boolean>,
    messageId: undefined as string | undefined,
    turnStart: 0,
    mobileTab: "session" as "session" | "review",
    newSessionWorktree: "main",
    promptHeight: 0,
  })

  const renderedUserMessages = createMemo(() => {
    const msgs = visibleUserMessages()
    const start = store.turnStart
    if (start <= 0) return msgs
    if (start >= msgs.length) return emptyUserMessages
    return msgs.slice(start)
  }, emptyUserMessages)

  const newSessionWorktree = createMemo(() => {
    if (store.newSessionWorktree === "create") return "create"
    const project = sync.project
    if (project && sync.data.path.directory !== project.worktree) return sync.data.path.directory
    return "main"
  })

  const activeMessage = createMemo(() => {
    if (!store.messageId) return lastUserMessage()
    const found = visibleUserMessages()?.find((m) => m.id === store.messageId)
    return found ?? lastUserMessage()
  })
  const setActiveMessage = (message: UserMessage | undefined) => {
    setStore("messageId", message?.id)
  }

  function navigateMessageByOffset(offset: number) {
    const msgs = visibleUserMessages()
    if (msgs.length === 0) return

    const current = activeMessage()
    const currentIndex = current ? msgs.findIndex((m) => m.id === current.id) : -1

    let targetIndex: number
    if (currentIndex === -1) {
      targetIndex = offset > 0 ? 0 : msgs.length - 1
    } else {
      targetIndex = currentIndex + offset
    }

    if (targetIndex < 0 || targetIndex >= msgs.length) return

    scrollToMessage(msgs[targetIndex], "auto")
  }

  const diffs = createMemo(() => (params.id ? (sync.data.session_diff[params.id] ?? []) : []))
  const diffsReady = createMemo(() => {
    const id = params.id
    if (!id) return true
    if (!hasReview()) return true
    return sync.data.session_diff[id] !== undefined
  })

  const idle = { type: "idle" as const }
  let inputRef!: HTMLDivElement
  let promptDock: HTMLDivElement | undefined
  let scroller: HTMLDivElement | undefined

  createEffect(() => {
    if (!params.id) return
    sync.session.sync(params.id)
  })

  createEffect(() => {
    if (!view().terminal.opened()) return
    if (!terminal.ready()) return
    if (terminal.all().length !== 0) return
    terminal.new()
  })

  createEffect(
    on(
      () => visibleUserMessages().at(-1)?.id,
      (lastId, prevLastId) => {
        if (lastId && prevLastId && lastId > prevLastId) {
          setStore("messageId", undefined)
        }
      },
      { defer: true },
    ),
  )

  const status = createMemo(() => sync.data.session_status[params.id ?? ""] ?? idle)

  createEffect(
    on(
      () => params.id,
      () => {
        setStore("messageId", undefined)
        setStore("expanded", {})
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const id = lastUserMessage()?.id
    if (!id) return
    setStore("expanded", id, status().type !== "idle")
  })

  command.register(() => [
    {
      id: "session.new",
      title: "New session",
      description: "Create a new session",
      category: "Session",
      keybind: "mod+shift+s",
      slash: "new",
      onSelect: () => navigate(`/${params.dir}/session`),
    },
    {
      id: "file.open",
      title: "Open file",
      description: "Search and open a file",
      category: "File",
      keybind: "mod+p",
      slash: "open",
      onSelect: () => dialog.show(() => <DialogSelectFile />),
    },
    {
      id: "terminal.toggle",
      title: "Toggle terminal",
      description: "Show or hide the terminal",
      category: "View",
      keybind: "ctrl+`",
      slash: "terminal",
      onSelect: () => view().terminal.toggle(),
    },
    {
      id: "review.toggle",
      title: "Toggle review",
      description: "Show or hide the review panel",
      category: "View",
      keybind: "mod+shift+r",
      onSelect: () => view().reviewPanel.toggle(),
    },
    {
      id: "terminal.new",
      title: "New terminal",
      description: "Create a new terminal tab",
      category: "Terminal",
      keybind: "ctrl+shift+`",
      onSelect: () => terminal.new(),
    },
    {
      id: "steps.toggle",
      title: "Toggle steps",
      description: "Show or hide steps for the current message",
      category: "View",
      keybind: "mod+e",
      slash: "steps",
      disabled: !params.id,
      onSelect: () => {
        const msg = activeMessage()
        if (!msg) return
        setStore("expanded", msg.id, (open: boolean | undefined) => !open)
      },
    },
    {
      id: "message.previous",
      title: "Previous message",
      description: "Go to the previous user message",
      category: "Session",
      keybind: "mod+arrowup",
      disabled: !params.id,
      onSelect: () => navigateMessageByOffset(-1),
    },
    {
      id: "message.next",
      title: "Next message",
      description: "Go to the next user message",
      category: "Session",
      keybind: "mod+arrowdown",
      disabled: !params.id,
      onSelect: () => navigateMessageByOffset(1),
    },
    {
      id: "model.choose",
      title: "Choose model",
      description: "Select a different model",
      category: "Model",
      keybind: "mod+'",
      slash: "model",
      onSelect: () => dialog.show(() => <DialogSelectModel />),
    },
    {
      id: "mcp.toggle",
      title: "Toggle MCPs",
      description: "Toggle MCPs",
      category: "MCP",
      keybind: "mod+;",
      slash: "mcp",
      onSelect: () => dialog.show(() => <DialogSelectMcp />),
    },
    {
      id: "agent.cycle",
      title: "Cycle agent",
      description: "Switch to the next agent",
      category: "Agent",
      keybind: "mod+.",
      slash: "agent",
      onSelect: () => local.agent.move(1),
    },
    {
      id: "agent.cycle.reverse",
      title: "Cycle agent backwards",
      description: "Switch to the previous agent",
      category: "Agent",
      keybind: "shift+mod+.",
      onSelect: () => local.agent.move(-1),
    },
    {
      id: "model.variant.cycle",
      title: "Cycle thinking effort",
      description: "Switch to the next effort level",
      category: "Model",
      keybind: "shift+mod+t",
      onSelect: () => {
        local.model.variant.cycle()
        showToast({
          title: "Thinking effort changed",
          description: "The thinking effort has been changed to " + (local.model.variant.current() ?? "Default"),
        })
      },
    },
    {
      id: "permissions.autoaccept",
      title:
        params.id && permission.isAutoAccepting(params.id, sdk.directory)
          ? "Stop auto-accepting edits"
          : "Auto-accept edits",
      category: "Permissions",
      keybind: "mod+shift+a",
      disabled: !params.id || !permission.permissionsEnabled(),
      onSelect: () => {
        const sessionID = params.id
        if (!sessionID) return
        permission.toggleAutoAccept(sessionID, sdk.directory)
        showToast({
          title: permission.isAutoAccepting(sessionID, sdk.directory)
            ? "Auto-accepting edits"
            : "Stopped auto-accepting edits",
          description: permission.isAutoAccepting(sessionID, sdk.directory)
            ? "Edit and write permissions will be automatically approved"
            : "Edit and write permissions will require approval",
        })
      },
    },
    {
      id: "session.undo",
      title: "Undo",
      description: "Undo the last message",
      category: "Session",
      slash: "undo",
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: async () => {
        const sessionID = params.id
        if (!sessionID) return
        if (status()?.type !== "idle") {
          await sdk.client.session.abort({ sessionID }).catch(() => {})
        }
        const revert = info()?.revert?.messageID
        // Find the last user message that's not already reverted
        const message = userMessages().findLast((x) => !revert || x.id < revert)
        if (!message) return
        await sdk.client.session.revert({ sessionID, messageID: message.id })
        // Restore the prompt from the reverted message
        const parts = sync.data.part[message.id]
        if (parts) {
          const restored = extractPromptFromParts(parts, { directory: sdk.directory })
          prompt.set(restored)
        }
        // Navigate to the message before the reverted one (which will be the new last visible message)
        const priorMessage = userMessages().findLast((x) => x.id < message.id)
        setActiveMessage(priorMessage)
      },
    },
    {
      id: "session.redo",
      title: "Redo",
      description: "Redo the last undone message",
      category: "Session",
      slash: "redo",
      disabled: !params.id || !info()?.revert?.messageID,
      onSelect: async () => {
        const sessionID = params.id
        if (!sessionID) return
        const revertMessageID = info()?.revert?.messageID
        if (!revertMessageID) return
        const nextMessage = userMessages().find((x) => x.id > revertMessageID)
        if (!nextMessage) {
          // Full unrevert - restore all messages and navigate to last
          await sdk.client.session.unrevert({ sessionID })
          prompt.reset()
          // Navigate to the last message (the one that was at the revert point)
          const lastMsg = userMessages().findLast((x) => x.id >= revertMessageID)
          setActiveMessage(lastMsg)
          return
        }
        // Partial redo - move forward to next message
        await sdk.client.session.revert({ sessionID, messageID: nextMessage.id })
        // Navigate to the message before the new revert point
        const priorMsg = userMessages().findLast((x) => x.id < nextMessage.id)
        setActiveMessage(priorMsg)
      },
    },
    {
      id: "session.compact",
      title: "Compact session",
      description: "Summarize the session to reduce context size",
      category: "Session",
      slash: "compact",
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: async () => {
        const sessionID = params.id
        if (!sessionID) return
        const model = local.model.current()
        if (!model) {
          showToast({
            title: "No model selected",
            description: "Connect a provider to summarize this session",
          })
          return
        }
        await sdk.client.session.summarize({
          sessionID,
          modelID: model.id,
          providerID: model.provider.id,
        })
      },
    },
    {
      id: "session.fork",
      title: "Fork from message",
      description: "Create a new session from a previous message",
      category: "Session",
      slash: "fork",
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: () => dialog.show(() => <DialogFork />),
    },
  ])

  const handleKeyDown = (event: KeyboardEvent) => {
    const activeElement = document.activeElement as HTMLElement | undefined
    if (activeElement) {
      const isProtected = activeElement.closest("[data-prevent-autofocus]")
      const isInput = /^(INPUT|TEXTAREA|SELECT)$/.test(activeElement.tagName) || activeElement.isContentEditable
      if (isProtected || isInput) return
    }
    if (dialog.active) return

    if (activeElement === inputRef) {
      if (event.key === "Escape") inputRef?.blur()
      return
    }

    if (event.key.length === 1 && event.key !== "Unidentified" && !(event.ctrlKey || event.metaKey)) {
      inputRef?.focus()
    }
  }

  const handleDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeDraggable", id)
  }

  const handleDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (draggable && droppable) {
      const currentTabs = tabs().all()
      const fromIndex = currentTabs?.indexOf(draggable.id.toString())
      const toIndex = currentTabs?.indexOf(droppable.id.toString())
      if (fromIndex !== toIndex && toIndex !== undefined) {
        tabs().move(draggable.id.toString(), toIndex)
      }
    }
  }

  const handleDragEnd = () => {
    setStore("activeDraggable", undefined)
  }

  const handleTerminalDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeTerminalDraggable", id)
  }

  const handleTerminalDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (draggable && droppable) {
      const terminals = terminal.all()
      const fromIndex = terminals.findIndex((t: LocalPTY) => t.id === draggable.id.toString())
      const toIndex = terminals.findIndex((t: LocalPTY) => t.id === droppable.id.toString())
      if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
        terminal.move(draggable.id.toString(), toIndex)
      }
    }
  }

  const handleTerminalDragEnd = () => {
    setStore("activeTerminalDraggable", undefined)
  }

  const contextOpen = createMemo(() => tabs().active() === "context" || tabs().all().includes("context"))
  const openedTabs = createMemo(() =>
    tabs()
      .all()
      .filter((tab) => tab !== "context"),
  )

  const reviewTab = createMemo(() => hasReview() || tabs().active() === "review")
  const mobileReview = createMemo(() => !isDesktop() && hasReview() && store.mobileTab === "review")

  const showTabs = createMemo(
    () => view().reviewPanel.opened() && (hasReview() || tabs().all().length > 0 || contextOpen()),
  )

  const activeTab = createMemo(() => {
    const active = tabs().active()
    if (active) return active
    if (reviewTab()) return "review"

    const first = openedTabs()[0]
    if (first) return first
    if (contextOpen()) return "context"
    return "review"
  })

  createEffect(() => {
    if (!layout.ready()) return
    if (tabs().active()) return
    if (!hasReview() && openedTabs().length === 0 && !contextOpen()) return
    tabs().setActive(activeTab())
  })

  createEffect(() => {
    const id = params.id
    if (!id) return
    if (!hasReview()) return

    const wants = isDesktop() ? view().reviewPanel.opened() && activeTab() === "review" : store.mobileTab === "review"
    if (!wants) return
    if (diffsReady()) return

    sync.session.diff(id)
  })

  const isWorking = createMemo(() => status().type !== "idle")
  const autoScroll = createAutoScroll({
    working: isWorking,
  })

  let scrollSpyFrame: number | undefined
  let scrollSpyTarget: HTMLDivElement | undefined

  const anchor = (id: string) => `message-${id}`

  const setScrollRef = (el: HTMLDivElement | undefined) => {
    scroller = el
    autoScroll.scrollRef(el)
  }

  const turnInit = 20
  const turnBatch = 20
  let turnHandle: number | undefined
  let turnIdle = false

  function cancelTurnBackfill() {
    const handle = turnHandle
    if (handle === undefined) return
    turnHandle = undefined

    if (turnIdle && window.cancelIdleCallback) {
      window.cancelIdleCallback(handle)
      return
    }

    clearTimeout(handle)
  }

  function scheduleTurnBackfill() {
    if (turnHandle !== undefined) return
    if (store.turnStart <= 0) return

    if (window.requestIdleCallback) {
      turnIdle = true
      turnHandle = window.requestIdleCallback(() => {
        turnHandle = undefined
        backfillTurns()
      })
      return
    }

    turnIdle = false
    turnHandle = window.setTimeout(() => {
      turnHandle = undefined
      backfillTurns()
    }, 0)
  }

  function backfillTurns() {
    const start = store.turnStart
    if (start <= 0) return

    const next = start - turnBatch
    const nextStart = next > 0 ? next : 0

    const el = scroller
    if (!el) {
      setStore("turnStart", nextStart)
      scheduleTurnBackfill()
      return
    }

    const beforeTop = el.scrollTop
    const beforeHeight = el.scrollHeight

    setStore("turnStart", nextStart)

    requestAnimationFrame(() => {
      const delta = el.scrollHeight - beforeHeight
      if (delta) el.scrollTop = beforeTop + delta
    })

    scheduleTurnBackfill()
  }

  createEffect(
    on(
      () => [params.id, messagesReady()] as const,
      ([id, ready]) => {
        cancelTurnBackfill()
        setStore("turnStart", 0)
        if (!id || !ready) return

        const len = visibleUserMessages().length
        const start = len > turnInit ? len - turnInit : 0
        setStore("turnStart", start)
        scheduleTurnBackfill()
      },
      { defer: true },
    ),
  )

  createResizeObserver(
    () => promptDock,
    ({ height }) => {
      const next = Math.ceil(height)

      if (next === store.promptHeight) return

      const el = scroller
      const stick = el ? el.scrollHeight - el.clientHeight - el.scrollTop < 10 : false

      setStore("promptHeight", next)

      if (stick && el) {
        requestAnimationFrame(() => {
          el.scrollTo({ top: el.scrollHeight, behavior: "auto" })
        })
      }
    },
  )

  const updateHash = (id: string) => {
    window.history.replaceState(null, "", `#${anchor(id)}`)
  }

  const scrollToMessage = (message: UserMessage, behavior: ScrollBehavior = "smooth") => {
    setActiveMessage(message)

    const msgs = visibleUserMessages()
    const index = msgs.findIndex((m) => m.id === message.id)
    if (index !== -1 && index < store.turnStart) {
      setStore("turnStart", index)
      scheduleTurnBackfill()

      requestAnimationFrame(() => {
        const el = document.getElementById(anchor(message.id))
        if (el) el.scrollIntoView({ behavior, block: "start" })
      })

      updateHash(message.id)
      return
    }

    const el = document.getElementById(anchor(message.id))
    if (el) el.scrollIntoView({ behavior, block: "start" })
    updateHash(message.id)
  }

  const getActiveMessageId = (container: HTMLDivElement) => {
    const cutoff = container.scrollTop + 100
    const nodes = container.querySelectorAll<HTMLElement>("[data-message-id]")
    let id: string | undefined

    for (const node of nodes) {
      const next = node.dataset.messageId
      if (!next) continue
      if (node.offsetTop > cutoff) break
      id = next
    }

    return id
  }

  const scheduleScrollSpy = (container: HTMLDivElement) => {
    scrollSpyTarget = container
    if (scrollSpyFrame !== undefined) return

    scrollSpyFrame = requestAnimationFrame(() => {
      scrollSpyFrame = undefined

      const target = scrollSpyTarget
      scrollSpyTarget = undefined
      if (!target) return

      const id = getActiveMessageId(target)
      if (!id) return
      if (id === store.messageId) return

      setStore("messageId", id)
    })
  }

  createEffect(() => {
    const sessionID = params.id
    const ready = messagesReady()
    if (!sessionID || !ready) return

    requestAnimationFrame(() => {
      const hash = window.location.hash.slice(1)
      if (!hash) {
        autoScroll.forceScrollToBottom()
        return
      }

      const hashTarget = document.getElementById(hash)
      if (hashTarget) {
        hashTarget.scrollIntoView({ behavior: "auto", block: "start" })
        return
      }

      const match = hash.match(/^message-(.+)$/)
      if (match) {
        const msg = visibleUserMessages().find((m) => m.id === match[1])
        if (msg) {
          scrollToMessage(msg, "auto")
          return
        }
      }

      autoScroll.forceScrollToBottom()
    })
  })

  createEffect(() => {
    document.addEventListener("keydown", handleKeyDown)
  })

  const previewPrompt = () =>
    prompt
      .current()
      .map((part) => {
        if (part.type === "file") return `[file:${part.path}]`
        if (part.type === "agent") return `@${part.name}`
        if (part.type === "image") return `[image:${part.filename}]`
        return part.content
      })
      .join("")
      .trim()

  createEffect(() => {
    if (!prompt.ready()) return
    handoff.prompt = previewPrompt()
  })

  createEffect(() => {
    if (!terminal.ready()) return
    handoff.terminals = terminal.all().map((t) => t.title)
  })

  createEffect(() => {
    if (!file.ready()) return
    handoff.files = Object.fromEntries(
      tabs()
        .all()
        .flatMap((tab) => {
          const path = file.pathFromTab(tab)
          if (!path) return []
          return [[path, file.selectedLines(path) ?? null] as const]
        }),
    )
  })

  onCleanup(() => {
    cancelTurnBackfill()
    document.removeEventListener("keydown", handleKeyDown)
    if (scrollSpyFrame !== undefined) cancelAnimationFrame(scrollSpyFrame)
  })

  return (
    <div class="relative bg-background-base size-full overflow-hidden flex flex-col">
      <SessionHeader />
      <div class="flex-1 min-h-0 flex flex-col md:flex-row">
        {/* Mobile tab bar - only shown on mobile when there are diffs */}
        <Show when={!isDesktop() && hasReview()}>
          <Tabs class="h-auto">
            <Tabs.List>
              <Tabs.Trigger
                value="session"
                class="w-1/2"
                classes={{ button: "w-full" }}
                onClick={() => setStore("mobileTab", "session")}
              >
                Session
              </Tabs.Trigger>
              <Tabs.Trigger
                value="review"
                class="w-1/2 !border-r-0"
                classes={{ button: "w-full" }}
                onClick={() => setStore("mobileTab", "review")}
              >
                {reviewCount()} Files Changed
              </Tabs.Trigger>
            </Tabs.List>
          </Tabs>
        </Show>

        {/* Session panel */}
        <div
          classList={{
            "@container relative shrink-0 flex flex-col min-h-0 h-full bg-background-stronger": true,
            "flex-1 md:flex-none py-6 md:py-3": true,
          }}
          style={{
            width: isDesktop() && showTabs() ? `${layout.session.width()}px` : "100%",
            "--prompt-height": store.promptHeight ? `${store.promptHeight}px` : undefined,
          }}
        >
          <div class="flex-1 min-h-0 overflow-hidden">
            <Switch>
              <Match when={params.id}>
                <Show when={activeMessage()}>
                  <Show
                    when={!mobileReview()}
                    fallback={
                      <div class="relative h-full overflow-hidden">
                        <Show
                          when={diffsReady()}
                          fallback={<div class="px-4 py-4 text-text-weak">Loading changes...</div>}
                        >
                          <SessionReviewTab
                            diffs={diffs}
                            view={view}
                            diffStyle="unified"
                            onViewFile={(path) => {
                              const value = file.tab(path)
                              tabs().open(value)
                              file.load(path)
                            }}
                            classes={{
                              root: "pb-[calc(var(--prompt-height,8rem)+32px)]",
                              header: "px-4",
                              container: "px-4",
                            }}
                          />
                        </Show>
                      </div>
                    }
                  >
                    <div class="relative w-full h-full min-w-0">
                      <Show when={isDesktop()}>
                        <div class="absolute inset-0 pointer-events-none z-10">
                          <SessionMessageRail
                            messages={visibleUserMessages()}
                            current={activeMessage()}
                            onMessageSelect={scrollToMessage}
                            wide={!showTabs()}
                            class="pointer-events-auto"
                          />
                        </div>
                      </Show>
                      <div
                        ref={setScrollRef}
                        onScroll={(e) => {
                          autoScroll.handleScroll()
                          if (isDesktop()) scheduleScrollSpy(e.currentTarget)
                        }}
                        onClick={autoScroll.handleInteraction}
                        class="relative min-w-0 w-full h-full overflow-y-auto no-scrollbar"
                      >
                        <div
                          ref={autoScroll.contentRef}
                          class="flex flex-col gap-32 items-start justify-start pb-[calc(var(--prompt-height,8rem)+64px)] md:pb-[calc(var(--prompt-height,10rem)+64px)] transition-[margin]"
                          classList={{
                            "mt-0.5": !showTabs(),
                            "mt-0": showTabs(),
                          }}
                        >
                          <Show when={store.turnStart > 0}>
                            <div class="w-full flex justify-center">
                              <Button
                                variant="ghost"
                                size="large"
                                class="text-12-medium opacity-50"
                                onClick={() => setStore("turnStart", 0)}
                              >
                                Render earlier messages
                              </Button>
                            </div>
                          </Show>
                          <Show when={historyMore()}>
                            <div class="w-full flex justify-center">
                              <Button
                                variant="ghost"
                                size="large"
                                class="text-12-medium opacity-50"
                                disabled={historyLoading()}
                                onClick={() => {
                                  const id = params.id
                                  if (!id) return
                                  setStore("turnStart", 0)
                                  sync.session.history.loadMore(id)
                                }}
                              >
                                {historyLoading() ? "Loading earlier messages..." : "Load earlier messages"}
                              </Button>
                            </div>
                          </Show>
                          <For each={renderedUserMessages()}>
                            {(message) => {
                              if (import.meta.env.DEV) {
                                onMount(() => {
                                  const id = params.id
                                  if (!id) return
                                  navMark({ dir: params.dir, to: id, name: "session:first-turn-mounted" })
                                })
                              }

                              return (
                                <div
                                  id={anchor(message.id)}
                                  data-message-id={message.id}
                                  classList={{
                                    "min-w-0 w-full max-w-full": true,
                                    "last:min-h-[calc(100vh-5.5rem-var(--prompt-height,8rem)-64px)] md:last:min-h-[calc(100vh-4.5rem-var(--prompt-height,10rem)-64px)]":
                                      platform.platform !== "desktop",
                                    "last:min-h-[calc(100vh-7rem-var(--prompt-height,8rem)-64px)] md:last:min-h-[calc(100vh-6rem-var(--prompt-height,10rem)-64px)]":
                                      platform.platform === "desktop",
                                  }}
                                >
                                  <SessionTurn
                                    sessionID={params.id!}
                                    messageID={message.id}
                                    lastUserMessageID={lastUserMessage()?.id}
                                    stepsExpanded={store.expanded[message.id] ?? false}
                                    onStepsExpandedToggle={() =>
                                      setStore("expanded", message.id, (open: boolean | undefined) => !open)
                                    }
                                    classes={{
                                      root: "min-w-0 w-full relative",
                                      content:
                                        "flex flex-col justify-between !overflow-visible [&_[data-slot=session-turn-message-header]]:top-[-32px]",
                                      container:
                                        "px-4 md:px-6 " +
                                        (!showTabs()
                                          ? "md:max-w-200 md:mx-auto"
                                          : visibleUserMessages().length > 1
                                            ? "md:pr-6 md:pl-18"
                                            : ""),
                                    }}
                                  />
                                </div>
                              )
                            }}
                          </For>
                        </div>
                      </div>
                    </div>
                  </Show>
                </Show>
              </Match>
              <Match when={true}>
                <NewSessionView
                  worktree={newSessionWorktree()}
                  onWorktreeChange={(value) => {
                    if (value === "create") {
                      setStore("newSessionWorktree", value)
                      return
                    }

                    setStore("newSessionWorktree", "main")

                    const target = value === "main" ? sync.project?.worktree : value
                    if (!target) return
                    if (target === sync.data.path.directory) return
                    layout.projects.open(target)
                    navigate(`/${base64Encode(target)}/session`)
                  }}
                />
              </Match>
            </Switch>
          </div>

          {/* Prompt input */}
          <div
            ref={(el) => (promptDock = el)}
            class="absolute inset-x-0 bottom-0 pt-12 pb-4 md:pb-8 flex flex-col justify-center items-center z-50 px-4 md:px-0 bg-gradient-to-t from-background-stronger via-background-stronger to-transparent pointer-events-none"
          >
            <div
              classList={{
                "w-full md:px-6 pointer-events-auto": true,
                "md:max-w-200": !showTabs(),
              }}
            >
              <Show
                when={prompt.ready()}
                fallback={
                  <div class="w-full min-h-32 md:min-h-40 rounded-md border border-border-weak-base bg-background-base/50 px-4 py-3 text-text-weak whitespace-pre-wrap pointer-events-none">
                    {handoff.prompt || "Loading prompt..."}
                  </div>
                }
              >
                <PromptInput
                  ref={(el) => {
                    inputRef = el
                  }}
                  newSessionWorktree={newSessionWorktree()}
                  onNewSessionWorktreeReset={() => setStore("newSessionWorktree", "main")}
                />
              </Show>
            </div>
          </div>

          <Show when={isDesktop() && showTabs()}>
            <ResizeHandle
              direction="horizontal"
              size={layout.session.width()}
              min={450}
              max={window.innerWidth * 0.45}
              onResize={layout.session.resize}
            />
          </Show>
        </div>

        {/* Desktop tabs panel (Review + Context + Files) - hidden on mobile */}
        <Show when={isDesktop() && showTabs()}>
          <div class="relative flex-1 min-w-0 h-full border-l border-border-weak-base">
            <DragDropProvider
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
              collisionDetector={closestCenter}
            >
              <DragDropSensors />
              <ConstrainDragYAxis />
              <Tabs value={activeTab()} onChange={openTab}>
                <div class="sticky top-0 shrink-0 flex">
                  <Tabs.List>
                    <Show when={reviewTab()}>
                      <Tabs.Trigger value="review">
                        <div class="flex items-center gap-3">
                          <Show when={diffs()}>
                            <DiffChanges changes={diffs()} variant="bars" />
                          </Show>
                          <div class="flex items-center gap-1.5">
                            <div>Review</div>
                            <Show when={info()?.summary?.files}>
                              <div class="text-12-medium text-text-strong h-4 px-2 flex flex-col items-center justify-center rounded-full bg-surface-base">
                                {info()?.summary?.files ?? 0}
                              </div>
                            </Show>
                          </div>
                        </div>
                      </Tabs.Trigger>
                    </Show>
                    <Show when={contextOpen()}>
                      <Tabs.Trigger
                        value="context"
                        closeButton={
                          <Tooltip value="Close tab" placement="bottom">
                            <IconButton icon="close" variant="ghost" onClick={() => tabs().close("context")} />
                          </Tooltip>
                        }
                        hideCloseButton
                        onMiddleClick={() => tabs().close("context")}
                      >
                        <div class="flex items-center gap-2">
                          <SessionContextUsage variant="indicator" />
                          <div>Context</div>
                        </div>
                      </Tabs.Trigger>
                    </Show>
                    <SortableProvider ids={openedTabs()}>
                      <For each={openedTabs()}>{(tab) => <SortableTab tab={tab} onTabClose={tabs().close} />}</For>
                    </SortableProvider>
                    <div class="bg-background-base h-full flex items-center justify-center border-b border-border-weak-base px-3">
                      <TooltipKeybind
                        title="Open file"
                        keybind={command.keybind("file.open")}
                        class="flex items-center"
                      >
                        <IconButton
                          icon="plus-small"
                          variant="ghost"
                          iconSize="large"
                          onClick={() => dialog.show(() => <DialogSelectFile />)}
                        />
                      </TooltipKeybind>
                    </div>
                  </Tabs.List>
                </div>
                <Show when={reviewTab()}>
                  <Tabs.Content value="review" class="flex flex-col h-full overflow-hidden contain-strict">
                    <Show when={activeTab() === "review"}>
                      <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                        <Show
                          when={diffsReady()}
                          fallback={<div class="px-6 py-4 text-text-weak">Loading changes...</div>}
                        >
                          <SessionReviewTab
                            diffs={diffs}
                            view={view}
                            diffStyle={layout.review.diffStyle()}
                            onDiffStyleChange={layout.review.setDiffStyle}
                            onViewFile={(path) => {
                              const value = file.tab(path)
                              tabs().open(value)
                              file.load(path)
                            }}
                          />
                        </Show>
                      </div>
                    </Show>
                  </Tabs.Content>
                </Show>
                <Show when={contextOpen()}>
                  <Tabs.Content value="context" class="flex flex-col h-full overflow-hidden contain-strict">
                    <Show when={activeTab() === "context"}>
                      <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                        <SessionContextTab
                          messages={messages}
                          visibleUserMessages={visibleUserMessages}
                          view={view}
                          info={info}
                        />
                      </div>
                    </Show>
                  </Tabs.Content>
                </Show>
                <For each={openedTabs()}>
                  {(tab) => {
                    let scroll: HTMLDivElement | undefined
                    let scrollFrame: number | undefined
                    let pending: { x: number; y: number } | undefined

                    const path = createMemo(() => file.pathFromTab(tab))
                    const state = createMemo(() => {
                      const p = path()
                      if (!p) return
                      return file.get(p)
                    })
                    const contents = createMemo(() => state()?.content?.content ?? "")
                    const cacheKey = createMemo(() => checksum(contents()))
                    const isImage = createMemo(() => {
                      const c = state()?.content
                      return (
                        c?.encoding === "base64" && c?.mimeType?.startsWith("image/") && c?.mimeType !== "image/svg+xml"
                      )
                    })
                    const isSvg = createMemo(() => {
                      const c = state()?.content
                      return c?.mimeType === "image/svg+xml"
                    })
                    const svgContent = createMemo(() => {
                      if (!isSvg()) return
                      const c = state()?.content
                      if (!c) return
                      if (c.encoding === "base64") return base64Decode(c.content)
                      return c.content
                    })
                    const svgPreviewUrl = createMemo(() => {
                      if (!isSvg()) return
                      const c = state()?.content
                      if (!c) return
                      if (c.encoding === "base64") return `data:image/svg+xml;base64,${c.content}`
                      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(c.content)}`
                    })
                    const imageDataUrl = createMemo(() => {
                      if (!isImage()) return
                      const c = state()?.content
                      return `data:${c?.mimeType};base64,${c?.content}`
                    })
                    const selectedLines = createMemo(() => {
                      const p = path()
                      if (!p) return null
                      if (file.ready()) return file.selectedLines(p) ?? null
                      return handoff.files[p] ?? null
                    })
                    const selection = createMemo(() => {
                      const range = selectedLines()
                      if (!range) return
                      return selectionFromLines(range)
                    })
                    const selectionLabel = createMemo(() => {
                      const sel = selection()
                      if (!sel) return
                      if (sel.startLine === sel.endLine) return `L${sel.startLine}`
                      return `L${sel.startLine}-${sel.endLine}`
                    })

                    const restoreScroll = (retries = 0) => {
                      const el = scroll
                      if (!el) return

                      const s = view()?.scroll(tab)
                      if (!s) return

                      // Wait for content to be scrollable - content may not have rendered yet
                      if (el.scrollHeight <= el.clientHeight && retries < 10) {
                        requestAnimationFrame(() => restoreScroll(retries + 1))
                        return
                      }

                      if (el.scrollTop !== s.y) el.scrollTop = s.y
                      if (el.scrollLeft !== s.x) el.scrollLeft = s.x
                    }

                    const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
                      pending = {
                        x: event.currentTarget.scrollLeft,
                        y: event.currentTarget.scrollTop,
                      }
                      if (scrollFrame !== undefined) return

                      scrollFrame = requestAnimationFrame(() => {
                        scrollFrame = undefined

                        const next = pending
                        pending = undefined
                        if (!next) return

                        view().setScroll(tab, next)
                      })
                    }

                    createEffect(
                      on(
                        () => state()?.loaded,
                        (loaded) => {
                          if (!loaded) return
                          requestAnimationFrame(restoreScroll)
                        },
                        { defer: true },
                      ),
                    )

                    createEffect(
                      on(
                        () => file.ready(),
                        (ready) => {
                          if (!ready) return
                          requestAnimationFrame(restoreScroll)
                        },
                        { defer: true },
                      ),
                    )

                    createEffect(
                      on(
                        () => tabs().active() === tab,
                        (active) => {
                          if (!active) return
                          if (!state()?.loaded) return
                          requestAnimationFrame(restoreScroll)
                        },
                      ),
                    )

                    onCleanup(() => {
                      if (scrollFrame === undefined) return
                      cancelAnimationFrame(scrollFrame)
                    })

                    return (
                      <Tabs.Content
                        value={tab}
                        class="mt-3"
                        ref={(el: HTMLDivElement) => {
                          scroll = el
                          restoreScroll()
                        }}
                        onScroll={handleScroll}
                      >
                        <Show when={activeTab() === tab}>
                          <Show when={selection()}>
                            {(sel) => (
                              <div class="hidden sticky top-0 z-10 px-6 py-2 _flex justify-end bg-background-base border-b border-border-weak-base">
                                <button
                                  type="button"
                                  class="flex items-center gap-2 px-2 py-1 rounded-md bg-surface-base border border-border-base text-12-regular text-text-strong hover:bg-surface-raised-base-hover"
                                  onClick={() => {
                                    const p = path()
                                    if (!p) return
                                    prompt.context.add({ type: "file", path: p, selection: sel() })
                                  }}
                                >
                                  <Icon name="plus-small" size="small" />
                                  <span>Add {selectionLabel()} to context</span>
                                </button>
                              </div>
                            )}
                          </Show>
                          <Switch>
                            <Match when={state()?.loaded && isImage()}>
                              <div class="px-6 py-4 pb-40">
                                <img src={imageDataUrl()} alt={path()} class="max-w-full" />
                              </div>
                            </Match>
                            <Match when={state()?.loaded && isSvg()}>
                              <div class="flex flex-col gap-4 px-6 py-4">
                                <Dynamic
                                  component={codeComponent}
                                  file={{
                                    name: path() ?? "",
                                    contents: svgContent() ?? "",
                                    cacheKey: cacheKey(),
                                  }}
                                  enableLineSelection
                                  selectedLines={selectedLines()}
                                  onLineSelected={(range: SelectedLineRange | null) => {
                                    const p = path()
                                    if (!p) return
                                    file.setSelectedLines(p, range)
                                  }}
                                  overflow="scroll"
                                  class="select-text"
                                />
                                <Show when={svgPreviewUrl()}>
                                  <div class="flex justify-center pb-40">
                                    <img src={svgPreviewUrl()} alt={path()} class="max-w-full max-h-96" />
                                  </div>
                                </Show>
                              </div>
                            </Match>
                            <Match when={state()?.loaded}>
                              <Dynamic
                                component={codeComponent}
                                file={{
                                  name: path() ?? "",
                                  contents: contents(),
                                  cacheKey: cacheKey(),
                                }}
                                enableLineSelection
                                selectedLines={selectedLines()}
                                onLineSelected={(range: SelectedLineRange | null) => {
                                  const p = path()
                                  if (!p) return
                                  file.setSelectedLines(p, range)
                                }}
                                overflow="scroll"
                                class="select-text pb-40"
                              />
                            </Match>
                            <Match when={state()?.loading}>
                              <div class="px-6 py-4 text-text-weak">Loading...</div>
                            </Match>
                            <Match when={state()?.error}>
                              {(err) => <div class="px-6 py-4 text-text-weak">{err()}</div>}
                            </Match>
                          </Switch>
                        </Show>
                      </Tabs.Content>
                    )
                  }}
                </For>
              </Tabs>
              <DragOverlay>
                <Show when={store.activeDraggable}>
                  {(tab) => {
                    const path = createMemo(() => file.pathFromTab(tab()))
                    return (
                      <div class="relative px-6 h-12 flex items-center bg-background-stronger border-x border-border-weak-base border-b border-b-transparent">
                        <Show when={path()}>{(p) => <FileVisual active path={p()} />}</Show>
                      </div>
                    )
                  }}
                </Show>
              </DragOverlay>
            </DragDropProvider>
          </div>
        </Show>
      </div>

      <Show when={isDesktop() && view().terminal.opened()}>
        <div
          class="relative w-full flex-col shrink-0 border-t border-border-weak-base"
          style={{ height: `${layout.terminal.height()}px` }}
        >
          <ResizeHandle
            direction="vertical"
            size={layout.terminal.height()}
            min={100}
            max={window.innerHeight * 0.6}
            collapseThreshold={50}
            onResize={layout.terminal.resize}
            onCollapse={view().terminal.close}
          />
          <Show
            when={terminal.ready()}
            fallback={
              <div class="flex flex-col h-full pointer-events-none">
                <div class="h-10 flex items-center gap-2 px-2 border-b border-border-weak-base bg-background-stronger overflow-hidden">
                  <For each={handoff.terminals}>
                    {(title) => (
                      <div class="px-2 py-1 rounded-md bg-surface-base text-14-regular text-text-weak truncate max-w-40">
                        {title}
                      </div>
                    )}
                  </For>
                  <div class="flex-1" />
                  <div class="text-text-weak pr-2">Loading...</div>
                </div>
                <div class="flex-1 flex items-center justify-center text-text-weak">Loading terminal...</div>
              </div>
            }
          >
            <DragDropProvider
              onDragStart={handleTerminalDragStart}
              onDragEnd={handleTerminalDragEnd}
              onDragOver={handleTerminalDragOver}
              collisionDetector={closestCenter}
            >
              <DragDropSensors />
              <ConstrainDragYAxis />
              <Tabs variant="alt" value={terminal.active()} onChange={terminal.open}>
                <Tabs.List class="h-10">
                  <SortableProvider ids={terminal.all().map((t: LocalPTY) => t.id)}>
                    <For each={terminal.all()}>{(pty) => <SortableTerminalTab terminal={pty} />}</For>
                  </SortableProvider>
                  <div class="h-full flex items-center justify-center">
                    <TooltipKeybind
                      title="New terminal"
                      keybind={command.keybind("terminal.new")}
                      class="flex items-center"
                    >
                      <IconButton icon="plus-small" variant="ghost" iconSize="large" onClick={terminal.new} />
                    </TooltipKeybind>
                  </div>
                </Tabs.List>
                <For each={terminal.all()}>
                  {(pty) => (
                    <Tabs.Content value={pty.id}>
                      <Terminal pty={pty} onCleanup={terminal.update} onConnectError={() => terminal.clone(pty.id)} />
                    </Tabs.Content>
                  )}
                </For>
              </Tabs>
              <DragOverlay>
                <Show when={store.activeTerminalDraggable}>
                  {(draggedId) => {
                    const pty = createMemo(() => terminal.all().find((t: LocalPTY) => t.id === draggedId()))
                    return (
                      <Show when={pty()}>
                        {(t) => (
                          <div class="relative p-1 h-10 flex items-center bg-background-stronger text-14-regular">
                            {t().title}
                          </div>
                        )}
                      </Show>
                    )
                  }}
                </Show>
              </DragOverlay>
            </DragDropProvider>
          </Show>
        </div>
      </Show>
    </div>
  )
}
