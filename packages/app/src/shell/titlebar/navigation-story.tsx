import type { ProjectListOutput, SessionInfo } from "@opencode/client/promise"
import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router"
import { createEffect, on, Show } from "solid-js"
import {
  createMemoryStorage,
  createStoryFetch,
  DialogStoryRuntime,
  STORY_DIRECTORY,
  STORY_PROJECTS,
  STORY_SERVER,
} from "@/components-lab/dialog-story-runtime"
import type { Platform } from "@/runtime/platform/platform"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { tabHref, tabKey, useTabs, type Tab } from "@/shell/tabs/tabs"
import { createRouteTabSync } from "./route-sync"
import { SidebarCustomized, type SidebarStripGrouping } from "./sidebar-customized"
import type { SidebarViewState } from "./sidebar-view"
import { TitlebarTabStrip } from "./tab-strip"
import "./titlebar.css"

const server = ServerConnection.key(STORY_SERVER)

const projects = STORY_PROJECTS.map((project) =>
  project.id === "prj_docs" ? { ...project, name: "Developer documentation and integration guides" } : project,
) satisfies ProjectListOutput

const idle = Date.UTC(2026, 10, 3, 12)

function session(id: string, title: string, project: ProjectListOutput[number], unread = false): SessionInfo {
  return {
    id: `ses_${id}`,
    title,
    projectID: project.id,
    location: { directory: project.canonical },
    time: { created: idle - 60_000, updated: idle, idle, viewed: unread ? undefined : idle },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
}

const sessions = [
  session("restore", "Restore workspace tabs", projects[0]),
  session("guide", "Review the keyboard navigation guide for switching between project sessions", projects[1], true),
  session("sidebar", "Sidebar focus order", projects[0]),
  session("landing", "Landing page spacing", projects[2]),
  session("contrast", "Check badge contrast", projects[0]),
  session("search", "Search index refresh", projects[1]),
  session("redirects", "Audit redirects", projects[2]),
  session("icons", "Project icons", projects[0]),
  session("examples", "Update examples", projects[1]),
  session("footer", "Footer links", projects[2]),
]

// All fetches and writes belong to one mount. The rest of the server (including the event stream)
// comes from the same fixture the standalone dialog stories use.
function navigationFetch(): typeof fetch {
  const fallback = createStoryFetch()

  const records = new Map(sessions.map((item) => [item.id, structuredClone(item)]))

  const handler = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)

    const url = new URL(request.url)

    if (url.pathname === "/api/project") return Response.json(projects)

    if (url.pathname === "/api/session") {
      const parent = url.searchParams.get("parentID")

      return Response.json({ data: parent && parent !== "null" ? [] : [...records.values()], cursor: {} })
    }

    const match = /^\/api\/session\/(ses_[^/]+)(?:\/(\w+))?$/.exec(url.pathname)

    if (!match) return fallback(input, init)
    const record = records.get(match[1])

    if (!record) return new Response(null, { status: 404 })

    if (match[2] === "message") return Response.json({ data: [], cursor: {} })

    if (match[2] === "view") record.time.viewed = record.time.idle

    if (request.method === "DELETE") records.delete(record.id)

    if (request.method === "PATCH") {
      const patch: { title?: string } = await request.json()

      if (patch.title !== undefined) record.title = patch.title
    }

    if (request.method !== "GET") return new Response(null, { status: 204 })

    return Response.json({ data: match[2] ? [] : record })
  }

  return Object.assign(handler, { preconnect: fallback.preconnect })
}

type Preset = "sessions" | "draft" | "crowded" | "projects" | "collapsed"

export function NavigationStory(props: { preset: Preset; width: number }) {
  const draft: Tab = { type: "draft", server, directory: STORY_DIRECTORY, draftID: "navigation-draft" }

  const open = props.preset === "crowded" ? sessions : sessions.slice(0, 4)

  const tabs: Tab[] = [...open.map((item): Tab => ({ type: "session", server, sessionId: item.id })), draft]

  const view: Omit<SidebarViewState, "filters"> = {
    grouping: "project",
    ordering: "manual",
    show: { recent: true, subagents: false, serverLabels: true },
    collapsed: props.preset === "collapsed" ? { [`project:${projects[0].id}`]: true } : {},
  }

  const storage = createMemoryStorage()
  storage("opencode.window.navigation.dat").setItem("tabs", JSON.stringify(tabs))
  storage("opencode.global.dat").setItem("sidebar.view", JSON.stringify(view))

  const platform: Platform = {
    platform: "desktop",
    windowID: "navigation",
    openDirectoryPickerDialog: async () => null,
    openExternal() {},
    notify: async () => {},
    restart: async () => {},
    storage,
    fetch: navigationFetch(),
  }

  const history = createMemoryHistory()
  history.set({ value: tabHref(props.preset === "draft" ? draft : tabs[0]), replace: true, scroll: false })

  return (
    <MemoryRouter history={history}>
      <Route
        path="*all"
        component={() => (
          <DialogStoryRuntime platform={platform}>
            <NavigationSurface
              sidebar={props.preset === "projects" || props.preset === "collapsed"}
              width={props.width}
            />
          </DialogStoryRuntime>
        )}
      />
    </MemoryRouter>
  )
}

function NavigationSurface(props: { sidebar: boolean; width: number }) {
  const tabs = useTabs()

  const route = createRouteTabSync()

  const global = useGlobal()

  createEffect(
    on(route.currentTab, (current) => {
      if (current?.type === "session") global.serverCtx(server)?.notification.session.markRead(current.sessionId)
    }),
  )

  const strip = (group?: SidebarStripGrouping) => (
    <TitlebarTabStrip
      orientation={props.sidebar ? "vertical" : "horizontal"}
      sections={group?.sections}
      tabFooter={group?.tabFooter}
      tabLabel={group?.tabLabel}
      tabs={tabs.store}
      currentTab={route.currentTab()}
      onNavigate={(tab, element) => {
        tabs.select(tab)
        element?.scrollIntoView({ block: "nearest", inline: "nearest" })
      }}
      onClose={(tab) => tabs.closeTab(tabs.store.indexOf(tab))}
      onCloseTabs={(items, keep) => tabs.closeTabs(items.map(tabKey), keep)}
      onReorder={tabs.reorder}
    />
  )

  return (
    <Show
      when={props.sidebar}
      fallback={
        <div class="max-w-full rounded-md bg-v2-background-bg-deep p-1" style={{ width: `${props.width}px` }}>
          {strip()}
        </div>
      }
    >
      <div
        data-slot="vertical-tabs-sidebar"
        class="flex h-[440px] max-w-full flex-col rounded-md bg-v2-background-bg-deep p-2"
        style={{ width: `${props.width}px` }}
      >
        <SidebarCustomized
          currentTab={route.currentTab()}
          onNewSession={() => void tabs.newDraft({ server, directory: STORY_DIRECTORY })}
        >
          {strip}
        </SidebarCustomized>
      </div>
    </Show>
  )
}
