import { Button } from "@opencode/ui/button"
import { Menu } from "@opencode/ui/menu"
import { createEffect, For, on, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { InboxSessionCard } from "./inbox"
import type { InboxStatus } from "./inbox-model"

const now = Date.UTC(2026, 10, 3, 12)

const statuses = ["done", "ready", "working", "approval", "input", "failed"] as const satisfies readonly InboxStatus[]

function SessionCardStory(props: {
  status: InboxStatus
  selected: boolean
  archived: boolean
  worktree: boolean
  remote: boolean
  branch: string
  title: string
  project: string
  projectKnown: boolean
  ageMinutes: number
  ageSeconds: number
  timestampKnown: boolean
  readAction: boolean
  width: number
}) {
  const language = useLanguage()

  const initial = () => ({ selected: props.selected, archived: props.archived, removed: false, status: props.status })

  const [state, setState] = createStore(initial())

  const toggleRead = () => {
    if (state.status !== "ready") return setState("status", "ready")
    setState("status", props.status === "failed" ? "failed" : "done")
  }

  createEffect(
    on(
      [
        () => props.status,
        () => props.title,
        () => props.project,
        () => props.projectKnown,
        () => props.selected,
        () => props.archived,
        () => props.readAction,
      ],
      () => setState(initial()),
    ),
  )

  return (
    <div class="flex flex-col gap-3" style={{ width: `${props.width}px` }}>
      <div class="rounded-[6px] bg-v2-background-bg-deep p-1">
        <Show
          when={!state.removed}
          fallback={<span class="text-[13px] leading-4 text-v2-text-text-muted">Session deleted</span>}
        >
          <InboxSessionCard
            project={
              props.projectKnown
                ? { id: "lab-opencode", name: props.project, worktree: "/workspace/opencode", icon: { color: "blue" } }
                : undefined
            }
            directory={props.worktree ? "/workspace/opencode/worktrees/tooltip-status" : "/workspace/opencode"}
            title={props.title}
            status={state.status}
            selected={state.selected}
            archived={state.archived}
            server={props.remote ? "Build server · build.example.internal" : undefined}
            branch={props.branch || undefined}
            worktree={props.worktree}
            now={now}
            since={props.timestampKnown ? now - props.ageMinutes * 60_000 - props.ageSeconds * 1000 : undefined}
            onOpen={() => setState("selected", true)}
            actions={
              <Show
                when={
                  props.readAction && (state.status === "ready" || state.status === "done" || state.status === "failed")
                }
              >
                <Menu.Item onSelect={toggleRead}>
                  {language.t(state.status === "ready" ? "session.markUnread" : "session.markRead")}
                </Menu.Item>
                <Menu.Separator />
              </Show>
            }
            onArchive={() => setState("archived", true)}
            onUnarchive={() => setState("archived", false)}
            onDelete={() => setState("removed", true)}
          />
        </Show>
      </div>
      <Button variant="ghost-muted" size="small" class="self-start" onClick={() => setState(initial())}>
        Reset session
      </Button>
      <span class="text-[12px] leading-4 text-v2-text-text-muted">
        Hover or Tab to inspect. Click to select; right-click for actions.
      </span>
    </div>
  )
}

export default {
  title: "App/Inbox/Session card",
  id: "app-inbox-session-card",
  render: SessionCardStory,
  args: {
    status: "done",
    selected: false,
    archived: false,
    worktree: true,
    remote: false,
    branch: "dev",
    title: "Tooltip status on latest dev",
    project: "opencode",
    projectKnown: true,
    ageMinutes: 41,
    ageSeconds: 0,
    timestampKnown: true,
    readAction: false,
    width: 280,
  },
  argTypes: {
    status: { control: "select", options: statuses },
    width: { control: { type: "range", min: 136, max: 640, step: 8 } },
    ageMinutes: { control: { type: "range", min: 0, max: 10_080, step: 1 } },
    ageSeconds: { control: { type: "range", min: 0, max: 59, step: 1 } },
  },
  parameters: {
    docs: {
      description: {
        component:
          "The real inbox card. Hover for metadata tooltips, Tab for focus, click to select, and right-click for local archive/delete actions.",
      },
    },
  },
}

export const Unread = {}

export const Selected = { args: { selected: true } }

export const Read = { args: { status: "ready" } }

export const Working = { args: { status: "working", ageMinutes: 2 } }

export const Approval = { args: { status: "approval", ageMinutes: 12 } }

export const Question = { args: { status: "input", title: "Choose a response format", ageMinutes: 3 } }

export const Failed = { args: { status: "failed", title: "Repair deployment pipeline" } }

export const Archived = { args: { archived: true, status: "ready" } }

export const NoGitMetadata = { args: { branch: "", worktree: false, project: "notes" } }

export const UnknownProject = { args: { projectKnown: false, worktree: false } }

export const Untitled = { args: { title: "" } }

export const RemoteServer = { args: { remote: true } }

export const LongValues = {
  args: {
    title: "Investigate synchronization across distributed sessions and remote worktrees",
    project: "enterprise-platform-infrastructure",
    branch: "feature/inbox-pagination-and-worktree-identities",
    remote: true,
  },
}

export const Narrow = { args: { width: 136, remote: true } }

export const AllStates = {
  render: (args: Parameters<typeof SessionCardStory>[0]) => (
    <div class="flex flex-wrap items-start gap-6">
      <For each={[args.status, ...statuses.filter((status) => status !== args.status)]}>
        {(status) => (
          <div class="flex flex-col gap-2">
            <span class="text-[13px] leading-4 text-v2-text-text-muted">{status}</span>
            <SessionCardStory {...args} status={status} />
          </div>
        )}
      </For>
    </div>
  ),
}

export const JustStarted = { args: { status: "working", ageMinutes: 0, ageSeconds: 12 } }

export const UnknownAge = { args: { status: "working", timestampKnown: false } }

export const MarkAsRead = { args: { readAction: true } }
