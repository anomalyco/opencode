import type { SessionInfo } from "@opencode/client/promise"
import { createEffect, createMemo, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { DialogStoryRuntime, STORY_PROJECTS, STORY_SERVER } from "@/components-lab/dialog-story-runtime"
import { normalizeProjectInfo } from "@/runtime/server/global-sync/utils"
import { useServer } from "@/runtime/server/current"
import { useLanguage } from "@/runtime/i18n/language"
import { SettingsSurfaceProvider } from "@/settings/surface"
import type { HomeController } from "./model"
import { createHomeProjectsController } from "./projects/controller"
import { HomeView } from "./route"
import { groupSessions, type HomeSessionsController } from "./sessions/controller"
import type { HomeSessionsListView } from "./sessions/load-machine"
import { buildHomeSessionRecords, homeSessionLocation } from "./sessions/records"
import { createHomeSessionSearchController } from "./sessions/search"

const scenarios = ["populated", "loading", "empty", "offline"] as const

type HomeArgs = { scenario: (typeof scenarios)[number]; project: string; search: string }

const projects = STORY_PROJECTS.map(normalizeProjectInfo)

function recentSessions(): SessionInfo[] {
  const titles = [
    [0, 0, "Review the session location picker"],
    [1, 0, "Document the worktree setup steps"],
    [2, 0, "Update the release notes page"],
    [0, 1, "Keep search focused when switching projects"],
    [1, 1, "Review the provider setup guide"],
    [2, 4, "Polish mobile navigation"],
  ] as const

  return titles.map(([index, daysAgo, title], i) => {
    const project = projects[index]

    const day = new Date()
    day.setDate(day.getDate() - daysAgo)
    day.setHours(10, 30 - i, 0, 0)

    return {
      id: `ses_home_${i}`,
      projectID: project.id,
      title,
      location: { directory: project.worktree },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: +day, updated: +day },
    }
  })
}

