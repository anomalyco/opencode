import {
  For,
  onCleanup,
  onMount,
  Show,
  Match,
  Switch,
  createMemo,
  createEffect,
  on,
  createRenderEffect,
  batch,
} from "solid-js"

import { Dynamic } from "solid-js/web"
import { useLocal } from "@/context/local"
import { selectionFromLines, useFile, type SelectedLineRange } from "@/context/file"
import { createStore } from "solid-js/store"
import { PromptInput } from "@/components/prompt-input"
import { SessionContextUsage } from "@/components/session-context-usage"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { DiffChanges } from "@opencode-ai/ui/diff-changes"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Tabs } from "@opencode-ai/ui/tabs"
import { useCodeComponent } from "@opencode-ai/ui/context/code"
import { SessionTurn } from "@opencode-ai/ui/session-turn"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import { SessionMessageRail } from "@opencode-ai/ui/session-message-rail"
import { SessionReview } from "@opencode-ai/ui/session-review"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { useSync } from "@/context/sync"
import { useTerminal, type LocalPTY } from "@/context/terminal"
import { useLayout } from "@/context/layout"
import { Terminal } from "@/components/terminal"
import { checksum } from "@opencode-ai/util/encode"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogSelectFile } from "@/components/dialog-select-file"
import { DialogSelectModel } from "@/components/dialog-select-model"
import { DialogSelectMcp } from "@/components/dialog-select-mcp"
import { useCommand } from "@/context/command"
import { useNavigate, useParams } from "@solidjs/router"
import { UserMessage } from "@opencode-ai/sdk/v2"
import { useSDK } from "@/context/sdk"
import { usePrompt } from "@/context/prompt"
import { extractPromptFromParts } from "@/utils/prompt"
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"
import { usePermission } from "@/context/permission"
import { showToast } from "@opencode-ai/ui/toast"
import {
  SessionHeader,
  SessionContextTab,
  SessionReviewTab,
  SortableTab,
  FileVisual,
  SortableTerminalTab,
  NewSessionView,
} from "@/components/session"

