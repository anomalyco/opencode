import { ScrollView } from "@opencode/ui/scroll-view"
import { createMediaQuery } from "@solid-primitives/media"
import { onMount, Show } from "solid-js"
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

  return (
    <Show when={settings.ready()}>
      <Show when={projectNavigation()} fallback={<HomeOverview />}>
        <ProjectLanding />
      </Show>
    </Show>
  )
}

function HomeOverview() {
  const layout = useLayout()
  const settings = useSettings()
  const home = createHomeController()
  const projects = createHomeProjectsController(home)
  const sessions = createHomeSessionsController(home)
  const search = createHomeSessionSearchController(home, sessions, settings.appearance.navigationPrototype)

  onMount(() => {
    // The navigation prototype has no search dialog, so Home's search field starts focused.
    if (layout.home.searchFocus.take() || settings.appearance.navigationPrototype()) search.query.focus()
  })

  return (
    <HomeView
      projects={projects}
      sessions={sessions}
      search={search}
      searchInline={settings.appearance.navigationPrototype()}
      // The sidebar already lists sessions in side tabs and List, so Home drops its project column there and picks
      // the project from the search field instead. Top tabs have no sidebar and keep Home's column.
      projectScope={settings.appearance.navigationPrototype() && settings.appearance.tabLayout() === "vertical"}
    />
  )
}

export function HomeView(props: {
  projects: ReturnType<typeof createHomeProjectsController>
  sessions: ReturnType<typeof createHomeSessionsController>
  search: ReturnType<typeof createHomeSessionSearchController>
  /** The navigation prototype's project picker, at the end of the search field in place of the projects column. */
  projectScope?: boolean
  /** Search filters the list in place rather than opening a results panel. */
  searchInline?: boolean
}) {
  const mobile = createMediaQuery("(max-width: 767px)")

  const scroll = createHomeScrollController(props.search.result.groups)

  return (
    <div
      data-slot="home-panel"
      class={`
        mx-[var(--shell-inline-inset,8px)] mb-[var(--shell-bottom-inset,8px)] mt-[var(--shell-top-inset,8px)] flex min-h-0 flex-1 flex-col self-stretch overflow-hidden rounded-[10px]
        bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]
      `}
    >
      <Show when={mobile() && !props.projectScope}>
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
            props.projectScope
              ? "mx-auto grid min-h-full w-full max-w-[768px] grid-rows-[minmax(0,1fr)] px-3 lg:px-6"
              : `
            mx-auto grid min-h-full w-full max-w-[1080px] grid-rows-[auto_minmax(0,1fr)] gap-4 px-3
            max-md:grid-rows-[minmax(0,1fr)] lg:grid-cols-[280px_minmax(0,720px)] lg:grid-rows-1 lg:gap-8 lg:px-6
          `
          }
        >
          <Show when={!mobile() && !props.projectScope}>
            <HomeProjects projects={props.projects} scroll={scroll} />
          </Show>
          <HomeSessions
            sessions={props.sessions}
            search={props.search}
            scroll={scroll}
            searchScope={props.projectScope ? <HomeProjects projects={props.projects} dropdown scope /> : undefined}
            searchInline={props.searchInline}
          />
        </div>
      </ScrollView>
      <div class="hidden shrink-0 px-3 py-2 md:block lg:hidden" classList={{ "!hidden": props.projectScope }}>
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
