import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  ParentProps,
  Show,
  Switch,
  type JSX,
} from "solid-js"
import { DateTime } from "luxon"
import { A, useNavigate, useParams } from "@solidjs/router"
import { useLayout, getAvatarColors } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { base64Decode, base64Encode } from "@opencode-ai/util/encode"
import { Avatar } from "@opencode-ai/ui/avatar"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { DiffChanges } from "@opencode-ai/ui/diff-changes"
import { getFilename } from "@opencode-ai/util/path"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Session, Project, ProviderAuthMethod, ProviderAuthAuthorization } from "@opencode-ai/sdk/v2/client"
import { usePlatform } from "@/context/platform"
import { createStore, produce } from "solid-js/store"
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
import { SelectDialog } from "@opencode-ai/ui/select-dialog"
import { Tag } from "@opencode-ai/ui/tag"
import { IconName } from "@opencode-ai/ui/icons/provider"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { Dialog } from "@opencode-ai/ui/dialog"
import { iife } from "@opencode-ai/util/iife"
import { Link } from "@/components/link"
import { List, ListRef } from "@opencode-ai/ui/list"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast, Toast } from "@opencode-ai/ui/toast"
import { useGlobalSDK } from "@/context/global-sdk"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useNotification } from "@/context/notification"
import { Binary } from "@opencode-ai/util/binary"
import { Header } from "@/components/header"

