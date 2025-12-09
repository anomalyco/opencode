import { createEffect, createMemo, For, Match, ParentProps, Show, Switch, type JSX } from "solid-js"
import { DateTime } from "luxon"
import { A, useNavigate, useParams } from "@solidjs/router"
import { useLayout } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { base64Decode, base64Encode } from "@opencode-ai/util/encode"
import { Mark } from "@opencode-ai/ui/logo"
import { Avatar } from "@opencode-ai/ui/avatar"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { DiffChanges } from "@opencode-ai/ui/diff-changes"
import { getFilename } from "@opencode-ai/util/path"
import { Select } from "@opencode-ai/ui/select"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Session } from "@opencode-ai/sdk/v2/client"
import { usePlatform } from "@/context/platform"
import { createStore } from "solid-js/store"
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

export default function Layout(props: ParentProps) {
  const [store, setStore] = createStore({
    lastSession: {} as { [directory: string]: string },
    activeDraggable: undefined as string | undefined,
  })

  const params = useParams()
  const globalSync = useGlobalSync()
  const layout = useLayout()
  const platform = usePlatform()
  const navigate = useNavigate()
  const currentDirectory = createMemo(() => base64Decode(params.dir ?? ""))
  const sessions = createMemo(() => globalSync.child(currentDirectory())[0].session ?? [])
  const currentSession = createMemo(() => sessions().find((s) => s.id === params.id))

  function navigateToProject(directory: string | undefined) {
    if (!directory) return
    const lastSession = store.lastSession[directory]
    navigate(`/${base64Encode(directory)}${lastSession ? `/session/${lastSession}` : ""}`)
  }

  function navigateToSession(session: Session | undefined) {
    if (!session) return
    navigate(`/${params.dir}/session/${session?.id}`)
  }

  function openProject(directory: string, navigate = true) {
    layout.projects.open(directory)
    if (navigate) navigateToProject(directory)
  }

  function closeProject(directory: string) {
    layout.projects.close(directory)
    // TODO: more intelligent navigation
    navigate("/")
  }

  async function chooseProject() {
    const result = await platform.openDirectoryPickerDialog?.({
      title: "Open project",
      multiple: true,
    })
    if (Array.isArray(result)) {
      for (const directory of result) {
        openProject(directory, false)
      }
      navigateToProject(result[0])
    } else if (result) {
      openProject(result)
    }
  }

  createEffect(() => {
    if (!params.dir || !params.id) return
    const directory = base64Decode(params.dir)
    setStore("lastSession", directory, params.id)
  })

  function getDraggableId(event: unknown): string | undefined {
    if (typeof event !== "object" || event === null) return undefined
    if (!("draggable" in event)) return undefined
    const draggable = (event as { draggable?: { id?: unknown } }).draggable
    if (!draggable) return undefined
    return typeof draggable.id === "string" ? draggable.id : undefined
  }

  function handleDragStart(event: unknown) {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeDraggable", id)
  }

  function handleDragOver(event: DragEvent) {
    const { draggable, droppable } = event
    if (draggable && droppable) {
      const projects = layout.projects.list()
      const fromIndex = projects.findIndex((p) => p.directory === draggable.id.toString())
      const toIndex = projects.findIndex((p) => p.directory === droppable.id.toString())
      if (fromIndex !== toIndex && toIndex !== -1) {
        layout.projects.move(draggable.id.toString(), toIndex)
      }
    }
  }

  function handleDragEnd() {
    setStore("activeDraggable", undefined)
  }

  const ConstrainDragXAxis = (): JSX.Element => {
    const context = useDragDropContext()
    if (!context) return <></>
    const [, { onDragStart, onDragEnd, addTransformer, removeTransformer }] = context
    const transformer: Transformer = {
      id: "constrain-x-axis",
      order: 100,
      callback: (transform) => ({ ...transform, x: 0 }),
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

  const SortableProject = (props: { project: { directory: string; expanded: boolean } }): JSX.Element => {
    const sortable = createSortable(props.project.directory)
    const [projectStore] = globalSync.child(props.project.directory)
    const slug = createMemo(() => base64Encode(props.project.directory))
    const name = createMemo(() => getFilename(props.project.directory))
    return (
      // @ts-ignore
      <div use:sortable classList={{ "opacity-0": sortable.isActiveDraggable }}>
        <Switch>
          <Match when={layout.sidebar.opened()}>
            <Collapsible variant="ghost" defaultOpen class="gap-2 shrink-0">
              <Button
                as={"div"}
                variant="ghost"
                class="group/session flex items-center justify-between gap-3 w-full px-1 self-stretch h-auto border-none"
              >
                <Collapsible.Trigger class="group/trigger flex items-center gap-3 p-0 text-left min-w-0 grow border-none">
                  <div class="size-6 shrink-0">
                    <Avatar
                      fallback={name()}
                      background="var(--surface-info-base)"
                      class="size-full group-hover/session:hidden"
                    />
                    <Icon
                      name="chevron-right"
                      size="large"
                      class="hidden size-full items-center justify-center text-text-subtle group-hover/session:flex group-data-[expanded]/trigger:rotate-90 transition-transform duration-50"
                    />
                  </div>
                  <span class="truncate text-14-medium text-text-strong">{name()}</span>
                </Collapsible.Trigger>
                <div class="flex invisible gap-1 items-center group-hover/session:visible has-[[data-expanded]]:visible">
                  <DropdownMenu>
                    <DropdownMenu.Trigger as={IconButton} icon="dot-grid" variant="ghost" />
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content>
                        <DropdownMenu.Item onSelect={() => closeProject(props.project.directory)}>
                          <DropdownMenu.ItemLabel>Close Project</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu>
                  <Tooltip placement="top" value="New session">
                    <IconButton as={A} href={`${slug()}/session`} icon="plus-small" variant="ghost" />
                  </Tooltip>
                </div>
              </Button>
              <Collapsible.Content>
                <nav class="hidden @[4rem]:flex w-full flex-col gap-1.5">
                  <For each={projectStore.session}>
                    {(session) => {
                      const updated = createMemo(() => DateTime.fromMillis(session.time.updated))
                      return (
                        <A
                          data-active={session.id === params.id}
                          href={`${slug()}/session/${session.id}`}
                          class="group/session focus:outline-none cursor-default"
                        >
                          <Tooltip placement="right" value={session.title}>
                            <div
                              class="w-full pl-4 pr-2 py-1 rounded-md
                                   group-data-[active=true]/session:bg-surface-raised-base-hover
                                   group-hover/session:bg-surface-raised-base-hover
                                   group-focus/session:bg-surface-raised-base-hover"
                            >
                              <div class="flex items-center self-stretch gap-6 justify-between">
                                <span class="text-14-regular text-text-strong overflow-hidden text-ellipsis truncate">
                                  {session.title}
                                </span>
                                <span class="text-12-regular text-text-weak text-right whitespace-nowrap">
                                  {Math.abs(updated().diffNow().as("seconds")) < 60
                                    ? "Now"
                                    : updated()
                                        .toRelative({
                                          style: "short",
                                          unit: ["days", "hours", "minutes"],
                                        })
                                        ?.replace(" ago", "")
                                        ?.replace(/ days?/, "d")
                                        ?.replace(" min.", "m")
                                        ?.replace(" hr.", "h")}
                                </span>
                              </div>
                              <div class="hidden _flex justify-between items-center self-stretch">
                                <span class="text-12-regular text-text-weak">{`${session.summary?.files || "No"} file${session.summary?.files !== 1 ? "s" : ""} changed`}</span>
                                <Show when={session.summary}>{(summary) => <DiffChanges changes={summary()} />}</Show>
                              </div>
                            </div>
                          </Tooltip>
                        </A>
                      )
                    }}
                  </For>
                </nav>
              </Collapsible.Content>
            </Collapsible>
          </Match>
          <Match when={true}>
            <Tooltip placement="right" value={props.project.directory}>
              <Button
                variant="ghost"
                size="large"
                class="flex items-center justify-center p-0 aspect-square border-none"
                data-selected={props.project.directory === currentDirectory()}
                onClick={() => navigateToProject(props.project.directory)}
              >
                <div class="size-6 shrink-0 inset-0">
                  <Avatar fallback={name()} background="var(--surface-info-base)" class="size-full" />
                </div>
              </Button>
            </Tooltip>
          </Match>
        </Switch>
      </div>
    )
  }

  const ProjectDragOverlay = (): JSX.Element => {
    const activeName = createMemo(() => {
      if (!store.activeDraggable) return undefined
      return getFilename(store.activeDraggable)
    })
    return (
      <Show when={activeName()}>
        {(name) => (
          <div class="flex items-center gap-3 px-2 py-1 bg-background-stronger rounded-md border border-border-weak-base">
            <Avatar fallback={name()} background="var(--surface-info-base)" class="size-6" />
            <span class="text-14-medium text-text-strong">{name()}</span>
          </div>
        )}
      </Show>
    )
  }

  return (
    <div class="relative h-screen flex flex-col">
      <header class="h-12 shrink-0 bg-background-base border-b border-border-weak-base flex" data-tauri-drag-region>
        <A
          href="/"
          classList={{
            "w-12 shrink-0 px-4 py-3.5": true,
            "flex items-center justify-start self-stretch": true,
            "border-r border-border-weak-base": true,
          }}
          style={{ width: layout.sidebar.opened() ? `${layout.sidebar.width()}px` : undefined }}
          data-tauri-drag-region
        >
          <Mark class="shrink-0" />
        </A>
        <div class="pl-4 px-6 flex items-center justify-between gap-4 w-full">
          <Show when={params.dir && layout.projects.list().length > 0}>
            <div class="flex items-center gap-3">
              <div class="flex items-center gap-2">
                <Select
                  options={layout.projects.list().map((project) => project.directory)}
                  current={currentDirectory()}
                  label={(x) => getFilename(x)}
                  onSelect={(x) => (x ? navigateToProject(x) : undefined)}
                  class="text-14-regular text-text-base"
                  variant="ghost"
                >
                  {/* @ts-ignore */}
                  {(i) => (
                    <div class="flex items-center gap-2">
                      <Icon name="folder" size="small" />
                      <div class="text-text-strong">{getFilename(i)}</div>
                    </div>
                  )}
                </Select>
                <div class="text-text-weaker">/</div>
                <Select
                  options={sessions()}
                  current={currentSession()}
                  placeholder="New session"
                  label={(x) => x.title}
                  value={(x) => x.id}
                  onSelect={navigateToSession}
                  class="text-14-regular text-text-base max-w-md"
                  variant="ghost"
                />
              </div>
              <Show when={currentSession()}>
                <Button as={A} href={`/${params.dir}/session`} icon="plus-small">
                  New session
                </Button>
              </Show>
            </div>
            <div class="flex items-center gap-4">
              <Tooltip
                class="shrink-0"
                value={
                  <div class="flex items-center gap-2">
                    <span>Toggle terminal</span>
                    <span class="text-icon-base text-12-medium">Ctrl `</span>
                  </div>
                }
              >
                <Button variant="ghost" class="group/terminal-toggle size-6 p-0" onClick={layout.terminal.toggle}>
                  <div class="relative flex items-center justify-center size-4 [&>*]:absolute [&>*]:inset-0">
                    <Icon
                      size="small"
                      name={layout.terminal.opened() ? "layout-bottom-full" : "layout-bottom"}
                      class="group-hover/terminal-toggle:hidden"
                    />
                    <Icon
                      size="small"
                      name="layout-bottom-partial"
                      class="hidden group-hover/terminal-toggle:inline-block"
                    />
                    <Icon
                      size="small"
                      name={layout.terminal.opened() ? "layout-bottom" : "layout-bottom-full"}
                      class="hidden group-active/terminal-toggle:inline-block"
                    />
                  </div>
                </Button>
              </Tooltip>
            </div>
          </Show>
        </div>
      </header>
      <div class="h-[calc(100vh-3rem)] flex">
        <div
          classList={{
            "relative @container w-12 pb-5 shrink-0 bg-background-base": true,
            "flex flex-col gap-5.5 items-start self-stretch justify-between": true,
            "border-r border-border-weak-base": true,
          }}
          style={{ width: layout.sidebar.opened() ? `${layout.sidebar.width()}px` : undefined }}
        >
          <Show when={layout.sidebar.opened()}>
            <ResizeHandle
              direction="horizontal"
              size={layout.sidebar.width()}
              min={150}
              max={window.innerWidth * 0.3}
              collapseThreshold={80}
              onResize={layout.sidebar.resize}
              onCollapse={layout.sidebar.close}
            />
          </Show>
          <div class="flex flex-col items-start self-stretch gap-4 p-2 min-h-0 overflow-hidden">
            <Tooltip class="shrink-0" placement="right" value="Toggle sidebar" inactive={layout.sidebar.opened()}>
              <Button
                variant="ghost"
                size="large"
                class="group/sidebar-toggle shrink-0 w-full text-left justify-start"
                onClick={layout.sidebar.toggle}
              >
                <div class="relative -ml-px flex items-center justify-center size-4 [&>*]:absolute [&>*]:inset-0">
                  <Icon
                    name={layout.sidebar.opened() ? "layout-left" : "layout-right"}
                    size="small"
                    class="group-hover/sidebar-toggle:hidden"
                  />
                  <Icon
                    name={layout.sidebar.opened() ? "layout-left-partial" : "layout-right-partial"}
                    size="small"
                    class="hidden group-hover/sidebar-toggle:inline-block"
                  />
                  <Icon
                    name={layout.sidebar.opened() ? "layout-left-full" : "layout-right-full"}
                    size="small"
                    class="hidden group-active/sidebar-toggle:inline-block"
                  />
                </div>
                <Show when={layout.sidebar.opened()}>
                  <div class="hidden group-hover/sidebar-toggle:block group-active/sidebar-toggle:block text-text-base">
                    Toggle sidebar
                  </div>
                </Show>
              </Button>
            </Tooltip>
            <DragDropProvider
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
              collisionDetector={closestCenter}
            >
              <DragDropSensors />
              <ConstrainDragXAxis />
              <div class="w-full min-w-8 flex flex-col gap-2 min-h-0 overflow-y-auto no-scrollbar">
                <SortableProvider ids={layout.projects.list().map((p) => p.directory)}>
                  <For each={layout.projects.list()}>{(project) => <SortableProject project={project} />}</For>
                </SortableProvider>
              </div>
              <DragOverlay>
                <ProjectDragOverlay />
              </DragOverlay>
            </DragDropProvider>
          </div>
          <div class="flex flex-col gap-1.5 self-stretch items-start shrink-0 px-2 py-3">
            <Show when={platform.openDirectoryPickerDialog}>
              <Tooltip placement="right" value="Open project" inactive={layout.sidebar.opened()}>
                <Button
                  class="flex w-full text-left justify-start text-12-medium text-text-base stroke-[1.5px]"
                  variant="ghost"
                  size="large"
                  icon="folder-add-left"
                  onClick={chooseProject}
                >
                  <Show when={layout.sidebar.opened()}>Open project</Show>
                </Button>
              </Tooltip>
            </Show>
            <Tooltip placement="right" value="Settings" inactive={layout.sidebar.opened()}>
              <Button
                disabled
                class="flex w-full text-left justify-start text-12-medium text-text-base stroke-[1.5px]"
                variant="ghost"
                size="large"
                icon="settings-gear"
              >
                <Show when={layout.sidebar.opened()}>Settings</Show>
              </Button>
            </Tooltip>
            <Tooltip placement="right" value="Share feedback" inactive={layout.sidebar.opened()}>
              <Button
                as={"a"}
                href="https://opencode.ai/desktop-feedback"
                target="_blank"
                class="flex w-full text-left justify-start text-12-medium text-text-base stroke-[1.5px]"
                variant="ghost"
                size="large"
                icon="bubble-5"
              >
                <Show when={layout.sidebar.opened()}>Share feedback</Show>
              </Button>
            </Tooltip>
          </div>
        </div>
        <main class="size-full overflow-x-hidden flex flex-col items-start">{props.children}</main>
      </div>
    </div>
  )
}