function same<T>(a: readonly T[], b: readonly T[]) {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((x, i) => x === b[i])
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
  const params = useParams()
  const navigate = useNavigate()
  const sdk = useSDK()
  const prompt = usePrompt()

  const permission = usePermission()
  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const tabs = createMemo(() => layout.tabs(sessionKey()))
  const view = createMemo(() => layout.view(sessionKey()))

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
  const revertMessageID = createMemo(() => info()?.revert?.messageID)
  const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))
  const emptyUserMessages: UserMessage[] = []
  const userMessages = createMemo(
    () => messages().filter((m) => m.role === "user") as UserMessage[],
    emptyUserMessages,
    { equals: same },
  )
  const visibleUserMessages = createMemo(
    () => {
      const revert = revertMessageID()
      if (!revert) return userMessages()
      return userMessages().filter((m) => m.id < revert)
    },
    emptyUserMessages,
    { equals: same },
  )
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
    userInteracted: false,
    stepsExpanded: true,
    mobileStepsExpanded: {} as Record<string, boolean>,
    messageId: undefined as string | undefined,
  })

  const activeMessage = createMemo(() => {
    if (!store.messageId) return lastUserMessage()
    // If the stored message is no longer visible (e.g., was reverted), fall back to last visible
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

    setActiveMessage(msgs[targetIndex])
  }

  const diffs = createMemo(() => (params.id ? (sync.data.session_diff[params.id] ?? []) : []))

  let inputRef!: HTMLDivElement

  createEffect(() => {
    if (!params.id) return
    sync.session.sync(params.id)
  })

  createEffect(() => {
    if (layout.terminal.opened()) {
      if (terminal.all().length === 0) {
        terminal.new()
      }
    }
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

  const idle = { type: "idle" as const }

  createEffect(
    on(
      () => params.id,
      (id) => {
        const status = sync.data.session_status[id ?? ""] ?? idle
        batch(() => {
          setStore("userInteracted", false)
          setStore("stepsExpanded", status.type !== "idle")
        })
      },
    ),
  )

  const status = createMemo(() => sync.data.session_status[params.id ?? ""] ?? idle)

  createEffect(
    on(
      () => status().type,
      (type) => {
        if (type !== "idle") return
        batch(() => {
          setStore("userInteracted", false)
          setStore("stepsExpanded", false)
        })
      },
      { defer: true },
    ),
  )

  const working = createMemo(() => status().type !== "idle" && activeMessage()?.id === lastUserMessage()?.id)

  createRenderEffect((prev) => {
    const isWorking = working()
    if (!prev && isWorking) {
      setStore("stepsExpanded", true)
    }
    if (prev && !isWorking && !store.userInteracted) {
      setStore("stepsExpanded", false)
    }
    return isWorking
  }, working())

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
      onSelect: () => layout.terminal.toggle(),
    },
    {
      id: "review.toggle",
      title: "Toggle review",
      description: "Show or hide the review panel",
      category: "View",
      keybind: "mod+shift+r",
      onSelect: () => layout.review.toggle(),
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
      description: "Show or hide the steps",
      category: "View",
      keybind: "mod+e",
      slash: "steps",
      disabled: !params.id,
      onSelect: () => setStore("stepsExpanded", (x) => !x),
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
      title: params.id && permission.isAutoAccepting(params.id) ? "Stop auto-accepting edits" : "Auto-accept edits",
      category: "Permissions",
      keybind: "mod+shift+a",
      disabled: !params.id || !permission.permissionsEnabled(),
      onSelect: () => {
        const sessionID = params.id
        if (!sessionID) return
        permission.toggleAutoAccept(sessionID, sdk.directory)
        showToast({
          title: permission.isAutoAccepting(sessionID) ? "Auto-accepting edits" : "Stopped auto-accepting edits",
          description: permission.isAutoAccepting(sessionID)
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
          const restored = extractPromptFromParts(parts)
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

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown)
  })

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown)
  })

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

  const reviewTab = createMemo(() => diffs().length > 0 || tabs().active() === "review")

  const showTabs = createMemo(
    () => layout.review.opened() && (diffs().length > 0 || tabs().all().length > 0 || contextOpen()),
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
    if (diffs().length === 0 && openedTabs().length === 0 && !contextOpen()) return
    tabs().setActive(activeTab())
  })

  const mobileWorking = createMemo(() => status().type !== "idle")
  const mobileAutoScroll = createAutoScroll({
    working: mobileWorking,
    onUserInteracted: () => setStore("userInteracted", true),
  })

  const MobileTurns = () => (
    <div
      ref={mobileAutoScroll.scrollRef}
      onScroll={mobileAutoScroll.handleScroll}
      onClick={mobileAutoScroll.handleInteraction}
      class="relative mt-2 min-w-0 w-full h-full overflow-y-auto no-scrollbar pb-12"
    >
      <div ref={mobileAutoScroll.contentRef} class="flex flex-col gap-45 items-start justify-start mt-4">
        <For each={visibleUserMessages()}>
          {(message) => (
            <SessionTurn
              sessionID={params.id!}
              messageID={message.id}
              lastUserMessageID={lastUserMessage()?.id}
              stepsExpanded={store.mobileStepsExpanded[message.id] ?? false}
              onStepsExpandedToggle={() => setStore("mobileStepsExpanded", message.id, (x) => !x)}
              onUserInteracted={() => setStore("userInteracted", true)}
              classes={{
                root: "min-w-0 w-full relative",
                content:
                  "flex flex-col justify-between !overflow-visible [&_[data-slot=session-turn-message-header]]:top-[-32px]",
                container: "px-4",
              }}
            />
          )}
        </For>
      </div>
    </div>
  )

  const DesktopSessionContent = () => (
    <Switch>
      <Match when={params.id}>
        <div class="flex items-start justify-start h-full min-h-0">
          <SessionMessageRail
            messages={visibleUserMessages()}
            current={activeMessage()}
            onMessageSelect={setActiveMessage}
            wide={!showTabs()}
          />
          <Show when={activeMessage()}>
            <SessionTurn
              sessionID={params.id!}
              messageID={activeMessage()!.id}
              lastUserMessageID={lastUserMessage()?.id}
              stepsExpanded={store.stepsExpanded}
              onStepsExpandedToggle={() => setStore("stepsExpanded", (x) => !x)}
              onUserInteracted={() => setStore("userInteracted", true)}
              classes={{
                root: "pb-20 flex-1 min-w-0",
                content: "pb-20",
                container:
                  "w-full " +
                  (!showTabs() ? "max-w-200 mx-auto px-6" : visibleUserMessages().length > 1 ? "pr-6 pl-18" : "px-6"),
              }}
            />
          </Show>
        </div>
      </Match>
      <Match when={true}>
        <NewSessionView />
      </Match>
    </Switch>
  )

  return (
    <div class="relative bg-background-base size-full overflow-hidden flex flex-col">
      <SessionHeader />
      <div class="md:hidden flex-1 min-h-0 flex flex-col bg-background-stronger">
        <Switch>
          <Match when={!params.id}>
            <div class="flex-1 min-h-0 overflow-hidden">
              <NewSessionView />
            </div>
          </Match>
          <Match when={diffs().length > 0}>
            <Tabs class="flex-1 min-h-0 flex flex-col pb-28">
              <Tabs.List>
                <Tabs.Trigger value="session" class="w-1/2" classes={{ button: "w-full" }}>
                  Session
                </Tabs.Trigger>
                <Tabs.Trigger value="review" class="w-1/2 !border-r-0" classes={{ button: "w-full" }}>
                  {diffs().length} Files Changed
                </Tabs.Trigger>
              </Tabs.List>
              <Tabs.Content value="session" class="flex-1 !overflow-hidden">
                <MobileTurns />
              </Tabs.Content>
              <Tabs.Content forceMount value="review" class="flex-1 !overflow-hidden hidden data-[selected]:block">
                <div class="relative h-full mt-6 overflow-y-auto no-scrollbar">
                  <SessionReview
                    diffs={diffs()}
                    diffStyle={layout.review.diffStyle()}
                    onDiffStyleChange={layout.review.setDiffStyle}
                    open={view().review.open()}
                    onOpenChange={view().review.setOpen}
                    classes={{
                      root: "pb-32",
                      header: "px-4",
                      container: "px-4",
                    }}
                  />
                </div>
              </Tabs.Content>
            </Tabs>
          </Match>
          <Match when={true}>
            <div class="flex-1 min-h-0 overflow-hidden">
              <MobileTurns />
            </div>
          </Match>
        </Switch>
        <div class="absolute inset-x-0 bottom-4 flex flex-col justify-center items-center z-50 px-4">
          <div class="w-full">
            <PromptInput
              ref={(el) => {
                inputRef = el
              }}
            />
          </div>
        </div>
      </div>

      <div class="hidden md:flex min-h-0 grow w-full">
        <div
          class="@container relative shrink-0 py-3 flex flex-col gap-6 min-h-0 h-full bg-background-stronger"
          style={{ width: showTabs() ? `${layout.session.width()}px` : "100%" }}
        >
          <div class="flex-1 min-h-0 overflow-hidden">
            <DesktopSessionContent />
          </div>
          <div class="absolute inset-x-0 bottom-8 flex flex-col justify-center items-center z-50">
            <div
              classList={{
                "w-full px-6": true,
                "max-w-200": !showTabs(),
              }}
            >
              <PromptInput
                ref={(el) => {
                  inputRef = el
                }}
              />
            </div>
          </div>
          <Show when={showTabs()}>
            <ResizeHandle
              direction="horizontal"
              size={layout.session.width()}
              min={450}
              max={window.innerWidth * 0.45}
              onResize={layout.session.resize}
            />
          </Show>
        </div>

        <Show when={showTabs()}>
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
                    <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                      <SessionReviewTab diffs={diffs} view={view} />
                    </div>
                  </Tabs.Content>
                </Show>
                <Show when={contextOpen()}>
                  <Tabs.Content value="context" class="flex flex-col h-full overflow-hidden contain-strict">
                    <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                      <SessionContextTab
                        messages={messages}
                        visibleUserMessages={visibleUserMessages}
                        view={view}
                        info={info}
                      />
                    </div>
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
                    const selectedLines = createMemo(() => {
                      const p = path()
                      if (!p) return null
                      return file.selectedLines(p) ?? null
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

                    const restoreScroll = () => {
                      const el = scroll
                      if (!el) return

                      const s = view()?.scroll(tab)
                      if (!s) return

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
                        <Show when={selection()}>
                          {(sel) => (
                            <div class="sticky top-0 z-10 px-6 py-2 flex justify-end bg-background-base border-b border-border-weak-base">
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
                          <Match when={state()?.loaded}>
                            <Dynamic
                              component={codeComponent}
                              file={{
                                name: path() ?? "",
                                contents: contents(),
                                cacheKey: checksum(contents()),
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

      <Show when={layout.terminal.opened()}>
        <div
          class="hidden md:flex relative w-full flex-col shrink-0 border-t border-border-weak-base"
          style={{ height: `${layout.terminal.height()}px` }}
        >
          <ResizeHandle
            direction="vertical"
            size={layout.terminal.height()}
            min={100}
            max={window.innerHeight * 0.6}
            collapseThreshold={50}
            onResize={layout.terminal.resize}
            onCollapse={layout.terminal.close}
          />
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
        </div>
      </Show>
    </div>
  )
}
