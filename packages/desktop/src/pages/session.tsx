import { For, onCleanup, onMount, Show, Match, Switch, createResource, createMemo } from "solid-js"
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
import { Tabs } from "@opencode-ai/ui/tabs"
import { Code } from "@opencode-ai/ui/code"
import { SessionTurn } from "@opencode-ai/ui/session-turn"
import { MessageNav } from "@opencode-ai/ui/message-nav"
import { SessionReview } from "@opencode-ai/ui/session-review"
import { SelectDialog } from "@opencode-ai/ui/select-dialog"
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
import { useSession } from "@/context/session"
import { useLayout } from "@/context/layout"
import { getDirectory, getFilename } from "@opencode-ai/util/path"

export default function Page() {
  const layout = useLayout()
  const local = useLocal()
  const sync = useSync()
  const session = useSession()
  const [store, setStore] = createStore({
    clickTimer: undefined as number | undefined,
    fileSelectOpen: false,
    activeDraggable: undefined as string | undefined,
  })
  let inputRef!: HTMLDivElement

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

  const wide = createMemo(() => layout.review.state() === "tab" || !session.diffs().length)

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
                  <div>Session</div>
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
              <Show when={layout.review.state() === "tab" && session.diffs().length}>
                <Tabs.Trigger
                  value="review"
                  closeButton={
                    <IconButton icon="collapse" size="normal" variant="ghost" onClick={layout.review.pane} />
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
                  <Match when={session.id}>
                    <div class="flex items-start justify-start h-full min-h-0">
                      <Show when={session.messages.user().length > 1}>
                        <>
                          <MessageNav
                            class="@6xl:hidden mt-2.5 absolute left-6"
                            messages={session.messages.user()}
                            current={session.messages.active()}
                            onMessageSelect={session.messages.setActive}
                            size="compact"
                            working={session.working()}
                          />
                          <MessageNav
                            classList={{
                              "hidden @6xl:flex absolute": true,
                              "mt-0.5 left-[calc(((100%_-_min(100%,_36.5rem))_/_2)-1.5rem)] -translate-x-full": wide(),
                              "mt-2.5 left-6": !wide(),
                            }}
                            messages={session.messages.user()}
                            current={session.messages.active()}
                            onMessageSelect={session.messages.setActive}
                            size={wide() ? "normal" : "compact"}
                            working={session.working()}
                          />
                        </>
                      </Show>
                      <SessionTurn
                        sessionID={session.id!}
                        messageID={session.messages.active()?.id!}
                        classes={{
                          root: "pb-20 flex-1 min-w-0",
                          content: "pb-20",
                          container: "w-full " + (wide() ? "max-w-146 mx-auto px-6" : "pr-6 pl-18"),
                        }}
                      />
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
              <Show when={layout.review.state() === "pane" && session.diffs().length}>
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
                    diffs={session.diffs()}
                    actions={
                      <Tooltip value="Open in tab">
                        <IconButton
                          icon="expand"
                          variant="ghost"
                          onClick={() => {
                            layout.review.tab()
                            session.layout.setActiveTab("review")
                          }}
                        />
                      </Tooltip>
                    }
                  />
                </div>
              </Show>
            </div>
          </Tabs.Content>
          <Show when={layout.review.state() === "tab" && session.diffs().length}>
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
                  diffs={session.diffs()}
                  split
                />
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
                <div class="relative px-6 h-12 flex items-center bg-background-stronger border-x border-border-weak-base border-b border-b-transparent">
                  <Show when={file()}>{(f) => <FileVisual active file={f()} />}</Show>
                </div>
              )
            }}
          </Show>
        </DragOverlay>
      </DragDropProvider>
      <Show when={session.layout.tabs.active}>
        <div class="absolute inset-x-0 px-6 max-w-146 flex flex-col justify-center items-center z-50 mx-auto bottom-8">
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
          onSelect={(x) => {
            if (x) {
              local.file.open(x)
              return session.layout.openTab("file://" + x)
            }
            return undefined
          }}
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
