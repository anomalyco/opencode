import { Show, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import createPresence from "solid-presence"
import { ScrollView } from "@argus-ai/ui/scroll-view"
import { Mark } from "@argus-ai/ui/logo"
import { Icon } from "@argus-ai/ui/icon"
import { Icon as IconV2 } from "@argus-ai/ui/v2/icon"
import { IconButtonV2 } from "@argus-ai/ui/v2/icon-button-v2"
import { TooltipV2 } from "@argus-ai/ui/v2/tooltip-v2"
import { Persist, persisted } from "@/utils/persist"
import { createHomeController } from "./home-controller"
import { createHomeProjectsController } from "./home-projects-controller"
import { HomeProjects } from "./home-projects"
import { HomeUtilityNav } from "./home-projects-view"
import { createHomeScrollController } from "./home-scroll-controller"
import { createHomeSessionSearchController } from "./home-session-search-controller"
import { createHomeSessionsController } from "./home-sessions-controller"
import { HomeSessions } from "./home-sessions"

const sidebarEase = "ease-[cubic-bezier(0.215,0.61,0.355,1)]"

// Persistent projects + sessions sidebar. Mounted once in NewLayout so it
// stays visible across routes instead of living on a dedicated home page.
// Collapsible; open state persists globally and animates via a width
// transition with a fade between the full panel and the collapsed rail.
export function HomeSidebar() {
  const home = createHomeController()
  const projects = createHomeProjectsController(home)
  const sessions = createHomeSessionsController(home)
  const search = createHomeSessionSearchController(home, sessions)
  const scroll = createHomeScrollController(sessions.data.groups)
  const language = projects.copy.language
  const [state, setState] = persisted(
    Persist.global("home.sidebar", ["home.sidebar.v1"]),
    createStore({ opened: true }),
  )
  const [openRef, setOpenRef] = createSignal<HTMLDivElement>()
  const [railRef, setRailRef] = createSignal<HTMLDivElement>()
  const openPresence = createPresence({
    show: () => state.opened,
    element: () => openRef() ?? null,
  })
  const railPresence = createPresence({
    show: () => !state.opened,
    element: () => railRef() ?? null,
  })
  const toggle = () => setState("opened", (value) => !value)

  return (
    <div
      class={`
        relative m-2 mr-0 hidden min-h-0 shrink-0 self-stretch flex-col overflow-hidden rounded-[10px]
        glass-surface shadow-[var(--v2-elevation-raised)]
        transition-[width] duration-200 motion-reduce:transition-none
        lg:flex [&_.scroll-view__thumb]:hidden
      `}
      classList={{ "w-[340px]": state.opened, "w-14": !state.opened }}
      aria-label={language.t("home.projects")}
    >
      <Show when={openPresence.present()}>
        <div
          ref={setOpenRef}
          data-visible={state.opened}
          data-component="home-sidebar-panel"
          class={`
            absolute top-0 bottom-0 left-0 flex w-[340px] min-h-0 flex-col transition-opacity duration-150
            ${sidebarEase} motion-reduce:transition-none
            data-[visible=false]:animate-out data-[visible=false]:fade-out
          `}
          aria-hidden={state.opened ? undefined : true}
        >
          <div class="flex h-9 shrink-0 items-center justify-between gap-2 px-3 pt-1.5">
            <Mark class="w-7" />
            <TooltipV2 placement="bottom" value={language.t("command.sidebar.toggle")}>
              <IconButtonV2
                data-action="home-sidebar-collapse"
                variant="ghost-muted"
                size="large"
                icon={<IconV2 name="sidebar-right" />}
                onClick={toggle}
                aria-label={language.t("command.sidebar.toggle")}
                aria-expanded={state.opened}
              />
            </TooltipV2>
          </div>
          <ScrollView
            class="min-h-0 flex-1 [container-type:size]"
            thumbContainer={scroll.viewport.thumbTrack}
            thumbHoverTarget={scroll.viewport.hoverTarget}
            viewportRef={scroll.viewport.setViewport}
            onScroll={(event) => scroll.viewport.update(event.currentTarget.scrollTop)}
            onWheel={scroll.viewport.containOuterWheel}
          >
            <div class="flex min-h-full w-full flex-col gap-4 px-3 py-3">
              <HomeProjects projects={projects} scroll={scroll} sidebar showUtility={false} />
              <HomeSessions sessions={sessions} search={search} scroll={scroll} sidebar />
            </div>
          </ScrollView>
          <HomeUtilityNav
            class="mx-2 mb-2 mt-1 flex shrink-0 border-t border-v2-border-border-base pt-1"
            onOpenSettings={projects.utility.settings}
            onOpenHelp={projects.utility.help}
            language={language}
          />
        </div>
      </Show>
      <Show when={railPresence.present()}>
        <div
          ref={setRailRef}
          data-visible={!state.opened}
          data-component="home-sidebar-rail"
          class={`
            absolute inset-0 flex min-h-0 flex-col items-center transition-opacity duration-150
            ${sidebarEase} motion-reduce:transition-none
            data-[visible=false]:animate-out data-[visible=false]:fade-out
          `}
          aria-hidden={state.opened ? true : undefined}
        >
          <div class="flex h-22 shrink-0 flex-col items-center justify-start gap-2 pt-2">
            <Mark class="w-7" />
            <TooltipV2 placement="right" value={language.t("command.sidebar.toggle")}>
              <IconButtonV2
                data-action="home-sidebar-expand"
                variant="ghost-muted"
                size="large"
                icon={<IconV2 name="sidebar-right" />}
                onClick={toggle}
                aria-label={language.t("command.sidebar.toggle")}
                aria-expanded={state.opened}
              />
            </TooltipV2>
          </div>
          <div class="flex-1" aria-hidden />
          <div class="flex w-full shrink-0 flex-col items-center gap-1 border-t border-v2-border-border-base pt-2 pb-2">
            <TooltipV2 placement="right" value={language.t("sidebar.settings")}>
              <IconButtonV2
                data-action="home-sidebar-rail-settings"
                variant="ghost-muted"
                size="large"
                icon={<IconV2 name="settings-gear" />}
                onClick={projects.utility.settings}
                aria-label={language.t("sidebar.settings")}
              />
            </TooltipV2>
            <TooltipV2 placement="right" value={language.t("sidebar.help")}>
              <IconButtonV2
                data-action="home-sidebar-rail-help"
                variant="ghost-muted"
                size="large"
                icon={<Icon name="help" />}
                onClick={projects.utility.help}
                aria-label={language.t("sidebar.help")}
              />
            </TooltipV2>
          </div>
        </div>
      </Show>
    </div>
  )
}