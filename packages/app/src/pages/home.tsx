import type { Session } from "@opencode-ai/sdk/v2/client"
import { createEffect, createMemo, createSignal, For, Match, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useQuery } from "@tanstack/solid-query"
import { Button } from "@opencode-ai/ui/button"
import { Logo } from "@opencode-ai/ui/logo"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Avatar as AvatarV2 } from "@opencode-ai/ui/v2/components/avatar-v2.jsx"
import { ButtonV2 } from "@opencode-ai/ui/v2/components/button-v2.jsx"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"
import { IconButtonV2 } from "@opencode-ai/ui/v2/components/icon-button-v2.jsx"
import { MenuV2 } from "@opencode-ai/ui/v2/components/menu-v2.jsx"
import { getAvatarColors, useLayout, type LocalProject } from "@/context/layout"
import { useNavigate, useSearchParams } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { decode64 } from "@/utils/base64"
import { getFilename } from "@opencode-ai/core/util/path"
import { Icon } from "@opencode-ai/ui/icon"
import { usePlatform } from "@/context/platform"
import { DateTime } from "luxon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { ServerConnection, useServer } from "@/context/server"
import { useServerSync } from "@/context/server-sync"
import { useLanguage } from "@/context/language"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import {
  displayName,
  getProjectAvatarSource,
  projectForSession,
  routeProjectRoot,
  sortedRootSessions,
} from "@/pages/layout/helpers"
import { sessionTitle } from "@/utils/session-title"
import { pathKey } from "@/utils/path-key"
import { messageAgentColor } from "@/utils/agent"
import { sessionPermissionRequest } from "@/pages/session/composer/session-request-tree"
import { ServerHealthIndicator } from "@/components/server/server-row"
import { useServers } from "@/context/servers"
import { useSettings } from "@/context/settings"

const HOME_SESSION_LIMIT = 15
const HOME_ROW =
  "flex min-w-0 w-full shrink-0 cursor-default items-center rounded-[6px] border-0 bg-transparent text-left text-v2-text-text-muted transition-colors duration-[120ms] ease-in-out hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
const HOME_PROJECT_NAV_ROW = `${HOME_ROW} h-7 gap-2 px-1.5 [&>span]:min-w-0 [&>span]:overflow-hidden [&>span]:text-ellipsis [&>span]:whitespace-nowrap`
const HOME_SECTION_LABEL = "text-v2-text-text-muted [font-weight:440]"

type HomeSessionRecord = {
  session: Session
  project: LocalProject
  projectName: string
}

type HomeSessionGroup = {
  id: "today" | "yesterday" | "older"
  title: string
  sessions: HomeSessionRecord[]
}

export default function Home() {
  const settings = useSettings()
  return (
    <Show when={settings.general.newLayoutDesigns()} fallback={<LegacyHome />}>
      <HomeDesign />
    </Show>
  )
}

