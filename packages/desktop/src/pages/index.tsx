import {
  Button,
  List,
  SelectDialog,
  Tooltip,
  IconButton,
  Tabs,
  Icon,
  Accordion,
  Diff,
  Collapsible,
  DiffChanges,
  ProgressCircle,
  Message,
  Typewriter,
} from "@opencode-ai/ui"
import { FileIcon } from "@/ui"
import FileTree from "@/components/file-tree"
import { MessageProgress } from "@/components/message-progress"
import { For, onCleanup, onMount, Show, Match, Switch, createSignal, createEffect, createMemo } from "solid-js"
import { useLocal, type LocalFile } from "@/context/local"
import { createStore } from "solid-js/store"
import { getDirectory, getFilename } from "@/utils"
import { ContentPart, PromptInput } from "@/components/prompt-input"
import { DateTime } from "luxon"
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
import { Code } from "@/components/code"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { type AssistantMessage as AssistantMessageType } from "@opencode-ai/sdk"
import { Markdown } from "@opencode-ai/ui"
import { Spinner } from "@/components/spinner"

export default function Page() {
  const local = useLocal()
  const sync = useSync()
  const sdk = useSDK()
  const [store, setStore] = createStore({
    clickTimer: undefined as number | undefined,
    fileSelectOpen: false,
  })
  let inputRef!: HTMLDivElement
  let messageScrollElement!: HTMLDivElement
  const [activeItem, setActiveItem] = createSignal<string | undefined>(undefined)

  createEffect(() => {
    // Set first message as active if none selected
    const userMessages = local.session.userMessages()
    if (userMessages.length > 0 && !local.session.activeMessage()) {
      local.session.setActiveMessage(userMessages[0].id)
    }
  })

  const MOD = typeof navigator === "object" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform) ? "Meta" : "Control"

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown)
  })

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown)
  })

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.getModifierState(MOD) && event.shiftKey && event.key.toLowerCase() === "p") {
      event.preventDefault()
      return
    }
    if (event.getModifierState(MOD) && event.key.toLowerCase() === "p") {
      event.preventDefault()
      setStore("fileSelectOpen", true)
      return
    }

    const focused = document.activeElement === inputRef
    if (focused) {
      if (event.key === "Escape") {
        inputRef?.blur()
      }
      return
    }

    if (local.file.active()) {
      const active = local.file.active()!
      if (event.key === "Enter" && active.selection) {
        local.context.add({
          type: "file",
          path: active.path,
          selection: { ...active.selection },
        })
        return
      }

      if (event.getModifierState(MOD)) {
        if (event.key.toLowerCase() === "a") {
          return
        }
        if (event.key.toLowerCase() === "c") {
          return
        }
      }
    }

    if (event.key.length === 1 && event.key !== "Unidentified" && !(event.ctrlKey || event.metaKey)) {
      inputRef?.focus()
    }
  }

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

  const handleFileClick = async (file: LocalFile) => {
    if (store.clickTimer) {
      resetClickTimer()
      local.file.update(file.path, { ...file, pinned: true })
    } else {
      local.file.open(file.path)
      startClickTimer()
    }
  }

  const navigateChange = (dir: 1 | -1) => {
    const active = local.file.active()
    if (!active) return
    const current = local.file.changeIndex(active.path)
    const next = current === undefined ? (dir === 1 ? 0 : -1) : current + dir
    local.file.setChangeIndex(active.path, next)
  }

  const handleTabChange = (path: string) => {
    if (path === "chat" || path === "review") return
    local.file.open(path)
  }

  const handleTabClose = (file: LocalFile) => {
    local.file.close(file.path)
  }

  const handleDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setActiveItem(id)
  }

  const handleDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (draggable && droppable) {
      const currentFiles = local.file.opened().map((file) => file.path)
      const fromIndex = currentFiles.indexOf(draggable.id.toString())
      const toIndex = currentFiles.indexOf(droppable.id.toString())
      if (fromIndex !== toIndex) {
        local.file.move(draggable.id.toString(), toIndex)
      }
    }
  }

  const handleDragEnd = () => {
    setActiveItem(undefined)
  }

  const scrollDiffItem = (element: HTMLElement) => {
    element.scrollIntoView({ block: "start", behavior: "instant" })
  }

  const handleDiffTriggerClick = (event: MouseEvent) => {
    // disabling scroll to diff for now
    return
    const target = event.currentTarget as HTMLElement
    queueMicrotask(() => {
      if (target.getAttribute("aria-expanded") !== "true") return
      const item = target.closest('[data-slot="accordion-item"]') as HTMLElement | null
      if (!item) return
      scrollDiffItem(item)
    })
  }

  const handlePromptSubmit = async (parts: ContentPart[]) => {
    const existingSession = local.session.active()
    let session = existingSession
    if (!session) {
      const created = await sdk.client.session.create()
      session = created.data ?? undefined
    }
    if (!session) return

    local.session.setActive(session.id)
    const toAbsolutePath = (path: string) => (path.startsWith("/") ? path : sync.absolute(path))

    const text = parts.map((part) => part.content).join("")
    const attachments = parts.filter((part) => part.type === "file")

    // const activeFile = local.context.active()
    // if (activeFile) {
    //   registerAttachment(
    //     activeFile.path,
    //     activeFile.selection,
    //     activeFile.name ?? formatAttachmentLabel(activeFile.path, activeFile.selection),
    //   )
    // }

    // for (const contextFile of local.context.all()) {
    //   registerAttachment(
    //     contextFile.path,
    //     contextFile.selection,
    //     formatAttachmentLabel(contextFile.path, contextFile.selection),
    //   )
    // }

    const attachmentParts = attachments.map((attachment) => {
      const absolute = toAbsolutePath(attachment.path)
      const query = attachment.selection
        ? `?start=${attachment.selection.startLine}&end=${attachment.selection.endLine}`
        : ""
      return {
        type: "file" as const,
        mime: "text/plain",
        url: `file://${absolute}${query}`,
        filename: getFilename(attachment.path),
        source: {
          type: "file" as const,
          text: {
            value: attachment.content,
            start: attachment.start,
            end: attachment.end,
          },
          path: absolute,
        },
      }
    })

    await sdk.client.session.prompt({
      path: { id: session.id },
      body: {
        agent: local.agent.current()!.name,
        model: {
          modelID: local.model.current()!.id,
          providerID: local.model.current()!.provider.id,
        },
        parts: [
          {
            type: "text",
            text,
          },
          ...attachmentParts,
        ],
      },
    })
  }

  const handleNewSession = () => {
    local.session.setActive(undefined)
    inputRef?.focus()
  }

  const TabVisual = (props: { file: LocalFile }): JSX.Element => {
    return (
      <div class="flex items-center gap-x-1.5">
        <FileIcon node={props.file} class="grayscale-100 group-data-[selected]/tab:grayscale-0" />
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
    file: LocalFile
    onTabClick: (file: LocalFile) => void
    onTabClose: (file: LocalFile) => void
  }): JSX.Element => {
    const sortable = createSortable(props.file.path)

    return (
      // @ts-ignore
      <div use:sortable classList={{ "h-full": true, "opacity-0": sortable.isActiveDraggable }}>
        <Tooltip value={props.file.path} placement="bottom" class="h-full">
          <div class="relative h-full">
            <Tabs.Trigger
              value={props.file.path}
              class="group/tab pl-3 pr-1"
              onClick={() => props.onTabClick(props.file)}
            >
              <TabVisual file={props.file} />
              <IconButton
                icon="close"
                class="mt-0.5 opacity-0 text-text-muted/60 group-data-[selected]/tab:opacity-100
                       group-data-[selected]/tab:text-text group-data-[selected]/tab:hover:bg-border-subtle
                       hover:opacity-100 group-hover/tab:opacity-100"
                variant="ghost"
                onClick={() => props.onTabClose(props.file)}
              />
            </Tabs.Trigger>
          </div>
        </Tooltip>
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

  return (
    <div class="relative h-screen flex flex-col">
      <header class="hidden h-12 shrink-0 bg-background-strong border-b border-border-weak-base"></header>
      <main class="h-[calc(100vh-0rem)] flex">
        <div class="w-70 shrink-0 bg-background-weak border-r border-border-weak-base flex flex-col items-start">
          <div class="h-10 flex items-center self-stretch px-5 border-b border-border-weak-base">
            <span class="text-14-regular overflow-hidden text-ellipsis">{getFilename(sync.data.path.directory)}</span>
          </div>
          <div class="flex flex-col items-start gap-4 self-stretch flex-1 py-4 px-3">
            <Button class="w-full" size="large" onClick={handleNewSession} icon="edit-small-2">
              New Session
            </Button>
            <List
              data={sync.data.session}
              key={(x) => x.id}
              current={local.session.active()}
              onSelect={(s) => local.session.setActive(s?.id)}
              onHover={(s) => (!!s ? sync.session.sync(s?.id) : undefined)}
            >
              {(session) => {
                const diffs = createMemo(() => session.summary?.diffs ?? [])
                const filesChanged = createMemo(() => diffs().length)
                const updated = DateTime.fromMillis(session.time.updated)
                return (
                  <Tooltip placement="right" value={session.title}>
                    <div>
                      <div class="flex items-center self-stretch gap-6 justify-between">
                        <span class="text-14-regular text-text-strong overflow-hidden text-ellipsis truncate">
                          {session.title}
                        </span>
                        <span class="text-12-regular text-text-weak text-right whitespace-nowrap">
                          {Math.abs(updated.diffNow().as("seconds")) < 60
                            ? "Now"
                            : updated
                                .toRelative({ style: "short", unit: ["days", "hours", "minutes"] })
                                ?.replace(" ago", "")
                                ?.replace(/ days?/, "d")
                                ?.replace(" min.", "m")
                                ?.replace(" hr.", "h")}
                        </span>
                      </div>
                      <div class="flex justify-between items-center self-stretch">
                        <span class="text-12-regular text-text-weak">{`${filesChanged() || "No"} file${filesChanged() !== 1 ? "s" : ""} changed`}</span>
                        <DiffChanges diff={diffs()} />
                      </div>
                    </div>
                  </Tooltip>
                )
              }}
            </List>
          </div>
        </div>
        <div class="relative bg-background-base w-full h-full overflow-x-hidden">
          <DragDropProvider
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            collisionDetector={closestCenter}
          >
            <DragDropSensors />
            <ConstrainDragYAxis />
            <Tabs onChange={handleTabChange}>
              <div class="sticky top-0 shrink-0 flex">
                <Tabs.List>
                  <Tabs.Trigger value="chat" class="flex gap-x-4 items-center">
                    <div>Chat</div>
                    <Tooltip value={`${local.session.tokens() ?? 0} Tokens`} class="flex items-center gap-1.5">
                      <ProgressCircle percentage={local.session.context() ?? 0} />
                      <div class="text-14-regular text-text-weak text-right">{local.session.context() ?? 0}%</div>
                    </Tooltip>
                  </Tabs.Trigger>
                  {/* <Tabs.Trigger value="review">Review</Tabs.Trigger> */}
                  <SortableProvider ids={local.file.opened().map((file) => file.path)}>
                    <For each={local.file.opened()}>
                      {(file) => <SortableTab file={file} onTabClick={handleFileClick} onTabClose={handleTabClose} />}
                    </For>
                  </SortableProvider>
                  <div class="bg-background-base h-full flex items-center justify-center border-b border-border-weak-base px-3">
                    <IconButton
                      icon="plus-small"
                      variant="ghost"
                      iconSize="large"
                      onClick={() => setStore("fileSelectOpen", true)}
                    />
                  </div>
                </Tabs.List>
                <div class="hidden shrink-0 h-full _flex items-center gap-1 px-2 border-b border-border-subtle/40">
                  <Show when={local.file.active() && local.file.active()!.content?.diff}>
                    {(() => {
                      const activeFile = local.file.active()!
                      const view = local.file.view(activeFile.path)
                      return (
                        <div class="flex items-center gap-1">
                          <Show when={view !== "raw"}>
                            <div class="mr-1 flex items-center gap-1">
                              <Tooltip value="Previous change" placement="bottom">
                                <IconButton icon="arrow-up" variant="ghost" onClick={() => navigateChange(-1)} />
                              </Tooltip>
                              <Tooltip value="Next change" placement="bottom">
                                <IconButton icon="arrow-down" variant="ghost" onClick={() => navigateChange(1)} />
                              </Tooltip>
                            </div>
                          </Show>
                          <Tooltip value="Raw" placement="bottom">
                            <IconButton
                              icon="file-text"
                              variant="ghost"
                              classList={{
                                "text-text": view === "raw",
                                "text-text-muted/70": view !== "raw",
                                "bg-background-element": view === "raw",
                              }}
                              onClick={() => local.file.setView(activeFile.path, "raw")}
                            />
                          </Tooltip>
                          <Tooltip value="Unified diff" placement="bottom">
                            <IconButton
                              icon="checklist"
                              variant="ghost"
                              classList={{
                                "text-text": view === "diff-unified",
                                "text-text-muted/70": view !== "diff-unified",
                                "bg-background-element": view === "diff-unified",
                              }}
                              onClick={() => local.file.setView(activeFile.path, "diff-unified")}
                            />
                          </Tooltip>
                          <Tooltip value="Split diff" placement="bottom">
                            <IconButton
                              icon="columns"
                              variant="ghost"
                              classList={{
                                "text-text": view === "diff-split",
                                "text-text-muted/70": view !== "diff-split",
                                "bg-background-element": view === "diff-split",
                              }}
                              onClick={() => local.file.setView(activeFile.path, "diff-split")}
                            />
                          </Tooltip>
                        </div>
                      )
                    })()}
                  </Show>
                </div>
              </div>
              <Tabs.Content value="chat" class="@container select-text flex flex-col flex-1 min-h-0 overflow-y-hidden">
                <div class="relative px-6 pt-12 max-w-2xl w-full mx-auto flex flex-col flex-1 min-h-0">
                  <Show
                    when={local.session.active()}
                    fallback={
                      <div class="flex flex-col pb-45 justify-end items-start gap-4 flex-[1_0_0] self-stretch">
                        <div class="text-20-medium text-text-weaker">New session</div>
                        <div class="flex justify-center items-center gap-3">
                          <Icon name="folder" size="small" />
                          <div class="text-12-medium text-text-weak">
                            {getDirectory(sync.data.path.directory)}
                            <span class="text-text-strong">{getFilename(sync.data.path.directory)}</span>
                          </div>
                        </div>
                        <div class="flex justify-center items-center gap-3">
                          <Icon name="pencil-line" size="small" />
                          <div class="text-12-medium text-text-weak">
                            Last modified&nbsp;
                            <span class="text-text-strong">
                              {DateTime.fromMillis(sync.data.project.time.created).toRelative()}
                            </span>
                          </div>
                        </div>
                      </div>
                    }
                  >
                    {(activeSession) => (
                      <div class="pt-3 flex flex-col flex-1 min-h-0">
                        <div class="flex-1 min-h-0">
                          <Show when={local.session.userMessages().length > 1}>
                            <ul
                              role="list"
                              class="absolute right-full mr-8 hidden w-60 shrink-0 @7xl:flex flex-col items-start gap-1"
                            >
                              <For each={local.session.userMessages()}>
                                {(message) => {
                                  const diffs = createMemo(() => message.summary?.diffs ?? [])
                                  const working = createMemo(() => !message.summary?.body)
                                  const assistantMessages = createMemo(() => {
                                    return sync.data.message[activeSession().id]?.filter(
                                      (m) => m.role === "assistant" && m.parentID == message.id,
                                    ) as AssistantMessageType[]
                                  })
                                  const parts = createMemo(() =>
                                    assistantMessages().flatMap((m) => sync.data.part[m.id]),
                                  )
                                  const lastPart = createMemo(() => parts().slice(-1)?.at(0))
                                  const rawStatus = createMemo(() => {
                                    const defaultStatus = "Working..."
                                    const last = lastPart()
                                    if (!last) return defaultStatus

                                    if (last.type === "tool") {
                                      switch (last.tool) {
                                        case "task":
                                          return "Delegating work..."
                                        case "todowrite":
                                        case "todoread":
                                          return "Planning next steps..."
                                        case "read":
                                          return "Gathering context..."
                                        case "list":
                                        case "grep":
                                        case "glob":
                                          return "Searching the codebase..."
                                        case "webfetch":
                                          return "Searching the web..."
                                        case "edit":
                                        case "write":
                                          return "Making edits..."
                                        case "bash":
                                          return "Running commands..."
                                        default:
                                          break
                                      }
                                    } else if (last.type === "reasoning") {
                                      return "Thinking..."
                                    } else if (last.type === "text") {
                                      return "Gathering thoughts..."
                                    }
                                    return defaultStatus
                                  })

                                  const [status, setStatus] = createSignal(rawStatus())
                                  let lastStatusChange = Date.now()
                                  let statusTimeout: number | undefined

                                  createEffect(() => {
                                    const newStatus = rawStatus()
                                    if (newStatus === status()) return

                                    const timeSinceLastChange = Date.now() - lastStatusChange

                                    if (timeSinceLastChange >= 1000) {
                                      setStatus(newStatus)
                                      lastStatusChange = Date.now()
                                      if (statusTimeout) {
                                        clearTimeout(statusTimeout)
                                        statusTimeout = undefined
                                      }
                                    } else {
                                      if (statusTimeout) clearTimeout(statusTimeout)
                                      statusTimeout = setTimeout(() => {
                                        setStatus(rawStatus())
                                        lastStatusChange = Date.now()
                                        statusTimeout = undefined
                                      }, 1000 - timeSinceLastChange) as unknown as number
                                    }
                                  })

                                  return (
                                    <li class="group/li flex items-center self-stretch">
                                      <button
                                        class="flex items-center self-stretch w-full gap-x-2 py-1 cursor-default"
                                        onClick={() => local.session.setActiveMessage(message.id)}
                                      >
                                        <Switch>
                                          <Match when={working()}>
                                            <Spinner class="text-text-base shrink-0 w-[18px] aspect-square" />
                                          </Match>
                                          <Match when={true}>
                                            <DiffChanges diff={diffs()} variant="bars" />
                                          </Match>
                                        </Switch>
                                        <div
                                          data-active={local.session.activeMessage()?.id === message.id}
                                          classList={{
                                            "text-14-regular text-text-weak whitespace-nowrap truncate min-w-0": true,
                                            "text-text-weak data-[active=true]:text-text-strong group-hover/li:text-text-base": true,
                                          }}
                                        >
                                          <Switch>
                                            <Match when={working()}>{status()}</Match>
                                            <Match when={true}>{message.summary?.title}</Match>
                                          </Switch>
                                        </div>
                                      </button>
                                    </li>
                                  )
                                }}
                              </For>
                            </ul>
                          </Show>
                          <div ref={messageScrollElement} class="grow min-w-0 h-full overflow-y-auto no-scrollbar">
                            <For each={local.session.userMessages()}>
                              {(message) => {
                                const isActive = createMemo(() => local.session.activeMessage()?.id === message.id)
                                const [titled, setTitled] = createSignal(!!message.summary?.title)
                                const [completed, setCompleted] = createSignal(!!message.summary?.body)
                                const [expanded, setExpanded] = createSignal(false)
                                const parts = createMemo(() => sync.data.part[message.id])
                                const title = createMemo(() => message.summary?.title)
                                const summary = createMemo(() => message.summary?.body)
                                const diffs = createMemo(() => message.summary?.diffs ?? [])
                                const assistantMessages = createMemo(() => {
                                  return sync.data.message[activeSession().id]?.filter(
                                    (m) => m.role === "assistant" && m.parentID == message.id,
                                  ) as AssistantMessageType[]
                                })
                                const hasToolPart = createMemo(() =>
                                  assistantMessages()
                                    ?.flatMap((m) => sync.data.part[m.id])
                                    .some((p) => p?.type === "tool"),
                                )
                                const working = createMemo(() => !summary())

                                // allowing time for the animations to finish
                                createEffect(() => {
                                  title()
                                  setTimeout(() => setTitled(!!title()), 10_000)
                                })
                                createEffect(() => {
                                  summary()
                                  setTimeout(() => setCompleted(!!summary()), 1200)
                                })

                                return (
                                  <Show when={isActive()}>
                                    <div
                                      data-message={message.id}
                                      class="flex flex-col items-start self-stretch gap-8 pb-50"
                                    >
                                      {/* Title */}
                                      <div class="py-2 flex flex-col items-start gap-2 self-stretch sticky top-0 bg-background-stronger z-10">
                                        <div class="w-full text-14-medium text-text-strong">
                                          <Show
                                            when={titled()}
                                            fallback={
                                              <Typewriter
                                                as="h1"
                                                text={title()}
                                                class="overflow-hidden text-ellipsis min-w-0 text-nowrap"
                                              />
                                            }
                                          >
                                            <h1 class="overflow-hidden text-ellipsis min-w-0 text-nowrap">{title()}</h1>
                                          </Show>
                                        </div>
                                      </div>
                                      <div class="-mt-8">
                                        <Message message={message} parts={parts()} />
                                      </div>
                                      {/* Summary */}
                                      <Show when={completed()}>
                                        <div class="w-full flex flex-col gap-6 items-start self-stretch">
                                          <div class="flex flex-col items-start gap-1 self-stretch">
                                            <h2 class="text-12-medium text-text-weak">
                                              <Switch>
                                                <Match when={diffs().length}>Summary</Match>
                                                <Match when={true}>Response</Match>
                                              </Switch>
                                            </h2>
                                            <Show when={summary()}>
                                              {(summary) => (
                                                <Markdown
                                                  classList={{ "[&>*]:fade-up-text": !diffs().length }}
                                                  text={summary()}
                                                />
                                              )}
                                            </Show>
                                          </div>
                                          <Accordion class="w-full" multiple>
                                            <For each={diffs()}>
                                              {(diff) => (
                                                <Accordion.Item value={diff.file}>
                                                  <Accordion.Header>
                                                    <Accordion.Trigger onClick={handleDiffTriggerClick}>
                                                      <div class="flex items-center justify-between w-full gap-5">
                                                        <div class="grow flex items-center gap-5 min-w-0">
                                                          <FileIcon
                                                            node={{ path: diff.file, type: "file" }}
                                                            class="shrink-0 size-4"
                                                          />
                                                          <div class="flex grow min-w-0">
                                                            <Show when={diff.file.includes("/")}>
                                                              <span class="text-text-base truncate-start">
                                                                {getDirectory(diff.file)}&lrm;
                                                              </span>
                                                            </Show>
                                                            <span class="text-text-strong shrink-0">
                                                              {getFilename(diff.file)}
                                                            </span>
                                                          </div>
                                                        </div>
                                                        <div class="shrink-0 flex gap-4 items-center justify-end">
                                                          <DiffChanges diff={diff} />
                                                          <Icon name="chevron-grabber-vertical" size="small" />
                                                        </div>
                                                      </div>
                                                    </Accordion.Trigger>
                                                  </Accordion.Header>
                                                  <Accordion.Content>
                                                    <Diff
                                                      before={{
                                                        name: diff.file!,
                                                        contents: diff.before!,
                                                      }}
                                                      after={{
                                                        name: diff.file!,
                                                        contents: diff.after!,
                                                      }}
                                                    />
                                                  </Accordion.Content>
                                                </Accordion.Item>
                                              )}
                                            </For>
                                          </Accordion>
                                        </div>
                                      </Show>
                                      {/* Response */}
                                      <div class="w-full">
                                        <Switch>
                                          <Match when={!completed()}>
                                            <MessageProgress assistantMessages={assistantMessages} done={!working()} />
                                          </Match>
                                          <Match when={completed() && hasToolPart()}>
                                            <Collapsible variant="ghost" open={expanded()} onOpenChange={setExpanded}>
                                              <Collapsible.Trigger class="text-text-weak hover:text-text-strong">
                                                <div class="flex items-center gap-1 self-stretch">
                                                  <div class="text-12-medium">
                                                    <Switch>
                                                      <Match when={expanded()}>Hide details</Match>
                                                      <Match when={!expanded()}>Show details</Match>
                                                    </Switch>
                                                  </div>
                                                  <Collapsible.Arrow />
                                                </div>
                                              </Collapsible.Trigger>
                                              <Collapsible.Content>
                                                <div class="w-full flex flex-col items-start self-stretch gap-3">
                                                  <For each={assistantMessages()}>
                                                    {(assistantMessage) => {
                                                      const parts = createMemo(
                                                        () => sync.data.part[assistantMessage.id],
                                                      )
                                                      return <Message message={assistantMessage} parts={parts()} />
                                                    }}
                                                  </For>
                                                </div>
                                              </Collapsible.Content>
                                            </Collapsible>
                                          </Match>
                                        </Switch>
                                      </div>
                                    </div>
                                  </Show>
                                )
                              }}
                            </For>
                          </div>
                        </div>
                      </div>
                    )}
                  </Show>
                </div>
              </Tabs.Content>
              {/* <Tabs.Content value="review" class="select-text"></Tabs.Content> */}
              <For each={local.file.opened()}>
                {(file) => (
                  <Tabs.Content value={file.path} class="select-text">
                    {(() => {
                      const view = local.file.view(file.path)
                      const showRaw = view === "raw" || !file.content?.diff
                      const code = showRaw ? (file.content?.content ?? "") : (file.content?.diff ?? "")
                      return <Code path={file.path} code={code} class="[&_code]:pb-60" />
                    })()}
                  </Tabs.Content>
                )}
              </For>
            </Tabs>
            <DragOverlay>
              {(() => {
                const id = activeItem()
                if (!id) return null
                const draggedFile = local.file.node(id)
                if (!draggedFile) return null
                return (
                  <div class="relative px-3 h-10 flex items-center bg-background-base border-x border-border-weak-base border-b border-b-transparent">
                    <TabVisual file={draggedFile} />
                  </div>
                )
              })()}
            </DragOverlay>
          </DragDropProvider>
          <div class="absolute inset-x-0 px-6 max-w-2xl flex flex-col justify-center items-center z-50 mx-auto bottom-8">
            <PromptInput
              ref={(el) => {
                inputRef = el
              }}
              onSubmit={handlePromptSubmit}
            />
          </div>
          <div class="hidden shrink-0 w-56 p-2 h-full overflow-y-auto">
            <FileTree path="" onFileClick={handleFileClick} />
          </div>
          <div class="hidden shrink-0 w-56 p-2">
            <Show
              when={local.file.changes().length}
              fallback={<div class="px-2 text-xs text-text-muted">No changes</div>}
            >
              <ul class="">
                <For each={local.file.changes()}>
                  {(path) => (
                    <li>
                      <button
                        onClick={() => local.file.open(path, { view: "diff-unified", pinned: true })}
                        class="w-full flex items-center px-2 py-0.5 gap-x-2 text-text-muted grow min-w-0 hover:bg-background-element"
                      >
                        <FileIcon node={{ path, type: "file" }} class="shrink-0 size-3" />
                        <span class="text-xs text-text whitespace-nowrap">{getFilename(path)}</span>
                        <span class="text-xs text-text-muted/60 whitespace-nowrap truncate min-w-0">
                          {getDirectory(path)}
                        </span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        </div>
      </main>
      <Show when={store.fileSelectOpen}>
        <SelectDialog
          defaultOpen
          title="Select file"
          placeholder="Search files"
          emptyMessage="No files found"
          items={local.file.search}
          key={(x) => x}
          onOpenChange={(open) => setStore("fileSelectOpen", open)}
          onSelect={(x) => (x ? local.file.open(x, { pinned: true }) : undefined)}
        >
          {(i) => (
            <div
              classList={{
                "w-full flex items-center justify-between rounded-md": true,
              }}
            >
              <div class="flex items-center gap-x-2 grow min-w-0">
                <FileIcon node={{ path: i, type: "file" }} class="shrink-0 size-4" />
                <div class="flex items-center text-14-regular">
                  <span class="text-text-weak whitespace-nowrap overflow-hidden overflow-ellipsis truncate min-w-0">
                    {getDirectory(i)}
                  </span>
                  <span class="text-text-strong whitespace-nowrap">{getFilename(i)}</span>
                </div>
              </div>
              <div class="flex items-center gap-x-1 text-text-muted/40 shrink-0"></div>
            </div>
          )}
        </SelectDialog>
      </Show>
    </div>
  )
}
