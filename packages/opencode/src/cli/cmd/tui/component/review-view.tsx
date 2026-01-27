import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useReview, type Change } from "../context/review"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { InputRenderable, RGBA } from "@opentui/core"
import { useDialog } from "@tui/ui/dialog"
import { useKeybind } from "../context/keybind"
import { formatPatch } from "diff"
import path from "path"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"

interface ReviewViewProps {
  sessionID: string
  onSendFeedback?: (message: string) => void
  onClose?: () => void
}

// Helper to get file extension for syntax highlighting
function filetype(input?: string) {
  if (!input) return "none"
  const ext = path.extname(input)
  const language = LANGUAGE_EXTENSIONS[ext]
  if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
  return language
}

// Button component with hover effect
interface ButtonProps {
  label: string
  onClick: () => void
  color: RGBA
  hoverColor: RGBA
  textColor: RGBA
  hoverTextColor: RGBA
}

function Button(props: ButtonProps) {
  const [hover, setHover] = createSignal(false)

  return (
    <box
      backgroundColor={hover() ? props.hoverColor : props.color}
      paddingLeft={2}
      paddingRight={2}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseDown={props.onClick}
    >
      <text fg={hover() ? props.hoverTextColor : props.textColor}>{props.label}</text>
    </box>
  )
}

// Generate a unified diff string for a single hunk
function formatHunkDiff(file: string, change: Change): string {
  const hunk = change.hunk
  // Format as a proper unified diff patch
  const patch = formatPatch({
    oldFileName: file,
    newFileName: file,
    oldHeader: "before",
    newHeader: "after",
    hunks: [hunk],
  })
  return patch
}