function HomeDesign() {
  const sync = useServerSync()
  const layout = useLayout()
  const platform = usePlatform()
  const dialog = useDialog()
  const navigate = useNavigate()
  const server = useServer()
  const language = useLanguage()
  const notification = useNotification()
  const [searchParams, setSearchParams] = useSearchParams<{ project?: string }>()
  const [state, setState] = createStore({ search: "" })

  // Selected project is URL-addressable via `/?project=<base64(worktree)>` so other
  // surfaces (e.g. the mobile bottom bar) can deep-link straight into a project's
  // session list. Selection stays in-memory free; the query param is the source of truth.
  const rawProjectParam = createMemo(() => {
    const raw = searchParams.project
    return Array.isArray(raw) ? raw[0] : raw
  })
  const selectedDirectory = createMemo(() => decode64(rawProjectParam()))
  const projects = createMemo(() => layout.projects.list())
  const selectedRoot = createMemo(() => {
    const directory = selectedDirectory()
    if (!directory) return
    return canonicalProjectRoot(directory)
  })
  const selectedProject = createMemo(() => {
    const root = selectedRoot()
    if (!root) return
    return projects().find((project) => pathKey(project.worktree) === pathKey(root))
  })
  const directories = (project: LocalProject) => [project.worktree, ...(project.sandboxes ?? [])]
  const projectDirectories = createMemo(() => {
    const project = selectedProject()
    if (!project) return [...projects().flatMap((project) => directories(project))]
    return directories(project)
  })
  const search = createMemo(() => state.search.trim())
  const sessionLoad = useQuery(() => ({
    queryKey: ["home", "sessions", ...projectDirectories()] as const,
    queryFn: async () => {
      await Promise.all(projectDirectories().map((directory) => sync.project.loadSessions(directory)))
      return null
    },
  }))

  const projectByID = createMemo(
    () => new Map(projects().flatMap((project) => (project.id ? [[project.id, project] as const] : []))),
  )
  const records = createMemo(() => {
    return [
      ...new Map(
        projectDirectories()
          .flatMap((directory) => sortedRootSessions(sync.child(directory, { bootstrap: false })[0], Date.now()))
          .map((session) => [`${pathKey(session.directory)}:${session.id}`, session] as const),
      ).values(),
    ]
      .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
      .flatMap((session) => {
        const project = projectForSession(session, projects(), projectByID())
        if (!project) return []
        return {
          session,
          project,
          projectName: displayName(project),
        }
      })
      .filter((record) => {
        const value = search().toLowerCase()
        if (!value) return true
        return `${record.session.title} ${record.projectName}`.toLowerCase().includes(value)
      })
      .slice(0, HOME_SESSION_LIMIT)
  })
  const groups = createMemo(() => groupSessions(records(), language))

  createEffect(() => {
    const raw = rawProjectParam()
    if (!raw) return

    const directory = selectedDirectory()
    if (!directory) {
      setSelectedDirectory(undefined, true)
      return
    }

    const root = canonicalProjectRoot(directory)
    if (!root) {
      // `sync.ready` currently tracks the bootstrap query pending state. Wait until
      // bootstrap has finished before deciding an unknown project param is invalid;
      // sandbox routes need project metadata to canonicalize to their root.
      if (!sync.ready) setSelectedDirectory(undefined, true)
      return
    }

    layout.projects.open(root)
    server.projects.touch(root)
    if (root !== directory) setSelectedDirectory(root, true)
  })

  function canonicalProjectRoot(directory: string) {
    return routeProjectRoot({
      directory,
      opened: projects(),
      projects: sync.data.project,
      workspaceOrder: {},
    })
  }

  function setSelectedDirectory(directory: string | undefined, replace = false) {
    setSearchParams({ project: directory ? base64Encode(directory) : undefined }, { replace })
  }

  function selectProject(directory: string) {
    const root = canonicalProjectRoot(directory)
    if (!root || !projects().some((project) => pathKey(project.worktree) === pathKey(root))) return
    layout.projects.open(root)
    server.projects.touch(root)
    setSelectedDirectory(root)
  }

  function clearSelectedProject() {
    setSelectedDirectory(undefined)
    setState("search", "")
  }

  function addProject(directory: string) {
    layout.projects.open(directory)
    server.projects.touch(directory)
    setSelectedDirectory(directory)
  }

  function openNewSession() {
    const project = selectedProject()
    if (!project) {
      void chooseProject()
      return
    }
    layout.projects.open(project.worktree)
    server.projects.touch(project.worktree)
    navigate(`/${base64Encode(project.worktree)}/session`)
  }

  function openProjectNewSession(directory: string) {
    layout.projects.open(directory)
    server.projects.touch(directory)
    navigate(`/${base64Encode(directory)}/session`)
  }

  const showEditProjectDialog = (project: LocalProject) => {
    void import("@/components/dialog-edit-project").then((x) => {
      dialog.show(() => <x.DialogEditProject project={project} />)
    })
  }

  const unseenCount = (project: LocalProject) =>
    directories(project).reduce((total, directory) => total + notification.project.unseenCount(directory), 0)

  const clearNotifications = (project: LocalProject) =>
    directories(project)
      .filter((directory) => notification.project.unseenCount(directory) > 0)
      .forEach((directory) => notification.project.markViewed(directory))

  function openSession(session: Session) {
    const project = projectForSession(session, projects(), projectByID())
    layout.projects.open(project?.worktree ?? session.directory)
    server.projects.touch(project?.worktree ?? session.directory)
    navigate(`/${base64Encode(session.directory)}/session/${session.id}`)
  }

  async function chooseProject() {
    function resolve(result: string | string[] | null) {
      if (Array.isArray(result)) {
        result.forEach(addProject)
        if (result[0]) setSelectedDirectory(result[0])
        return
      }
      if (result) addProject(result)
    }

    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform.openDirectoryPickerDialog?.({
        title: language.t("command.project.open"),
        multiple: true,
      })
      resolve(result)
      return
    }

    dialog.show(
      () => <DialogSelectDirectory multiple={true} onSelect={resolve} />,
      () => resolve(null),
    )
  }

  function openSettings() {
    void import("@/components/dialog-settings").then((x) => {
      dialog.show(() => <x.DialogSettings />)
    })
  }

  const projectSelected = createMemo(() => !!selectedProject())

  return (
    <div class="mx-auto grid w-full h-full max-w-[1080px] gap-8 px-6 pb-16 lg:grid-cols-[280px_minmax(0,720px)]">
      <HomeProjectColumn
        // Mobile is a master -> detail flow: the projects list is the master screen and
        // collapses once a project is selected. Desktop always shows both columns.
        class={projectSelected() ? "hidden lg:flex" : "flex"}
        hasProjects={projects().length > 0}
        selectedProject={selectedDirectory()}
        selectProject={selectProject}
        openNewSession={openProjectNewSession}
        chooseProject={() => void chooseProject()}
        editProject={showEditProjectDialog}
        closeProject={(directory) => {
          layout.projects.close(directory)
          if (selectedDirectory() === directory) setSelectedDirectory(undefined)
        }}
        clearNotifications={clearNotifications}
        unseenCount={unseenCount}
        openSettings={openSettings}
        openHelp={() => platform.openLink("https://opencode.ai/desktop-feedback")}
        language={language}
      />

      <section
        class="min-w-0 flex-1 flex-col overflow-y-hidden lg:flex lg:pt-12"
        classList={{
          flex: projectSelected(),
          hidden: !projectSelected(),
        }}
        aria-label={language.t("sidebar.project.recentSessions")}
      >
        <Switch>
          <Match when={projectDirectories().length === 0 && !sync.ready}>
            <HomeEmptyState
              status
              icon="folder-add-left"
              title={language.t("home.loading.title")}
              description={language.t("common.loading")}
            />
          </Match>
          <Match when={projectDirectories().length === 0}>
            <HomeEmptyState
              icon="folder-add-left"
              title={language.t("home.empty.title")}
              description={language.t("home.empty.description")}
              action={language.t("home.project.add")}
              actionVariant="primary"
              onAction={() => void chooseProject()}
              hint={language.t("home.empty.hint")}
            />
          </Match>
          <Match when={true}>
            <HomeSessionsColumn />
          </Match>
        </Switch>
      </section>
    </div>
  )

  function HomeSessionsColumn() {
    return (
      <>
        <Show when={selectedProject()}>
          {(project) => (
            <div class="mb-3 flex min-w-0 items-center gap-2 px-1 lg:hidden">
              <IconButtonV2
                data-action="home-sessions-back"
                variant="ghost-muted"
                size="large"
                class="shrink-0 [&_[data-slot=icon-svg]]:text-v2-icon-icon-base"
                icon={<IconV2 name="outline-chevron-down" class="rotate-90" />}
                onClick={clearSelectedProject}
                aria-label={language.t("home.projects.back")}
              />
              <HomeProjectAvatar project={project()} class="size-7 shrink-0 rounded-[8px]" />
              <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-v2-text-text-base [font-weight:560]">
                {displayName(project())}
              </span>
            </div>
          )}
        </Show>
        <HomeSessionSearch
          value={state.search}
          placeholder={language.t("home.sessions.search.placeholder")}
          onInput={(value) => setState("search", value)}
          clearLabel={language.t("common.clear")}
          onClear={() => setState("search", "")}
        />
        <div class="mt-3 overflow-auto flex-1">
          <div class="pt-3 flex flex-col gap-6">
            <Show
              when={!sessionLoad.isLoading}
              fallback={<HomeSessionSkeleton label={language.t("common.loading")} />}
            >
              <Switch>
                <Match when={groups().length === 0 && search().length > 0}>
                  <HomeEmptyState
                    status
                    icon="magnifying-glass"
                    title={language.t("home.sessions.search.empty")}
                    description={language.t("home.sessions.search.empty.description")}
                  />
                </Match>
                <Match when={groups().length === 0}>
                  <HomeEmptyState
                    icon="edit"
                    title={language.t("home.sessions.empty")}
                    description={language.t("home.sessions.empty.description")}
                    action={language.t("command.session.new")}
                    actionVariant="primary"
                    onAction={openNewSession}
                  />
                </Match>
                <Match when={true}>
                  <For each={groups()}>
                    {(group, index) => (
                      <div class="flex min-w-0 flex-col gap-4">
                        <HomeSessionGroupHeader
                          title={group.title}
                          onNewSession={index() === 0 ? openNewSession : undefined}
                        />
                        <div class="flex min-w-0 flex-col gap-2 lg:gap-px">
                          <For each={group.sessions}>
                            {(record) => (
                              <HomeSessionRow
                                record={record}
                                projectSelected={projectSelected()}
                                openSession={openSession}
                              />
                            )}
                          </For>
                        </div>
                      </div>
                    )}
                  </For>
                </Match>
              </Switch>
            </Show>
          </div>
        </div>
      </>
    )
  }
}

