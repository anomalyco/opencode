import type { Session } from "@opencode-ai/sdk/v2/client"
import { Logo } from "@opencode-ai/ui/logo"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { KeybindV2 } from "@opencode-ai/ui/v2/keybind-v2"
import { createMediaQuery } from "@solid-primitives/media"
import { useQuery } from "@tanstack/solid-query"
import { For, Show, createMemo, startTransition } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useDirectoryPicker } from "@/components/directory-picker"
import { newTabTooltipKeybind } from "@/components/command-tooltip-keybind"
import { useSettingsCommand } from "@/components/settings-dialog"
import { type TitlebarUpdate } from "@/components/titlebar"
import {
  loadHomeSessionIndex,
  retainHomeSessions,
  type HomeSessionEvents,
} from "@/context/global-sync/home-session-index"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLayout, type LocalProject } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { ServerConnection } from "@/context/server"
import { useTabs } from "@/context/tabs"
import { createHomeController } from "@/pages/home/home-controller"
import { archiveHomeSession } from "@/pages/home-session-archive"
import { historyTreeGroups, errorMessage, homeProjectDirectories } from "@/pages/layout/helpers"
import {
  HISTORY_TREE_CARD_INSET,
  HISTORY_TREE_HEADER,
  HISTORY_TREE_OPEN_WIDTH,
  HISTORY_TREE_SIDEBAR_INSET,
  historyTreeMacLights,
  historyTreeWindowChromeStart,
  historyTreeWindowToggle,
} from "@/pages/layout/history-tree-chrome"
import { useV2SessionChrome } from "@/pages/layout/session-chrome"
import { SessionTabAvatar } from "@/pages/layout/session-tab-avatar"
import { useSessionTabAvatarState } from "@/pages/layout/project-avatar-state"
import { pathKey } from "@/utils/path-key"
import { sessionTitle } from "@/utils/session-title"
import { showToast } from "@/utils/toast"
import { Binary } from "@opencode-ai/core/util/binary"

const TREE_SESSION_LIMIT = 64
const TREE_GUTTER = "flex size-4 shrink-0 items-center justify-center"
const TREE_ROW = "flex h-8 w-full min-w-0 items-center gap-2"
const TREE_BUTTON =
  "rounded-[6px] text-left text-[13px] font-[440] leading-4 tracking-[-0.04px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
// Row pills span the whole track, so 6px of lead padding puts glyphs on the same column as the
// 28px toggle button's centered icon, and trailing actions mirror it from the pill's end edge.
const TREE_PAD = "ps-1.5 pe-2"
const TREE_PAD_ACTION = "ps-1.5 pe-8"
const TREE_PAD_SESSION = "ps-[30px] pe-8"
const TREE_ACTION = "absolute end-0 top-1/2 -translate-y-1/2"
const TREE_TRACK = {
  "padding-inline-start": `${HISTORY_TREE_SIDEBAR_INSET}px`,
  "padding-inline-end": `${HISTORY_TREE_SIDEBAR_INSET}px`,
}
const TREE_FADE =
  "transition-[opacity,transform] duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:duration-[0ms]"
const TREE_TOGGLE =
  "transition-transform duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] motion-reduce:transform-none"

