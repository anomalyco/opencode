import { For, Match, Show, Switch, createSignal, splitProps } from "solid-js"
import { Tabs } from "@/ui/tabs"
import { FileIcon, Icon, IconButton, Logo, Tooltip } from "@/ui"
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
import type { LocalFile } from "@/context/local"
import { Code } from "@/components/code"
import PromptForm from "@/components/prompt-form"
import { useLocal, useSDK, useSync } from "@/context"
import { getFilename } from "@/utils"
import type { JSX } from "solid-js"

interface EditorPaneProps {
  layoutKey: string
  timelinePane: string
  onFileClick: (file: LocalFile) => void
  onOpenModelSelect: () => void
  onInputRefChange: (element: HTMLTextAreaElement | null) => void
}

export default function EditorPane(props: EditorPaneProps): JSX.Element {
  const [localProps] = splitProps(props, [
    "layoutKey",
    "timelinePane",
    "onFileClick",
    "onOpenModelSelect",
    "onInputRefChange",
  ])
  const local = useLocal()
  const sdk = useSDK()
  const sync = useSync()
  const [activeItem, setActiveItem] = createSignal<string | undefined>(undefined)

  const navigateChange = (dir: 1 | -1) => {
    const active = local.file.active()
    if (!active) return
    const current = local.file.changeIndex(active.path)
    const next = current === undefined ? (dir === 1 ? 0 : -1) : current + dir
    local.file.setChangeIndex(active.path, next)
  }

  const handleTabChange = (path: string) => {
    local.file.open(path)
  }

  const handleTabClose = (file: LocalFile) => {
    local.file.close(file.path)
  }

  const handlePromptSubmit = async (prompt: string) => {
    const existingSession = local.layout.visible(localProps.layoutKey, localProps.timelinePane)
      ? local.session.active()
      : undefined
    let session = existingSession
    if (!session) {
      const created = await sdk.session.create()
      session = created.data ?? undefined
    }
    if (!session) return
    local.session.setActive(session.id)
    local.layout.show(localProps.layoutKey, localProps.timelinePane)

    await sdk.session.prompt({
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
            text: prompt,
          },
          ...(local.context.active()
            ? [
                {
                  type: "file" as const,
                  mime: "text/plain",
                  url: `file://${local.context.active()!.absolute}`,
                  filename: local.context.active()!.name,
                  source: {
                    type: "file" as const,
                    text: {
                      value: "@" + local.context.active()!.name,
                      start: 0,
                      end: 0,
                    },
                    path: local.context.active()!.absolute,
                  },
                },
              ]
            : []),
          ...local.context.all().flatMap((file) => [
            {
              type: "file" as const,
              mime: "text/plain",
              url: `file://${sync.absolute(file.path)}${file.selection ? `?start=${file.selection.startLine}&end=${file.selection.endLine}` : ""}`,
              filename: getFilename(file.path),
              source: {
                type: "file" as const,
                text: {
                  value: "@" + getFilename(file.path),
                  start: 0,
                  end: 0,
                },
                path: sync.absolute(file.path),
              },
            },
          ]),
        ],
      },
    })
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

  return (
    <div class="relative flex h-full flex-col">
      <Logo size={64} variant="ornate" class="absolute top-2/5 left-1/2 transform -translate-x-1/2 -translate-y-1/2" />
      <DragDropProvider
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        collisionDetector={closestCenter}
      >
        <DragDropSensors />
        <ConstrainDragYAxis />
        <Tabs
          class="relative grow w-full flex flex-col h-full"
          value={local.file.active()?.path}
          onChange={handleTabChange}
        >
          <div class="sticky top-0 shrink-0 flex">
            <Tabs.List class="grow">
              <SortableProvider ids={local.file.opened().map((file) => file.path)}>
                <For each={local.file.opened()}>
                  {(file) => (
                    <SortableTab file={file} onTabClick={localProps.onFileClick} onTabClose={handleTabClose} />
                  )}
                </For>
              </SortableProvider>
            </Tabs.List>
            <div class="shrink-0 h-full flex items-center gap-1 px-2 border-b border-border-subtle/40">
              <Show when={local.file.active() && local.file.active()!.content?.diff}>
                {(() => {
                  const activeFile = local.file.active()!
                  const view = local.file.view(activeFile.path)
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
                          onClick={() => local.file.setView(activeFile.path, "raw")}
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
                          onClick={() => local.file.setView(activeFile.path, "diff-unified")}
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
                          onClick={() => local.file.setView(activeFile.path, "diff-split")}
                        >
                          <Icon name="columns" size={14} />
                        </IconButton>
                      </Tooltip>
                    </div>
                  )
                })()}
              </Show>
              <Tooltip
                value={local.layout.visible(localProps.layoutKey, localProps.timelinePane) ? "Close pane" : "Open pane"}
                placement="bottom"
              >
                <IconButton
                  size="xs"
                  variant="ghost"
                  onClick={() => local.layout.toggle(localProps.layoutKey, localProps.timelinePane)}
                >
                  <Icon
                    name={
                      local.layout.visible(localProps.layoutKey, localProps.timelinePane) ? "close-pane" : "open-pane"
                    }
                    size={14}
                  />
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
      <PromptForm
        class="peer/editor absolute inset-x-4 z-50 flex items-center justify-center"
        classList={{
          "bottom-8": !!local.file.active(),
          "bottom-3/8": local.file.active() === undefined,
        }}
        onSubmit={handlePromptSubmit}
        onOpenModelSelect={localProps.onOpenModelSelect}
        onInputRefChange={(element) => localProps.onInputRefChange(element ?? null)}
      />
    </div>
  )
}

function TabVisual(props: { file: LocalFile }): JSX.Element {
  return (
    <div class="flex items-center gap-x-1.5">
      <FileIcon node={props.file} class="" />
      <span classList={{ "text-xs": true, "text-primary": !!props.file.status?.status, italic: !props.file.pinned }}>
        {props.file.name}
      </span>
      <span class="text-xs opacity-70">
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

function SortableTab(props: {
  file: LocalFile
  onTabClick: (file: LocalFile) => void
  onTabClose: (file: LocalFile) => void
}): JSX.Element {
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
            class="absolute right-1 top-1.5 opacity-0 text-text-muted/60 peer-data-[selected]/tab:opacity-100 peer-data-[selected]/tab:text-text peer-data-[selected]/tab:hover:bg-border-subtle hover:opacity-100 peer-hover/tab:opacity-100"
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

function ConstrainDragYAxis(): JSX.Element {
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
