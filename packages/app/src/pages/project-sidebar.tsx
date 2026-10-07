import { createMemo, For, Show, startTransition, Suspense } from "solid-js"
import { createStore } from "solid-js/store"
import { useQuery } from "@tanstack/solid-query"
import { SessionProgressIndicatorV2 } from "@opencode-ai/session-ui/v2/session-progress-indicator-v2"
import { useGlobal } from "@/context/global"
import { useLayout, type LocalProject } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { ServerConnection } from "@/context/server"
import { useTabs } from "@/context/tabs"
import { loadHomeSessionIndex, type HomeSessionEvents } from "@/context/global-sync/home-session-index"
import { compareSessionTime } from "@/pages/layout/helpers"
import { useSessionTabAvatarState } from "@/pages/layout/project-avatar-state"
import { shouldOpenSessionInBackground } from "@/pages/home-session-open"
import { pathKey } from "@/utils/path-key"
import { sessionHref } from "@/utils/session-route"
import { sessionTitle } from "@/utils/session-title"
import { createHomeController } from "./home/home-controller"
import { createHomeProjectsController } from "./home/home-projects-controller"
import { HomeProjects } from "./home/home-projects"

export function ProjectSidebar() {
  const layout = useLayout()
  const language = useLanguage()
  const home = createHomeController()
  const projects = createHomeProjectsController(home)
  const [state, setState] = createStore({ collapsed: {} as Record<string, boolean> })
  const key = (server: ServerConnection.Any, project: LocalProject) =>
    `${ServerConnection.key(server)}\0${project.worktree}`

  return (
    <div
      id="project-sidebar"
      data-component="project-sidebar"
      aria-label={language.t("sidebar.nav.projectsAndSessions")}
      aria-hidden={!layout.sidebar.opened()}
      inert={!layout.sidebar.opened()}
      class="m-2 mr-0 w-[256px] max-w-[calc(100vw-32px)] shrink-0 overflow-hidden rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)] max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-40"
      classList={{ hidden: !layout.sidebar.opened() }}
    >
      <HomeProjects
        projects={projects}
        tree={{
          expanded: (server, project) => !state.collapsed[key(server, project)],
          toggle: (server, project) => setState("collapsed", key(server, project), (value) => !value),
          content: (server, project) => <ProjectSessions server={server} project={project} />,
        }}
      />
    </div>
  )
}

function ProjectSessions(props: { server: ServerConnection.Any; project: LocalProject }) {
  const global = useGlobal()
  const layout = useLayout()
  const language = useLanguage()
  const tabs = useTabs()
  const context = createMemo(() => global.ensureServerCtx(props.server))
  const cache = () => context().sync.homeSessions
  const [state, setState] = createStore({ limit: 5 })
  // Every project on the same server shares one index query and live event cache.
  const events = useQuery(() => ({
    queryKey: cache().eventsKey,
    queryFn: async (): Promise<HomeSessionEvents> => ({ sequence: 0, entries: [] }),
    initialData: { sequence: 0, entries: [] } satisfies HomeSessionEvents,
    enabled: false,
  }))
  const index = useQuery(() => ({
    queryKey: cache().indexKey,
    enabled: layout.sidebar.opened() && global.servers.health[ServerConnection.key(props.server)]?.healthy !== false,
    queryFn: async ({ signal }) => {
      const source = context()
      const current = source.sync.homeSessions
      const sequence = current.eventSequence()
      const result = await loadHomeSessionIndex(
        (input, options) => source.sdk.client.v2.session.list(input, options),
        sequence,
        signal,
      )
      current.complete(sequence)
      return result
    },
    staleTime: 30_000,
    retry: false,
  }))
  const sessions = createMemo(() => {
    const directories = new Set([props.project.worktree, ...(props.project.sandboxes ?? [])].map(pathKey))
    return cache()
      .sessions(index.data, events.data)
      .filter((session) => !session.parentID && !session.time.archived && directories.has(pathKey(session.directory)))
      .sort(compareSessionTime)
  })
  const selected = (id: string) => {
    const route = layout.route()
    return route.type === "session" && route.sessionId === id && route.server === ServerConnection.key(props.server)
  }
  const open = (event: MouseEvent, id: string) => {
    if (event.button !== 0 && event.button !== 1) return
    event.preventDefault()
    context().projects.touch(props.project.worktree)
    const tab = tabs.addSessionTab({ server: ServerConnection.key(props.server), sessionId: id })
    if (
      shouldOpenSessionInBackground({
        button: event.button,
        mac: /(Mac|iPod|iPhone|iPad)/.test(navigator.platform),
        meta: event.metaKey,
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
        alt: event.altKey,
      })
    )
      return
    void startTransition(() => tabs.select(tab))
  }

  return (
    <div data-component="project-sidebar-sessions" class="mb-2 min-w-0">
      <Suspense fallback={<div class="py-1 pl-8 text-v2-text-text-faint">{language.t("common.loading")}</div>}>
        <For each={sessions().slice(0, state.limit)}>
          {(session) => {
            const status = useSessionTabAvatarState(
              () => ServerConnection.key(props.server),
              () => session.directory,
              () => session.id,
            )
            return (
              <a
                data-component="project-sidebar-session"
                href={sessionHref(ServerConnection.key(props.server), session.id)}
                aria-current={selected(session.id) ? "page" : undefined}
                title={sessionTitle(session.title)}
                class="flex h-8 min-w-0 items-center gap-2 rounded-md pl-8 pr-2 text-[13px] font-normal text-v2-text-text-muted hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base focus-visible:outline-none focus-visible:bg-v2-background-bg-layer-01 focus-visible:shadow-[inset_0_0_0_0.5px_var(--v2-border-border-muted)]"
                classList={{ "bg-v2-background-bg-layer-03 text-v2-text-text-base": selected(session.id) }}
                onClick={(event) => open(event, session.id)}
                onAuxClick={(event) => {
                  if (event.button === 1) open(event, session.id)
                }}
              >
                <span class="min-w-0 flex-1 truncate">{sessionTitle(session.title)}</span>
                <Show when={status.loading()}>
                  <SessionProgressIndicatorV2 class="size-4 shrink-0" />
                </Show>
              </a>
            )
          }}
        </For>
        <Show when={sessions().length > state.limit}>
          <button
            type="button"
            data-action="project-sidebar-more"
            class="flex h-8 w-full items-center rounded-md pl-8 text-[13px] text-v2-text-text-faint hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base"
            onClick={() => setState("limit", (limit) => limit + 5)}
          >
            {language.t("common.loadMore")}
          </button>
        </Show>
        <Show when={index.isError}>
          <div role="status" class="py-1 pl-8 pr-2 text-v2-text-text-faint">
            {language.t("common.requestFailed")}
          </div>
        </Show>
      </Suspense>
    </div>
  )
}
