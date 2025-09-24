import { Button, FileIcon, Icon, IconButton, Logo, Tooltip } from "@/ui"
import { Tabs } from "@/ui/tabs"
import { Select } from "@/components/select"
import FileTree from "@/components/file-tree"
import { For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { SelectDialog } from "@/components/select-dialog"
import { useLocal, useSDK } from "@/context"
import { Code } from "@/components/code"
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  createSortable,
  closestCenter,
  useDragDropContext,
} from "@thisbeyond/solid-dnd"
import type { DragEvent, Transformer } from "@thisbeyond/solid-dnd"
import type { LocalFile } from "@/context/local"
import SessionList from "@/components/session-list"
import SessionTimeline from "@/components/session-timeline"
import { createStore } from "solid-js/store"

export default function Page() {
  const sdk = useSDK()
  const local = useLocal()
  const [store, setStore] = createStore({
    clickTimer: undefined as number | undefined,
    activeItem: undefined as string | undefined,
    prompt: "",
    dragging: undefined as "left" | "right" | undefined,
    modelSelectOpen: false,
  })

  let inputRef: HTMLInputElement | undefined = undefined

  const MOD = typeof navigator === "object" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform) ? "Meta" : "Control"

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown)
  })

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown)
  })

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.getModifierState(MOD) && e.shiftKey && e.key.toLowerCase() === "p") {
      e.preventDefault()
      setStore("modelSelectOpen", true)
      return
    }
    if (e.getModifierState(MOD) && e.key.toLowerCase() === "p") {
      e.preventDefault()
      setStore("modelSelectOpen", true)
      return
    }

    const inputFocused = document.activeElement === inputRef
    if (inputFocused) {
      if (e.key === "Escape") {
        inputRef?.blur()
      }
      return
    }

    if (document.activeElement?.id === "select-filter") {
      return
    }

    if (local.file.active()) {
      if (e.getModifierState(MOD)) {
        if (e.key.toLowerCase() === "a") {
          return
        }
        if (e.key.toLowerCase() === "c") {
          return
        }
      }
    }

    if (e.key.length === 1 && e.key !== "Unidentified") {
      inputRef?.focus()
    }
  }

  const navigateChange = (dir: 1 | -1) => {
    const active = local.file.active()
    if (!active) return
    const current = local.file.changeIndex(active.path)
    const next = current == undefined ? (dir === 1 ? 0 : -1) : current + dir
    local.file.setChangeIndex(active.path, next)
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

  const handleTabChange = (path: string) => {
    local.file.open(path)
  }

  const handleTabClose = (file: LocalFile) => {
    local.file.close(file.path)
  }

  const onDragStart = (event: any) => {
    setStore("activeItem", event.draggable.id as string)
  }

  const onDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (draggable && droppable) {
      const currentFiles = local.file.opened().map((f) => f.path)
      const fromIndex = currentFiles.indexOf(draggable.id.toString())
      const toIndex = currentFiles.indexOf(droppable.id.toString())
      if (fromIndex !== toIndex) {
        local.file.move(draggable.id.toString(), toIndex)
      }
    }
  }

  const onDragEnd = () => {
    setStore("activeItem", undefined)
  }

  const handleLeftDragStart = (e: MouseEvent) => {
    e.preventDefault()
    setStore("dragging", "left")
    const startX = e.clientX
    const startWidth = local.layout.leftWidth()

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startX
      const newWidth = startWidth + deltaX
      local.layout.setLeftWidth(newWidth)
    }

    const handleMouseUp = () => {
      setStore("dragging", undefined)
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
  }

  const handleRightDragStart = (e: MouseEvent) => {
    e.preventDefault()
    setStore("dragging", "right")
    const startX = e.clientX
    const startWidth = local.layout.rightWidth()

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = startX - e.clientX
      const newWidth = startWidth + deltaX
      local.layout.setRightWidth(newWidth)
    }

    const handleMouseUp = () => {
      setStore("dragging", undefined)
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
  }

  const handleSubmit = async (e: SubmitEvent) => {
    e.preventDefault()
    const prompt = store.prompt
    setStore("prompt", "")
    inputRef?.blur()

    const session =
      (local.layout.rightPane() ? local.session.active() : undefined) ??
      (await sdk.session.create().then((x) => x.data!))
    local.session.setActive(session!.id)
    local.layout.openRightPane()

    const response = await sdk.session.prompt({
      path: { id: session!.id },
      body: {
        agent: local.agent.current()!.name,
        model: { modelID: local.model.current()!.id, providerID: local.model.current()!.provider.id },
        parts: [
          {
            type: "text",
            text: prompt,
          },
          ...local.file
            .opened()
            .filter((f) => f.selection || local.file.active()?.path === f.path)
            .flatMap((f) => [
              {
                type: "file" as const,
                mime: "text/plain",
                url: `file://${f.absolute}${f.selection ? `?start=${f.selection.startLine}&end=${f.selection.endLine}` : ""}`,
                filename: f.name,
                source: {
                  type: "file" as const,
                  text: {
                    value: "@" + f.name,
                    start: 0, // f.start,
                    end: 0, // f.end,
                  },
                  path: f.absolute,
                },
              },
            ]),
        ],
      },
    })

    console.log("response", response)
  }

  return (
    <div class="relative">
      <div
        class="fixed top-0 left-0 h-full border-r border-border-subtle/30 flex flex-col overflow-hidden"
        style={`width: ${local.layout.leftWidth()}px`}
      >
        <Tabs class="relative flex flex-col h-full" defaultValue="files">
          <div class="sticky top-0 shrink-0 flex">
            <Tabs.List class="grow w-full after:hidden">
              <Tabs.Trigger value="files" class="flex-1 justify-center text-xs">
                Files
              </Tabs.Trigger>
              <Tabs.Trigger value="changes" class="flex-1 justify-center text-xs">
                Changes
              </Tabs.Trigger>
            </Tabs.List>
          </div>
          <Tabs.Content value="files" class="grow min-h-0 py-2 bg-background">
            <FileTree path="" onFileClick={handleFileClick} />
          </Tabs.Content>
          <Tabs.Content value="changes" class="grow min-h-0 py-2 bg-background">
            <div class="px-2 text-xs text-text-muted">No changes yet</div>
          </Tabs.Content>
        </Tabs>
      </div>
      <div
        class="fixed top-0 h-full w-1.5 bg-transparent cursor-col-resize z-50 group"
        style={`left: ${local.layout.leftWidth()}px`}
        onMouseDown={(e) => handleLeftDragStart(e)}
      >
        <div
          classList={{
            "w-0.5 h-full bg-transparent group-hover:bg-border-active transition-colors": true,
            "bg-border-active!": store.dragging === "left",
          }}
        />
      </div>
      <Show when={local.layout.rightPane()}>
        <div
          class="fixed top-0 right-0 h-full border-l border-border-subtle/30 flex flex-col overflow-hidden"
          style={`width: ${local.layout.rightWidth()}px`}
        >
          <div class="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
            <Show when={local.session.active()} fallback={<SessionList />}>
              {(activeSession) => (
                <div class="relative">
                  <div class="sticky top-0 bg-background z-50 px-2 h-8 border-b border-border-subtle/30">
                    <div class="h-full flex items-center gap-2">
                      <IconButton
                        size="xs"
                        variant="ghost"
                        onClick={() => local.session.clearActive()}
                        class="text-text-muted hover:text-text"
                      >
                        <Icon name="arrow-left" size={14} />
                      </IconButton>
                      <h2 class="text-sm font-medium text-text truncate">
                        {activeSession().title || "Untitled Session"}
                      </h2>
                    </div>
                  </div>
                  <SessionTimeline session={activeSession().id} />
                </div>
              )}
            </Show>
          </div>
        </div>
        <div
          class="fixed top-0 h-full w-1.5 bg-transparent cursor-col-resize z-50 group flex justify-end"
          style={`right: ${local.layout.rightWidth()}px`}
          onMouseDown={(e) => handleRightDragStart(e)}
        >
          <div
            classList={{
              "w-0.5 h-full bg-transparent group-hover:bg-border-active transition-colors": true,
              "bg-border-active!": store.dragging === "right",
            }}
          />
        </div>
      </Show>
      <div
        class="relative"
        style={`margin-left: ${local.layout.leftWidth()}px; margin-right: ${local.layout.rightPane() ? local.layout.rightWidth() : 0}px`}
      >
        <Logo
          size={64}
          variant="ornate"
          class="absolute top-2/5 left-1/2 transform -translate-x-1/2 -translate-y-1/2"
        />
        <DragDropProvider
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragOver={onDragOver}
          collisionDetector={closestCenter}
        >
          <DragDropSensors />
          <ConstrainDragYAxis />
          <Tabs
            class="relative grow w-full flex flex-col h-screen"
            value={local.file.active()?.path}
            onChange={handleTabChange}
          >
            <div class="sticky top-0 shrink-0 flex">
              <Tabs.List class="grow">
                <SortableProvider ids={local.file.opened().map((f) => f.path)}>
                  <For each={local.file.opened()}>
                    {(file) => <SortableTab file={file} onTabClick={handleFileClick} onTabClose={handleTabClose} />}
                  </For>
                </SortableProvider>
              </Tabs.List>
              <div class="shrink-0 h-full flex items-center gap-1 px-2 border-b border-border-subtle/40">
                <Show when={local.file.active() && local.file.active()!.content?.diff}>
                  {(() => {
                    const f = local.file.active()!
                    const view = local.file.view(f.path)
                    return (
                      <div class="flex items-center gap-1">
                        <Show when={view !== "raw"}>
                          <div class="mr-1 flex items-center gap-1">
                            <Tooltip value="Previous change" placement="bottom">
                              <IconButton size="xs" variant="ghost" onClick={() => navigateChange(-1)}>
                                <Icon name="arrow-up" size={14} />
                              </IconButton>
                            </Tooltip>
                            <Tooltip value="Next change" placement="bottom">
                              <IconButton size="xs" variant="ghost" onClick={() => navigateChange(1)}>
                                <Icon name="arrow-down" size={14} />
                              </IconButton>
                            </Tooltip>
                          </div>
                        </Show>
                        <Tooltip value="Raw" placement="bottom">
                          <IconButton
                            size="xs"
                            variant="ghost"
                            classList={{
                              "text-text": view === "raw",
                              "text-text-muted/70": view !== "raw",
                              "bg-background-element": view === "raw",
                            }}
                            onClick={() => local.file.setView(f.path, "raw")}
                          >
                            <Icon name="file-text" size={14} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip value="Unified diff" placement="bottom">
                          <IconButton
                            size="xs"
                            variant="ghost"
                            classList={{
                              "text-text": view === "diff-unified",
                              "text-text-muted/70": view !== "diff-unified",
                              "bg-background-element": view === "diff-unified",
                            }}
                            onClick={() => local.file.setView(f.path, "diff-unified")}
                          >
                            <Icon name="checklist" size={14} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip value="Split diff" placement="bottom">
                          <IconButton
                            size="xs"
                            variant="ghost"
                            classList={{
                              "text-text": view === "diff-split",
                              "text-text-muted/70": view !== "diff-split",
                              "bg-background-element": view === "diff-split",
                            }}
                            onClick={() => local.file.setView(f.path, "diff-split")}
                          >
                            <Icon name="columns" size={14} />
                          </IconButton>
                        </Tooltip>
                      </div>
                    )
                  })()}
                </Show>
                <Tooltip value={local.layout.rightPane() ? "Close pane" : "Open pane"} placement="bottom">
                  <IconButton size="xs" variant="ghost" onClick={() => local.layout.toggleRightPane()}>
                    <Icon name={local.layout.rightPane() ? "close-pane" : "open-pane"} size={14} />
                  </IconButton>
                </Tooltip>
              </div>
            </div>
            <For each={local.file.opened()}>
              {(file) => (
                <Tabs.Content value={file.path} class="grow h-full pt-1 select-text">
                  {(() => {
                    const view = local.file.view(file.path)
                    const showRaw = view === "raw" || !file.content?.diff
                    const code = showRaw ? (file.content?.content ?? "") : (file.content?.diff ?? "")
                    return <Code path={file.path} code={code} />
                  })()}
                </Tabs.Content>
              )}
            </For>
          </Tabs>
          <DragOverlay>
            {store.activeItem &&
              (() => {
                const draggedFile = local.file.node(store.activeItem!)
                return (
                  <div
                    class="relative px-3 h-8 flex items-center 
                           text-sm font-medium text-text whitespace-nowrap
                           shrink-0 bg-background-panel 
                           border-x border-border-subtle/40 border-b border-b-transparent"
                  >
                    <TabVisual file={draggedFile} />
                  </div>
                )
              })()}
          </DragOverlay>
        </DragDropProvider>
        <form
          onSubmit={handleSubmit}
          class="peer/editor absolute inset-x-4 z-50 flex items-center justify-center"
          classList={{
            "bottom-8": !!local.file.active(),
            "bottom-2/5": local.file.active() === undefined,
          }}
        >
          <div
            class="w-full max-w-xl min-w-0 p-2 mx-auto rounded-lg isolate backdrop-blur-xs
                   flex flex-col gap-1
                   bg-gradient-to-b from-background-panel/90 to-background/90
                   ring-1 ring-border-active/50 border border-transparent
                   shadow-[0_0_33px_rgba(0,0,0,0.8)]
                   focus-within:ring-2 focus-within:ring-primary/40 focus-within:border-primary"
          >
            <div class="flex flex-wrap gap-1">
              <Show when={local.file.active()}>
                <FileTag
                  default
                  file={local.file.active()!}
                  onClose={() => local.file.close(local.file.active()?.path ?? "")}
                />
              </Show>
              <For each={local.file.opened().filter((x) => x.selection)}>
                {(file) => <FileTag file={file} onClose={() => local.file.select(file.path, undefined)} />}
              </For>
            </div>
            <input
              ref={(el) => (inputRef = el)}
              type="text"
              value={store.prompt}
              onInput={(e) => setStore("prompt", e.currentTarget.value)}
              placeholder="Placeholder text..."
              class="w-full p-1 pb-4 text-text font-light placeholder-text-muted/70 text-sm focus:outline-none"
            />
            <div class="flex justify-between items-center text-xs text-text-muted">
              <div class="flex gap-2 items-center">
                <Select
                  options={local.agent.list().map((a) => a.name)}
                  current={local.agent.current().name}
                  onSelect={local.agent.set}
                  class="uppercase"
                />
                <Button onClick={() => setStore("modelSelectOpen", true)}>
                  {local.model.current()?.name ?? "Select model"}
                  <Icon name="chevron-down" size={24} class="text-text-muted" />
                </Button>
                <span class="text-text-muted/70 whitespace-nowrap">{local.model.current()?.provider.name}</span>
              </div>
              <div class="flex gap-1 items-center">
                <IconButton class="text-text-muted" size="xs" variant="ghost">
                  <Icon name="photo" size={16} />
                </IconButton>
                <IconButton class="text-background-panel! bg-primary rounded-full!" size="xs" variant="ghost">
                  <Icon name="arrow-up" size={14} />
                </IconButton>
              </div>
            </div>
          </div>
        </form>
      </div>
      <Show when={store.modelSelectOpen}>
        <SelectDialog
          key={(x) => `${x.provider.id}:${x.id}`}
          items={local.model.list()}
          current={local.model.current()}
          render={(i) => (
            <div class="w-full flex items-center justify-between">
              <div class="flex items-center gap-x-2 text-text-muted grow min-w-0">
                <img src={`https://models.dev/logos/${i.provider.id}.svg`} class="size-4 invert opacity-40" />
                <span class="text-xs text-text whitespace-nowrap">{i.name}</span>
                <span class="text-xs text-text-muted/80 whitespace-nowrap overflow-hidden overflow-ellipsis truncate min-w-0">
                  {i.id}
                </span>
              </div>
              <div class="flex items-center gap-x-1 text-text-muted/40 shrink-0">
                <Tooltip forceMount={false} value="Reasoning">
                  <Icon name="brain" size={16} classList={{ "text-accent": i.reasoning }} />
                </Tooltip>
                <Tooltip forceMount={false} value="Tools">
                  <Icon name="hammer" size={16} classList={{ "text-secondary": i.tool_call }} />
                </Tooltip>
                <Tooltip forceMount={false} value="Attachments">
                  <Icon name="photo" size={16} classList={{ "text-success": i.attachment }} />
                </Tooltip>
                <div class="rounded-full bg-text-muted/20 text-text-muted/80 w-9 h-4 flex items-center justify-center text-[10px]">
                  {new Intl.NumberFormat("en-US", {
                    notation: "compact",
                    compactDisplay: "short",
                  }).format(i.limit.context)}
                </div>
                <Tooltip forceMount={false} value={`$${i.cost?.input}/1M input, $${i.cost?.output}/1M output`}>
                  <div class="rounded-full bg-success/20 text-success/80 w-9 h-4 flex items-center justify-center text-[10px]">
                    <Switch fallback="FREE">
                      <Match when={i.cost?.input > 10}>$$$</Match>
                      <Match when={i.cost?.input > 1}>$$</Match>
                      <Match when={i.cost?.input > 0.1}>$</Match>
                    </Switch>
                  </div>
                </Tooltip>
              </div>
            </div>
          )}
          filter={{
            keys: ["provider.name", "name", "id"],
          }}
          groupBy={(x) => x.provider.name}
          onClose={() => setStore("modelSelectOpen", false)}
          onSelect={(x) => local.model.set(x ? { modelID: x.id, providerID: x.provider.id } : undefined)}
        />
      </Show>
    </div>
  )
}