function HomeProjectColumn(props: {
  class?: string
  hasProjects: boolean
  selectedProject?: string
  selectProject: (directory: string) => void
  openNewSession: (directory: string) => void
  chooseProject: () => void
  editProject: (project: LocalProject) => void
  closeProject: (directory: string) => void
  clearNotifications: (project: LocalProject) => void
  unseenCount: (project: LocalProject) => number
  openSettings: () => void
  openHelp: () => void
  language: ReturnType<typeof useLanguage>
}) {
  const servers = useServers()
  const layout = useLayout()
  const projects = createMemo(() => layout.projects.list())
  return (
    <aside
      class={`min-w-0 flex-col lg:flex lg:pt-[52px] gap-4 ${props.class ?? "flex"}`}
      aria-label={props.language.t("home.projects")}
    >
      <div class="flex h-7 min-w-0 items-center justify-between pl-1.5">
        <div class={HOME_SECTION_LABEL}>{props.language.t("home.projects")}</div>
        <Show when={props.hasProjects}>
          <IconButtonV2
            data-action="home-add-project"
            variant="ghost-muted"
            size="large"
            class="titlebar-icon [&_[data-slot=icon-svg]]:text-v2-icon-icon-muted"
            icon={<IconV2 name="folder-add-left" />}
            onClick={props.chooseProject}
            aria-label={props.language.t("home.project.add")}
          />
        </Show>
      </div>
      <Show
        when={servers.list().length > 1}
        fallback={
          <HomeProjectListViewport>
            <ProjectList
              projects={projects()}
              selectedProject={props.selectedProject}
              showEmptyFallback={false}
              onSelectedProjectChange={props.selectProject}
              onChooseProject={props.chooseProject}
              openNewSession={props.openNewSession}
              editProject={props.editProject}
              closeProject={props.closeProject}
              clearNotifications={props.clearNotifications}
              unseenCount={props.unseenCount}
              language={props.language}
            />
          </HomeProjectListViewport>
        }
      >
        <For each={servers.list()}>
          {(server) => {
            const key = ServerConnection.key(server)
            const healthy = () => !!servers.health[key]?.healthy
            const [open, setOpen] = createSignal(true)

            return (
              <div class="max-h-[min(572px,calc(100vh_-_300px))] min-w-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <div class="relative h-7 group">
                  <button
                    class="w-full h-full px-1.5 gap-2 flex flex-row items-center hover:not-disabled:bg-v2-overlay-simple-overlay-hover rounded-[4px]"
                    disabled={!healthy()}
                    onClick={() => setOpen((o) => !o)}
                  >
                    <div class="size-4 flex items-center justify-center">
                      <ServerHealthIndicator health={servers.health[key]} />
                    </div>
                    <div class="flex flex-row items-center gap-1">
                      <span>{server.displayName ?? new URL(server.http.url).host}</span>
                      <Show when={healthy()}>
                        <IconV2
                          name="outline-chevron-down"
                          class="text-v2-icon-icon-muted data-[open=false]:-rotate-90"
                          data-open={open()}
                        />
                      </Show>
                    </div>
                  </button>
                  <IconButtonV2
                    class="absolute right-1 inset-y-1 opacity-0 group-hover:opacity-100"
                    name="out"
                    variant="ghost-muted"
                    size="small"
                    icon={<IconV2 name="outline-dots" class="text-v2-icon-icon-muted" />}
                  />
                </div>
                <Show when={healthy() && open()}>
                  <div class="h-px bg-v2-border-border-base mx-3 my-1" />
                  <HomeProjectListViewport>
                    <ProjectList
                      projects={projects()}
                      selectedProject={props.selectedProject}
                      showEmptyFallback={true}
                      onSelectedProjectChange={props.selectProject}
                      onChooseProject={props.chooseProject}
                      openNewSession={props.openNewSession}
                      editProject={props.editProject}
                      closeProject={props.closeProject}
                      clearNotifications={props.clearNotifications}
                      unseenCount={props.unseenCount}
                      language={props.language}
                    />
                  </HomeProjectListViewport>
                </Show>
              </div>
            )
          }}
        </For>
      </Show>
      <div class="flex min-w-0 flex-col gap-1">
        <button
          type="button"
          class={`${HOME_PROJECT_NAV_ROW} text-v2-text-text-base [&>[data-slot=icon-svg]]:text-v2-icon-icon-base`}
          onClick={props.openSettings}
        >
          <IconV2 name="settings-gear" size="small" />
          <span>{props.language.t("sidebar.settings")}</span>
        </button>
        <button
          type="button"
          class={`${HOME_PROJECT_NAV_ROW} text-v2-text-text-base [&>[data-slot=icon-svg]]:text-v2-icon-icon-base`}
          onClick={props.openHelp}
        >
          <IconV2 name="help" size="small" />
          <span>{props.language.t("sidebar.help")}</span>
        </button>
      </div>
    </aside>
  )
}

