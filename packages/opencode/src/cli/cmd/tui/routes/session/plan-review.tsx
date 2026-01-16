import { createSignal, createEffect, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import type { TextareaRenderable } from "@opentui/core"
import { useKeybind } from "../../context/keybind"
import { useTheme } from "../../context/theme"
import { useSDK } from "../../context/sdk"
import { SplitBorder } from "../../component/border"
import { useTextareaKeybindings } from "../../component/textarea-keybindings"
import type { PlanReview } from "@/session/plan-review"

type PlanReviewRequest = PlanReview.Request

/**
 * Inline plan content that displays in the chat history (scrollable)
 * This is ephemeral - it disappears when the plan is approved/rejected
 */
export function PlanReviewContent(props: { request: PlanReviewRequest }) {
  const { theme, syntax } = useTheme()

  const [content, setContent] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(true)

  // Load plan content - tracks props.request.id reactively
  createEffect(() => {
    const filePath = props.request.filePath
    setLoading(true)
    setContent(null)

    Bun.file(filePath).text()
      .then((result) => {
        setContent(result)
      })
      .catch(() => {
        setContent("(Unable to read plan file)")
      })
      .finally(() => {
        setLoading(false)
      })
  })

  return (
    <box
      marginTop={1}
      border={["left"]}
      borderColor={theme.warning}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        backgroundColor={theme.backgroundPanel}
        flexShrink={0}
        gap={1}
      >
        {/* Header */}
        <text fg={theme.text}>
          <span style={{ bold: true }}>Plan Review</span>
          <span style={{ fg: theme.textMuted }}> · {props.request.filePath}</span>
        </text>

        {/* Content with markdown rendering */}
        <Show when={loading()}>
          <text fg={theme.textMuted}>Loading plan...</text>
        </Show>

        <Show when={!loading() && content()}>
          <box paddingTop={1}>
            <code
              filetype="markdown"
              drawUnstyledText={false}
              streaming={false}
              syntaxStyle={syntax()}
              content={content()!}
              conceal={false}
              fg={theme.text}
            />
          </box>
        </Show>
      </box>
    </box>
  )
}

/**
 * Docked controls for plan review (keyboard hints, feedback input)
 */
export function PlanReviewControls(props: { request: PlanReviewRequest }) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const keybind = useKeybind()
  const bindings = useTextareaKeybindings()

  const [rejectMode, setRejectMode] = createSignal(false)

  let textarea: TextareaRenderable | undefined

  function approve() {
    sdk.client.planReview.approve({
      requestID: props.request.id,
    })
  }

  function reject(feedback?: string) {
    sdk.client.planReview.reject({
      requestID: props.request.id,
      feedback,
    })
  }

  useKeyboard((evt) => {
    // When in reject mode (typing feedback)
    if (rejectMode()) {
      if (evt.name === "escape") {
        evt.preventDefault()
        setRejectMode(false)
        return
      }
      if (evt.name === "return") {
        evt.preventDefault()
        const feedback = textarea?.plainText?.trim() ?? ""
        reject(feedback || undefined)
        return
      }
      // Let textarea handle all other keys
      return
    }

    // Normal mode
    if (evt.name === "return") {
      evt.preventDefault()
      approve()
      return
    }

    if (evt.name === "r") {
      evt.preventDefault()
      setRejectMode(true)
      return
    }

    if (evt.name === "escape" || keybind.match("app_exit", evt)) {
      evt.preventDefault()
      reject()
      return
    }
  })

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.warning}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box paddingLeft={2} paddingRight={3} paddingTop={1} paddingBottom={1} gap={1}>
        {/* Awaiting Approval badge */}
        <text fg={theme.textMuted}>
          <span style={{ bg: theme.warning, fg: theme.background, bold: true }}> AWAITING APPROVAL </span>
        </text>

        {/* Reject feedback input */}
        <Show when={rejectMode()}>
          <box gap={1}>
            <text fg={theme.text}>Feedback (optional):</text>
            <textarea
              ref={(val: TextareaRenderable) => (textarea = val)}
              focused
              placeholder="Enter feedback for revision..."
              textColor={theme.text}
              focusedTextColor={theme.text}
              cursorColor={theme.primary}
              keyBindings={bindings()}
            />
          </box>
        </Show>

        {/* Keyboard hints */}
        <box flexDirection="row" gap={2}>
          <Show when={!rejectMode()}>
            <text fg={theme.textMuted}>
              <span style={{ fg: theme.text }}>enter</span> approve
            </text>
            <text fg={theme.textMuted}>
              <span style={{ fg: theme.text }}>r</span> reject
            </text>
            <text fg={theme.textMuted}>
              <span style={{ fg: theme.text }}>esc</span> dismiss
            </text>
          </Show>
          <Show when={rejectMode()}>
            <text fg={theme.textMuted}>
              <span style={{ fg: theme.text }}>enter</span> submit feedback
            </text>
            <text fg={theme.textMuted}>
              <span style={{ fg: theme.text }}>esc</span> cancel
            </text>
          </Show>
        </box>
      </box>
    </box>
  )
}