const TabVisual = (props: { file: LocalFile }) => {
  const local = useLocal()
  return (
    <div class="flex items-center gap-x-1.5">
      <FileIcon node={props.file} class="" />
      <span
        classList={{ "text-xs": true, "text-primary": local.file.changed(props.file.path), italic: !props.file.pinned }}
      >
        {props.file.name}
      </span>
      <span class="text-xs opacity-70">
        <Switch>
          <Match when={local.file.status(props.file.path)?.status === "modified"}>
            <span class="text-primary">M</span>
          </Match>
          <Match when={local.file.status(props.file.path)?.status === "added"}>
            <span class="text-success">A</span>
          </Match>
          <Match when={local.file.status(props.file.path)?.status === "deleted"}>
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
}) => {
  const sortable = createSortable(props.file.path)

  return (
    // @ts-ignore
    <div use:sortable classList={{ "opacity-0": sortable.isActiveDraggable }}>
      <Tooltip value={props.file.path} placement="bottom">
        <div class="relative">
          <Tabs.Trigger value={props.file.path} class="peer/tab pr-7" onClick={() => props.onTabClick(props.file)}>
            <TabVisual file={props.file} />
          </Tabs.Trigger>
          <IconButton
            class="absolute right-1 top-1.5 opacity-0 text-text-muted/60
                   peer-data-[selected]/tab:opacity-100 peer-data-[selected]/tab:text-text
                   peer-data-[selected]/tab:hover:bg-border-subtle
                   hover:opacity-100 peer-hover/tab:opacity-100"
            size="xs"
            variant="ghost"
            onClick={() => props.onTabClose(props.file)}
          >
            <Icon name="close" size={16} />
          </IconButton>
        </div>
      </Tooltip>
    </div>
  )
}