function HomeProjectListViewport(props: { children: JSX.Element }) {
  return (
    <div class="max-h-[min(288px,36vh)] min-w-0 overflow-y-auto pr-1 [scrollbar-width:none] lg:max-h-none lg:overflow-visible lg:pr-0 [&::-webkit-scrollbar]:hidden">
      {props.children}
    </div>
  )
}

function HomeProjectRow(props: {
  project: LocalProject
  selected: boolean
  unseenCount: number
  selectProject: (directory: string) => void
  openNewSession: (directory: string) => void
  editProject: (project: LocalProject) => void
  closeProject: (directory: string) => void
  clearNotifications: (project: LocalProject) => void
  language: ReturnType<typeof useLanguage>
}) {
  const name = createMemo(() => displayName(props.project))
  const directoryName = createMemo(() => projectDirectoryName(props.project.worktree))
  const [menuOpen, setMenuOpen] = createSignal(false)

  return (
    <div class="group/project relative flex min-h-16 min-w-0 items-center rounded-[12px] lg:h-8 lg:min-h-0 lg:rounded-[6px]">
      <button
        type="button"
        data-component="home-project-row"
        class="peer flex min-h-16 w-full min-w-0 shrink-0 cursor-default items-center gap-3 rounded-[12px] bg-v2-background-bg-deep px-2.5 py-2.5 pr-24 text-left text-v2-text-text-muted shadow-[var(--v2-elevation-raised)] transition-[background-color,box-shadow] duration-[120ms] ease-in-out hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none lg:h-7 lg:min-h-0 lg:gap-2 lg:rounded-[6px] lg:bg-transparent lg:px-1.5 lg:py-0 lg:pr-16 lg:shadow-none"
        classList={{
          "bg-v2-overlay-simple-overlay-hover shadow-[0_0_0_0.5px_var(--v2-border-border-focus),var(--v2-elevation-raised)] lg:shadow-none":
            props.selected,
        }}
        data-selected={props.selected ? "" : undefined}
        aria-current={props.selected ? "page" : undefined}
        onClick={() => props.selectProject(props.project.worktree)}
      >
        <HomeProjectAvatar project={props.project} />
        <span class="flex min-w-0 flex-1 flex-col gap-0.5 lg:block">
          <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-v2-text-text-base [font-weight:560] lg:[font-weight:inherit]">
            {name()}
          </span>
          <Show when={directoryName() !== name()}>
            <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-v2-text-text-muted [font-weight:440] lg:hidden">
              {directoryName()}
            </span>
          </Show>
        </span>
        <Show when={props.unseenCount > 0}>
          <span class="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-text-interactive-base px-1.5 text-[11px] leading-none text-text-on-interactive-base [font-weight:650] lg:hidden">
            {Math.min(props.unseenCount, 99)}
          </span>
        </Show>
      </button>
      <div
        class="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 opacity-100 transition-opacity lg:right-1 lg:gap-0.5 lg:opacity-0 lg:group-hover/project:opacity-100 lg:peer-focus-visible:opacity-100 lg:focus-within:opacity-100 lg:data-[menu=true]:opacity-100"
        data-menu={menuOpen()}
      >
        <MenuV2 gutter={4} modal={false} placement="bottom-end" open={menuOpen()} onOpenChange={setMenuOpen}>
          <MenuV2.Trigger
            as={IconButtonV2}
            data-action="home-project-menu"
            variant="ghost-muted"
            size="small"
            icon={<IconV2 name="outline-dots" />}
            aria-label={props.language.t("common.moreOptions")}
          />
          <MenuV2.Portal>
            <MenuV2.Content>
              <MenuV2.Item onSelect={() => props.openNewSession(props.project.worktree)}>
                {props.language.t("command.session.new")}
              </MenuV2.Item>
              <MenuV2.Item onSelect={() => props.editProject(props.project)}>
                {props.language.t("common.edit")}
              </MenuV2.Item>
              <MenuV2.Item disabled={props.unseenCount === 0} onSelect={() => props.clearNotifications(props.project)}>
                {props.language.t("sidebar.project.clearNotifications")}
              </MenuV2.Item>
              <MenuV2.Separator />
              <MenuV2.Item onSelect={() => props.closeProject(props.project.worktree)}>
                {props.language.t("common.close")}
              </MenuV2.Item>
            </MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
        <IconButtonV2
          data-action="home-project-new-session"
          variant="ghost-muted"
          size="small"
          icon={<IconV2 name="edit" />}
          aria-label={props.language.t("command.session.new")}
          onClick={(event) => {
            event.stopPropagation()
            props.openNewSession(props.project.worktree)
          }}
        />
      </div>
    </div>
  )
}

