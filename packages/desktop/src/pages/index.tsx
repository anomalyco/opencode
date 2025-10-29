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
} from "@opencode-ai/ui"
import { FileIcon } from "@/ui"
import FileTree from "@/components/file-tree"
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
import { ProgressCircle } from "@/components/progress-circle"
import { AssistantMessage, Part } from "@/components/assistant-message"
import { type AssistantMessage as AssistantMessageType } from "@opencode-ai/sdk"
import { DiffChanges } from "@/components/diff-changes"

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
    if (!local.session.activeMessage()) return
    if (!messageScrollElement) return
    const element = messageScrollElement.querySelector(`[data-message="${local.session.activeMessage()?.id}"]`)
    element?.scrollIntoView({ block: "start", behavior: "instant" })
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
    local.session.setActive(session.id)
  }

  const handleNewSession = () => {
    local.session.setActive(undefined)
    inputRef?.focus()
  }

  const TabVisual = (props: { file: LocalFile }): JSX.Element => {
    return (
      <div class="flex items-center gap-x-1.5">
        <FileIcon node={props.file} class="_grayscale-100" />
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
            <Tabs.Trigger value={props.file.path} class="peer/tab pr-7" onClick={() => props.onTabClick(props.file)}>
              <TabVisual file={props.file} />
            </Tabs.Trigger>
            <IconButton
              icon="close"
              class="absolute right-1 top-1.5 opacity-0 text-text-muted/60 peer-data-[selected]/tab:opacity-100 peer-data-[selected]/tab:text-text peer-data-[selected]/tab:hover:bg-border-subtle hover:opacity-100 peer-hover/tab:opacity-100"
              variant="ghost"
              onClick={() => props.onTabClose(props.file)}
            />
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
                return (
                  <Tooltip placement="right" value={session.title}>
                    <div>
                      <div class="flex items-center self-stretch gap-6 justify-between">
                        <span class="text-14-regular text-text-strong overflow-hidden text-ellipsis truncate">
                          {session.title}
                        </span>
                        <span class="text-12-regular text-text-weak text-right whitespace-nowrap">
                          {DateTime.fromMillis(session.time.updated).toRelative()}
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
              <Tabs.Content value="chat" class="select-text flex flex-col flex-1 min-h-0 overflow-y-hidden">
                <div class="px-6 pt-12 max-w-[904px] w-full mx-auto flex flex-col flex-1 min-h-0">
                  <Show
                    when={local.session.active()}
                    fallback={
                      <div class="flex flex-col pb-36 justify-end items-start gap-4 flex-[1_0_0] self-stretch">
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
                        <div class="flex items-start gap-8 flex-1 min-h-0">
                          <Show when={local.session.userMessages().length > 1}>
                            <ul role="list" class="w-60 shrink-0 flex flex-col items-start gap-1">
                              <For each={local.session.userMessages()}>
                                {(message) => {
                                  const countLines = (text: string) => {
                                    if (!text) return 0
                                    return text.split("\n").length
                                  }

                                  const additions = createMemo(
                                    () =>
                                      message.summary?.diffs.reduce((acc, diff) => acc + (diff.additions ?? 0), 0) ?? 0,
                                  )

                                  const deletions = createMemo(
                                    () =>
                                      message.summary?.diffs.reduce((acc, diff) => acc + (diff.deletions ?? 0), 0) ?? 0,
                                  )

                                  const totalBeforeLines = createMemo(
                                    () =>
                                      message.summary?.diffs.reduce((acc, diff) => acc + countLines(diff.before), 0) ??
                                      0,
                                  )

                                  const blockCounts = createMemo(() => {
                                    const TOTAL_BLOCKS = 5

                                    const adds = additions()
                                    const dels = deletions()
                                    const unchanged = Math.max(0, totalBeforeLines() - dels)

                                    const totalActivity = unchanged + adds + dels

                                    if (totalActivity === 0) {
                                      return { added: 0, deleted: 0, neutral: TOTAL_BLOCKS }
                                    }

                                    const percentAdded = adds / totalActivity
                                    const percentDeleted = dels / totalActivity
                                    const added_raw = percentAdded * TOTAL_BLOCKS
                                    const deleted_raw = percentDeleted * TOTAL_BLOCKS

                                    let added = adds > 0 ? Math.ceil(added_raw) : 0
                                    let deleted = dels > 0 ? Math.ceil(deleted_raw) : 0

                                    let total_allocated = added + deleted
                                    if (total_allocated > TOTAL_BLOCKS) {
                                      if (added_raw < deleted_raw) {
                                        added = Math.floor(added_raw)
                                      } else {
                                        deleted = Math.floor(deleted_raw)
                                      }

                                      total_allocated = added + deleted
                                      if (total_allocated > TOTAL_BLOCKS) {
                                        if (added_raw < deleted_raw) {
                                          deleted = Math.floor(deleted_raw)
                                        } else {
                                          added = Math.floor(added_raw)
                                        }
                                      }
                                    }

                                    const neutral = Math.max(0, TOTAL_BLOCKS - added - deleted)

                                    return { added, deleted, neutral }
                                  })

                                  const ADD_COLOR = "var(--icon-diff-add-base)"
                                  const DELETE_COLOR = "var(--icon-diff-delete-base)"
                                  const NEUTRAL_COLOR = "var(--icon-weak-base)"

                                  const visibleBlocks = createMemo(() => {
                                    const counts = blockCounts()
                                    const blocks = [
                                      ...Array(counts.added).fill(ADD_COLOR),
                                      ...Array(counts.deleted).fill(DELETE_COLOR),
                                      ...Array(counts.neutral).fill(NEUTRAL_COLOR),
                                    ]
                                    return blocks.slice(0, 5)
                                  })

                                  return (
                                    <li
                                      class="group/li flex items-center gap-x-2 py-1 self-stretch cursor-default"
                                      onClick={() => local.session.setActiveMessage(message.id)}
                                    >
                                      <div class="w-[18px] shrink-0">
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 12" fill="none">
                                          <g>
                                            <For each={visibleBlocks()}>
                                              {(color, i) => (
                                                <rect x={i() * 4} width="2" height="12" rx="1" fill={color} />
                                              )}
                                            </For>
                                          </g>
                                        </svg>
                                      </div>
                                      <div
                                        data-active={local.session.activeMessage()?.id === message.id}
                                        classList={{
                                          "text-14-regular text-text-weak whitespace-nowrap truncate min-w-0": true,
                                          "text-text-weak data-[active=true]:text-text-strong group-hover/li:text-text-base": true,
                                        }}
                                      >
                                        {message.summary?.title ?? local.session.getMessageText(message)}
                                      </div>
                                    </li>
                                  )
                                }}
                              </For>
                            </ul>
                          </Show>
                          <div ref={messageScrollElement} class="grow min-w-0 h-full overflow-y-auto no-scrollbar">
                            <div class="flex flex-col items-start gap-50 pb-50">
                              <For each={local.session.userMessages()}>
                                {(message) => {
                                  const [expanded, setExpanded] = createSignal(false)
                                  const title = createMemo(() => message.summary?.title)
                                  const prompt = createMemo(() => local.session.getMessageText(message))
                                  const summary = createMemo(() => message.summary?.body)
                                  const assistantMessages = createMemo(() => {
                                    return sync.data.message[activeSession().id]?.filter(
                                      (m) => m.role === "assistant" && m.parentID == message.id,
                                    ) as AssistantMessageType[]
                                  })
                                  const working = createMemo(() => {
                                    const last = assistantMessages()[assistantMessages().length - 1]
                                    if (!last) return false
                                    return !last.time.completed
                                  })

                                  return (
                                    <div
                                      data-message={message.id}
                                      class="flex flex-col items-start self-stretch gap-8 min-h-[calc(100vh-15rem)]"
                                    >
                                      {/* Title */}
                                      <div class="py-2 flex flex-col items-start gap-2 self-stretch sticky top-0 bg-background-stronger">
                                        <h1 class="text-14-medium text-text-strong overflow-hidden text-ellipsis min-w-0">
                                          {title() ?? prompt()}
                                        </h1>
                                      </div>
                                      <Show when={title}>
                                        <div class="-mt-8 text-12-regular text-text-base line-clamp-3">{prompt()}</div>
                                      </Show>
                                      {/* Response */}
                                      <div class="w-full flex flex-col gap-2">
                                        <Collapsible variant="ghost" open={expanded()} onOpenChange={setExpanded}>
                                          <Collapsible.Trigger class="text-text-weak hover:text-text-strong">
                                            <div class="flex items-center gap-1 self-stretch">
                                              <h2 class="text-12-medium">
                                                <Switch>
                                                  <Match when={expanded()}>Hide steps</Match>
                                                  <Match when={!expanded()}>Show steps</Match>
                                                </Switch>
                                              </h2>
                                              <Collapsible.Arrow />
                                            </div>
                                          </Collapsible.Trigger>
                                          <Collapsible.Content>
                                            <div class="w-full flex flex-col items-start self-stretch gap-8">
                                              <For each={assistantMessages()}>
                                                {(assistantMessage) => {
                                                  const parts = createMemo(() => sync.data.part[assistantMessage.id])
                                                  return <AssistantMessage message={assistantMessage} parts={parts()} />
                                                }}
                                              </For>
                                            </div>
                                          </Collapsible.Content>
                                        </Collapsible>
                                        <Show when={working() && !expanded()}>
                                          {(_) => {
                                            const lastMessageWithText = createMemo(() =>
                                              assistantMessages().findLast((m) => {
                                                const parts = sync.data.part[m.id]
                                                return parts?.find((p) => p.type === "text")
                                              }),
                                            )
                                            const lastMessageWithReasoning = createMemo(() =>
                                              assistantMessages().findLast((m) => {
                                                const parts = sync.data.part[m.id]
                                                return parts?.find((p) => p.type === "reasoning")
                                              }),
                                            )
                                            const lastMessageWithTool = createMemo(() =>
                                              assistantMessages().findLast((m) => {
                                                const parts = sync.data.part[m.id]
                                                return parts?.find(
                                                  (p) => p.type === "tool" && p.state.status === "completed",
                                                )
                                              }),
                                            )
                                            return (
                                              <div class="w-full flex flex-col gap-2">
                                                <Switch>
                                                  <Match when={lastMessageWithText()}>
                                                    {(last) => {
                                                      const lastTextPart = createMemo(() =>
                                                        sync.data.part[last().id].findLast((p) => p.type === "text"),
                                                      )
                                                      return <Part message={last()} part={lastTextPart()!} readonly />
                                                    }}
                                                  </Match>
                                                  <Match when={lastMessageWithReasoning()}>
                                                    {(last) => {
                                                      const lastReasoningPart = createMemo(() =>
                                                        sync.data.part[last().id].findLast(
                                                          (p) => p.type === "reasoning",
                                                        ),
                                                      )
                                                      return (
                                                        <Part message={last()} part={lastReasoningPart()!} readonly />
                                                      )
                                                    }}
                                                  </Match>
                                                </Switch>
                                                <Show when={lastMessageWithTool()}>
                                                  {(last) => {
                                                    const lastToolPart = createMemo(() =>
                                                      sync.data.part[last().id].findLast(
                                                        (p) => p.type === "tool" && p.state.status === "completed",
                                                      ),
                                                    )
                                                    return <Part message={last()} part={lastToolPart()!} readonly />
                                                  }}
                                                </Show>
                                              </div>
                                            )
                                          }}
                                        </Show>
                                      </div>
                                      {/* Summary */}
                                      <Show when={!working()}>
                                        <div class="w-full flex flex-col gap-6 items-start self-stretch">
                                          <div class="flex flex-col items-start gap-1 self-stretch">
                                            <h2 class="text-12-medium text-text-weak">Summary</h2>
                                            <div class="text-14-regular text-text-base self-stretch">{summary()}</div>
                                          </div>
                                          <Accordion class="w-full" multiple>
                                            <For each={message.summary?.diffs || []}>
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
                                    </div>
                                  )
                                }}
                              </For>
                            </div>
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
                  <div class="relative px-3 h-8 flex items-center text-sm font-medium text-text whitespace-nowrap shrink-0 bg-background-panel border-x border-border-subtle/40 border-b border-b-transparent">
                    <TabVisual file={draggedFile} />
                  </div>
                )
              })()}
            </DragOverlay>
          </DragDropProvider>
          <div
            classList={{
              "absolute inset-x-0 px-6 max-w-[904px] flex flex-col justify-center items-center z-50 mx-auto": true,
              "bottom-8": true,
              // "bottom-8": !!local.session.active(),
              // "bottom-1/2 translate-y-1/2": !local.session.active(),
            }}
          >
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
