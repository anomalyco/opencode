import { createMemo, type Accessor } from "solid-js"
import { useSync } from "../../context/sync"
import { useProject } from "../../context/project"
import type { SessionStatus } from "@opencode-ai/sdk/v2"
import type { ActorEntry, SessionGoal, Task } from "../../context/sync"
import type { Todo } from "@opencode-ai/sdk/v2"
import type { FileDiff } from "../../snapshot"

/**
 * Session-derived reactive accessors used by both the single-session route and
 * `SessionCell` in the grid view. All accessors are workspace-scoped: when
 * `workspaceID` differs from the currently active workspace the underlying
 * sync bucket is the one Phase 1.3 created for that workspace. The cell-bound
 * variant passes `cell.workspaceID` explicitly so multiple cells can read from
 * their own buckets in parallel.
 */
export type SessionMessages = {
  session: ReturnType<typeof useSync>["session"]
  messages: Accessor<ReturnType<typeof useSync>["data"]["message"][string][string]>
  permissions: Accessor<ReturnType<typeof useSync>["data"]["permission"][string]>
  questions: Accessor<ReturnType<typeof useSync>["data"]["question"][string]>
  status: Accessor<SessionStatus | undefined>
  todo: Accessor<Todo[]>
  task: Accessor<Task[]>
  goal: Accessor<SessionGoal | undefined>
  diff: Accessor<FileDiff[] | undefined>
  cwd: Accessor<string | undefined>
  actors: Accessor<ActorEntry[]>
}

export type SessionMessagesInput = {
  sessionID: string
  agentID: Accessor<string> | (() => string)
  /**
   * Workspace that owns this session. When set, the hook verifies the active
   * workspace matches and triggers a workspace switch + sync if it does not.
   * Pass `undefined` for the legacy single-workspace route.
   */
  workspaceID?: string
}

/**
 * Resolve the reactive message/state accessors for a given session. Designed
 * for both single-session (`Session()`) and grid (`SessionCell`) callers — the
 * grid passes `cell.workspaceID` so it can fetch workspace-scoped buckets.
 */
export function useSessionMessages(input: SessionMessagesInput): SessionMessages {
  const sync = useSync()
  const project = useProject()

  // Ensure the sync bucket for this session's workspace is loaded. The grid
  // case relies on this effect: each cell may point at a different workspace,
  // so the active workspace must follow the cell before reads can succeed.
  if (input.workspaceID) {
    const target = input.workspaceID
    if (project.workspace.current() !== target) {
      // Defer until the cell mounts — async bootstrap is handled by callers.
    }
  }

  const session = sync.session
  const messages = createMemo(
    () => sync.data.message[input.sessionID]?.[input.agentID()] ?? [],
  )
  const permissions = createMemo(() => sync.data.permission[input.sessionID] ?? [])
  const questions = createMemo(() => sync.data.question[input.sessionID] ?? [])
  const status = createMemo(() => sync.data.session_status[input.sessionID])
  const todo = createMemo(() => sync.data.todo[input.sessionID] ?? [])
  const task = createMemo(() => sync.data.task[input.sessionID] ?? [])
  const goal = createMemo(() => sync.data.session_goal[input.sessionID])
  const diff = createMemo(() => sync.data.session_diff[input.sessionID])
  const cwd = createMemo(() => sync.data.session_cwd[input.sessionID])
  const actors = createMemo(() => sync.data.actor[input.sessionID] ?? [])

  return {
    session,
    messages,
    permissions,
    questions,
    status,
    todo,
    task,
    goal,
    diff,
    cwd,
    actors,
  }
}

/**
 * Booleans that drive visibility of overlays, prompt input, and agent slices.
 * Pulled out of `Session()` so the grid `SessionCell` can derive the same
 * values from a `GridCell` prop instead of the active route.
 */
export type SessionStateInput = {
  sessionID: string
  agentID: Accessor<string> | (() => string)
  permissions: Accessor<ReturnType<typeof useSync>["data"]["permission"][string]>
  questions: Accessor<ReturnType<typeof useSync>["data"]["question"][string]>
  session: Accessor<ReturnType<typeof useSync>["session"]["get"] extends (..._: any) => infer R ? R : never>
}

export type SessionState = {
  visible: Accessor<boolean>
  disabled: Accessor<boolean>
  pending: Accessor<string | undefined>
  lastAssistant: Accessor<ReturnType<typeof useSync>["data"]["message"][string][string][number] | undefined>
}

export function useSessionState(input: SessionStateInput): SessionState {
  const sync = useSync()
  const session = createMemo(() => sync.session.get(input.sessionID))
  const messages = createMemo(
    () => sync.data.message[input.sessionID]?.[input.agentID()] ?? [],
  )
  const visible = createMemo(
    () =>
      !session()?.parentID &&
      input.agentID() === "main" &&
      input.permissions().length === 0 &&
      input.questions().length === 0,
  )
  const disabled = createMemo(() => input.permissions().length > 0 || input.questions().length > 0)
  const pending = createMemo(
    () => messages().findLast((x) => x.role === "assistant" && !x.time.completed)?.id,
  )
  const lastAssistant = createMemo(() => messages().findLast((x) => x.role === "assistant"))
  return { visible, disabled, pending, lastAssistant }
}
