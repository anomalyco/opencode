import { Button } from "@opencode/ui/button"
import { createEffect, createMemo, For } from "solid-js"
import { createStore } from "solid-js/store"
import { InboxSessionCard, InboxSessionList } from "./inbox"
import type { InboxStatus } from "./inbox-model"

const now = Date.UTC(2026, 10, 3, 12)

const titles = [
  "Tooltip status on latest dev",
  "Cross-platform synchronization",
  "User feedback analysis",
  "Add button component",
  "Investigate synchronization across distributed sessions and remote worktrees",
  "Review keyboard navigation",
]

function SessionListStory(props: {
  currentCount: number
  needsCount: number
  recentCount: number
  workingCount: number
  archived: boolean
  workingExpanded: boolean
  selectedSession: string
  width: number
  height: number
}) {
  const [state, setState] = createStore({
    selected: props.selectedSession,
    expanded: props.workingExpanded,
    archived: props.archived,
    removed: new Array<string>(),
    action: "",
  })

  createEffect(() => setState("selected", props.selectedSession))
  createEffect(() => setState("expanded", props.workingExpanded))
  createEffect(() => setState("archived", props.archived))

  const sessions = (section: "current" | "needs" | "recent" | "working", count: number) =>
    Array.from({ length: count }, (_, index) => {
      const status = (): InboxStatus => {
        if (section === "current") return "ready"

        if (section === "working") return "working"

        if (section === "needs") return index % 2 === 0 ? "approval" : "input"

        if (index % 3 === 0) return "done"

        return index % 3 === 1 ? "ready" : "failed"
      }

      return { id: `${section}-${index}`, index, status: status(), title: titles[index % titles.length] ?? "" }
    }).filter((session) => !state.removed.includes(session.id))

  const current = createMemo(() => sessions("current", props.currentCount))

  const needs = createMemo(() => sessions("needs", props.needsCount))

  const recent = createMemo(() => sessions("recent", props.recentCount))

  const working = createMemo(() => sessions("working", props.workingCount))

  const remove = (id: string, action: string) => {
    setState("removed", (removed) => [...removed, id])
    setState("action", action)
  }

  const rows = (list: typeof recent) => (
    <For each={list()}>
      {(session) => (
        <InboxSessionCard
          project={{
            id: session.index % 3 === 2 ? "lab-port-ui" : "lab-opencode",
            name: session.index % 3 === 2 ? "port-ui" : "opencode",
            worktree: "/workspace/opencode",
            icon: { color: session.index % 3 === 2 ? "purple" : "blue" },
          }}
          directory={session.index % 2 === 0 ? "/workspace/opencode/worktrees/tooltip-status" : "/workspace/opencode"}
          title={session.title}
          status={session.status}
          selected={state.selected === session.id}
          archived={false}
          server={session.index % 3 === 2 ? "Build server · build.example.internal" : undefined}
          branch={session.index % 4 === 3 ? undefined : "dev"}
          worktree={session.index % 2 === 0}
          now={now}
          since={now - (session.index + 1) * 7 * 60_000}
          onOpen={() => setState("selected", session.id)}
          onArchive={() => {
            remove(session.id, `Archived ${session.title}`)
            setState("archived", true)
          }}
          onUnarchive={() => {}}
          onDelete={() => remove(session.id, `Deleted ${session.title}`)}
        />
      )}
    </For>
  )

  return (
    <div class="flex flex-col gap-3">
      <div
        class="flex min-h-0 flex-col overflow-hidden rounded-[6px] bg-v2-background-bg-deep py-2 ps-[11px] pe-[3px]"
        style={{ width: `${props.width}px`, height: `${props.height}px` }}
      >
        <InboxSessionList
          currentCount={current().length}
          needsCount={needs().length}
          recentCount={recent().length}
          workingCount={working().length}
          archived={state.archived}
          workingExpanded={state.expanded}
          onToggleWorking={() => setState("expanded", !state.expanded)}
          onArchived={() => setState("action", "Archived sessions requested (local story only)")}
          current={rows(current)}
          needs={rows(needs)}
          recent={rows(recent)}
          working={rows(working)}
        />
      </div>
      <div class="flex items-center gap-3 text-[12px] leading-4 text-v2-text-text-muted">
        <Button
          variant="ghost-muted"
          size="small"
          onClick={() =>
            setState({
              selected: props.selectedSession,
              expanded: props.workingExpanded,
              archived: props.archived,
              removed: [],
              action: "",
            })
          }
        >
          Reset list
        </Button>
        <span aria-live="polite">{state.action}</span>
      </div>
      <span class="max-w-[360px] text-[12px] leading-4 text-v2-text-text-muted">
        Click to select; right-click to archive or delete. Working collapses. All actions stay local to this story.
      </span>
    </div>
  )
}

export default {
  title: "App/Inbox/Session lists",
  id: "app-inbox-session-lists",
  render: SessionListStory,
  args: {
    currentCount: 0,
    needsCount: 2,
    recentCount: 6,
    workingCount: 2,
    archived: true,
    workingExpanded: true,
    selectedSession: "recent-1",
    width: 280,
    height: 640,
  },
  argTypes: {
    currentCount: { control: { type: "range", min: 0, max: 1, step: 1 } },
    needsCount: { control: { type: "range", min: 0, max: 12, step: 1 } },
    recentCount: { control: { type: "range", min: 0, max: 10, step: 1 } },
    workingCount: { control: { type: "range", min: 0, max: 12, step: 1 } },
    selectedSession: {
      control: "select",
      options: ["current-0", "recent-1", "recent-0", "needs-0", "working-0", "none"],
    },
    width: { control: { type: "range", min: 136, max: 640, step: 8 } },
    height: { control: { type: "range", min: 240, max: 900, step: 20 } },
  },
  parameters: {
    docs: {
      description: {
        component:
          "The production inbox list and cards with local fixtures. Click to select, collapse Working, right-click to archive or delete, and reset without touching real sessions. Archived records an action rather than opening the live search dialog.",
      },
    },
  },
}

export const Mixed = {}

export const CurrentSession = { args: { currentCount: 1, selectedSession: "current-0" } }

export const CurrentOnly = {
  args: {
    currentCount: 1,
    needsCount: 0,
    recentCount: 0,
    workingCount: 0,
    selectedSession: "current-0",
    archived: false,
  },
}

export const RecentOnly = { args: { needsCount: 0, workingCount: 0 } }

export const NeedsAttention = { args: { needsCount: 4, recentCount: 0, workingCount: 0, archived: false } }

export const WorkingOnly = {
  args: { needsCount: 0, recentCount: 0, workingCount: 3, selectedSession: "working-0", archived: false },
}

export const WorkingCollapsed = { args: { workingExpanded: false, selectedSession: "working-0" } }

export const Empty = { args: { needsCount: 0, recentCount: 0, workingCount: 0, archived: false } }

export const Dense = { args: { needsCount: 4, recentCount: 10, workingCount: 5 } }

export const Narrow = { args: { width: 136 } }

export const ShortSidebar = { args: { height: 360 } }
