import { ScrollView } from "@opencode/ui/scroll-view"
import { createMediaQuery } from "@solid-primitives/media"
import { useNavigate } from "@solidjs/router"
import { createMemo, onMount, Show } from "solid-js"
import { useAutomationSource } from "@/automations/source"
import { useLayout } from "@/shell/state/layout"
import { useSettings } from "@/settings/model"
import { useProjectNavigation } from "@/shell/project-navigation"
import { createProviderTip, ProviderTip } from "@/providers/connect/tip"
import { ServerProvider } from "@/runtime/server/current"
import { useServers } from "@/runtime/server/registry"
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
  const automations = useAutomationSource()
  const navigate = useNavigate()
  const projects = createHomeProjectsController(home, {
    automations: { available: automations.available, open: () => navigate("/automations") },
  })
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
      providerTip
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
  providerTip?: boolean
}) {
  const mobile = createMediaQuery("(max-width: 767px)")
  // Between md and lg the projects column has no room beside the sessions, so the picker moves into the search field.
  const tablet = createMediaQuery("(min-width: 768px) and (max-width: 1023px)")
  const scoped = () => props.projectScope || tablet()

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
      <div class="relative flex min-h-0 flex-1 flex-col">
        <ScrollView
          class="isolate min-h-0 flex-1 [container-type:size]"
          thumbContainer={scroll.viewport.thumbTrack()}
          thumbHoverTarget={scroll.viewport.hoverTarget()}
          viewportRef={scroll.viewport.setViewport}
          onScroll={(event) => scroll.viewport.update(event.currentTarget.scrollTop)}
        >
          <div
            class={
              scoped()
                ? "mx-auto grid min-h-full w-full max-w-[768px] grid-rows-[minmax(0,1fr)] px-3 lg:px-6"
                : `
            mx-auto grid min-h-full w-full max-w-[1056px] grid-rows-[auto_minmax(0,1fr)] gap-4 px-3
            max-md:grid-rows-[minmax(0,1fr)] lg:grid-cols-[256px_minmax(0,720px)] lg:grid-rows-1 lg:gap-8 lg:px-6
          `
            }
          >
            <Show when={!mobile() && !scoped()}>
              <HomeProjects projects={props.projects} scroll={scroll} />
            </Show>
            <HomeSessions
              sessions={props.sessions}
              search={props.search}
              scroll={scroll}
              searchScope={
                scoped() ? (
                  <HomeProjects
                    projects={props.projects}
                    dropdown
                    scope
                    // A pick from the column clears the search by pressing outside it, but this picker is inside the
                    // field. Inline search filters the list in place, so the query carries over to the new project.
                    onPick={props.searchInline ? undefined : props.search.query.close}
                  />
                ) : undefined
              }
              searchInline={props.searchInline}
            />
          </div>
        </ScrollView>
        <Show when={props.providerTip}>
          <HomeProviderTip />
        </Show>
      </div>
      <div class="hidden shrink-0 px-3 py-2 md:block lg:hidden" classList={{ "!hidden": props.projectScope }}>
        <HomeUtilityNav
          class="flex"
          onOpenSettings={props.projects.utility.settings}
          onOpenHelp={props.projects.utility.help}
          automations={props.projects.utility.automations}
          language={props.projects.copy.language}
        />
      </div>
    </div>
  )
}

// Home sits outside any server's context, so the tip reads the current server's default Location.
function HomeProviderTip() {
  const servers = useServers()
  const server = createMemo(() => servers.list.find(servers.current))

  return (
    <Show when={server()} keyed>
      {(conn) => (
        <ServerProvider conn={conn}>
          <HomeProviderTipContent />
        </ServerProvider>
      )}
    </Show>
  )
}

function HomeProviderTipContent() {
  const tip = createProviderTip(() => undefined)

  return (
    <>
      <div
        aria-hidden="true"
        data-visible={tip.visible()}
        class="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-v2-background-bg-base from-40% to-transparent opacity-0 transition-opacity duration-[250ms] ease-[cubic-bezier(0.215,0.61,0.355,1)] data-[visible=true]:opacity-100 motion-reduce:transition-none"
      />
      <ProviderTip tip={tip} />
    </>
  )
}