const FileTag = (props: { file: LocalFile; default?: boolean; onClose: () => void }) => (
  <div
    class="flex items-center bg-background group/tag
           border border-border-subtle/60 border-dashed
           rounded-md text-xs text-text-muted"
  >
    <IconButton class="text-text-muted" size="xs" variant="ghost" onClick={props.onClose}>
      <Switch fallback={<FileIcon node={props.file} class="group-hover/tag:hidden size-3!" />}>
        <Match when={props.default}>
          <Icon name="file" class="group-hover/tag:hidden" size={12} />
        </Match>
      </Switch>
      <Icon name="close" class="hidden group-hover/tag:block" size={12} />
    </IconButton>
    <div class="pr-1 flex gap-1 items-center">
      <span>{props.file.name}</span>
      <Show when={!props.default && props.file.selection}>
        <span class="">
          ({props.file.selection!.startLine}-{props.file.selection!.endLine})
        </span>
      </Show>
    </div>
  </div>
)

const ConstrainDragYAxis = () => {
  const context = useDragDropContext()
  if (!context) return <></>
  const [, { onDragStart, onDragEnd, addTransformer, removeTransformer }] = context
  const transformer: Transformer = {
    id: "constrain-y-axis",
    order: 100,
    callback: (transform) => ({ ...transform, y: 0 }),
  }
  onDragStart((event: any) => {
    addTransformer("draggables", event.draggable.id, transformer)
  })
  onDragEnd((event: any) => {
    removeTransformer("draggables", event.draggable.id, transformer.id)
  })
  return <></>
}
