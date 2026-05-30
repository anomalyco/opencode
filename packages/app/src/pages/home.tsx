import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { useNavigate } from "@solidjs/router"
import { Icon } from "@opencode-ai/ui/icon"
import { DateTime } from "luxon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogCreateProject } from "@/components/dialog-create-project"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { useServer } from "@/context/server"
import { useGlobalSync } from "@/context/global-sync"
import { captureVeritly } from "@/lib/telemetry/posthog"

// Deterministic avatar colour from project id
const AVATAR_PALETTE = [
  { bg: "#D1FAE5", fg: "#065F46" }, // green
  { bg: "#DBEAFE", fg: "#1D4ED8" }, // blue
  { bg: "#EDE9FE", fg: "#5B21B6" }, // violet
  { bg: "#FEF3C7", fg: "#92400E" }, // amber
  { bg: "#FCE7F3", fg: "#9D174D" }, // pink
  { bg: "#E0F2FE", fg: "#0369A1" }, // sky
  { bg: "#FEE2E2", fg: "#991B1B" }, // red
  { bg: "#F0FDF4", fg: "#166534" }, // emerald
]

function avatarColor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length]
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
}

function getStats(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h)
  const seed = Math.abs(h)
  const files = (seed % 12) + 4
  const dashboards = (seed % 4) + 1
  const workflows = (seed % 3) + 1
  return { files, dashboards, workflows }
}