function HomeProjectAvatar(props: { project: LocalProject; class?: string }) {
  const name = createMemo(() => displayName(props.project))
  return (
    <AvatarV2
      fallback={name()}
      src={getProjectAvatarSource(props.project.id, props.project.icon)}
      kind="org"
      size="small"
      {...getAvatarColors(props.project.icon?.color)}
      class={props.class ?? "size-10 rounded-[10px] lg:size-4 lg:rounded"}
    />
  )
}

function projectDirectoryName(directory: string) {
  return getFilename(directory)
}

function HomeSessionSearch(props: {
  value: string
  placeholder: string
  clearLabel: string
  onInput: (value: string) => void
  onClear: () => void
}) {
  return (
    <label class="ml-4 flex h-9 w-[calc(100%_-_48px)] sticky top-0 inset-x-0 items-center gap-2 rounded-[6px] bg-v2-background-bg-deep px-3 py-1 text-v2-icon-icon-muted transition-[background-color,box-shadow] duration-[120ms] ease-in-out focus-within:bg-v2-background-bg-base focus-within:shadow-[0_0_0_0.5px_var(--v2-border-border-focus),var(--v2-elevation-raised)]">
      <IconV2 name="magnifying-glass" size="small" />
      <input
        class="min-w-0 flex-1 border-0 bg-transparent text-v2-text-text-base outline-0 [font-weight:440] placeholder:text-v2-text-text-faint"
        value={props.value}
        placeholder={props.placeholder}
        aria-label={props.placeholder}
        onInput={(event) => props.onInput(event.currentTarget.value)}
      />
      <Show when={props.value.trim()}>
        <button
          type="button"
          class="flex size-5 shrink-0 items-center justify-center rounded text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
          aria-label={props.clearLabel}
          onClick={(event) => {
            event.preventDefault()
            props.onClear()
          }}
        >
          <Icon name="close-small" size="small" />
        </button>
      </Show>
    </label>
  )
}