export function SessionHistoryTree(props: { update?: TitlebarUpdate }) {
  const language = useLanguage()
  const layout = useLayout()
  const tabs = useTabs()
  const command = useCommand()
  const platform = usePlatform()
  const openSettings = useSettingsCommand()
  const chrome = useV2SessionChrome()
  const home = createHomeController()
  const pickDirectory = useDirectoryPicker()
  const mobile = createMediaQuery("(max-width: 767px)")
  const [collapsed, setCollapsed] = createStore<Record<string, boolean>>({})
  const cache = () => home.server.focusedSync().homeSessions
  const sessionEventLoad = useQuery(() => ({
    queryKey: cache().eventsKey,
    queryFn: async (): Promise<HomeSessionEvents> => ({ sequence: 0, entries: [] }),
    initialData: { sequence: 0, entries: [] } satisfies HomeSessionEvents,
    enabled: false,
  }))
  const sessionLoad = useQuery(() => ({
    queryKey: cache().indexKey,
    enabled: !!home.server.focusedContext(),
    queryFn: async ({ signal }) => {
      const ctx = home.server.focusedContext()
      if (!ctx) return { sessions: [], eventSequence: 0 }
      const eventSequence = cache().eventSequence()
      const index = await loadHomeSessionIndex(
        (input, options) => ctx.sdk.client.v2.session.list(input, options),
        eventSequence,
        signal,
      )
      cache().complete(eventSequence)
      return index
    },
    retry: false,
    staleTime: 30_000,
    refetchOnMount: true,
    refetchOnReconnect: true,
  }))
  const sessions = createMemo(() =>
    retainHomeSessions(cache().sessions(sessionLoad.data, sessionEventLoad.data), TREE_SESSION_LIMIT, Date.now()),
  )
  const projects = createMemo(() => home.project.list())
  const groups = createMemo(() => historyTreeGroups(projects(), sessions()))
  const route = () => layout.route()
  const railOpen = () => layout.historyTree.opened()
  const macLights = () => historyTreeMacLights(platform)
  const chromeStart = () => historyTreeWindowChromeStart(macLights())
  const headerPad = () => ({ ...TREE_TRACK, "padding-inline-start": `${chromeStart()}px` })
  const overlayToggle = () =>
    historyTreeWindowToggle({
      mobile: mobile(),
      treeOpened: layout.historyTree.opened(),
      session: route().type === "session",
    })
  const fadeClass = () => ({
    [TREE_FADE]: true,
    "opacity-100 [transform:translateX(0)]": railOpen(),
    "pointer-events-none opacity-0 [transform:translateX(-8px)] rtl:[transform:translateX(8px)]": !railOpen(),
  })
  const conn = () => home.server.focused()
  const canAddProject = createMemo(() => {
    const current = conn()
    return !!current && home.server.health(current)?.healthy !== false
  })

  const openSession = (session: Session) => {
    const current = conn()
    const ctx = home.server.focusedContext()
    if (!current || !ctx) return
    ctx.projects.open(session.directory)
    ctx.projects.touch(session.directory)
    void startTransition(() => {
      const tab = tabs.addSessionTab({ server: ServerConnection.key(current), sessionId: session.id })
      tabs.select(tab)
    })
  }

  const openNew = (project: LocalProject) => {
    const current = conn()
    if (!current) return
    setCollapsed(pathKey(project.worktree), false)
    home.project.openProjectNewSession(current, project.worktree)
  }

  const addProject = () => {
    const current = conn()
    if (!current || home.server.health(current)?.healthy === false) return
    pickDirectory({
      server: current,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: (result) => {
        const directories = homeProjectDirectories(result)
        if (directories.length === 0) return
        home.project.add(current, directories)
        for (const directory of directories) setCollapsed(pathKey(directory), false)
      },
    })
  }

  const selectedSession = () => {
    const current = route()
    if (current.type !== "session") return
    return current.sessionId
  }

  const openHelp = () => platform.openExternal("https://opencode.ai/desktop-feedback")

  const archiveSession = async (session: Session) => {
    const current = conn()
    const ctx = home.server.focusedContext()
    if (!current || !ctx) return
    const [, setStore] = ctx.sync.child(session.directory)
    if ((await ctx.sdk.protocol) !== "v1") return
    await archiveHomeSession({
      server: ServerConnection.key(current),
      session,
      archive: (sessionID) =>
        ctx.sdk.client.session.update({
          sessionID,
          directory: session.directory,
          time: { archived: Date.now() },
        }),
      remove: () => {
        setStore(
          produce((draft) => {
            const match = Binary.search(draft.session, session.id, (item) => item.id)
            if (match.found) draft.session.splice(match.index, 1)
          }),
        )
        cache().remove(session.id)
      },
      onError: (cause) =>
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(cause, language.t("common.requestFailed")),
        }),
    })
  }

  return (
    <>
      <nav
        data-slot="session-history-tree"
        aria-label={language.t("sidebar.nav.projectsAndSessions")}
        style={{ width: railOpen() ? `${HISTORY_TREE_OPEN_WIDTH}px` : "0px" }}
        class="flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-v2-background-bg-deep pt-2 transition-[width] duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:duration-[0ms]"
      >
        <div class="flex h-full min-h-0 w-[244px] shrink-0 flex-col">
          <Show when={railOpen()}>
            <div class="flex h-12 shrink-0 items-center gap-2" style={headerPad()} classList={fadeClass()}>
              <TooltipV2
                class="inline-flex shrink-0 items-center"
                placement="right"
                value={
                  <>
                    {language.t("command.sidebar.toggle")}
                    <KeybindV2 keys={command.keybindParts("sidebar.toggle")} variant="neutral" />
                  </>
                }
              >
                <IconButtonV2
                  type="button"
                  data-action="sidebar-toggle"
                  variant="ghost-muted"
                  size="large"
                  class={TREE_TOGGLE}
                  icon={<IconV2 name="sidebar-right" />}
                  aria-label={language.t("command.sidebar.toggle")}
                  aria-expanded={layout.historyTree.opened()}
                  onClick={() => layout.historyTree.toggle()}
                />
              </TooltipV2>
              <Logo class="h-3.5 w-auto min-w-0 shrink opacity-60" aria-hidden="true" />
            </div>
          </Show>
          <Show when={railOpen()}>
            <div class="shrink-0 pb-2" style={TREE_TRACK} classList={fadeClass()}>
            <TooltipV2
              placement="right"
              value={
                <>
                  {language.t("command.session.new")}
                  <KeybindV2 keys={newTabTooltipKeybind(command)} variant="neutral" />
                </>
              }
            >
              <button
                type="button"
                data-action="sidebar-new-session"
                class={`${TREE_ROW} ${TREE_BUTTON} ${TREE_PAD}`}
                classList={{ "bg-v2-overlay-simple-overlay-hover": route().type === "draft" }}
                aria-pressed={route().type === "draft"}
                aria-label={language.t("command.session.new")}
                onClick={() => {
                  chrome.openNewTab()
                }}
              >
                <span class={TREE_GUTTER}>
                  <IconV2 name="plus" class="size-4 text-v2-icon-icon-muted" />
                </span>
                <span class="min-w-0 truncate">{language.t("command.session.new")}</span>
              </button>
            </TooltipV2>
            </div>
          </Show>
          <Show when={railOpen()}>
            <div class="flex min-h-0 flex-1 flex-col" classList={fadeClass()}>
            <div class="min-h-0 flex-1 overflow-y-auto py-1 no-scrollbar" style={TREE_TRACK}>
              <div class={`${TREE_ROW} justify-between ps-1.5`}>
                <div class="min-w-0 truncate text-[12px] font-[440] leading-4 tracking-[-0.04px] text-v2-text-text-muted">
                  {language.t("home.projects")}
                </div>
                <TooltipV2 class="flex shrink-0 items-center" placement="right" value={language.t("home.project.add")}>
                  <IconButtonV2
                    type="button"
                    data-action="sidebar-add-project"
                    variant="ghost-muted"
                    size="large"
                    icon={<IconV2 name="folder-add-left" />}
                    disabled={!canAddProject()}
                    aria-label={language.t("home.project.add")}
                    onClick={addProject}
                  />
                </TooltipV2>
              </div>
              <For each={groups()}>
                {(group) => {
                  const key = pathKey(group.project.worktree)
                  const open = () => collapsed[key] !== true
                  return (
                    <div class="mb-2 flex flex-col gap-1">
                      <div class="group/project relative">
                        <button
                          type="button"
                          class={`${TREE_ROW} ${TREE_BUTTON} ${TREE_PAD_ACTION}`}
                          aria-expanded={open()}
                          onClick={() => setCollapsed(key, open())}
                        >
                          <span class={TREE_GUTTER}>
                            <IconV2 name="folder" class="size-4 text-v2-icon-icon-muted" />
                          </span>
                          <span class="min-w-0 truncate text-v2-text-text-muted">{group.projectName}</span>
                        </button>
                        <div class={TREE_ACTION}>
                          <TooltipV2 placement="right" value={language.t("command.session.new")}>
                            <IconButtonV2
                              type="button"
                              data-action="sidebar-project-new-session"
                              variant="ghost-muted"
                              size="large"
                              class="md:opacity-0 md:group-hover/project:opacity-100 focus-visible:opacity-100"
                              icon={<IconV2 name="plus" />}
                              aria-label={language.t("command.session.new")}
                              onClick={() => openNew(group.project)}
                            />
                          </TooltipV2>
                        </div>
                      </div>
                      <Show when={open()}>
                        <div class="flex flex-col gap-0.5">
                          <For each={group.sessions}>
                            {(session) => (
                              <HistoryTreeRow
                                project={group.project}
                                server={() => home.selection.value().server}
                                session={session}
                                selected={selectedSession() === session.id}
                                onOpen={() => openSession(session)}
                                onArchive={() => archiveSession(session)}
                              />
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  )
                }}
              </For>
            </div>
            <div class="flex shrink-0 flex-col pb-3 pt-1" style={TREE_TRACK}>
              <Show when={props.update?.version() || props.update?.installing()}>
                <button
                  type="button"
                  class={`${TREE_ROW} ${TREE_BUTTON} ${TREE_PAD}`}
                  disabled={props.update?.installing()}
                  aria-busy={props.update?.installing()}
                  aria-label={language.t("toast.update.action.installRestart")}
                  onClick={() => props.update?.install()}
                >
                  <span class="min-w-0 truncate text-v2-text-text-accent">{language.t("titlebar.update")}</span>
                </button>
              </Show>
              <button type="button" class={`${TREE_ROW} ${TREE_BUTTON} ${TREE_PAD}`} onClick={openSettings}>
                <span class={TREE_GUTTER}>
                  <IconV2 name="settings-gear" class="size-4 text-v2-icon-icon-muted" />
                </span>
                <span class="min-w-0 truncate text-v2-text-text-muted">{language.t("sidebar.settings")}</span>
              </button>
              <button type="button" class={`${TREE_ROW} ${TREE_BUTTON} ${TREE_PAD}`} onClick={openHelp}>
                <span class={TREE_GUTTER}>
                  <IconV2 name="help" class="size-4 text-v2-icon-icon-muted" />
                </span>
                <span class="min-w-0 truncate text-v2-text-text-muted">{language.t("sidebar.help")}</span>
              </button>
            </div>
          </div>
          </Show>
        </div>
      </nav>
      <Show when={overlayToggle()}>
        <div
          data-slot="history-tree-window-chrome"
          class="pointer-events-none absolute z-20 flex shrink-0 items-center md:z-40"
          style={{
            top: `${HISTORY_TREE_CARD_INSET}px`,
            height: `${HISTORY_TREE_HEADER}px`,
            "inset-inline-start": `${chromeStart()}px`,
          }}
        >
          <div class="pointer-events-auto shrink-0">
            <TooltipV2
              class="inline-flex shrink-0 items-center"
              placement="right"
              value={
                <>
                  {language.t("command.sidebar.toggle")}
                  <KeybindV2 keys={command.keybindParts("sidebar.toggle")} variant="neutral" />
                </>
              }
            >
              <IconButtonV2
                type="button"
                data-action="sidebar-toggle"
                variant="ghost-muted"
                size="large"
                class={TREE_TOGGLE}
                icon={<IconV2 name="sidebar-right" />}
                aria-label={language.t("command.sidebar.toggle")}
                aria-expanded={layout.historyTree.opened()}
                onClick={() => layout.historyTree.toggle()}
              />
            </TooltipV2>
          </div>
        </div>
      </Show>
    </>
  )
}

function HistoryTreeRow(props: {
  project: LocalProject
  server: () => ServerConnection.Key
  session: Session
  selected: boolean
  onOpen: () => void
  onArchive: () => void
}) {
  const language = useLanguage()
  const avatar = useSessionTabAvatarState(
    props.server,
    () => props.session.directory,
    () => props.session.id,
  )
  const title = () => sessionTitle(props.session.title) || props.session.id
  const menu = () => <SessionHistoryRowMenuItems onArchive={props.onArchive} />

  return (
    <div class="group/session relative">
      <MenuV2.Context>
        <MenuV2.Context.Trigger as="div" class="contents">
          <button
            type="button"
            data-component="session-history-row"
            data-session-id={props.session.id}
            aria-current={props.selected ? "page" : undefined}
            class={`${TREE_ROW} ${TREE_BUTTON} ${TREE_PAD_SESSION}`}
            classList={{ "bg-v2-overlay-simple-overlay-hover": props.selected }}
            aria-label={avatar.loading() ? language.t("sidebar.history.runningChat", { title: title() }) : undefined}
            onClick={props.onOpen}
          >
            <span class={TREE_GUTTER}>
              <SessionTabAvatar
                project={props.project}
                directory={props.session.directory}
                sessionId={props.session.id}
                server={props.server()}
                revealProjectOnHover={false}
              />
            </span>
            <span class="min-w-0 truncate">{title()}</span>
          </button>
        </MenuV2.Context.Trigger>
        <MenuV2.Context.Portal>
          <MenuV2.Context.Content>{menu()}</MenuV2.Context.Content>
        </MenuV2.Context.Portal>
      </MenuV2.Context>
      <div class={TREE_ACTION}>
        <MenuV2 placement="bottom-end" gutter={4}>
          <TooltipV2 placement="right" value={language.t("common.moreOptions")}>
            <MenuV2.Trigger
              as={IconButtonV2}
              type="button"
              data-action="session-history-more"
              variant="ghost-muted"
              size="large"
              class="md:opacity-0 md:group-hover/session:opacity-100 focus-visible:opacity-100 data-[expanded]:opacity-100"
              icon={<IconV2 name="outline-dots" />}
              aria-label={language.t("common.moreOptions")}
              onPointerDown={(event: PointerEvent) => event.stopPropagation()}
            />
          </TooltipV2>
          <MenuV2.Portal>
            <MenuV2.Content>{menu()}</MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
      </div>
    </div>
  )
}

function SessionHistoryRowMenuItems(props: { onArchive: () => void }) {
  const language = useLanguage()
  return (
    <MenuV2.Item
      data-action="session-history-archive"
      onSelect={() => void props.onArchive()}
    >
      <span class="flex items-center gap-2">
        <IconV2 name="archive" class="size-4 shrink-0 text-v2-icon-icon-muted" />
        <span>{language.t("common.archive")}</span>
      </span>
    </MenuV2.Item>
  )
}