export default function Home() {
  const sync = useGlobalSync()
  const dialog = useDialog()
  const navigate = useNavigate()
  const server = useServer()

  const [search, setSearch] = createSignal("")
  const [view, setView] = createSignal<"grid" | "list">("grid")

  const sorted = createMemo(() =>
    sync.data.project
      .slice()
      .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created)),
  )

  const filtered = createMemo(() => {
    const query = search().toLowerCase().trim()
    if (!query) return sorted()
    return sorted().filter((p) => (p.name ?? p.id).toLowerCase().includes(query))
  })

  const lastProjectID = createMemo(() => server.projects.last())

  const jumpBackProject = createMemo(() => {
    if (filtered().length === 0 || search().trim() !== "") return undefined
    const lastID = lastProjectID()
    if (lastID) {
      const match = sorted().find((p) => p.id === lastID)
      if (match) return match
    }
    return sorted()[0]
  })

  const otherProjects = createMemo(() => {
    if (search().trim() !== "") return filtered()
    const jumpBack = jumpBackProject()
    if (jumpBack) {
      return filtered().filter((p) => p.id !== jumpBack.id)
    }
    return filtered()
  })

  function openProject(projectID: string, source: "recent" | "create_dialog" | "empty_state") {
    captureVeritly("project_opened", { source })
    server.projects.touch(projectID)
    navigate(`/${projectID}`)
  }

  function rememberProject(project: (typeof sync.data.project)[number]) {
    const next = sync.data.project.slice()
    const index = next.findIndex((item) => item.id === project.id)
    if (index >= 0) next[index] = project
    else next.unshift(project)
    sync.set("project", next)
  }

  function chooseProject(from: "toolbar" | "empty_state") {
    const source = from === "empty_state" ? "empty_state" : "create_dialog"
    dialog.show(() => (
      <DialogCreateProject
        onCreate={(project) => {
          rememberProject(project)
          openProject(project.id, source)
        }}
      />
    ))
  }

  return (
    <div class="flex flex-col min-h-full bg-background-base">
      {/* Header Section */}
      <div class="shrink-0 pt-10 pb-6">
        <div class="projects-container flex items-start justify-between">
          <div class="flex flex-col">
            <h1 class="projects-header-title">Projects</h1>
            <p class="projects-header-subtitle">
              Veritly workspace • {sorted().length} {sorted().length === 1 ? "project" : "projects"}
            </p>
          </div>
          <Button
            variant="secondary"
            class="flex items-center gap-1.5 border-border-weak-base shadow-none hover:bg-surface-base-hover rounded-md text-[13px] font-medium"
            onClick={() => chooseProject("toolbar")}
          >
            <Icon name="folder-add-left" size="small" />
            New project
          </Button>
        </div>
      </div>

      {/* Search and Filters */}
      <div class="shrink-0 py-4">
        <div class="projects-container flex items-center justify-between gap-4">
          <div class="projects-search-input-wrapper">
            <input
              type="text"
              placeholder="Search projects"
              class="projects-search-input"
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
            />
          </div>

          <div class="flex items-center gap-3">
            <button type="button" class="projects-filter-button">
              Recent
              <Icon name="chevron-down" size="small" class="text-icon-weak" />
            </button>

            <div class="projects-view-toggle">
              <button
                type="button"
                class="projects-view-toggle-btn"
                classList={{ active: view() === "grid" }}
                onClick={() => setView("grid")}
                aria-label="Grid view"
              >
                <svg class="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="3" width="5.5" height="5.5" rx="1" />
                  <rect x="11.5" y="3" width="5.5" height="5.5" rx="1" />
                  <rect x="3" y="11.5" width="5.5" height="5.5" rx="1" />
                  <rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1" />
                </svg>
              </button>
              <button
                type="button"
                class="projects-view-toggle-btn"
                classList={{ active: view() === "list" }}
                onClick={() => setView("list")}
                aria-label="List view"
              >
                <svg class="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="3" y1="5" x2="17" y2="5" />
                  <line x1="3" y1="10" x2="17" y2="10" />
                  <line x1="3" y1="15" x2="17" y2="15" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <Switch>
        <Match when={sorted().length > 0}>
          {/* Jump Back In Section */}
          <Show when={jumpBackProject()}>
            {(project) => {
              const color = avatarColor(project().id)
              const label = project().name ?? project().id
              const stats = getStats(project().id)
              const ts = DateTime.fromMillis(Number(project().time.updated ?? project().time.created)).toRelative()
              return (
                <div class="shrink-0 py-6">
                  <div class="projects-container">
                    <h2 class="text-11-medium text-text-weak uppercase tracking-wider mb-3">Jump back in</h2>
                    <button
                      type="button"
                      class="project-jump-back-card"
                      onClick={() => openProject(project().id, "recent")}
                    >
                      <div class="flex items-center gap-4">
                        <div
                          style={{
                            width: "44px",
                            height: "44px",
                            "border-radius": "8px",
                            background: color.bg,
                            color: color.fg,
                            display: "flex",
                            "align-items": "center",
                            "justify-content": "center",
                            "font-size": "14px",
                            "font-weight": "600",
                            "flex-shrink": "0",
                          }}
                        >
                          {initials(label)}
                        </div>
                        <div class="flex flex-col min-w-0">
                          <div class="flex items-baseline gap-2">
                            <span class="text-16-medium text-text-strong truncate">{label}</span>
                          </div>
                          <div class="flex items-center gap-3 text-12-regular text-text-weak mt-1">
                            <span class="flex items-center gap-1">
                              <Icon name="copy" size="small" class="text-icon-weak" />
                              {stats.files} files
                            </span>
                            <span class="text-border-base">•</span>
                            <span class="flex items-center gap-1">
                              <svg class="size-3.5 text-icon-weak" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="3" y="3" width="5.5" height="5.5" rx="1" />
                                <rect x="11.5" y="3" width="5.5" height="5.5" rx="1" />
                                <rect x="3" y="11.5" width="5.5" height="5.5" rx="1" />
                                <rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1" />
                              </svg>
                              {stats.dashboards} {stats.dashboards === 1 ? "dashboard" : "dashboards"}
                            </span>
                            <span class="text-border-base">•</span>
                            <span class="flex items-center gap-1">
                              <svg class="size-3.5 text-icon-weak" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="14" cy="5" r="1.5" fill="currentColor" />
                                <circle cx="6" cy="10" r="1.5" fill="currentColor" />
                                <circle cx="14" cy="15" r="1.5" fill="currentColor" />
                                <path d="M14 5H9a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3h5" />
                              </svg>
                              {stats.workflows} {stats.workflows === 1 ? "workflow" : "workflows"}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div class="flex items-center gap-4">
                        <span class="text-12-regular text-text-weak">Edited {ts} by you</span>
                        <span class="project-badge-audit active">
                          <Icon name="check" size="small" />
                          Audit on
                        </span>
                      </div>
                    </button>
                  </div>
                </div>
              )
            }}
          </Show>

          {/* All Projects Section */}
          <div class="flex-1 py-6 overflow-auto">
            <div class="projects-container">
              <h2 class="text-11-medium text-text-weak uppercase tracking-wider mb-4">All projects</h2>

              <div
                style={{
                  display: "grid",
                  "grid-template-columns": "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: "16px",
                }}
              >
                <For each={otherProjects()}>
                  {(project) => {
                    const color = avatarColor(project.id)
                    const label = project.name ?? project.id
                    const stats = getStats(project.id)
                    const ts = DateTime.fromMillis(Number(project.time.updated ?? project.time.created)).toRelative()

                    return (
                      <button
                        type="button"
                        class="project-grid-card"
                        onClick={() => openProject(project.id, "recent")}
                      >
                        <div class="flex items-start justify-between w-full">
                          <div
                            style={{
                              width: "36px",
                              height: "36px",
                              "border-radius": "8px",
                              background: color.bg,
                              color: color.fg,
                              display: "flex",
                              "align-items": "center",
                              "justify-content": "center",
                              "font-size": "12px",
                              "font-weight": "600",
                            }}
                          >
                            {initials(label)}
                          </div>
                          <Button
                            variant="ghost"
                            class="size-8 rounded-md p-0 flex items-center justify-center text-icon-weak hover:text-text-strong"
                            onClick={(e: MouseEvent) => {
                              e.stopPropagation()
                              // Option menu trigger coming soon
                            }}
                            aria-label="Options"
                          >
                            <svg class="size-5" viewBox="0 0 20 20" fill="currentColor">
                              <circle cx="5" cy="10" r="1.5" />
                              <circle cx="10" cy="10" r="1.5" />
                              <circle cx="15" cy="10" r="1.5" />
                            </svg>
                          </Button>
                        </div>

                        <div class="flex flex-col mt-4 min-w-0">
                          <span class="text-14-medium text-text-strong truncate">{label}</span>
                        </div>

                        <div class="flex items-center gap-3 text-12-regular text-text-weak mt-4">
                          <span class="flex items-center gap-1">
                            <Icon name="copy" size="small" class="text-icon-weak" />
                            {stats.files}
                          </span>
                          <span class="flex items-center gap-1">
                            <svg class="size-3.5 text-icon-weak" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                              <rect x="3" y="3" width="5.5" height="5.5" rx="1" />
                              <rect x="11.5" y="3" width="5.5" height="5.5" rx="1" />
                              <rect x="3" y="11.5" width="5.5" height="5.5" rx="1" />
                              <rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1" />
                            </svg>
                            {stats.dashboards}
                          </span>
                          <span class="flex items-center gap-1">
                            <svg class="size-3.5 text-icon-weak" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                              <circle cx="14" cy="5" r="1.5" fill="currentColor" />
                              <circle cx="6" cy="10" r="1.5" fill="currentColor" />
                              <circle cx="14" cy="15" r="1.5" fill="currentColor" />
                              <path d="M14 5H9a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3h5" />
                            </svg>
                            {stats.workflows}
                          </span>
                        </div>

                        <div class="flex items-center justify-between w-full mt-4 pt-3 border-t border-border-weak-base">
                          <span class="text-12-regular text-text-weak">{ts}</span>
                          <span class="project-badge-audit">
                            <Icon name="check" size="small" />
                            Audit
                          </span>
                        </div>
                      </button>
                    )
                  }}
                </For>

                {/* New project card */}
                <button
                  type="button"
                  class="project-dashed-card"
                  onClick={() => chooseProject("toolbar")}
                >
                  <Icon name="folder-add-left" class="text-icon-weak" />
                  <span class="text-12-regular text-text-weak">New project</span>
                </button>
              </div>
            </div>
          </div>
        </Match>

        <Match when={true}>
          {/* Empty state */}
          <div class="flex-1 flex flex-col items-center justify-center py-20">
            <div class="size-12 rounded-xl border border-border-base bg-background-strong flex items-center justify-center mb-4">
              <Icon name="folder-add-left" />
            </div>
            <h3 class="text-14-medium text-text-strong">No projects yet</h3>
            <p class="text-12-regular text-text-weak mt-1">Create your first project to get started.</p>
            <Button class="px-4 mt-4" onClick={() => chooseProject("empty_state")}>
              Create project
            </Button>
          </div>
        </Match>
      </Switch>
    </div>
  )
}