function HomeEmptyState(props: {
  icon: Parameters<typeof IconV2>[0]["name"]
  title: string
  description: string
  action?: string
  actionVariant?: "primary" | "neutral"
  onAction?: () => void
  hint?: string
  status?: boolean
}) {
  return (
    <div class="flex min-h-[320px] flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <div class="flex size-10 items-center justify-center rounded-[10px] bg-v2-background-bg-deep text-v2-icon-icon-muted shadow-[var(--v2-elevation-raised)]">
        <Show when={props.status && props.icon === "folder-add-left"} fallback={<IconV2 name={props.icon} />}>
          <Spinner class="size-[18px]" />
        </Show>
      </div>
      <div class="flex max-w-[320px] flex-col gap-1">
        <div class="text-v2-text-text-base [font-weight:530]">{props.title}</div>
        <div class="text-v2-text-text-muted [font-weight:440]">{props.description}</div>
      </div>
      <Show when={props.action && props.onAction}>
        <ButtonV2
          variant={props.actionVariant === "primary" ? "contrast" : "neutral"}
          size="normal"
          icon={props.icon}
          onClick={() => props.onAction?.()}
        >
          {props.action}
        </ButtonV2>
      </Show>
      <Show when={props.hint}>
        <div class="max-w-[320px] text-v2-text-text-muted [font-weight:440]">{props.hint}</div>
      </Show>
    </div>
  )
}

function HomeSessionGroupHeader(props: { title: string; onNewSession?: () => void }) {
  const language = useLanguage()
  return (
    <div class="flex h-7 min-w-0 items-center justify-between px-4">
      <div class={HOME_SECTION_LABEL}>{props.title}</div>
      <Show when={props.onNewSession}>
        {(onNewSession) => (
          <ButtonV2
            data-action="home-new-session"
            variant="ghost"
            size="normal"
            icon="edit"
            class="h-7 px-2 text-v2-text-text-muted"
            onClick={onNewSession()}
          >
            {language.t("command.session.new")}
          </ButtonV2>
        )}
      </Show>
    </div>
  )
}

