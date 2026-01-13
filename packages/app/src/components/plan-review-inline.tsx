import { Component, createEffect, createSignal, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { TextField } from "@opencode-ai/ui/text-field"
import { useSDK } from "@/context/sdk"
import type { PlanReviewRequest } from "@opencode-ai/sdk/v2/client"

export const PlanReviewInline: Component<{ request: PlanReviewRequest }> = (props) => {
  const sdk = useSDK()

  const [content, setContent] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [rejectMode, setRejectMode] = createSignal(false)
  const [feedback, setFeedback] = createSignal("")
  const [submitting, setSubmitting] = createSignal(false)

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
    <div class="border border-border-base rounded-md overflow-hidden bg-background-base shadow-lg">
      <div class="px-4 py-3 border-b border-border-base bg-background-stronger">
        <div class="text-14-semibold text-text-base">Plan Review</div>
        <div class="text-12-regular text-text-weak mt-0.5">{props.request.filePath}</div>
      </div>

      <div class="p-4 bg-background-base">
        {/* Plan content */}
        <div class="border border-border-base rounded-md overflow-hidden mb-4">
          <div class="max-h-64 overflow-auto p-3 bg-background-stronger">
            <Show when={loading()}>
              <span class="text-text-weak text-14-regular">Loading plan...</span>
            </Show>
            <Show when={!loading()}>
              <pre class="text-13-regular text-text-base whitespace-pre-wrap font-mono leading-relaxed">
                {content()}
              </pre>
            </Show>
          </div>
        </div>

        {/* Feedback input (shown in reject mode) */}
        <Show when={rejectMode()}>
          <div class="mb-4">
            <TextField
              autofocus
              label="Feedback (optional)"
              placeholder="Enter feedback for revision..."
              value={feedback()}
              onChange={setFeedback}
            />
          </div>
        </Show>

        {/* Actions */}
        <div class="flex justify-end gap-2">
          <Show when={!rejectMode()}>
            <Button
              type="button"
              variant="ghost"
              size="normal"
              onClick={handleDismiss}
              disabled={submitting()}
            >
              Dismiss
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="normal"
              onClick={handleReject}
              disabled={submitting()}
            >
              Reject
            </Button>
            <Button
              type="button"
              variant="primary"
              size="normal"
              onClick={handleApprove}
              disabled={submitting() || loading()}
            >
              {submitting() ? "Approving..." : "Approve"}
            </Button>
          </Show>
          <Show when={rejectMode()}>
            <Button
              type="button"
              variant="ghost"
              size="normal"
              onClick={handleCancelReject}
              disabled={submitting()}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="normal"
              onClick={handleReject}
              disabled={submitting()}
            >
              {submitting() ? "Submitting..." : "Submit Feedback"}
            </Button>
          </Show>
        </div>
      </div>
    </div>
  )
}
