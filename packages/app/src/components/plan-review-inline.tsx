import { Component, createEffect, createSignal, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { TextField } from "@opencode-ai/ui/text-field"
import { Icon } from "@opencode-ai/ui/icon"
import { Markdown } from "@opencode-ai/ui/markdown"
import { useSDK } from "@/context/sdk"
import type { PlanReviewRequest } from "@opencode-ai/sdk/v2/client"

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
    <div class="px-4 md:px-6 py-4 border-l-4 border-l-yellow-500 bg-yellow-500/5">
      {/* Header row with icon and title */}
      <div class="flex items-center gap-2 mb-3">
        <Icon name="checklist" class="size-4 text-yellow-600" />
        <span class="text-14-semibold text-text-base">Plan Review</span>
      </div>
      <div class="text-12-regular text-text-weak mb-3">{props.request.filePath}</div>

      {/* Plan content with markdown */}
      <div class="border border-border-base rounded-md overflow-hidden bg-background-base">
        <Show when={loading()}>
          <div class="p-4 text-text-weak">Loading plan...</div>
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
    <div class="border-l-4 border-l-yellow-500 bg-yellow-500/5 px-4 md:px-6 py-3">
      {/* Awaiting Approval badge */}
      <div class="flex items-center gap-2 mb-3">
        <span class="text-11-medium text-yellow-600 bg-yellow-500/15 px-1.5 py-0.5 rounded">
          Awaiting Approval
        </span>
      </div>

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
  )
}

/**
 * @deprecated Use PlanReviewContent (inline) + PlanReviewControls (docked) instead
 */
export const PlanReviewInline: Component<{ request: PlanReviewRequest }> = (props) => {
  return <PlanReviewContent request={props.request} />
}
