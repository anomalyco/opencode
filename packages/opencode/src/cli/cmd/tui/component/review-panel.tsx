import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useReview, type ReviewStatus } from "../context/review"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { InputRenderable, RGBA } from "@opentui/core"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "../context/sync"
import { useKeybind } from "../context/keybind"
import { createTwoFilesPatch } from "diff"
import path from "path"

interface ReviewPanelProps {
  sessionID: string
  onSendFeedback?: (message: string) => void
  onClose?: () => void
}

// Helper to get file extension for syntax highlighting
function filetype(filepath: string): string {
  const ext = path.extname(filepath).slice(1)
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    html: "html",
    css: "css",
    scss: "scss",
    sql: "sql",
  }
  return map[ext] ?? ext
}

// Button component with hover effect
interface ButtonProps {
  label: string
  onClick: () => void
  color: RGBA
  hoverColor: RGBA
  textColor: RGBA
  hoverTextColor: RGBA
  active?: boolean
  activeColor?: RGBA
  activeTextColor?: RGBA
}

function Button(props: ButtonProps) {
  const [hover, setHover] = createSignal(false)

  const bg = () => {
    if (props.active && props.activeColor) return props.activeColor
    return hover() ? props.hoverColor : props.color
  }

  const fg = () => {
    if (props.active && props.activeTextColor) return props.activeTextColor
    return hover() ? props.hoverTextColor : props.textColor
  }

  return (
    <box
      backgroundColor={bg()}
      paddingLeft={2}
      paddingRight={2}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseDown={props.onClick}
    >
      <text fg={fg()}>{props.label}</text>
    </box>
  )
}

