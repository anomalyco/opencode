import { Component, createEffect, createSignal, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { TextField } from "@opencode-ai/ui/text-field"
import { Icon } from "@opencode-ai/ui/icon"
import { Markdown } from "@opencode-ai/ui/markdown"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useSDK } from "@/context/sdk"
import type { PlanReviewRequest } from "@opencode-ai/sdk/v2/client"
import { getFilename } from "@opencode-ai/util/path"

/**
 * Inline plan content that displays in the chat history (scrollable)
 */
export const PlanReviewContent: Component<{ request: PlanReviewRequest }> = (props) => {
  const sdk = useSDK()

  const [content, setContent] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(true)

  // Load plan content on mount
  createEffect(async () => {
    try {
      const response = await sdk.client.planReview.content({ requestID: props.request.id })
      setContent(response.data ?? "(Empty plan file)")
    } catch {
      setContent("(Unable to read plan file)")
    } finally {
      setLoading(false)
    }
  })

  return (
    <div class="px-4 md:px-6 py-4">
      {/* Header */}
      <div class="flex items-center gap-2 mb-3">
        <div class="flex items-center justify-center size-6 rounded-md bg-surface-warning-weaker">
          <Icon name="checklist" class="size-4 text-icon-warning" />
        </div>
        <span class="text-14-semibold text-text-strong">Plan</span>
        <span class="text-12-regular text-text-subtle">{getFilename(props.request.filePath)}</span>
      </div>

      {/* Plan content with markdown */}
      <div class="rounded-md border border-border-base bg-surface-inset-base overflow-hidden">
        <Show when={loading()}>
          <div class="p-4 flex items-center gap-2 text-text-weak">
            <Spinner />
            <span class="text-14-regular">Loading plan...</span>
          </div>
        </Show>
        <Show when={!loading()}>
          <div class="p-4 prose prose-sm max-w-none">
            <Markdown text={content() ?? ""} />
          </div>
        </Show>
      </div>
    </div>
  )
}

/**
 * Docked controls for plan review (buttons, feedback input)
 */
export const PlanReviewControls: Component<{ request: PlanReviewRequest }> = (props) => {
  const sdk = useSDK()

  const [rejectMode, setRejectMode] = createSignal(false)
  const [feedback, setFeedback] = createSignal("")
  const [submitting, setSubmitting] = createSignal(false)

  async function handleApprove() {
    setSubmitting(true)
    try {
      await sdk.client.planReview.approve({ requestID: props.request.id })
    } finally {
      setSubmitting(false)
    }
  }

  async function handleReject() {
    if (!rejectMode()) {
      setRejectMode(true)
      return
    }
    setSubmitting(true)
    try {
      await sdk.client.planReview.reject({ requestID: props.request.id, feedback: feedback() || undefined })
    } finally {
      setSubmitting(false)
    }
  }

  function handleDismiss() {
    sdk.client.planReview.reject({ requestID: props.request.id })
  }

  function handleCancelReject() {
    setRejectMode(false)
    setFeedback("")
  }

  return (
    <div class="bg-surface-raised-stronger-non-alpha shadow-xs-border rounded-md overflow-clip">
      <div class="px-4 py-3">
        {/* Header row */}
        <div class="flex items-center justify-between gap-4 mb-3">
          <div class="flex items-center gap-2 min-w-0">
            <div class="flex items-center justify-center size-6 rounded-md bg-surface-warning-weaker shrink-0">
              <Icon name="checklist" class="size-4 text-icon-warning" />
            </div>
            <span class="text-14-semibold text-text-strong">Plan Review</span>
            <span class="text-12-regular text-text-subtle truncate">{getFilename(props.request.filePath)}</span>
          </div>
          <span class="text-11-medium text-text-warning bg-surface-warning-weaker px-1.5 py-0.5 rounded shrink-0">
            Awaiting Approval
          </span>
        </div>

        {/* Description */}
        <p class="text-12-regular text-text-weak mb-3">
          Review the plan above. Approve to begin implementation, or reject with feedback to revise.
        </p>

        {/* Feedback input (shown in reject mode) */}
        <Show when={rejectMode()}>
          <div class="mb-3">
            <TextField
              autofocus
              label="Feedback (optional)"
              placeholder="Enter feedback for revision..."
              value={feedback()}
              onChange={setFeedback}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter" && !submitting()) {
                  e.preventDefault()
                  handleReject()
                }
              }}
            />
          </div>
        </Show>

        {/* Actions */}
        <div class="flex justify-end gap-2">
          <Show when={!rejectMode()}>
            <Button type="button" variant="ghost" size="normal" onClick={handleDismiss} disabled={submitting()}>
              Dismiss
            </Button>
            <Button type="button" variant="ghost" size="normal" onClick={handleReject} disabled={submitting()}>
              Reject
            </Button>
            <Button type="button" variant="primary" size="normal" onClick={handleApprove} disabled={submitting()}>
              {submitting() ? "Approving..." : "Approve"}
            </Button>
          </Show>
          <Show when={rejectMode()}>
            <Button type="button" variant="ghost" size="normal" onClick={handleCancelReject} disabled={submitting()}>
              Cancel
            </Button>
            <Button type="button" variant="primary" size="normal" onClick={handleReject} disabled={submitting()}>
              {submitting() ? "Submitting..." : "Submit Feedback"}
            </Button>
          </Show>
        </div>
      </div>
    </div>
  )
}

/**
 * @deprecated Use PlanReviewContent (inline) + PlanReviewControls (docked) instead
 */
export const PlanReviewInline: Component<{ request: PlanReviewRequest }> = (props) => {
  return <PlanReviewContent request={props.request} />
}