export function ReviewView(props: ReviewViewProps) {
  const { theme, syntax } = useTheme()
  const review = useReview()
  const dimensions = useTerminalDimensions()
  const dialog = useDialog()
  const keybind = useKeybind()

  const [commentDraft, setCommentDraft] = createSignal("")
  const [activeChangeId, setActiveChangeId] = createSignal<string | null>(null)
  const inputRefs: Record<string, InputRenderable | undefined> = {}

  // Reset state when session changes
  createEffect(
    on(
      () => props.sessionID,
      () => {
        setCommentDraft("")
        setActiveChangeId(null)
      },
      { defer: true },
    ),
  )

  const diffs = createMemo(() => review.getDiffs(props.sessionID))
  const openFiles = createMemo(() => review.getOpenFiles(props.sessionID))
  const commentCount = createMemo(() => review.getCommentCount(props.sessionID))
  const selectedChange = createMemo(() => review.getSelectedChange(props.sessionID))

  // Initialize open files if empty and there are diffs
  createEffect(
    on(
      () => diffs().length,
      (length) => {
        if (length > 0 && openFiles().length === 0) {
          // Auto-expand first 10 files
          const files = diffs()
            .slice(0, 10)
            .map((d) => d.file)
          review.setOpenFiles(props.sessionID, files)
        }
      },
    ),
  )

  // Handle expand/collapse all
  const handleToggleAll = () => {
    if (openFiles().length > 0) {
      review.collapseAll(props.sessionID)
    } else {
      review.expandAll(props.sessionID)
    }
  }

  // Handle file toggle
  const handleToggleFile = (file: string) => {
    review.toggleFile(props.sessionID, file)
  }

  // Handle clicking on a change - select it and open comment input
  const handleChangeClick = (file: string, changeId: string) => {
    review.selectChange(props.sessionID, file, changeId)
    setActiveChangeId(changeId)
    setTimeout(() => inputRefs[changeId]?.focus(), 10)
  }

  // Handle adding a comment
  const handleAddComment = (file: string, changeId: string) => {
    const text = commentDraft().trim()
    if (text) {
      review.addComment(props.sessionID, file, changeId, text)
      setCommentDraft("")
      setActiveChangeId(null)
    }
  }

  // Handle submit - send feedback to agent
  const handleSubmit = () => {
    const message = review.generateFeedbackMessage(props.sessionID)
    if (message && props.onSendFeedback) {
      props.onSendFeedback(message)
    }
    review.clearSession(props.sessionID)
    review.hide()
  }

  // Keyboard navigation
  useKeyboard((evt) => {
    if (review.viewMode === "hidden") return
    if (dialog.stack.length > 0) return

    // When in comment mode, handle escape and return
    if (activeChangeId()) {
      if (evt.name === "escape") {
        setActiveChangeId(null)
        setCommentDraft("")
        evt.preventDefault()
        return
      }
      if (evt.name === "return" && !evt.shift && !evt.ctrl && !evt.meta && !evt.super) {
        const change = selectedChange()
        if (change) {
          handleAddComment(change.file, change.changeId)
        }
        evt.preventDefault()
        return
      }
      return
    }

    // Navigate to next change
    if (keybind.match("review_next_change", evt) || evt.name === "down" || evt.name === "j") {
      review.selectNextChange(props.sessionID)
      evt.preventDefault()
      return
    }

    // Navigate to previous change
    if (keybind.match("review_prev_change", evt) || evt.name === "up" || evt.name === "k") {
      review.selectPrevChange(props.sessionID)
      evt.preventDefault()
      return
    }

    // Start commenting on selected change
    if (keybind.match("review_comment", evt) || evt.name === "c") {
      const change = selectedChange()
      if (change) {
        setActiveChangeId(change.changeId)
        setTimeout(() => inputRefs[change.changeId]?.focus(), 10)
      }
      evt.preventDefault()
      return
    }

    // Submit feedback
    if (keybind.match("review_submit", evt)) {
      handleSubmit()
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
            <b>Session changes</b>
            <span style={{ fg: theme.textMuted }}>
              {" "}
              ({diffs().length} files, {commentCount()} comments)
            </span>
          </text>
          <box flexDirection="row" gap={2}>
            <text fg={theme.textMuted}>
              <b>j/k</b> nav | <b>c</b> comment | <b>S</b> submit | <b>Esc</b> close
            </text>
          </box>
        </box>
      </box>

      {/* Toolbar */}
      <box paddingLeft={2} paddingRight={2} paddingBottom={1} flexShrink={0}>
        <box flexDirection="row" gap={2}>
          <Button
            label={openFiles().length > 0 ? "Collapse all" : "Expand all"}
            onClick={handleToggleAll}
            color={theme.backgroundElement}
            hoverColor={theme.backgroundMenu}
            textColor={theme.textMuted}
            hoverTextColor={theme.text}
          />
          <Show when={commentCount() > 0}>
            <Button
              label={`Submit feedback (${keybind.display("review_submit")})`}
              onClick={handleSubmit}
              color={theme.backgroundElement}
              hoverColor={theme.primary}
              textColor={theme.primary}
              hoverTextColor={theme.background}
            />
          </Show>
        </box>
      </box>

      {/* File list with accordion */}
      <scrollbox flexGrow={1} paddingLeft={1} paddingRight={1}>
        <For each={diffs()}>
          {(diff) => {
            const isOpen = () => openFiles().includes(diff.file)
            const changes = createMemo(() => review.getChanges(diff))
            const fileComments = createMemo(() => review.getFileComments(props.sessionID, diff.file))
            const fileCommentCount = createMemo(() => {
              const fc = fileComments()
              let count = 0
              for (const changeId of Object.keys(fc)) {
                count += fc[changeId].length
              }
              return count
            })

            return (
              <box flexDirection="column" marginBottom={1}>
                {/* File header */}
                <box
                  backgroundColor={theme.backgroundPanel}
                  paddingLeft={2}
                  paddingRight={2}
                  onMouseDown={() => handleToggleFile(diff.file)}
                >
                  <box flexDirection="row" justifyContent="space-between">
                    <box flexDirection="row" gap={1}>
                      <text fg={theme.textMuted}>{isOpen() ? "▼" : "▶"}</text>
                      <text fg={theme.text}>{path.basename(diff.file)}</text>
                      <text fg={theme.textMuted}>{path.dirname(diff.file)}</text>
                    </box>
                    <box flexDirection="row" gap={2}>
                      <Show when={fileCommentCount() > 0}>
                        <text fg={theme.warning}>{fileCommentCount()} comments</text>
                      </Show>
                      <Show when={diff.additions > 0}>
                        <text fg={theme.diffAdded}>+{diff.additions}</text>
                      </Show>
                      <Show when={diff.deletions > 0}>
                        <text fg={theme.diffRemoved}>-{diff.deletions}</text>
                      </Show>
                    </box>
                  </box>
                </box>

                {/* File content when expanded - show each change with its diff and comment UI inline */}
                <Show when={isOpen()}>
                  <box flexDirection="column">
                    <For each={changes()}>
                      {(change) => {
                        const isSelected = () =>
                          selectedChange()?.changeId === change.id && selectedChange()?.file === diff.file
                        const isCommenting = () => activeChangeId() === change.id
                        const comments = createMemo(() => review.getComments(props.sessionID, diff.file, change.id))
                        const hunkDiff = createMemo(() => formatHunkDiff(diff.file, change))

                        return (
                          <box
                            flexDirection="column"
                            marginTop={1}
                            onMouseDown={() => handleChangeClick(diff.file, change.id)}
                          >
                            {/* Change header with line range - no left padding, aligns with diff */}
                            <box
                              flexDirection="row"
                              justifyContent="space-between"
                              backgroundColor={isSelected() ? theme.backgroundElement : theme.backgroundPanel}
                              paddingRight={2}
                            >
                              <text fg={isSelected() ? theme.text : theme.textMuted}>
                                Lines {change.hunk.newStart}-{change.hunk.newStart + change.hunk.newLines - 1}
                                {isSelected() && !isCommenting() ? " (click or press c to comment)" : ""}
                              </text>
                              <Show when={comments().length > 0}>
                                <text fg={theme.warning}>{comments().length} comments</text>
                              </Show>
                            </box>

                            {/* Diff view for this specific hunk */}
                            <box backgroundColor={isSelected() ? theme.backgroundElement : undefined}>
                              <diff
                                diff={hunkDiff()}
                                view="unified"
                                filetype={filetype(diff.file)}
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
                            </box>

                            {/* Comment input - appears directly below the hunk when active */}
                            <Show when={isCommenting()}>
                              <box
                                backgroundColor={theme.backgroundElement}
                                paddingTop={1}
                                paddingBottom={1}
                                paddingLeft={1}
                                paddingRight={1}
                                flexDirection="row"
                                gap={1}
                              >
                                <text fg={theme.primary} flexShrink={0}>
                                  Comment:
                                </text>
                                <input
                                  ref={(r) => {
                                    inputRefs[change.id] = r
                                  }}
                                  value={commentDraft()}
                                  onInput={(value) => setCommentDraft(value)}
                                  placeholder="Type your comment... (Enter to submit, Esc to cancel)"
                                  focusedBackgroundColor={theme.backgroundElement}
                                  cursorColor={theme.primary}
                                  focusedTextColor={theme.text}
                                  flexGrow={1}
                                />
                              </box>
                            </Show>

                            {/* Existing comments for this change */}
                            <Show when={comments().length > 0}>
                              <box marginTop={1} flexDirection="column" gap={1}>
                                <For each={comments()}>
                                  {(comment) => (
                                    <box
                                      backgroundColor={theme.backgroundPanel}
                                      paddingLeft={1}
                                      paddingRight={1}
                                      paddingTop={1}
                                      paddingBottom={1}
                                    >
                                      <text fg={theme.text}>{comment.text}</text>
                                    </box>
                                  )}
                                </For>
                              </box>
                            </Show>
                          </box>
                        )
                      }}
                    </For>
                  </box>
                </Show>
              </box>
            )
          }}
        </For>

        <Show when={diffs().length === 0}>
          <box flexGrow={1} alignItems="center" justifyContent="center">
            <text fg={theme.textMuted}>No changes to review</text>
          </box>
        </Show>
      </scrollbox>
    </box>
  )
}