function HomeStory(props: HomeArgs) {
  const server = useServer()

  const language = useLanguage()

  const [state, setState] = createStore<{
    directory?: string
    scenario: HomeArgs["scenario"]
    activity: string
    visible: typeof projects
    sessions: SessionInfo[]
  }>({
    scenario: props.scenario,
    activity: "",
    visible: projects,
    sessions: recentSessions(),
  })

  const visible = () => state.visible

  const directory = () => state.directory

  const setDirectory = (value?: string) => setState("directory", value)

  const setActivity = (value: string) => setState("activity", value)

  const selected = createMemo(() => visible().find((project) => project.worktree === directory()))

  createEffect(
    on(
      () => props.scenario,
      (next) => {
        setState({ scenario: next, visible: projects, sessions: recentSessions(), activity: "" })
      },
    ),
  )
  createEffect(
    on(
      () => props.project,
      (name) => setDirectory(projects.find((item) => item.name === name)?.worktree),
    ),
  )

  const home: HomeController = {
    selection: {
      value: () => ({ server: server.key, directory: directory() }),
      focusServer: () => setDirectory(undefined),
    },
    server: {
      list: () => [STORY_SERVER],
      focused: () => STORY_SERVER,
      health: () => (state.scenario === "offline" ? { type: "unreachable" } : { type: "healthy" }),
      label: () => "This computer",
      context: () => server.ctx,
      focusedContext: () => server.ctx,
      focusedSync: () => server.ctx.sync,
    },
    project: {
      list: visible,
      forServer: visible,
      selected,
      newSession: () => selected() ?? visible()[0],
      select: (_, next) => setDirectory(directory() === next ? undefined : next),
      add: (_, directories) => {
        const added = projects.filter((item) => directories.includes(item.worktree))
        setState("visible", (items) => [
          ...items,
          ...added.filter((project) => !items.some((item) => item.id === project.id)),
        ])
        setDirectory(added[0]?.worktree)
      },
      openNewSession: () => setActivity(`New session in ${selected()?.name ?? visible()[0]?.name}`),
      openProjectNewSession: (_, path) => setActivity(`New session in ${path}`),
      openProjectSession: (_, _path, session) => setActivity(`Opened ${session.title}`),
    },
  }

  const navigation = createHomeProjectsController(home)

  const records = createMemo(() =>
    buildHomeSessionRecords({
      sessions: () => (state.scenario === "populated" ? state.sessions : []),
      projectDirectories: () => {
        const project = selected()

        return project && [project.worktree, ...project.sandboxes]
      },
      projects: visible,
    }),
  )

  const listView = (): HomeSessionsListView => {
    if (state.scenario === "offline") return { status: "unavailable", reason: "offline" }

    if (state.scenario === "loading") return { status: "loading", skeleton: true }

    return { status: "ready", revealing: false }
  }

  const recent: HomeSessionsController = {
    copy: { language },
    platform: { desktop: true },
    tab: { isOpen: () => false },
    location: { value: (record) => homeSessionLocation(record.session.location.directory, "main"), sync() {} },
    data: {
      listView,
      records,
      groups: createMemo(() => groupSessions(records(), language)),
      searchRecords: records,
      loading: () => state.scenario === "loading",
      retry: () => setState("scenario", "populated"),
    },
    session: {
      server: () => server.key,
      canCreate: () => visible().length > 0 && state.scenario !== "offline",
      showProjectName: () => !selected(),
      lookup: async (id) => records().find((record) => record.session.id === id),
      create: home.project.openNewSession,
      open: (session) => setActivity(`Opened ${session.title}`),
      archive: async () => {},
      rename: async (_, session, title) => {
        setState("sessions", (item) => item.id === session.id, "title", title)

        return true
      },
      export: (_, session) => setActivity(`Export ${session.title}`),
      exporting: () => false,
      showDelete: async (_, session) => setActivity(`Delete ${session.title}`),
    },
  }

  const search = createHomeSessionSearchController(home, recent)

  createEffect(
    on(
      () => props.search,
      (value) => {
        search.query.close()

        if (!value || value === "none") return

        // The inspector selects a preset on pointerdown. Let Home finish handling that outside press before opening search.
        const frame = requestAnimationFrame(() => {
          search.query.input(value)
          search.query.focus()
        })

        onCleanup(() => cancelAnimationFrame(frame))
      },
    ),
  )

  return (
    <div class="relative flex h-dvh min-h-0 w-full flex-col bg-v2-background-bg-deep">
      <HomeView
        projects={{
          ...navigation,
          utility: { settings: () => setActivity("Opened settings"), help: () => setActivity("Opened help") },
          project: {
            ...navigation.project,
            openNewSession: home.project.openProjectNewSession,
            edit: (_, project) => setActivity(`Edit ${project.name}`),
            hide: (_, project) => {
              setState("visible", (items) => items.filter((item) => item.worktree !== project.worktree))

              if (directory() === project.worktree) setDirectory(undefined)
            },
          },
        }}
        sessions={recent}
        search={search}
      />
      <Show when={state.activity}>
        <output class="absolute inset-x-4 bottom-4 text-center text-12-regular text-text-weak">{state.activity}</output>
      </Show>
    </div>
  )
}

export default {
  title: "App/Home",
  id: "app-home",
  parameters: { layout: "fullscreen" },
  args: { scenario: "populated", project: "all", search: "none" },
  argTypes: {
    scenario: { control: "select", options: scenarios },
    project: { control: "select", options: ["all", ...projects.map((project) => project.name)] },
    search: { control: "select", options: ["none", "review", "worktree", "billing"] },
  },
  render: (args: HomeArgs) => (
    <DialogStoryRuntime>
      <SettingsSurfaceProvider>
        <HomeStory {...args} />
      </SettingsSurfaceProvider>
    </DialogStoryRuntime>
  ),
}

export const Populated = {}

export const ProjectFilter = { args: { project: "docs" } }

export const SessionSearch = { args: { search: "review" } }

export const Loading = { args: { scenario: "loading" } }

export const Empty = { args: { scenario: "empty" } }

export const Offline = { args: { scenario: "offline" } }
