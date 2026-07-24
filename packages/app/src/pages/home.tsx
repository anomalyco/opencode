import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { createHomeController } from "./home/home-controller"
import { createHomeProjectsController } from "./home/home-projects-controller"
import { HomeUtilityNav } from "./home/home-projects-view"
import { HomeProjects } from "./home/home-projects"
import { createHomeScrollController } from "./home/home-scroll-controller"
import { createHomeSessionSearchController } from "./home/home-session-search-controller"
import { createHomeSessionsController } from "./home/home-sessions-controller"
import { HomeSessions } from "./home/home-sessions"

export function NewHome() {
  const home = createHomeController()
  const projects = createHomeProjectsController(home)
  const sessions = createHomeSessionsController(home)
  const search = createHomeSessionSearchController(home, sessions)
  const scroll = createHomeScrollController(sessions.groups)
  return (
    <div class="rounded-[10px] shadow-[var(--v2-elevation-raised)] m-2 min-h-0 overflow-hidden bg-v2-background-bg-base self-stretch flex-1">
      <ScrollView
        class="h-full [container-type:size]"
        thumbContainer={scroll.thumbTrack}
        thumbHoverTarget={scroll.hoverTarget}
        viewportRef={scroll.setViewport}
        onScroll={(event) => scroll.update(event.currentTarget.scrollTop)}
        onWheel={scroll.containOuterWheel}
      >
        <div class="mx-auto grid min-h-full w-full max-w-[1080px] grid-rows-[auto_minmax(0,1fr)_auto] gap-4 px-3 lg:grid-cols-[280px_minmax(0,720px)] lg:grid-rows-1 lg:gap-8 lg:px-6">
          <HomeProjects projects={projects} scroll={scroll} />
          <HomeSessions sessions={sessions} search={search} scroll={scroll} />
          <HomeUtilityNav
            class="flex lg:hidden"
            onOpenSettings={projects.openSettings}
            onOpenHelp={projects.openHelp}
            language={projects.language}
          />
        </div>
      </ScrollView>
    </div>
  )
}
