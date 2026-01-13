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

export function PlanReviewPrompt(props: { request: PlanReviewRequest }) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const keybind = useKeybind()
  const bindings = useTextareaKeybindings()

  const [content, setContent] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [rejectMode, setRejectMode] = createSignal(false)
  const [scrollOffset, setScrollOffset] = createSignal(0)

  let textarea: TextareaRenderable | undefined

  // Load plan content on mount
  createEffect(async () => {
    try {
      const result = await Bun.file(props.request.filePath).text()
      setContent(result)
    } catch {
      setContent("(Unable to read plan file)")
    } finally {
      setLoading(false)
    }
  })

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

  const contentLines = () => {
    const c = content()
    if (!c) return []
    return c.split("\n")
  }

  const visibleLines = () => {
    const lines = contentLines()
    const offset = scrollOffset()
    const maxVisible = 20 // Show max 20 lines at a time
    return lines.slice(offset, offset + maxVisible)
  }

  const canScrollUp = () => scrollOffset() > 0
  const canScrollDown = () => scrollOffset() + 20 < contentLines().length

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

    // Scroll navigation
    if (evt.name === "up" || evt.name === "k") {
      evt.preventDefault()
      if (canScrollUp()) {
        setScrollOffset((o) => o - 1)
      }
      return
    }

    if (evt.name === "down" || evt.name === "j") {
      evt.preventDefault()
      if (canScrollDown()) {
        setScrollOffset((o) => o + 1)
      }
      return
    }

    if (evt.name === "pageup") {
      evt.preventDefault()
      setScrollOffset((o) => Math.max(0, o - 10))
      return
    }

    if (evt.name === "pagedown") {
      evt.preventDefault()
      setScrollOffset((o) => Math.min(contentLines().length - 20, o + 10))
      return
    }
  })

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.accent}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
        {/* Header */}
        <box paddingLeft={1}>
          <text>
            <span style={{ fg: theme.text, bold: true }}>Plan Review</span>
          </text>
        </box>

        <box paddingLeft={1}>
          <text fg={theme.textMuted}>{props.request.filePath}</text>
        </box>

        {/* Content */}
        <Show when={loading()}>
          <box paddingLeft={1}>
            <text fg={theme.textMuted}>Loading plan...</text>
          </box>
        </Show>

        <Show when={!loading()}>
          <box paddingLeft={1} flexDirection="column">
            {visibleLines().map((line) => (
              <text fg={theme.text}>{line || " "}</text>
            ))}
            <Show when={canScrollDown()}>
              <text fg={theme.textMuted}>... ({contentLines().length - scrollOffset() - 20} more lines)</text>
            </Show>
          </box>
        </Show>

        {/* Reject feedback input */}
        <Show when={rejectMode()}>
          <box paddingLeft={1} gap={1}>
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
      </box>

      {/* Footer with keybindings */}
      <box
        flexDirection="row"
        flexShrink={0}
        gap={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        justifyContent="space-between"
      >
        <box flexDirection="row" gap={2}>
          <Show when={!rejectMode()}>
            <text fg={theme.text}>
              {"↑↓"} <span style={{ fg: theme.textMuted }}>scroll</span>
            </text>
            <text fg={theme.text}>
              enter <span style={{ fg: theme.textMuted }}>approve</span>
            </text>
            <text fg={theme.text}>
              r <span style={{ fg: theme.textMuted }}>reject</span>
            </text>
            <text fg={theme.text}>
              esc <span style={{ fg: theme.textMuted }}>dismiss</span>
            </text>
          </Show>
          <Show when={rejectMode()}>
            <text fg={theme.text}>
              enter <span style={{ fg: theme.textMuted }}>submit feedback</span>
            </text>
            <text fg={theme.text}>
              esc <span style={{ fg: theme.textMuted }}>cancel</span>
            </text>
          </Show>
        </box>
      </box>
    </box>
  )
}
