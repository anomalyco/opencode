import type { Event, WorkflowRun } from "@opencode-ai/sdk/v2"
import type { useSDK } from "../context/sdk"

// The generated v2 SDK now carries the full workflow surface natively (regenerated
// in this branch): the `Event` union has the `workflow.run.updated`/`finished`
// members, `WorkflowRun` carries `pending_question`, and `sdk.client.workflow.answer`
// exists. This module is the thin TUI-facing layer over those generated pieces:
//   - asWorkflowRunEvent narrows the real Event union (no string/`unknown` casts);
//   - answerWorkflowRun maps the generated answer() result to a small TUI union.

export const WORKFLOW_RUN_UPDATED = "workflow.run.updated"
export const WORKFLOW_RUN_FINISHED = "workflow.run.finished"

// The two generated Event union members for workflow run lifecycle frames.
export type WorkflowRunEventMember = Extract<
  Event,
  { type: typeof WORKFLOW_RUN_UPDATED | typeof WORKFLOW_RUN_FINISHED }
>

// The wire shape of a workflow.run.updated/finished event's `properties`, taken
// straight from the generated Event union member.
export type WorkflowRunEventData = WorkflowRunEventMember["properties"]

export type WorkflowRunEvent = {
  kind: "updated" | "finished"
  run: WorkflowRunEventData
}

// A run's pending question, derived from the generated WorkflowRun type so it
// tracks the SDK shape automatically.
export type PendingQuestion = NonNullable<WorkflowRun["pending_question"]>

// Narrows a raw SDK `Event` to a workflow run event when it carries one of the
// generated workflow.run.* members. The narrowing is a real discriminated-union
// check against the typed `event.type`, so `event.properties` is the generated
// WorkflowRunEventData without any cast.
export function asWorkflowRunEvent(event: Event): WorkflowRunEvent | undefined {
  if (event.type !== WORKFLOW_RUN_UPDATED && event.type !== WORKFLOW_RUN_FINISHED) return undefined
  return {
    kind: event.type === WORKFLOW_RUN_FINISHED ? "finished" : "updated",
    run: event.properties,
  }
}

export type AnswerResult =
  | { type: "ok"; run: WorkflowRun }
  | { type: "not_found" }
  | { type: "no_question" }
  | { type: "error"; message: string }

export type AnswerInput = {
  id: string
  answer: string
  permissionSessionID?: string
}

// The slice of the SDK context this helper needs: the generated client (for the
// typed answer() method) and the active directory (forwarded as the route's
// directory query param, matching how the rest of the dashboard calls the client).
export type WorkflowAnswerClient = {
  client: ReturnType<typeof useSDK>["client"]
  directory?: string
}

// Calls the generated `sdk.client.workflow.answer` (POST /workflow/run/:id/answer)
// with a body of only the set fields. Maps 200 -> {run}, 404 -> not_found,
// 409 -> no_question, anything else (incl. transport failure) -> error.
export async function answerWorkflowRun(sdk: WorkflowAnswerClient, input: AnswerInput): Promise<AnswerResult> {
  const payload: { answer: string; permissionSessionID?: string } = { answer: input.answer }
  if (input.permissionSessionID !== undefined) payload.permissionSessionID = input.permissionSessionID
  try {
    const result = await sdk.client.workflow.answer({
      id: input.id,
      directory: sdk.directory,
      workflowAnswerPayload: payload,
    })
    if (result.data) return { type: "ok", run: result.data }
    const status = result.response.status
    if (status === 404) return { type: "not_found" }
    if (status === 409) return { type: "no_question" }
    return { type: "error", message: `unexpected status ${status}` }
  } catch (error) {
    return { type: "error", message: error instanceof Error ? error.message : String(error) }
  }
}
