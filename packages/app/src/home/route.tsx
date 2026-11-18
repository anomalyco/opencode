import { ScrollView } from "@opencode/ui/scroll-view"
import { createMediaQuery } from "@solid-primitives/media"
import { Match, onMount, Show, Switch, type JSX } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { displayName } from "@opencode/ui/project-avatar"
import { useLanguage } from "@/runtime/i18n/language"
import { ProjectIcon } from "@/shell/layout/project-icon"
import { useLayout } from "@/shell/state/layout"
import { useSettings } from "@/settings/model"
import { useProjectNavigation } from "@/shell/project-navigation"
import { ProjectLanding } from "./projects/landing"
import { createHomeController } from "./model"
import { createHomeProjectsController } from "./projects/controller"
import { HomeUtilityNav } from "./projects/view"
import { HomeProjects } from "./projects/region"
import { createHomeScrollController } from "./scroll"
import { createHomeSessionSearchController } from "./sessions/search"
import { createHomeSessionsController } from "./sessions/controller"
import { HomeSessions } from "./sessions/region"

export function Home() {
  const settings = useSettings()

  const projectNavigation = useProjectNavigation()

  // Consolidated lists projects in the sidebar, so its Home is the session list alone.
  const consolidated = () =>
    settings.appearance.tabLayout() === "vertical" && settings.general.sidebarOrganize() === "consolidated"

  return (
    <Show when={settings.ready()}>
      <Switch fallback={<HomeOverview />}>
        <Match when={consolidated()}>
          <HomeOverview compact />
        </Match>
        <Match when={projectNavigation()}>
          <ProjectLanding />
        </Match>
      </Switch>
    </Show>
  )
}

function HomeOverview(props: { compact?: boolean }) {
  const layout = useLayout()
  const language = useLanguage()
  const home = createHomeController()
  const projects = createHomeProjectsController(home)
  const sessions = createHomeSessionsController(home)
  const search = createHomeSessionSearchController(home, sessions)

  const clear = (directory: string) => {
    const conn = home.server.focused()

    if (conn) home.project.select(conn, directory)
  }

  onMount(() => {
    if (layout.home.searchFocus.take()) search.query.focus()
  })

  return (
    <HomeView
      projects={projects}
      sessions={sessions}
      search={search}
      compact={props.compact}
      filter={
        <Show when={props.compact && home.server.focused() && home.project.selected()}>
          {(project) => (
            // The avatar sits 6px from the chip's edges and the 20px close button 4px, each equal on its three sides.
            // A middle click anywhere on the chip clears it, like closing a tab.
            <span
              class="pointer-events-auto flex h-7 min-w-0 max-w-[220px] items-center gap-1.5 rounded-[6px] bg-v2-background-bg-layer-01 ps-1.5 pe-1 text-v2-text-text-base [font-weight:440]"
              onMouseDown={(event) => {
                if (event.button === 1) event.preventDefault()
              }}
              onAuxClick={(event) => {
                if (event.button !== 1) return
                event.preventDefault()
                clear(project().worktree)
              }}
            >
              <span class="flex size-4 shrink-0 items-center justify-center">
                <ProjectIcon project={project()} />
              </span>
              <span class="min-w-0 truncate" dir="auto">
                {displayName(project())}
              </span>
              <IconButton
                variant="ghost-muted"
                size="small"
                icon={<Icon name="close" />}
                aria-label={language.t("common.clear")}
                onClick={() => clear(project().worktree)}
              />
            </span>
          )}
        </Show>
      }
    />
  )
}

export function HomeView(props: {
  projects: ReturnType<typeof createHomeProjectsController>
  sessions: ReturnType<typeof createHomeSessionsController>
  search: ReturnType<typeof createHomeSessionSearchController>
  /** Without the projects column and utility nav, for layouts whose sidebar already lists projects. */
  compact?: boolean
  filter?: JSX.Element
}) {
  const mobile = createMediaQuery("(max-width: 767px)")

  const scroll = createHomeScrollController(props.sessions.data.groups)

  return (
    <div
      data-slot="home-panel"
      class={`
        mx-[var(--shell-inline-inset,8px)] mb-[var(--shell-bottom-inset,8px)] mt-[var(--shell-top-inset,8px)] flex min-h-0 flex-1 flex-col self-stretch overflow-hidden rounded-[10px]
        bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]
      `}
    >
      <Show when={mobile() && !props.compact}>
        <div class="relative z-40 -mb-3 shrink-0 px-3 pt-3">
          <HomeProjects projects={props.projects} scroll={scroll} dropdown />
        </div>
      </Show>
      <ScrollView
        class="min-h-0 flex-1 [container-type:size]"
        thumbContainer={scroll.viewport.thumbTrack()}
        thumbHoverTarget={scroll.viewport.hoverTarget()}
        viewportRef={scroll.viewport.setViewport}
        onScroll={(event) => scroll.viewport.update(event.currentTarget.scrollTop)}
      >
        <div
          class={
            props.compact
              ? "mx-auto grid min-h-full w-full max-w-[768px] grid-rows-[minmax(0,1fr)] px-3 lg:px-6"
              : `
            mx-auto grid min-h-full w-full max-w-[1080px] grid-rows-[auto_minmax(0,1fr)] gap-4 px-3
            max-md:grid-rows-[minmax(0,1fr)] lg:grid-cols-[280px_minmax(0,720px)] lg:grid-rows-1 lg:gap-8 lg:px-6
          `
          }
        >
          <Show when={!mobile() && !props.compact}>
            <HomeProjects projects={props.projects} scroll={scroll} />
          </Show>
          <HomeSessions sessions={props.sessions} search={props.search} scroll={scroll} filter={props.filter} />
        </div>
      </ScrollView>
      <div class="hidden shrink-0 px-3 py-2 md:block lg:hidden" classList={{ "!hidden": !!props.compact }}>
        <HomeUtilityNav
          class="flex"
          onOpenSettings={props.projects.utility.settings}
          onOpenHelp={props.projects.utility.help}
          language={props.projects.copy.language}
        />
      </div>
    </div>
  )
}