export function ReviewPanel(props: ReviewPanelProps) {
  const { theme, syntax } = useTheme()
  const review = useReview()
  const sync = useSync()
  const dimensions = useTerminalDimensions()
  const dialog = useDialog()
  const keybind = useKeybind()

  const [feedbackInput, setFeedbackInput] = createSignal("")
  const [isRejectMode, setIsRejectMode] = createSignal(false)
  let feedbackInputRef: InputRenderable | undefined

  // Reset state when session changes
  createEffect(
    on(
      () => props.sessionID,
      () => {
        setIsRejectMode(false)
        setFeedbackInput("")
      },
      { defer: true },
    ),
  )

  const diffs = createMemo(() => review.getDiffs(props.sessionID))
  const reviews = createMemo(() => review.getSessionReviews(props.sessionID))
  const pendingCount = createMemo(() => review.getPendingCount(props.sessionID))
  const selectedIndex = createMemo(() => {
    const idx = review.getSelectedIndex(props.sessionID)
    const maxIdx = diffs().length - 1
    return Math.min(Math.max(0, idx), Math.max(0, maxIdx))
  })

  // Get diff style preference
  const diffStyle = createMemo(() => sync.data.config.tui?.diff_style)

  // Generate unified diff for selected file
  const selectedDiff = createMemo(() => {
    const diff = diffs()[selectedIndex()]
    if (!diff) return null
    const unifiedDiff = createTwoFilesPatch(diff.file, diff.file, diff.before, diff.after, "before", "after")
    return {
      file: diff.file,
      diff: unifiedDiff,
      additions: diff.additions,
      deletions: diff.deletions,
    }
  })

  // Determine diff view style based on width
  const diffViewStyle = createMemo(() => {
    if (diffStyle() === "stacked") return "unified"
    return dimensions().width > 120 ? "split" : "unified"
  })

  // Current file's review
  const currentReview = createMemo(() => reviews()[selectedIndex()]?.review)

  // When entering reject mode, populate with existing feedback
  createEffect(
    on(
      () => isRejectMode(),
      (rejecting) => {
        if (rejecting) {
          setFeedbackInput(currentReview()?.feedback ?? "")
          setTimeout(() => feedbackInputRef?.focus(), 10)
        }
      },
    ),
  )

  // Handle approve action (no auto-advance, just mark as approved)
  const handleApprove = () => {
    review.approveCurrent(props.sessionID)
  }

  // Handle reject action (toggle reject mode for inline input)
  const handleReject = () => {
    if (diffs().length > 0) {
      if (isRejectMode()) {
        // Confirm rejection
        const file = diffs()[selectedIndex()]?.file
        if (file) {
          review.rejectAndAdvance(props.sessionID, feedbackInput() || undefined)
        }
        setIsRejectMode(false)
        setFeedbackInput("")
      } else {
        setIsRejectMode(true)
      }
    }
  }

  // Handle reset to pending
  const handleReset = () => {
    review.resetCurrent(props.sessionID)
    setIsRejectMode(false)
    setFeedbackInput("")
  }

  // Handle approve all
  const handleApproveAll = () => {
    review.approveAll(props.sessionID)
  }

  // Keyboard navigation
  useKeyboard((evt) => {
    if (review.viewMode === "hidden") return
    // Skip processing if a dialog (e.g., command palette) is open
    if (dialog.stack.length > 0) return

    // When in reject mode, handle escape and return specially
    if (isRejectMode()) {
      if (evt.name === "escape") {
        setIsRejectMode(false)
        setFeedbackInput("")
        evt.preventDefault()
        return
      }
      if (evt.name === "return" && !evt.shift && !evt.ctrl && !evt.meta && !evt.super) {
        handleReject() // Confirm rejection
        evt.preventDefault()
        return
      }
      // Let all other keys pass through to the input
      return
    }

    // Approve current file
    if (keybind.match("review_approve", evt)) {
      handleApprove()
      evt.preventDefault()
      return
    }

    // Reject (toggle reject mode)
    if (keybind.match("review_reject", evt)) {
      handleReject()
      evt.preventDefault()
      return
    }

    // Reset to pending
    if (keybind.match("review_reset", evt)) {
      handleReset()
      evt.preventDefault()
      return
    }

    // Approve all
    if (keybind.match("review_approve_all", evt)) {
      handleApproveAll()
      evt.preventDefault()
      return
    }

    // Navigation with j/k only when not in text input
    if (!evt.defaultPrevented) {
      if (keybind.match("review_next", evt) || evt.name === "down") {
        review.selectNext(props.sessionID)
        evt.preventDefault()
        return
      }
      if (keybind.match("review_prev", evt) || evt.name === "up") {
        review.selectPrev(props.sessionID)
        evt.preventDefault()
        return
      }
    }

    // Submit review
    if (keybind.match("review_submit", evt)) {
      const message = review.generateFeedbackMessage(props.sessionID)
      if (message && props.onSendFeedback) {
        props.onSendFeedback(message)
        review.clearSession(props.sessionID)
        review.hide()
      }
      evt.preventDefault()
      return
    }

    // Escape to close
    if (evt.name === "escape") {
      review.hide()
      props.onClose?.()
      evt.preventDefault()
      return
    }
  })

  const getStatusColor = (status: ReviewStatus) => {
    switch (status) {
      case "approved":
        return theme.success
      case "rejected":
        return theme.error
      default:
        return theme.textMuted
    }
  }

  const getStatusIcon = (status: ReviewStatus) => {
    switch (status) {
      case "approved":
        return "✓"
      case "rejected":
        return "✗"
      default:
        return "○"
    }
  }

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={theme.background}
    >
      {/* Header */}
      <box paddingTop={1} paddingLeft={2} paddingRight={2} flexShrink={0}>
        <box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
          <text fg={theme.text}>
            <b>Review Changes</b>
            <span style={{ fg: theme.textMuted }}>
              {" "}
              ({pendingCount()}/{diffs().length} pending)
            </span>
          </text>
          <text fg={theme.textMuted}>
            <b>a</b> approve | <b>r</b> reject | <b>u</b> reset | <b>A</b> all | <b>j/k</b> nav | <b>S</b> submit |{" "}
            <b>Esc</b> close
          </text>
        </box>
      </box>

      {/* Main content - file list + diff view */}
      <box flexDirection="row" flexGrow={1}>
        {/* File list sidebar */}
        <box
          width={Math.min(50, Math.floor(dimensions().width * 0.25))}
          backgroundColor={theme.backgroundPanel}
          paddingTop={1}
          paddingBottom={1}
        >
          <scrollbox flexGrow={1}>
            <For each={diffs()}>
              {(diff, index) => {
                const isSelected = () => index() === selectedIndex()
                // Use reactive accessor to get status from store
                const status = () => review.getReview(props.sessionID, diff.file)?.status ?? "pending"
                const feedback = () => review.getReview(props.sessionID, diff.file)?.feedback

                return (
                  <box
                    backgroundColor={isSelected() ? theme.backgroundElement : undefined}
                    paddingLeft={2}
                    paddingRight={1}
                    onMouseDown={() => review.selectIndex(props.sessionID, index())}
                  >
                    <box flexDirection="row" gap={1}>
                      <text fg={getStatusColor(status())} flexShrink={0}>
                        {getStatusIcon(status())}
                      </text>
                      <text fg={isSelected() ? theme.text : theme.textMuted} wrapMode="none" flexGrow={1}>
                        {path.basename(diff.file)}
                      </text>
                      <box flexDirection="row" gap={1} flexShrink={0}>
                        <Show when={diff.additions > 0}>
                          <text fg={theme.diffAdded}>+{diff.additions}</text>
                        </Show>
                        <Show when={diff.deletions > 0}>
                          <text fg={theme.diffRemoved}>-{diff.deletions}</text>
                        </Show>
                      </box>
                    </box>
                    <Show when={feedback()}>
                      <text fg={theme.warning} wrapMode="none">
                        {feedback()}
                      </text>
                    </Show>
                  </box>
                )
              }}
            </For>
          </scrollbox>

          {/* Action buttons */}
          <box paddingLeft={2} paddingRight={2} paddingTop={1} gap={1}>
            {/* Approve All button - same style as approve button */}
            <Button
              label={`✓ Approve All (${keybind.display("review_approve_all")})`}
              onClick={handleApproveAll}
              color={theme.backgroundElement}
              hoverColor={theme.success}
              textColor={theme.success}
              hoverTextColor={theme.background}
            />

            {/* Submit button when all reviewed */}
            <Show when={review.allReviewed(props.sessionID)}>
              <Button
                label={`Submit Review (${keybind.display("review_submit")})`}
                onClick={() => {
                  const message = review.generateFeedbackMessage(props.sessionID)
                  if (message && props.onSendFeedback) {
                    props.onSendFeedback(message)
                    review.clearSession(props.sessionID)
                    review.hide()
                  }
                }}
                color={theme.backgroundElement}
                hoverColor={theme.primary}
                textColor={theme.primary}
                hoverTextColor={theme.background}
              />
            </Show>
          </box>
        </box>

        {/* Diff view */}
        <box flexGrow={1} flexDirection="column">
          <Show when={selectedDiff()}>
            {/* File header with action buttons */}
            <box paddingLeft={2} paddingRight={2} paddingTop={1} flexShrink={0}>
              <box flexDirection="row" justifyContent="space-between" alignItems="center">
                <text fg={theme.text}>
                  <b>{selectedDiff()!.file}</b>
                </text>
                <box flexDirection="row" gap={2} alignItems="center">
                  <Show when={selectedDiff()!.additions > 0}>
                    <text fg={theme.diffAdded}>+{selectedDiff()!.additions}</text>
                  </Show>
                  <Show when={selectedDiff()!.deletions > 0}>
                    <text fg={theme.diffRemoved}>-{selectedDiff()!.deletions}</text>
                  </Show>
                  <text fg={getStatusColor(currentReview()?.status ?? "pending")}>
                    {getStatusIcon(currentReview()?.status ?? "pending")} {currentReview()?.status ?? "pending"}
                  </text>
                </box>
              </box>

              {/* Action buttons row */}
              <box flexDirection="row" gap={2} paddingTop={1}>
                <Button
                  label="✓ Approve"
                  onClick={handleApprove}
                  color={theme.backgroundElement}
                  hoverColor={theme.success}
                  textColor={theme.success}
                  hoverTextColor={theme.background}
                  active={currentReview()?.status === "approved"}
                  activeColor={theme.success}
                  activeTextColor={theme.background}
                />
                <Button
                  label="✗ Reject"
                  onClick={handleReject}
                  color={theme.backgroundElement}
                  hoverColor={theme.error}
                  textColor={theme.error}
                  hoverTextColor={theme.background}
                  active={currentReview()?.status === "rejected"}
                  activeColor={theme.error}
                  activeTextColor={theme.background}
                />
                <Show when={currentReview()?.status !== "pending"}>
                  <Button
                    label="↺ Reset"
                    onClick={handleReset}
                    color={theme.backgroundElement}
                    hoverColor={theme.backgroundMenu}
                    textColor={theme.textMuted}
                    hoverTextColor={theme.text}
                  />
                </Show>
              </box>
            </box>

            {/* Inline rejection reason input */}
            <Show when={isRejectMode()}>
              <box paddingLeft={2} paddingRight={2} paddingTop={1} flexShrink={0}>
                <box
                  backgroundColor={theme.backgroundElement}
                  paddingTop={1}
                  paddingBottom={1}
                  paddingLeft={1}
                  paddingRight={1}
                  flexDirection="row"
                  gap={1}
                >
                  <text fg={theme.error} flexShrink={0}>
                    Reason:
                  </text>
                  <input
                    ref={(r) => {
                      feedbackInputRef = r
                    }}
                    value={feedbackInput()}
                    onInput={(value) => setFeedbackInput(value)}
                    placeholder="Optional rejection reason... (Enter to confirm, Esc to cancel)"
                    focusedBackgroundColor={theme.backgroundElement}
                    cursorColor={theme.primary}
                    focusedTextColor={theme.text}
                    flexGrow={1}
                  />
                </box>
              </box>
            </Show>

            {/* Show existing feedback if rejected */}
            <Show when={!isRejectMode() && currentReview()?.status === "rejected" && currentReview()?.feedback}>
              <box paddingLeft={2} paddingRight={2} paddingTop={1} flexShrink={0}>
                <text fg={theme.warning}>
                  <b>Reason:</b> {currentReview()?.feedback}
                </text>
              </box>
            </Show>

            <scrollbox flexGrow={1} paddingLeft={1} paddingRight={1} paddingTop={1}>
              <diff
                diff={selectedDiff()!.diff}
                view={diffViewStyle()}
                filetype={filetype(selectedDiff()!.file)}
                syntaxStyle={syntax()}
                showLineNumbers={true}
                width="100%"
                fg={theme.text}
                addedBg={theme.diffAddedBg}
                removedBg={theme.diffRemovedBg}
                contextBg={theme.diffContextBg}
                addedSignColor={theme.diffHighlightAdded}
                removedSignColor={theme.diffHighlightRemoved}
                lineNumberFg={theme.diffLineNumber}
                lineNumberBg={theme.diffContextBg}
                addedLineNumberBg={theme.diffAddedLineNumberBg}
                removedLineNumberBg={theme.diffRemovedLineNumberBg}
              />
            </scrollbox>
          </Show>
          <Show when={!selectedDiff()}>
            <box flexGrow={1} alignItems="center" justifyContent="center">
              <text fg={theme.textMuted}>No changes to review</text>
            </box>
          </Show>
        </box>
      </box>
    </box>
  )
}
