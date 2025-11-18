import {
  SelectDialog,
  IconButton,
  Tabs,
  Icon,
  Accordion,
  Diff,
  Collapsible,
  DiffChanges,
  Message,
  Typewriter,
  Card,
  Code,
  Tooltip,
  ProgressCircle,
  Button,
} from "@opencode-ai/ui"
import { FileIcon } from "@/ui"
import { MessageProgress } from "@/components/message-progress"
import {
  For,
  onCleanup,
  onMount,
  Show,
  Match,
  Switch,
  createSignal,
  createEffect,
  createMemo,
  createResource,
} from "solid-js"
import { useLocal, type LocalFile } from "@/context/local"
import { createStore } from "solid-js/store"
import { getDirectory, getFilename } from "@/utils"
import { PromptInput } from "@/components/prompt-input"
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
import { useSync } from "@/context/sync"
import { type AssistantMessage as AssistantMessageType } from "@opencode-ai/sdk"
import { Markdown } from "@opencode-ai/ui"
import { Spinner } from "@/components/spinner"
import { useSession } from "@/context/session"
import { StickyAccordionHeader } from "@/components/sticky-accordion-header"
import { SessionReview } from "@/components/session-review"

export default function Page() {
  const local = useLocal()
  const sync = useSync()
  const session = useSession()
  const [store, setStore] = createStore({
    clickTimer: undefined as number | undefined,
    fileSelectOpen: false,
    activeDraggable: undefined as string | undefined,
  })
  let inputRef!: HTMLDivElement
  let messageScrollElement!: HTMLDivElement

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
    if (event.ctrlKey && event.key.toLowerCase() === "t") {
      event.preventDefault()
      const currentTheme = localStorage.getItem("theme") ?? "oc-1"
      const themes = ["oc-1", "oc-2-paper"]
      const nextTheme = themes[(themes.indexOf(currentTheme) + 1) % themes.length]
      localStorage.setItem("theme", nextTheme)
      document.documentElement.setAttribute("data-theme", nextTheme)
      return
    }

    const focused = document.activeElement === inputRef
    if (focused) {
      if (event.key === "Escape") {
        inputRef?.blur()
      }
      return
    }

    // if (local.file.active()) {
    //   const active = local.file.active()!
    //   if (event.key === "Enter" && active.selection) {
    //     local.context.add({
    //       type: "file",
    //       path: active.path,
    //       selection: { ...active.selection },
    //     })
    //     return
    //   }
    //
    //   if (event.getModifierState(MOD)) {
    //     if (event.key.toLowerCase() === "a") {
    //       return
    //     }
    //     if (event.key.toLowerCase() === "c") {
    //       return
    //     }
    //   }
    // }

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

  const handleTabClick = async (tab: string) => {
    if (store.clickTimer) {
      resetClickTimer()
      // local.file.update(file.path, { ...file, pinned: true })
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
      const currentTabs = session.layout.tabs.opened
      const fromIndex = currentTabs?.indexOf(draggable.id.toString())
      const toIndex = currentTabs?.indexOf(droppable.id.toString())
      if (fromIndex !== toIndex && toIndex !== undefined) {
        session.layout.moveTab(draggable.id.toString(), toIndex)
      }
    }
  }

  const handleDragEnd = () => {
    setStore("activeDraggable", undefined)
  }

  const FileVisual = (props: { file: LocalFile }): JSX.Element => {
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
            closeButton={<IconButton icon="close" variant="ghost" onClick={() => props.onTabClose(props.tab)} />}
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

  return (
    <div class="relative bg-background-base size-full overflow-x-hidden">
      <DragDropProvider
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        collisionDetector={closestCenter}
      >
        <DragDropSensors />
        <ConstrainDragYAxis />
        <Tabs value={session.layout.tabs.active ?? "chat"} onChange={session.layout.openTab}>
          <div class="sticky top-0 shrink-0 flex">
            <Tabs.List>
              <Tabs.Trigger value="chat">
                <div class="flex gap-x-[17px] items-center">
                  <div>Chat</div>
                  <Tooltip
                    value={`${new Intl.NumberFormat("en-US", {
                      notation: "compact",
                      compactDisplay: "short",
                    }).format(session.usage.tokens() ?? 0)} Tokens`}
                    class="flex items-center gap-1.5"
                  >
                    <ProgressCircle percentage={session.usage.context() ?? 0} />
                    <div class="text-14-regular text-text-weak text-left w-7">{session.usage.context() ?? 0}%</div>
                  </Tooltip>
                </div>
              </Tabs.Trigger>
              <Show when={local.layout.review.state() === "tab" && session.diffs().length}>
                <Tabs.Trigger
                  value="review"
                  closeButton={
                    <IconButton icon="collapse" size="normal" variant="ghost" onClick={local.layout.review.pane} />
                  }
                >
                  <div class="flex items-center gap-3">
                    <Show when={session.diffs()}>
                      <DiffChanges changes={session.diffs()} variant="bars" />
                    </Show>
                    <div class="flex items-center gap-1.5">
                      <div>Review</div>
                      <Show when={session.info()?.summary?.files}>
                        <div class="text-12-medium text-text-strong h-4 px-2 flex flex-col items-center justify-center rounded-full bg-surface-base">
                          {session.info()?.summary?.files ?? 0}
                        </div>
                      </Show>
                    </div>
                  </div>
                </Tabs.Trigger>
              </Show>
              <SortableProvider ids={session.layout.tabs.opened ?? []}>
                <For each={session.layout.tabs.opened ?? []}>
                  {(tab) => <SortableTab tab={tab} onTabClick={handleTabClick} onTabClose={session.layout.closeTab} />}
                </For>
              </SortableProvider>
              <div class="bg-background-base h-full flex items-center justify-center border-b border-border-weak-base px-3">
                <Tooltip value="Open file" class="flex items-center">
                  <IconButton
                    icon="plus-small"
                    variant="ghost"
                    iconSize="large"
                    onClick={() => setStore("fileSelectOpen", true)}
                  />
                </Tooltip>
              </div>
            </Tabs.List>
          </div>
          <Tabs.Content value="chat" class="@container select-text flex flex-col flex-1 min-h-0 overflow-y-hidden">
            <div
              classList={{
                "w-full flex-1 min-h-0": true,
                grid: local.layout.review.state() === "tab",
                flex: local.layout.review.state() === "pane",
              }}
            >
              <div class="relative shrink-0 px-6 py-3 flex flex-col gap-6 flex-1 min-h-0 w-full max-w-xl mx-auto">
                <Switch>
                  <Match when={session.id}>
                    <div
                      classList={{
                        "flex-1 min-h-0 pb-20": true,
                        "flex items-start justify-start": local.layout.review.state() === "pane",
                      }}
                    >
                      <Show when={session.messages.user().length > 1}>
                        <ul
                          role="list"
                          classList={{
                            "mr-8 shrink-0 flex flex-col items-start": true,
                            "absolute right-full w-60 mt-3 @7xl:gap-2 @7xl:mt-1": local.layout.review.state() === "tab",
                            "mt-3": local.layout.review.state() === "pane",
                          }}
                        >
                          <For each={session.messages.user()}>
                            {(message) => {
                              const assistantMessages = createMemo(() => {
                                if (!session.id) return []
                                return sync.data.message[session.id]?.filter(
                                  (m) => m.role === "assistant" && m.parentID == message.id,
                                ) as AssistantMessageType[]
                              })
                              const error = createMemo(() => assistantMessages().find((m) => m?.error)?.error)
                              const working = createMemo(() => !message.summary?.body && !error())

                              const handleClick = () => session.messages.setActive(message.id)

                              return (
                                <li
                                  classList={{
                                    "group/li flex items-center self-stretch justify-end": true,
                                    "@7xl:justify-start": local.layout.review.state() === "tab",
                                  }}
                                >
                                  <Tooltip
                                    placement="right"
                                    gutter={8}
                                    value={
                                      <div class="flex items-center gap-2">
                                        <DiffChanges changes={message.summary?.diffs ?? []} variant="bars" />
                                        {message.summary?.title}
                                      </div>
                                    }
                                  >
                                    <button
                                      data-active={session.messages.active()?.id === message.id}
                                      onClick={handleClick}
                                      classList={{
                                        "group/tick flex items-center justify-start h-2 w-8 -mr-3": true,
                                        "data-[active=true]:[&>div]:bg-icon-strong-base data-[active=true]:[&>div]:w-full": true,
                                        "@7xl:hidden": local.layout.review.state() === "tab",
                                      }}
                                    >
                                      <div class="h-px w-5 bg-icon-base group-hover/tick:w-full group-hover/tick:bg-icon-strong-base" />
                                    </button>
                                  </Tooltip>
                                  <button
                                    classList={{
                                      "hidden items-center self-stretch w-full gap-x-2 cursor-default": true,
                                      "@7xl:flex": local.layout.review.state() === "tab",
                                    }}
                                    onClick={handleClick}
                                  >
                                    <Switch>
                                      <Match when={working()}>
                                        <Spinner class="text-text-base shrink-0 w-[18px] aspect-square" />
                                      </Match>
                                      <Match when={true}>
                                        <DiffChanges changes={message.summary?.diffs ?? []} variant="bars" />
                                      </Match>
                                    </Switch>
                                    <div
                                      data-active={session.messages.active()?.id === message.id}
                                      classList={{
                                        "text-14-regular text-text-weak whitespace-nowrap truncate min-w-0": true,
                                        "text-text-weak data-[active=true]:text-text-strong group-hover/li:text-text-base": true,
                                      }}
                                    >
                                      <Show when={message.summary?.title} fallback="New message">
                                        {message.summary?.title}
                                      </Show>
                                    </div>
                                  </button>
                                </li>
                              )
                            }}
                          </For>
                        </ul>
                      </Show>
                      <div ref={messageScrollElement} class="grow size-full min-w-0 overflow-y-auto no-scrollbar">
                        <For each={session.messages.user()}>
                          {(message) => {
                            const isActive = createMemo(() => session.messages.active()?.id === message.id)
                            const [titled, setTitled] = createSignal(!!message.summary?.title)
                            const assistantMessages = createMemo(() => {
                              if (!session.id) return []
                              return sync.data.message[session.id]?.filter(
                                (m) => m.role === "assistant" && m.parentID == message.id,
                              ) as AssistantMessageType[]
                            })
                            const error = createMemo(() => assistantMessages().find((m) => m?.error)?.error)
                            const [completed, setCompleted] = createSignal(!!message.summary?.body || !!error())
                            const [detailsExpanded, setDetailsExpanded] = createSignal(false)
                            const parts = createMemo(() => sync.data.part[message.id])
                            const hasToolPart = createMemo(() =>
                              assistantMessages()
                                ?.flatMap((m) => sync.data.part[m.id])
                                .some((p) => p?.type === "tool"),
                            )
                            const working = createMemo(() => !message.summary?.body && !error())

                            // allowing time for the animations to finish
                            createEffect(() => {
                              const title = message.summary?.title
                              setTimeout(() => setTitled(!!title), 10_000)
                            })
                            createEffect(() => {
                              const summary = message.summary?.body
                              const complete = !!summary || !!error()
                              setTimeout(() => setCompleted(complete), 1200)
                            })

                            return (
                              <Show when={isActive()}>
                                <div
                                  data-message={message.id}
                                  class="flex flex-col items-start self-stretch gap-8 pb-20"
                                >
                                  {/* Title */}
                                  <div class="flex items-center gap-2 self-stretch sticky top-0 bg-background-stronger z-20 h-8">
                                    <div class="w-full text-14-medium text-text-strong">
                                      <Show
                                        when={titled()}
                                        fallback={
                                          <Typewriter
                                            as="h1"
                                            text={message.summary?.title}
                                            class="overflow-hidden text-ellipsis min-w-0 text-nowrap"
                                          />
                                        }
                                      >
                                        <h1 class="overflow-hidden text-ellipsis min-w-0 text-nowrap">
                                          {message.summary?.title}
                                        </h1>
                                      </Show>
                                    </div>
                                  </div>
                                  <Message message={message} parts={parts()} />
                                  {/* Summary */}
                                  <Show when={completed()}>
                                    <div class="w-full flex flex-col gap-6 items-start self-stretch">
                                      <div class="flex flex-col items-start gap-1 self-stretch">
                                        <h2 class="text-12-medium text-text-weak">
                                          <Switch>
                                            <Match when={message.summary?.diffs?.length}>Summary</Match>
                                            <Match when={true}>Response</Match>
                                          </Switch>
                                        </h2>
                                        <Show when={message.summary?.body}>
                                          {(summary) => (
                                            <Markdown
                                              classList={{
                                                "text-14-regular": !!message.summary?.diffs?.length,
                                                "[&>*]:fade-up-text": !message.summary?.diffs?.length,
                                              }}
                                              text={summary()}
                                            />
                                          )}
                                        </Show>
                                      </div>
                                      <Accordion class="w-full" multiple>
                                        <For each={message.summary?.diffs ?? []}>
                                          {(diff) => (
                                            <Accordion.Item value={diff.file}>
                                              <StickyAccordionHeader class="top-10 data-expanded:before:-top-10">
                                                <Accordion.Trigger>
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
                                                      <DiffChanges changes={diff} />
                                                      <Icon name="chevron-grabber-vertical" size="small" />
                                                    </div>
                                                  </div>
                                                </Accordion.Trigger>
                                              </StickyAccordionHeader>
                                              <Accordion.Content class="max-h-60 overflow-y-auto no-scrollbar">
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
                                  <Show when={error() && !detailsExpanded()}>
                                    <Card variant="error" class="text-text-on-critical-base">
                                      {error()?.data?.message as string}
                                    </Card>
                                  </Show>
                                  {/* Response */}
                                  <div class="w-full">
                                    <Switch>
                                      <Match when={!completed()}>
                                        <MessageProgress assistantMessages={assistantMessages} done={!working()} />
                                      </Match>
                                      <Match when={completed() && hasToolPart()}>
                                        <Collapsible
                                          variant="ghost"
                                          open={detailsExpanded()}
                                          onOpenChange={setDetailsExpanded}
                                        >
                                          <Collapsible.Trigger class="text-text-weak hover:text-text-strong">
                                            <div class="flex items-center gap-1 self-stretch">
                                              <div class="text-12-medium">
                                                <Switch>
                                                  <Match when={detailsExpanded()}>Hide details</Match>
                                                  <Match when={!detailsExpanded()}>Show details</Match>
                                                </Switch>
                                              </div>
                                              <Collapsible.Arrow />
                                            </div>
                                          </Collapsible.Trigger>
                                          <Collapsible.Content>
                                            <div class="w-full flex flex-col items-start self-stretch gap-3">
                                              <For each={assistantMessages()}>
                                                {(assistantMessage) => {
                                                  const parts = createMemo(() => sync.data.part[assistantMessage.id])
                                                  return <Message message={assistantMessage} parts={parts()} />
                                                }}
                                              </For>
                                              <Show when={error()}>
                                                <Card variant="error" class="text-text-on-critical-base">
                                                  {error()?.data?.message as string}
                                                </Card>
                                              </Show>
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
                  </Match>
                  <Match when={true}>
                    <div class="size-full flex flex-col pb-45 justify-end items-start gap-4 flex-[1_0_0] self-stretch">
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
                  </Match>
                </Switch>
                <div class="absolute inset-x-0 px-6 max-w-2xl flex flex-col justify-center items-center z-50 mx-auto bottom-8">
                  <PromptInput
                    ref={(el) => {
                      inputRef = el
                    }}
                  />
                </div>
              </div>
              <Show when={local.layout.review.state() === "pane" && session.diffs().length}>
                <div
                  classList={{
                    "relative grow px-6 py-3 flex-1 min-h-0 border-l border-border-weak-base": true,
                  }}
                >
                  <SessionReview />
                </div>
              </Show>
            </div>
          </Tabs.Content>
          <Show when={local.layout.review.state() === "tab" && session.diffs().length}>
            <Tabs.Content value="review" class="select-text flex flex-col h-full overflow-hidden">
              <div
                classList={{
                  "relative px-6 py-3 flex-1 min-h-0 overflow-hidden": true,
                }}
              >
                <SessionReview split hideExpand class="pb-40" />
              </div>
            </Tabs.Content>
          </Show>
          <For each={session.layout.tabs.opened}>
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
                          file={{ name: f().path, contents: f().content?.content ?? "" }}
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
                <div class="relative px-3 h-10 flex items-center bg-background-base border-x border-border-weak-base border-b border-b-transparent">
                  <Show when={file()}>{(f) => <FileVisual file={f()} />}</Show>
                </div>
              )
            }}
          </Show>
        </DragOverlay>
      </DragDropProvider>
      <Show when={session.layout.tabs.active}>
        <div class="absolute inset-x-0 px-6 max-w-2xl flex flex-col justify-center items-center z-50 mx-auto bottom-6">
          <PromptInput
            ref={(el) => {
              inputRef = el
            }}
          />
        </div>
      </Show>
      <div class="hidden shrink-0 w-56 p-2 h-full overflow-y-auto">
        {/* <FileTree path="" onFileClick={ handleTabClick} /> */}
      </div>
      <div class="hidden shrink-0 w-56 p-2">
        <Show when={local.file.changes().length} fallback={<div class="px-2 text-xs text-text-muted">No changes</div>}>
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
      <Show when={store.fileSelectOpen}>
        <SelectDialog
          defaultOpen
          title="Select file"
          placeholder="Search files"
          emptyMessage="No files found"
          items={local.file.searchFiles}
          key={(x) => x}
          onOpenChange={(open) => setStore("fileSelectOpen", open)}
          onSelect={(x) => (x ? session.layout.openTab("file://" + x) : undefined)}
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