export default function Layout(props: ParentProps) {
  const [store, setStore] = createStore({
    lastSession: {} as { [directory: string]: string },
    activeDraggable: undefined as string | undefined,
  })

  const params = useParams()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const layout = useLayout()
  const platform = usePlatform()
  const notification = useNotification()
  const navigate = useNavigate()
  const providers = useProviders()

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
    const index = layout.projects.list().findIndex((x) => x.worktree === directory)
    const next = layout.projects.list()[index + 1]
    layout.projects.close(directory)
    if (next) navigateToProject(next.worktree)
    else navigate("/")
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

  async function connectProvider() {
    layout.dialog.open("provider")
  }

  createEffect(() => {
    if (!params.dir || !params.id) return
    const directory = base64Decode(params.dir)
    setStore("lastSession", directory, params.id)
    notification.session.markViewed(params.id)
  })

  createEffect(() => {
    const sidebarWidth = layout.sidebar.opened() ? layout.sidebar.width() : 48
    document.documentElement.style.setProperty("--dialog-left-margin", `${sidebarWidth}px`)
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
      const fromIndex = projects.findIndex((p) => p.worktree === draggable.id.toString())
      const toIndex = projects.findIndex((p) => p.worktree === droppable.id.toString())
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

  const ProjectAvatar = (props: {
    project: Project
    class?: string
    expandable?: boolean
    notify?: boolean
  }): JSX.Element => {
    const notification = useNotification()
    const notifications = createMemo(() => notification.project.unseen(props.project.worktree))
    const hasError = createMemo(() => notifications().some((n) => n.type === "error"))
    const name = createMemo(() => getFilename(props.project.worktree))
    const mask = "radial-gradient(circle 5px at calc(100% - 2px) 2px, transparent 5px, black 5.5px)"
    return (
      <div class="relative size-6 shrink-0">
        <Avatar
          fallback={name()}
          src={props.project.icon?.url}
          {...getAvatarColors(props.project.icon?.color)}
          class={`size-full ${props.class ?? ""}`}
          style={
            notifications().length > 0 && props.notify ? { "-webkit-mask-image": mask, "mask-image": mask } : undefined
          }
        />
        <Show when={props.expandable}>
          <Icon
            name="chevron-right"
            size="large"
            class="hidden size-full items-center justify-center text-text-subtle group-hover/session:flex group-data-[expanded]/trigger:rotate-90 transition-transform duration-50"
          />
        </Show>
        <Show when={notifications().length > 0 && props.notify}>
          <div
            classList={{
              "absolute -top-0.5 -right-0.5 size-1.5 rounded-full": true,
              "bg-icon-critical-base": hasError(),
              "bg-text-interactive-base": !hasError(),
            }}
          />
        </Show>
      </div>
    )
  }

  const ProjectVisual = (props: { project: Project & { expanded: boolean }; class?: string }): JSX.Element => {
    const name = createMemo(() => getFilename(props.project.worktree))
    const current = createMemo(() => base64Decode(params.dir ?? ""))
    return (
      <Switch>
        <Match when={layout.sidebar.opened()}>
          <Button
            as={"div"}
            variant="ghost"
            data-active
            class="flex items-center justify-between gap-3 w-full px-1 self-stretch h-8 border-none rounded-lg"
          >
            <div class="flex items-center gap-3 p-0 text-left min-w-0 grow">
              <ProjectAvatar project={props.project} />
              <span class="truncate text-14-medium text-text-strong">{name()}</span>
            </div>
          </Button>
        </Match>
        <Match when={true}>
          <Button
            variant="ghost"
            size="large"
            class="flex items-center justify-center p-0 aspect-square border-none rounded-lg"
            data-selected={props.project.worktree === current()}
            onClick={() => navigateToProject(props.project.worktree)}
          >
            <ProjectAvatar project={props.project} notify />
          </Button>
        </Match>
      </Switch>
    )
  }

  const SortableProject = (props: { project: Project & { expanded: boolean } }): JSX.Element => {
    const notification = useNotification()
    const sortable = createSortable(props.project.worktree)
    const slug = createMemo(() => base64Encode(props.project.worktree))
    const name = createMemo(() => getFilename(props.project.worktree))
    const [store, setStore] = globalSync.child(props.project.worktree)
    const sessions = createMemo(() => store.session ?? [])
    const [expanded, setExpanded] = createSignal(true)
    return (
      // @ts-ignore
      <div use:sortable classList={{ "opacity-30": sortable.isActiveDraggable }}>
        <Switch>
          <Match when={layout.sidebar.opened()}>
            <Collapsible variant="ghost" defaultOpen class="gap-2 shrink-0" onOpenChange={setExpanded}>
              <Button
                as={"div"}
                variant="ghost"
                class="group/session flex items-center justify-between gap-3 w-full px-1 self-stretch h-auto border-none rounded-lg"
              >
                <Collapsible.Trigger class="group/trigger flex items-center gap-3 p-0 text-left min-w-0 grow border-none">
                  <ProjectAvatar
                    project={props.project}
                    class="group-hover/session:hidden"
                    expandable
                    notify={!expanded()}
                  />
                  <span class="truncate text-14-medium text-text-strong">{name()}</span>
                </Collapsible.Trigger>
                <div class="flex invisible gap-1 items-center group-hover/session:visible has-[[data-expanded]]:visible">
                  <DropdownMenu>
                    <DropdownMenu.Trigger as={IconButton} icon="dot-grid" variant="ghost" />
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content>
                        <DropdownMenu.Item onSelect={() => closeProject(props.project.worktree)}>
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
                  <For each={sessions()}>
                    {(session) => {
                      const updated = createMemo(() => DateTime.fromMillis(session.time.updated))
                      const notifications = createMemo(() => notification.session.unseen(session.id))
                      const hasError = createMemo(() => notifications().some((n) => n.type === "error"))
                      async function archive(session: Session) {
                        await globalSDK.client.session.update({
                          directory: session.directory,
                          sessionID: session.id,
                          time: { archived: Date.now() },
                        })
                        setStore(
                          produce((draft) => {
                            const match = Binary.search(draft.session, session.id, (s) => s.id)
                            if (match.found) draft.session.splice(match.index, 1)
                          }),
                        )
                      }
                      return (
                        <div class="group/session">
                          <Tooltip placement="right" value={session.title}>
                            <div
                              class="relative w-full pl-4 pr-1 py-1 rounded-md
                                     group-[.active]/session:bg-surface-raised-base-hover
                                     group-hover/session:bg-surface-raised-base-hover
                                     group-focus/session:bg-surface-raised-base-hover"
                            >
                              <div class="flex items-center self-stretch gap-6 justify-between">
                                <A
                                  href={`${slug()}/session/${session.id}`}
                                  class="text-14-regular text-text-strong overflow-hidden text-ellipsis truncate focus:outline-none cursor-default grow"
                                >
                                  {session.title}
                                </A>
                                <div class="shrink-0 group-hover/session:hidden mr-1">
                                  <Switch>
                                    <Match when={hasError()}>
                                      <div class="size-1.5 mr-1.5 rounded-full bg-text-diff-delete-base" />
                                    </Match>
                                    <Match when={notifications().length > 0}>
                                      <div class="size-1.5 mr-1.5 rounded-full bg-text-interactive-base" />
                                    </Match>
                                    <Match when={true}>
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
                                    </Match>
                                  </Switch>
                                </div>
                                <div class="hidden group-hover/session:flex group-active/session:flex text-text-base gap-1">
                                  {/* <IconButton icon="dot-grid" variant="ghost" /> */}
                                  <Tooltip placement="right" value="Archive session">
                                    <IconButton icon="archive" variant="ghost" onClick={() => archive(session)} />
                                  </Tooltip>
                                </div>
                              </div>
                              <Show when={session.summary?.files}>
                                <div class="flex justify-between items-center self-stretch">
                                  <span class="text-12-regular text-text-weak">{`${session.summary?.files || "No"} file${session.summary?.files !== 1 ? "s" : ""} changed`}</span>
                                  <Show when={session.summary}>{(summary) => <DiffChanges changes={summary()} />}</Show>
                                </div>
                              </Show>
                            </div>
                          </Tooltip>
                        </div>
                      )
                    }}
                  </For>
                  <Show when={sessions().length === 0}>
                    <A href={`${slug()}/session`} class="group/session focus:outline-none cursor-default">
                      <Tooltip placement="right" value="New session">
                        <div
                          class="relative w-full pl-4 pr-1 py-1 rounded-md
                                 group-[.active]/session:bg-surface-raised-base-hover
                                 group-hover/session:bg-surface-raised-base-hover
                                 group-focus/session:bg-surface-raised-base-hover"
                        >
                          <div class="flex items-center self-stretch gap-6 justify-between">
                            <span class="text-14-regular text-text-strong overflow-hidden text-ellipsis truncate">
                              New session
                            </span>
                          </div>
                        </div>
                      </Tooltip>
                    </A>
                  </Show>
                </nav>
              </Collapsible.Content>
            </Collapsible>
          </Match>
          <Match when={true}>
            <Tooltip placement="right" value={props.project.worktree}>
              <ProjectVisual project={props.project} />
            </Tooltip>
          </Match>
        </Switch>
      </div>
    )
  }

  const ProjectDragOverlay = (): JSX.Element => {
    const project = createMemo(() => layout.projects.list().find((p) => p.worktree === store.activeDraggable))
    return (
      <Show when={project()}>
        {(p) => (
          <div class="bg-background-base rounded-md">
            <ProjectVisual project={p()} />
          </div>
        )}
      </Show>
    )
  }

  return (
    <div class="relative flex-1 min-h-0 flex flex-col">
      <Header navigateToProject={navigateToProject} navigateToSession={navigateToSession} />
      <div class="flex-1 min-h-0 flex">
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
                class="group/sidebar-toggle shrink-0 w-full text-left justify-start rounded-lg px-2"
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
                <SortableProvider ids={layout.projects.list().map((p) => p.worktree)}>
                  <For each={layout.projects.list()}>{(project) => <SortableProject project={project} />}</For>
                </SortableProvider>
              </div>
              <DragOverlay>
                <ProjectDragOverlay />
              </DragOverlay>
            </DragDropProvider>
          </div>
          <div class="flex flex-col gap-1.5 self-stretch items-start shrink-0 px-2 py-3">
            <Switch>
              <Match when={!providers.paid().length && layout.sidebar.opened()}>
                <div class="rounded-md bg-background-stronger shadow-xs-border-base">
                  <div class="p-3 flex flex-col gap-2">
                    <div class="text-12-medium text-text-strong">Getting started</div>
                    <div class="text-text-base">OpenCode includes free models so you can start immediately.</div>
                    <div class="text-text-base">Connect any provider to use models, inc. Claude, GPT, Gemini etc.</div>
                  </div>
                  <Tooltip placement="right" value="Connect provider" inactive={layout.sidebar.opened()}>
                    <Button
                      class="flex w-full text-left justify-start text-12-medium text-text-strong stroke-[1.5px] rounded-lg rounded-t-none shadow-none border-t border-border-weak-base pl-2.25 pb-px"
                      size="large"
                      icon="plus"
                      onClick={connectProvider}
                    >
                      <Show when={layout.sidebar.opened()}>Connect provider</Show>
                    </Button>
                  </Tooltip>
                </div>
              </Match>
              <Match when={true}>
                <Tooltip placement="right" value="Connect provider" inactive={layout.sidebar.opened()}>
                  <Button
                    class="flex w-full text-left justify-start text-12-medium text-text-base stroke-[1.5px] rounded-lg px-2"
                    variant="ghost"
                    size="large"
                    icon="plus"
                    onClick={connectProvider}
                  >
                    <Show when={layout.sidebar.opened()}>Connect provider</Show>
                  </Button>
                </Tooltip>
              </Match>
            </Switch>
            <Show when={platform.openDirectoryPickerDialog}>
              <Tooltip placement="right" value="Open project" inactive={layout.sidebar.opened()}>
                <Button
                  class="flex w-full text-left justify-start text-12-medium text-text-base stroke-[1.5px] rounded-lg px-2"
                  variant="ghost"
                  size="large"
                  icon="folder-add-left"
                  onClick={chooseProject}
                >
                  <Show when={layout.sidebar.opened()}>Open project</Show>
                </Button>
              </Tooltip>
            </Show>
            {/* <Tooltip placement="right" value="Settings" inactive={layout.sidebar.opened()}> */}
            {/*   <Button */}
            {/*     disabled */}
            {/*     class="flex w-full text-left justify-start text-12-medium text-text-base stroke-[1.5px] rounded-lg px-2" */}
            {/*     variant="ghost" */}
            {/*     size="large" */}
            {/*     icon="settings-gear" */}
            {/*   > */}
            {/*     <Show when={layout.sidebar.opened()}>Settings</Show> */}
            {/*   </Button> */}
            {/* </Tooltip> */}
            <Tooltip placement="right" value="Share feedback" inactive={layout.sidebar.opened()}>
              <Button
                as={"a"}
                href="https://opencode.ai/desktop-feedback"
                target="_blank"
                class="flex w-full text-left justify-start text-12-medium text-text-base stroke-[1.5px] rounded-lg px-2"
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
        <Show when={layout.dialog.opened() === "provider"}>
          <SelectDialog
            defaultOpen
            title="Connect provider"
            placeholder="Search providers"
            activeIcon="plus-small"
            key={(x) => x?.id}
            items={providers.all}
            filterKeys={["id", "name"]}
            groupBy={(x) => (popularProviders.includes(x.id) ? "Popular" : "Other")}
            sortBy={(a, b) => {
              if (popularProviders.includes(a.id) && popularProviders.includes(b.id))
                return popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id)
              return a.name.localeCompare(b.name)
            }}
            sortGroupsBy={(a, b) => {
              if (a.category === "Popular" && b.category !== "Popular") return -1
              if (b.category === "Popular" && a.category !== "Popular") return 1
              return 0
            }}
            onSelect={(x) => {
              if (!x) return
              layout.dialog.connect(x.id)
            }}
            onOpenChange={(open) => {
              if (open) {
                layout.dialog.open("provider")
              } else {
                layout.dialog.close("provider")
              }
            }}
          >
            {(i) => (
              <div class="px-1.25 w-full flex items-center gap-x-4">
                <ProviderIcon
                  data-slot="list-item-extra-icon"
                  id={i.id as IconName}
                  // TODO: clean this up after we update icon in models.dev
                  classList={{
                    "text-icon-weak-base": true,
                    "size-4 mx-0.5": i.id === "opencode",
                    "size-5": i.id !== "opencode",
                  }}
                />
                <span>{i.name}</span>
                <Show when={i.id === "opencode"}>
                  <Tag>Recommended</Tag>
                </Show>
                <Show when={i.id === "anthropic"}>
                  <div class="text-14-regular text-text-weak">Connect with Claude Pro/Max or API key</div>
                </Show>
              </div>
            )}
          </SelectDialog>
        </Show>
        <Show when={layout.dialog.opened() === "connect"}>
          {iife(() => {
            const providerID = createMemo(() => layout.connect.provider()!)
            const provider = createMemo(() => globalSync.data.provider.all.find((x) => x.id === providerID())!)
            const methods = createMemo(
              () =>
                globalSync.data.provider_auth[providerID()] ?? [
                  {
                    type: "api",
                    label: "API key",
                  },
                ],
            )
            const [store, setStore] = createStore({
              method: undefined as undefined | ProviderAuthMethod,
              authorization: undefined as undefined | ProviderAuthAuthorization,
              state: "pending" as undefined | "pending" | "complete" | "error",
              error: undefined as string | undefined,
            })

            const methodIndex = createMemo(() => methods().findIndex((x) => x.label === store.method?.label))

            async function selectMethod(index: number) {
              const method = methods()[index]
              setStore(
                produce((draft) => {
                  draft.method = method
                  draft.authorization = undefined
                  draft.state = undefined
                  draft.error = undefined
                }),
              )

              if (method.type === "oauth") {
                setStore("state", "pending")
                const start = Date.now()
                await globalSDK.client.provider.oauth
                  .authorize(
                    {
                      providerID: providerID(),
                      method: index,
                    },
                    { throwOnError: true },
                  )
                  .then((x) => {
                    const elapsed = Date.now() - start
                    const delay = 1000 - elapsed

                    if (delay > 0) {
                      setTimeout(() => {
                        setStore("state", "complete")
                        setStore("authorization", x.data!)
                      }, delay)
                      return
                    }
                    setStore("state", "complete")
                    setStore("authorization", x.data!)
                  })
                  .catch((e) => {
                    setStore("state", "error")
                    setStore("error", String(e))
                  })
              }
            }

            let listRef: ListRef | undefined
            function handleKey(e: KeyboardEvent) {
              if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
                return
              }
              if (e.key === "Escape") return
              listRef?.onKeyDown(e)
            }

            onMount(() => {
              if (methods().length === 1) {
                selectMethod(0)
              }

              document.addEventListener("keydown", handleKey)
              onCleanup(() => {
                document.removeEventListener("keydown", handleKey)
              })
            })

            async function complete() {
              await globalSDK.client.global.dispose()
              setTimeout(() => {
                showToast({
                  variant: "success",
                  icon: "circle-check",
                  title: `${provider().name} connected`,
                  description: `${provider().name} models are now available to use.`,
                })
                layout.connect.complete()
              }, 500)
            }

            return (
              <Dialog
                modal
                defaultOpen
                onOpenChange={(open) => {
                  if (open) {
                    layout.dialog.open("connect")
                  } else {
                    layout.dialog.close("connect")
                  }
                }}
              >
                <Dialog.Header class="px-4.5">
                  <Dialog.Title class="flex items-center">
                    <IconButton
                      tabIndex={-1}
                      icon="arrow-left"
                      variant="ghost"
                      onClick={() => {
                        if (methods().length === 1) {
                          layout.dialog.open("provider")
                          return
                        }
                        if (store.authorization) {
                          setStore("authorization", undefined)
                          setStore("method", undefined)
                          return
                        }
                        if (store.method) {
                          setStore("method", undefined)
                          return
                        }
                        layout.dialog.open("provider")
                      }}
                    />
                  </Dialog.Title>
                  <Dialog.CloseButton tabIndex={-1} />
                </Dialog.Header>
                <Dialog.Body>
                  <div class="flex flex-col gap-6 px-2.5 pb-3">
                    <div class="px-2.5 flex gap-4 items-center">
                      <ProviderIcon id={providerID() as IconName} class="size-5 shrink-0 icon-strong-base" />
                      <div class="text-16-medium text-text-strong">
                        <Switch>
                          <Match
                            when={providerID() === "anthropic" && store.method?.label?.toLowerCase().includes("max")}
                          >
                            Login with Claude Pro/Max
                          </Match>
                          <Match when={true}>Connect {provider().name}</Match>
                        </Switch>
                      </div>
                    </div>
                    <div class="px-2.5 pb-10 flex flex-col gap-6">
                      <Switch>
                        <Match when={store.method === undefined}>
                          <div class="text-14-regular text-text-base">Select login method for {provider().name}.</div>
                          <div class="">
                            <List
                              ref={(ref) => (listRef = ref)}
                              items={methods}
                              key={(m) => m?.label}
                              onSelect={async (method, index) => {
                                if (!method) return
                                selectMethod(index)
                              }}
                            >
                              {(i) => (
                                <div class="w-full flex items-center gap-x-4">
                                  <div class="w-4 h-2 rounded-[1px] bg-input-base shadow-xs-border-base flex items-center justify-center">
                                    <div
                                      class="w-2.5 h-0.5 bg-icon-strong-base hidden"
                                      data-slot="list-item-extra-icon"
                                    />
                                  </div>
                                  <span>{i.label}</span>
                                </div>
                              )}
                            </List>
                          </div>
                        </Match>
                        <Match when={store.state === "pending"}>
                          <div class="text-14-regular text-text-base">
                            <div class="flex items-center gap-x-4">
                              <Spinner />
                              <span>Authorization in progress...</span>
                            </div>
                          </div>
                        </Match>
                        <Match when={store.state === "error"}>
                          <div class="text-14-regular text-text-base">
                            <div class="flex items-center gap-x-4">
                              <Icon name="circle-ban-sign" class="text-icon-critical-base" />
                              <span>Authorization failed: {store.error}</span>
                            </div>
                          </div>
                        </Match>
                        <Match when={store.method?.type === "api"}>
                          {iife(() => {
                            const [formStore, setFormStore] = createStore({
                              value: "",
                              error: undefined as string | undefined,
                            })

                            async function handleSubmit(e: SubmitEvent) {
                              e.preventDefault()

                              const form = e.currentTarget as HTMLFormElement
                              const formData = new FormData(form)
                              const apiKey = formData.get("apiKey") as string

                              if (!apiKey?.trim()) {
                                setFormStore("error", "API key is required")
                                return
                              }

                              setFormStore("error", undefined)
                              await globalSDK.client.auth.set({
                                providerID: providerID(),
                                auth: {
                                  type: "api",
                                  key: apiKey,
                                },
                              })
                              await complete()
                            }

                            return (
                              <div class="flex flex-col gap-6">
                                <Switch>
                                  <Match when={provider().id === "opencode"}>
                                    <div class="flex flex-col gap-4">
                                      <div class="text-14-regular text-text-base">
                                        OpenCode Zen gives you access to a curated set of reliable optimized models for
                                        coding agents.
                                      </div>
                                      <div class="text-14-regular text-text-base">
                                        With a single API key you’ll get access to models such as Claude, GPT, Gemini,
                                        GLM and more.
                                      </div>
                                      <div class="text-14-regular text-text-base">
                                        Visit{" "}
                                        <Link href="https://opencode.ai/zen" tabIndex={-1}>
                                          opencode.ai/zen
                                        </Link>{" "}
                                        to collect your API key.
                                      </div>
                                    </div>
                                  </Match>
                                  <Match when={true}>
                                    <div class="text-14-regular text-text-base">
                                      Enter your {provider().name} API key to connect your account and use{" "}
                                      {provider().name} models in OpenCode.
                                    </div>
                                  </Match>
                                </Switch>
                                <form onSubmit={handleSubmit} class="flex flex-col items-start gap-4">
                                  <TextField
                                    autofocus
                                    type="text"
                                    label={`${provider().name} API key`}
                                    placeholder="API key"
                                    name="apiKey"
                                    value={formStore.value}
                                    onChange={setFormStore.bind(null, "value")}
                                    validationState={formStore.error ? "invalid" : undefined}
                                    error={formStore.error}
                                  />
                                  <Button class="w-auto" type="submit" size="large" variant="primary">
                                    Submit
                                  </Button>
                                </form>
                              </div>
                            )
                          })}
                        </Match>
                        <Match when={store.method?.type === "oauth"}>
                          <Switch>
                            <Match when={store.authorization?.method === "code"}>
                              {iife(() => {
                                const [formStore, setFormStore] = createStore({
                                  value: "",
                                  error: undefined as string | undefined,
                                })

                                onMount(() => {
                                  if (store.authorization?.method === "code" && store.authorization?.url) {
                                    platform.openLink(store.authorization.url)
                                  }
                                })

                                async function handleSubmit(e: SubmitEvent) {
                                  e.preventDefault()

                                  const form = e.currentTarget as HTMLFormElement
                                  const formData = new FormData(form)
                                  const code = formData.get("code") as string

                                  if (!code?.trim()) {
                                    setFormStore("error", "Authorization code is required")
                                    return
                                  }

                                  setFormStore("error", undefined)
                                  const { error } = await globalSDK.client.provider.oauth.callback({
                                    providerID: providerID(),
                                    method: methodIndex(),
                                    code,
                                  })
                                  if (!error) {
                                    await complete()
                                    return
                                  }
                                  setFormStore("error", "Invalid authorization code")
                                }

                                return (
                                  <div class="flex flex-col gap-6">
                                    <div class="text-14-regular text-text-base">
                                      Visit <Link href={store.authorization!.url}>this link</Link> to collect your
                                      authorization code to connect your account and use {provider().name} models in
                                      OpenCode.
                                    </div>
                                    <form onSubmit={handleSubmit} class="flex flex-col items-start gap-4">
                                      <TextField
                                        autofocus
                                        type="text"
                                        label={`${store.method?.label} authorization code`}
                                        placeholder="Authorization code"
                                        name="code"
                                        value={formStore.value}
                                        onChange={setFormStore.bind(null, "value")}
                                        validationState={formStore.error ? "invalid" : undefined}
                                        error={formStore.error}
                                      />
                                      <Button class="w-auto" type="submit" size="large" variant="primary">
                                        Submit
                                      </Button>
                                    </form>
                                  </div>
                                )
                              })}
                            </Match>
                            <Match when={store.authorization?.method === "auto"}>
                              {iife(() => {
                                const code = createMemo(() => {
                                  const instructions = store.authorization?.instructions
                                  if (instructions?.includes(":")) {
                                    return instructions?.split(":")[1]?.trim()
                                  }
                                  return instructions
                                })

                                onMount(async () => {
                                  const result = await globalSDK.client.provider.oauth.callback({
                                    providerID: providerID(),
                                    method: methodIndex(),
                                  })
                                  if (result.error) {
                                    // TODO: show error
                                    layout.dialog.close("connect")
                                    return
                                  }
                                  await complete()
                                })

                                return (
                                  <div class="flex flex-col gap-6">
                                    <div class="text-14-regular text-text-base">
                                      Visit <Link href={store.authorization!.url}>this link</Link> and enter the code
                                      below to connect your account and use {provider().name} models in OpenCode.
                                    </div>
                                    <TextField
                                      label="Confirmation code"
                                      class="font-mono"
                                      value={code()}
                                      readOnly
                                      copyable
                                    />
                                    <div class="text-14-regular text-text-base flex items-center gap-4">
                                      <Spinner />
                                      <span>Waiting for authorization...</span>
                                    </div>
                                  </div>
                                )
                              })}
                            </Match>
                          </Switch>
                        </Match>
                      </Switch>
                    </div>
                  </div>
                </Dialog.Body>
              </Dialog>
            )
          })}
        </Show>
      </div>
      <Toast.Region />
    </div>
  )
}
