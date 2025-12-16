import { For, onCleanup, onMount, Show, Match, Switch, createResource, createMemo, createEffect, on } from "solid-js"
import { useLocal, type LocalFile } from "@/context/local"
import { createStore } from "solid-js/store"
import { PromptInput } from "@/components/prompt-input"
import { DateTime } from "luxon"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { DiffChanges } from "@opencode-ai/ui/diff-changes"
import { ProgressCircle } from "@opencode-ai/ui/progress-circle"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Code } from "@opencode-ai/ui/code"
import { SessionTurn } from "@opencode-ai/ui/session-turn"
import { SessionMessageRail } from "@opencode-ai/ui/session-message-rail"
import { SessionReview } from "@opencode-ai/ui/session-review"
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  closestCenter,
  createSortable,
  useDragDropContext,
} from "@thisbeyond/solid-dnd"
import type { DragEvent, Transformer } from "@thisbeyond/solid-dnd"
import type { JSX } from "solid-js"
import { useSync } from "@/context/sync"
import { useTerminal, type LocalPTY } from "@/context/terminal"
import { useLayout } from "@/context/layout"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { Terminal } from "@/components/terminal"
import { checksum } from "@opencode-ai/util/encode"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogSelectFile } from "@/components/dialog-select-file"
import { DialogSelectModel } from "@/components/dialog-select-model"
import { useCommand } from "@/context/command"
import { useNavigate, useParams } from "@solidjs/router"
import { AssistantMessage, UserMessage } from "@opencode-ai/sdk/v2"
import { useSDK } from "@/context/sdk"
import { usePrompt } from "@/context/prompt"
import { extractPromptFromParts } from "@/utils/prompt"