function HomeSessionRow(props: {
  record: HomeSessionRecord
  projectSelected: boolean
  openSession: (session: Session) => void
}) {
  const serverSync = useServerSync()
  const notification = useNotification()
  const permission = usePermission()
  const [sessionStore] = serverSync.child(props.record.session.directory, { bootstrap: false })
  const title = createMemo(() => sessionTitle(props.record.session.title) || props.record.session.id)
  const unseenCount = createMemo(() => notification.session.unseenCount(props.record.session.id))
  const hasError = createMemo(() => notification.session.unseenHasError(props.record.session.id))
  const hasPermissions = createMemo(
    () =>
      !!sessionPermissionRequest(sessionStore.session, sessionStore.permission, props.record.session.id, (item) => {
        return !permission.autoResponds(item, props.record.session.directory)
      }),
  )
  const isWorking = createMemo(() => {
    if (hasPermissions()) return false
    return sessionStore.session_working(props.record.session.id)
  })
  const tint = createMemo(() => messageAgentColor(sessionStore.message[props.record.session.id], sessionStore.agent))
  const showStatus = createMemo(() => isWorking() || hasPermissions() || hasError() || unseenCount() > 0)
  const language = useLanguage()
  const timestamp = createMemo(() =>
    formatChatTimestamp(props.record.session.time.updated ?? props.record.session.time.created, language),
  )
  // No cheap last-message snippet exists in memory (home only loads session metadata,
  // not messages), so the secondary line shows the owning project name on the
  // all-projects list. In a project's detail view the header already names the
  // project, so the preview line is dropped to avoid a column of repeated text.
  const preview = createMemo(() => (props.projectSelected ? undefined : props.record.projectName))

  // Defined as a component (not a shared JSX node) so it can render in both the
  // mobile and desktop layouts; a reused JSX node would only mount in one place.
  // `suppressUnseenDot` hides the plain unseen-blue-dot branch where an inline
  // unread count pill already represents that state (mobile detail view), so we
  // never show both a dot and a pill for the same "unseen + idle" state.
  const StatusDot = (dotProps?: { suppressUnseenDot?: boolean }) => (
    <Show when={showStatus()}>
      <div
        class="flex size-4 shrink-0 items-center justify-center"
        style={{ color: tint() ?? "var(--icon-interactive-base)" }}
      >
        <Switch>
          <Match when={isWorking()}>
            <Spinner class="size-[15px]" />
          </Match>
          <Match when={hasPermissions()}>
            <div class="size-1.5 rounded-full bg-surface-warning-strong" />
          </Match>
          <Match when={hasError()}>
            <div class="size-1.5 rounded-full bg-text-diff-delete-base" />
          </Match>
          <Match when={!dotProps?.suppressUnseenDot && unseenCount() > 0}>
            <div class="size-1.5 rounded-full bg-text-interactive-base" />
          </Match>
        </Switch>
      </div>
    </Show>
  )

  return (
    <button
      type="button"
      data-component="home-session-row"
      class={`${HOME_ROW} min-h-16 gap-3 rounded-[12px] bg-v2-background-bg-deep px-3 py-2.5 shadow-[var(--v2-elevation-raised)] lg:h-10 lg:min-h-0 lg:gap-2 lg:rounded-[6px] lg:bg-transparent lg:px-6 lg:py-3 lg:pl-4 lg:shadow-none`}
      onClick={() => props.openSession(props.record.session)}
    >
      {/* Mobile: Telegram-style chat row — avatar, bold title + muted preview, trailing time + badge. */}
      <HomeProjectAvatar project={props.record.project} class="size-11 shrink-0 rounded-full lg:hidden" />
      <span class="flex min-w-0 flex-1 flex-col gap-0.5 lg:hidden">
        <span class="flex min-w-0 items-center gap-2">
          {/* Suppress the unseen blue dot when the inline count pill below already shows it. */}
          <StatusDot suppressUnseenDot={!preview()} />
          <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-v2-text-text-base [font-weight:560]">
            {title()}
          </span>
          <span class="shrink-0 text-[12px] text-v2-text-text-faint [font-weight:440]">{timestamp()}</span>
          {/* In the detail view there is no second line, so the badge sits inline with the title. */}
          <Show when={!preview() && unseenCount() > 0}>
            <span class="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-text-interactive-base px-1.5 text-[11px] leading-none text-text-on-interactive-base [font-weight:650]">
              {Math.min(unseenCount(), 99)}
            </span>
          </Show>
        </span>
        <Show when={preview()}>
          {(previewText) => (
            <span class="flex min-w-0 items-center gap-2">
              <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-v2-text-text-muted [font-weight:440]">
                {previewText()}
              </span>
              <Show when={unseenCount() > 0}>
                <span class="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-text-interactive-base px-1.5 text-[11px] leading-none text-text-on-interactive-base [font-weight:650]">
                  {Math.min(unseenCount(), 99)}
                </span>
              </Show>
            </span>
          )}
        </Show>
      </span>

      {/* Desktop: unchanged compact row. */}
      <span class="hidden min-w-0 items-center gap-2 lg:flex lg:flex-1">
        <StatusDot />
        <span
          class={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-v2-text-text-base [font-weight:530] ${props.record.projectName ? "max-w-[min(70%,480px)] flex-[0_1_auto]" : "flex-[1_1_auto]"}`}
        >
          {title()}
        </span>
        <Show when={props.record.projectName}>
          <span class="min-w-0 flex-[1_1_auto] overflow-hidden text-ellipsis whitespace-nowrap text-v2-text-text-muted [font-weight:440]">
            {props.record.projectName}
          </span>
        </Show>
      </span>
    </button>
  )
}

function formatChatTimestamp(millis: number, language: ReturnType<typeof useLanguage>): string {
  // Localize via the app's current Intl locale (e.g. "zh-Hans") so weekday/month/
  // date/time read correctly for non-English users; keep the translated "Yesterday".
  const time = DateTime.fromMillis(millis).setLocale(language.intl())
  if (!time.isValid) return ""
  const now = DateTime.local()
  if (time.hasSame(now, "day")) return time.toLocaleString(DateTime.TIME_SIMPLE)
  if (time.hasSame(now.minus({ days: 1 }), "day")) return language.t("home.sessions.group.yesterday")
  if (time > now.minus({ days: 7 })) return time.toFormat("ccc")
  if (time.hasSame(now, "year")) return time.toFormat("d LLL")
  return time.toLocaleString(DateTime.DATE_SHORT)
}

function HomeSessionSkeleton(props: { label: string }) {
  return (
    <div class="flex min-w-0 flex-col gap-4">
      <div class="flex h-7 min-w-0 items-center justify-between px-4">
        <div class={HOME_SECTION_LABEL}>{props.label}</div>
      </div>
      <div class="flex min-w-0 flex-col gap-px" aria-hidden="true">
        <For each={[0, 1, 2, 3]}>{() => <div class="h-10 rounded-[6px] bg-v2-background-bg-deep opacity-70" />}</For>
      </div>
    </div>
  )
}

function groupSessions(records: HomeSessionRecord[], language: ReturnType<typeof useLanguage>): HomeSessionGroup[] {
  const now = DateTime.local()
  const yesterday = now.minus({ days: 1 })
  const todaySessions = records.filter((record) =>
    DateTime.fromMillis(record.session.time.updated ?? record.session.time.created).hasSame(now, "day"),
  )
  const yesterdaySessions = records.filter((record) =>
    DateTime.fromMillis(record.session.time.updated ?? record.session.time.created).hasSame(yesterday, "day"),
  )
  const olderSessions = records.filter((record) => {
    const time = DateTime.fromMillis(record.session.time.updated ?? record.session.time.created)
    return !time.hasSame(now, "day") && !time.hasSame(yesterday, "day")
  })
  const olderTitle =
    todaySessions.length === 0 && yesterdaySessions.length === 0
      ? language.t("sidebar.project.recentSessions")
      : language.t("home.sessions.group.older")

  return [
    { id: "today" as const, title: language.t("home.sessions.group.today"), sessions: todaySessions },
    { id: "yesterday" as const, title: language.t("home.sessions.group.yesterday"), sessions: yesterdaySessions },
    { id: "older" as const, title: olderTitle, sessions: olderSessions },
  ].filter((group) => group.sessions.length > 0)
}

function LegacyHome() {
  const sync = useServerSync()
  const layout = useLayout()
  const platform = usePlatform()
  const dialog = useDialog()
  const navigate = useNavigate()
  const servers = useServers()
  const server = useServer()
  const language = useLanguage()
  const homedir = createMemo(() => sync.data.path.home)
  const recent = createMemo(() => {
    return sync.data.project
      .slice()
      .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
      .slice(0, 5)
  })

  const serverDotClass = createMemo(() => {
    const healthy = servers.health[server.key]?.healthy
    if (healthy === true) return "bg-icon-success-base"
    if (healthy === false) return "bg-icon-critical-base"
    return "bg-border-weak-base"
  })

  function openProject(directory: string) {
    layout.projects.open(directory)
    server.projects.touch(directory)
    navigate(`/${base64Encode(directory)}`)
  }

  async function chooseProject() {
    function resolve(result: string | string[] | null) {
      if (Array.isArray(result)) {
        for (const directory of result) {
          openProject(directory)
        }
      } else if (result) {
        openProject(result)
      }
    }

    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform.openDirectoryPickerDialog?.({
        title: language.t("command.project.open"),
        multiple: true,
      })
      resolve(result)
    } else {
      dialog.show(
        () => <DialogSelectDirectory multiple={true} onSelect={resolve} />,
        () => resolve(null),
      )
    }
  }

  return (
    <div class="mx-auto mt-55 w-full md:w-auto px-4">
      <Logo class="md:w-xl opacity-12" />
      <Button
        size="large"
        variant="ghost"
        class="mt-4 mx-auto text-14-regular text-text-weak"
        onClick={() => dialog.show(() => <DialogSelectServer />)}
      >
        <div
          classList={{
            "size-2 rounded-full": true,
            [serverDotClass()]: true,
          }}
        />
        {server.name}
      </Button>
      <Switch>
        <Match when={sync.data.project.length > 0}>
          <div class="mt-20 w-full flex flex-col gap-4">
            <div class="flex gap-2 items-center justify-between pl-3">
              <div class="text-14-medium text-text-strong">{language.t("home.recentProjects")}</div>
              <Button icon="folder-add-left" size="normal" class="pl-2 pr-3" onClick={chooseProject}>
                {language.t("command.project.open")}
              </Button>
            </div>
            <ul class="flex flex-col gap-2">
              <For each={recent()}>
                {(project) => (
                  <Button
                    size="large"
                    variant="ghost"
                    class="text-14-mono text-left justify-between px-3"
                    onClick={() => openProject(project.worktree)}
                  >
                    {project.worktree.replace(homedir(), "~")}
                    <div class="text-14-regular text-text-weak">
                      {DateTime.fromMillis(project.time.updated ?? project.time.created).toRelative()}
                    </div>
                  </Button>
                )}
              </For>
            </ul>
          </div>
        </Match>
        <Match when={!sync.ready}>
          <div class="mt-30 mx-auto flex flex-col items-center gap-3">
            <div class="text-12-regular text-text-weak">{language.t("common.loading")}</div>
            <Button class="px-3" onClick={chooseProject}>
              {language.t("command.project.open")}
            </Button>
          </div>
        </Match>
        <Match when={true}>
          <div class="mt-30 mx-auto flex flex-col items-center gap-3">
            <Icon name="folder-add-left" size="large" />
            <div class="flex flex-col gap-1 items-center justify-center">
              <div class="text-14-medium text-text-strong">{language.t("home.empty.title")}</div>
              <div class="text-12-regular text-text-weak">{language.t("home.empty.description")}</div>
            </div>
            <Button class="px-3 mt-1" onClick={chooseProject}>
              {language.t("command.project.open")}
            </Button>
          </div>
        </Match>
      </Switch>
    </div>
  )
}

function ProjectList(props: {
  projects: LocalProject[]
  selectedProject?: string
  showEmptyFallback?: boolean
  onSelectedProjectChange?(project: string): void
  onChooseProject?(): void
  openNewSession: (directory: string) => void
  editProject: (project: LocalProject) => void
  closeProject: (directory: string) => void
  clearNotifications: (project: LocalProject) => void
  unseenCount: (project: LocalProject) => number
  language: ReturnType<typeof useLanguage>
}) {
  return (
    <Show
      when={props.projects.length > 0}
      fallback={
        <Show when={props.showEmptyFallback}>
          <button
            type="button"
            class={`${HOME_PROJECT_NAV_ROW} text-v2-text-text-base [&>[data-slot=icon-svg]]:text-v2-icon-icon-base`}
            onClick={() => props.onChooseProject?.()}
          >
            <IconV2 name="folder-add-left" size="small" />
            <span>{props.language.t("home.project.add")}</span>
          </button>
        </Show>
      }
    >
      <div class="flex flex-col gap-1">
        <For each={props.projects}>
          {(project) => (
            <HomeProjectRow
              project={project}
              selected={props.selectedProject === project.worktree}
              unseenCount={props.unseenCount(project)}
              selectProject={(directory) => props.onSelectedProjectChange?.(directory)}
              openNewSession={props.openNewSession}
              editProject={props.editProject}
              closeProject={props.closeProject}
              clearNotifications={props.clearNotifications}
              language={props.language}
            />
          )}
        </For>
      </div>
    </Show>
  )
}
