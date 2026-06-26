import { createMemo, type Accessor } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useWorkflow } from "./use-workflow"
import type { UserMessage } from "@opencode-ai/sdk/v2"

export type StatusState =
  | "idle"
  | "running"
  | "parallel"
  | "retry"
  | "retry_exhausted"
  | "error"
  | "complete"

export type WorkflowStatus = {
  state: StatusState
  startedAt: number | undefined
}

export function useWorkflowStatus(sessionID: Accessor<string | undefined>): Accessor<WorkflowStatus> {
  const sync = useSync()
  const wf = useWorkflow(sessionID)

  const parentStatus = createMemo(() => {
    const id = sessionID()
    if (!id) return "idle" as const
    return sync.data.session_status[id]?.type ?? ("idle" as const)
  })

  const lastUserTime = createMemo(() => {
    const id = sessionID()
    if (!id) return undefined
    const messages = sync.data.message[id] ?? []
    const last = messages.findLast((m): m is UserMessage => m.role === "user")
    return last?.time.created
  })

  return createMemo<WorkflowStatus>(() => {
    const ps = parentStatus()
    const workers = wf.workers()
    const inFlight = wf.inFlight()
    const failed = wf.failed()

    if (ps === "retry") return { state: "retry", startedAt: lastUserTime() }
    if (ps === "retry_exhausted") return { state: "retry_exhausted", startedAt: lastUserTime() }

    if (workers.length > 0) {
      if (inFlight.length > 0) return { state: "parallel", startedAt: workers[0]?.session.time.created }
      if (parentStatus() === "idle") {
        if (failed.length > 0) return { state: "error", startedAt: workers[0]?.session.time.created }
        return { state: "complete", startedAt: workers[0]?.session.time.created }
      }
      return { state: "parallel", startedAt: workers[0]?.session.time.created }
    }

    if (ps !== "idle") return { state: "running", startedAt: lastUserTime() }
    return { state: "idle", startedAt: undefined }
  })
}

export * as WorkflowStateMachine from "./state-machine"