export default function Page() {
  const layout = useLayout()
  const local = useLocal()
  const sync = useSync()
  const terminal = useTerminal()
  const dialog = useDialog()
  const command = useCommand()
  const params = useParams()
  const navigate = useNavigate()
  const sdk = useSDK()
  const prompt = usePrompt()

  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const tabs = createMemo(() => layout.tabs(sessionKey()))

  const info = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))
  const revertMessageID = createMemo(() => info()?.revert?.messageID)
  const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))
  const userMessages = createMemo(() =>
    messages()
      .filter((m) => m.role === "user")
      .sort((a, b) => a.id.localeCompare(b.id)),
  )
  // Visible user messages excludes reverted messages (those >= revertMessageID)
  const visibleUserMessages = createMemo(() => {
    const revert = revertMessageID()
    if (!revert) return userMessages()
    return userMessages().filter((m) => m.id < revert)
  })
  const lastUserMessage = createMemo(() => visibleUserMessages()?.at(-1))

  const [messageStore, setMessageStore] = createStore<{ messageId?: string }>({})
  const activeMessage = createMemo(() => {
    if (!messageStore.messageId) return lastUserMessage()
    // If the stored message is no longer visible (e.g., was reverted), fall back to last visible
    const found = visibleUserMessages()?.find((m) => m.id === messageStore.messageId)
    return found ?? lastUserMessage()
  })
  const setActiveMessage = (message: UserMessage | undefined) => {
    setMessageStore("messageId", message?.id)
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

  const last = createMemo(
    () => messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage,
  )
  const model = createMemo(() =>
    last() ? sync.data.provider.all.find((x) => x.id === last().providerID)?.models[last().modelID] : undefined,
  )
  const diffs = createMemo(() => (params.id ? (sync.data.session_diff[params.id] ?? []) : []))

  const tokens = createMemo(() => {
    if (!last()) return
    const t = last().tokens
    return t.input + t.output + t.reasoning + t.cache.read + t.cache.write
  })

  const context = createMemo(() => {
    const total = tokens()
    const limit = model()?.limit.context
    if (!total || !limit) return 0
    return Math.round((total / limit) * 100)
  })

  const [store, setStore] = createStore({
    clickTimer: undefined as number | undefined,
    activeDraggable: undefined as string | undefined,
    activeTerminalDraggable: undefined as string | undefined,
    stepsExpanded: false,
  })
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
          setMessageStore("messageId", undefined)
        }
      },
      { defer: true },
    ),
  )

  const status = createMemo(() => sync.data.session_status[params.id ?? ""] ?? { type: "idle" })

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
    // {
    //   id: "theme.toggle",
    //   title: "Toggle theme",
    //   description: "Switch between themes",
    //   category: "View",
    //   keybind: "ctrl+t",
    //   slash: "theme",
    //   onSelect: () => {
    //     const currentTheme = localStorage.getItem("theme") ?? "oc-1"
    //     const themes = ["oc-1", "oc-2-paper"]
    //     const nextTheme = themes[(themes.indexOf(currentTheme) + 1) % themes.length]
    //     localStorage.setItem("theme", nextTheme)
    //     document.documentElement.setAttribute("data-theme", nextTheme)
    //   },
    // },
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
      id: "agent.cycle",
      title: "Cycle agent",
      description: "Switch to the next agent",
      category: "Agent",
      keybind: "mod+.",
      slash: "agent",
      onSelect: () => local.agent.move(1),
    },
    {
      id: "session.undo",
      title: "Undo",
      description: "Undo the last message",
      category: "Session",
      keybind: "mod+z",
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
      keybind: "mod+shift+z",
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
    if ((document.activeElement as HTMLElement)?.dataset?.component === "terminal") return
    if (dialog.active) return

    if (event.key === "PageUp" || event.key === "PageDown") {
      const scrollContainer = document.querySelector('[data-slot="session-turn-content"]') as HTMLElement
      if (scrollContainer) {
        event.preventDefault()
        const scrollAmount = scrollContainer.clientHeight * 0.8
        scrollContainer.scrollBy({
          top: event.key === "PageUp" ? -scrollAmount : scrollAmount,
          behavior: "instant",
        })
      }
      return
    }

    const focused = document.activeElement === inputRef
    if (focused) {
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

  const resetClickTimer = () => {
    if (!store.clickTimer) return
    clearTimeout(store.clickTimer)
    setStore("clickTimer", undefined)
  }

  const startClickTimer = () => {
    const newClickTimer = setTimeout(() => {
      setStore("clickTimer", undefined)
    }, 300)
    setStore("clickTimer", newClickTimer as unknown as number)
  }

  const handleTabClick = async (tab: string) => {
    if (store.clickTimer) {
      resetClickTimer()
    } else {
      if (tab.startsWith("file://")) {
        local.file.open(tab.replace("file://", ""))
      }
      startClickTimer()
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

  const SortableTerminalTab = (props: { terminal: LocalPTY }): JSX.Element => {
    const sortable = createSortable(props.terminal.id)
    return (
      // @ts-ignore
      <div use:sortable classList={{ "h-full": true, "opacity-0": sortable.isActiveDraggable }}>
        <div class="relative h-full">
          <Tabs.Trigger
            value={props.terminal.id}
            closeButton={
              terminal.all().length > 1 && (
                <IconButton icon="close" variant="ghost" onClick={() => terminal.close(props.terminal.id)} />
              )
            }
          >
            {props.terminal.title}
          </Tabs.Trigger>
        </div>
      </div>
    )
  }

  const FileVisual = (props: { file: LocalFile; active?: boolean }): JSX.Element => {
    return (
      <div class="flex items-center gap-x-1.5">
        <FileIcon
          node={props.file}
          classList={{
            "grayscale-100 group-data-[selected]/tab:grayscale-0": !props.active,
            "grayscale-0": props.active,
          }}
        />
        <span
          classList={{
            "text-14-medium": true,
            "text-primary": !!props.file.status?.status,
            italic: !props.file.pinned,
          }}
        >
          {props.file.name}
        </span>
        <span class="hidden opacity-70">
          <Switch>
            <Match when={props.file.status?.status === "modified"}>
              <span class="text-primary">M</span>
            </Match>
            <Match when={props.file.status?.status === "added"}>
              <span class="text-success">A</span>
            </Match>
            <Match when={props.file.status?.status === "deleted"}>
              <span class="text-error">D</span>
            </Match>
          </Switch>
        </span>
      </div>
    )
  }

  const SortableTab = (props: {
    tab: string
    onTabClick: (tab: string) => void
    onTabClose: (tab: string) => void
  }): JSX.Element => {
    const sortable = createSortable(props.tab)
    const [file] = createResource(
      () => props.tab,
      async (tab) => {
        if (tab.startsWith("file://")) {
          return local.file.node(tab.replace("file://", ""))
        }
        return undefined
      },
    )
    return (
      // @ts-ignore
      <div use:sortable classList={{ "h-full": true, "opacity-0": sortable.isActiveDraggable }}>
        <div class="relative h-full">
          <Tabs.Trigger
            value={props.tab}
            closeButton={
              <Tooltip value="Close tab" placement="bottom">
                <IconButton icon="close" variant="ghost" onClick={() => props.onTabClose(props.tab)} />
              </Tooltip>
            }
            hideCloseButton
            onClick={() => props.onTabClick(props.tab)}
          >
            <Switch>
              <Match when={file()}>{(f) => <FileVisual file={f()} />}</Match>
            </Switch>
          </Tabs.Trigger>
        </div>
      </div>
    )
  }

  const ConstrainDragYAxis = (): JSX.Element => {
    const context = useDragDropContext()
    if (!context) return <></>
    const [, { onDragStart, onDragEnd, addTransformer, removeTransformer }] = context
    const transformer: Transformer = {
      id: "constrain-y-axis",
      order: 100,
      callback: (transform) => ({ ...transform, y: 0 }),
    }
    onDragStart((event) => {
      const id = getDraggableId(event)
      if (!id) return
      addTransformer("draggables", id, transformer)
    })
    onDragEnd((event) => {
      const id = getDraggableId(event)
      if (!id) return
      removeTransformer("draggables", id, transformer.id)
    })
    return <></>
  }

  const getDraggableId = (event: unknown): string | undefined => {
    if (typeof event !== "object" || event === null) return undefined
    if (!("draggable" in event)) return undefined
    const draggable = (event as { draggable?: { id?: unknown } }).draggable
    if (!draggable) return undefined
    return typeof draggable.id === "string" ? draggable.id : undefined
  }

  const wide = createMemo(() => layout.review.state() === "tab" || !diffs().length)

  return (
    <div class="relative bg-background-base size-full overflow-x-hidden flex flex-col">
      <div class="min-h-0 grow w-full">
        <DragDropProvider
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          collisionDetector={closestCenter}
        >
          <DragDropSensors />
          <ConstrainDragYAxis />
          <Tabs value={tabs().active() ?? "chat"} onChange={tabs().open}>
            <div class="sticky top-0 shrink-0 flex">
              <Tabs.List>
                <Tabs.Trigger value="chat">
                  <div class="flex gap-x-[17px] items-center">
                    <div>Session</div>
                    <Tooltip
                      value={`${new Intl.NumberFormat("en-US", {
                        notation: "compact",
                        compactDisplay: "short",
                      }).format(tokens() ?? 0)} Tokens`}
                      class="flex items-center gap-1.5"
                    >
                      <ProgressCircle percentage={context() ?? 0} />
                      <div class="text-14-regular text-text-weak text-left w-7">{context() ?? 0}%</div>
                    </Tooltip>
                  </div>
                </Tabs.Trigger>
                <Show when={layout.review.state() === "tab" && diffs().length}>
                  <Tabs.Trigger
                    value="review"
                    closeButton={
                      <Tooltip value="Close tab" placement="bottom">
                        <IconButton icon="collapse" size="normal" variant="ghost" onClick={layout.review.pane} />
                      </Tooltip>
                    }
                  >
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
                <SortableProvider ids={tabs().all() ?? []}>
                  <For each={tabs().all() ?? []}>
                    {(tab) => <SortableTab tab={tab} onTabClick={handleTabClick} onTabClose={tabs().close} />}
                  </For>
                </SortableProvider>
                <div class="bg-background-base h-full flex items-center justify-center border-b border-border-weak-base px-3">
                  <Tooltip value="Open file" class="flex items-center">
                    <IconButton
                      icon="plus-small"
                      variant="ghost"
                      iconSize="large"
                      onClick={() => dialog.show(() => <DialogSelectFile />)}
                    />
                  </Tooltip>
                </div>
              </Tabs.List>
            </div>
            <Tabs.Content value="chat" class="@container select-text flex flex-col flex-1 min-h-0 overflow-y-hidden">
              <div
                classList={{
                  "w-full flex-1 min-h-0": true,
                  grid: layout.review.state() === "tab",
                  flex: layout.review.state() === "pane",
                }}
              >
                <div
                  classList={{
                    "relative shrink-0 py-3 flex flex-col gap-6 flex-1 min-h-0 w-full": true,
                    "max-w-146 mx-auto": !wide(),
                  }}
                >
                  <Switch>
                    <Match when={params.id}>
                      <div class="flex items-start justify-start h-full min-h-0">
                        <SessionMessageRail
                          messages={visibleUserMessages()}
                          current={activeMessage()}
                          onMessageSelect={setActiveMessage}
                          wide={wide()}
                        />
                        <Show when={activeMessage()}>
                          <SessionTurn
                            sessionID={params.id!}
                            messageID={activeMessage()!.id}
                            stepsExpanded={store.stepsExpanded}
                            onStepsExpandedChange={(expanded) => setStore("stepsExpanded", expanded)}
                            classes={{
                              root: "pb-20 flex-1 min-w-0",
                              content: "pb-20",
                              container:
                                "w-full " +
                                (wide()
                                  ? "max-w-146 mx-auto px-6"
                                  : visibleUserMessages().length > 1
                                    ? "pr-6 pl-18"
                                    : "px-6"),
                            }}
                          />
                        </Show>
                      </div>
                    </Match>
                    <Match when={true}>
                      <div class="size-full flex flex-col pb-45 justify-end items-start gap-4 flex-[1_0_0] self-stretch max-w-146 mx-auto px-6">
                        <div class="text-20-medium text-text-weaker">New session</div>
                        <div class="flex justify-center items-center gap-3">
                          <Icon name="folder" size="small" />
                          <div class="text-12-medium text-text-weak">
                            {getDirectory(sync.data.path.directory)}
                            <span class="text-text-strong">{getFilename(sync.data.path.directory)}</span>
                          </div>
                        </div>
                        <Show when={sync.project}>
                          {(project) => (
                            <div class="flex justify-center items-center gap-3">
                              <Icon name="pencil-line" size="small" />
                              <div class="text-12-medium text-text-weak">
                                Last modified&nbsp;
                                <span class="text-text-strong">
                                  {DateTime.fromMillis(project().time.updated ?? project().time.created).toRelative()}
                                </span>
                              </div>
                            </div>
                          )}
                        </Show>
                      </div>
                    </Match>
                  </Switch>
                  <div class="absolute inset-x-0 bottom-8 flex flex-col justify-center items-center z-50">
                    <div class="w-full max-w-146 px-6">
                      <PromptInput
                        ref={(el) => {
                          inputRef = el
                        }}
                      />
                    </div>
                  </div>
                </div>
                <Show when={layout.review.state() === "pane" && diffs().length}>
                  <div
                    classList={{
                      "relative grow pt-3 flex-1 min-h-0 border-l border-border-weak-base": true,
                    }}
                  >
                    <SessionReview
                      classes={{
                        root: "pb-20",
                        header: "px-6",
                        container: "px-6",
                      }}
                      diffs={diffs()}
                      actions={
                        <Tooltip value="Open in tab">
                          <IconButton
                            icon="expand"
                            variant="ghost"
                            onClick={() => {
                              layout.review.tab()
                              tabs().setActive("review")
                            }}
                          />
                        </Tooltip>
                      }
                    />
                  </div>
                </Show>
              </div>
            </Tabs.Content>
            <Show when={layout.review.state() === "tab" && diffs().length}>
              <Tabs.Content value="review" class="select-text flex flex-col h-full overflow-hidden">
                <div
                  classList={{
                    "relative pt-3 flex-1 min-h-0 overflow-hidden": true,
                  }}
                >
                  <SessionReview
                    classes={{
                      root: "pb-40",
                      header: "px-6",
                      container: "px-6",
                    }}
                    diffs={diffs()}
                    split
                  />
                </div>
              </Tabs.Content>
            </Show>
            <For each={tabs().all()}>
              {(tab) => {
                const [file] = createResource(
                  () => tab,
                  async (tab) => {
                    if (tab.startsWith("file://")) {
                      return local.file.node(tab.replace("file://", ""))
                    }
                    return undefined
                  },
                )
                return (
                  <Tabs.Content value={tab} class="select-text mt-3">
                    <Switch>
                      <Match when={file()}>
                        {(f) => (
                          <Code
                            file={{
                              name: f().path,
                              contents: f().content?.content ?? "",
                              cacheKey: checksum(f().content?.content ?? ""),
                            }}
                            overflow="scroll"
                            class="pb-40"
                          />
                        )}
                      </Match>
                    </Switch>
                  </Tabs.Content>
                )
              }}
            </For>
          </Tabs>
          <DragOverlay>
            <Show when={store.activeDraggable}>
              {(draggedFile) => {
                const [file] = createResource(
                  () => draggedFile(),
                  async (tab) => {
                    if (tab.startsWith("file://")) {
                      return local.file.node(tab.replace("file://", ""))
                    }
                    return undefined
                  },
                )
                return (
                  <div class="relative px-6 h-12 flex items-center bg-background-stronger border-x border-border-weak-base border-b border-b-transparent">
                    <Show when={file()}>{(f) => <FileVisual active file={f()} />}</Show>
                  </div>
                )
              }}
            </Show>
          </DragOverlay>
        </DragDropProvider>
        <Show when={tabs().active()}>
          <div class="absolute inset-x-0 px-6 max-w-146 flex flex-col justify-center items-center z-50 mx-auto bottom-8">
            <PromptInput
              ref={(el) => {
                inputRef = el
              }}
            />
          </div>
        </Show>
      </div>
      <Show when={layout.terminal.opened()}>
        <div
          class="relative w-full flex flex-col shrink-0 border-t border-border-weak-base"
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
                  <Tooltip value="New Terminal" class="flex items-center">
                    <IconButton icon="plus-small" variant="ghost" iconSize="large" onClick={terminal.new} />
                  </Tooltip>
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
