import { Accordion } from "./accordion"
import { Button } from "./button"
import { DropdownMenu } from "./dropdown-menu"
import { RadioGroup } from "./radio-group"
import { DiffChanges } from "./diff-changes"
import { FileIcon } from "./file-icon"
import { Icon } from "./icon"
import { IconButton } from "./icon-button"
import { StickyAccordionHeader } from "./sticky-accordion-header"
import { Tooltip } from "./tooltip"
import { ScrollView } from "./scroll-view"
import { useFileComponent } from "../context/file"
import { useI18n } from "../context/i18n"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { checksum } from "@opencode-ai/util/encode"
import { createEffect, createMemo, For, Match, onCleanup, Show, Switch, untrack, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { type FileContent, type SnapshotFileDiff, type VcsFileDiff } from "@opencode-ai/sdk/v2"
import { PreloadMultiFileDiffResult } from "@pierre/diffs/ssr"
import { type SelectedLineRange } from "@pierre/diffs"
import { Dynamic } from "solid-js/web"
import { mediaKindFromPath } from "../pierre/media"
import { cloneSelectedLineRange, previewSelectedLines } from "../pierre/selection-bridge"
import { createLineCommentController } from "./line-comment-annotations"
import type { LineCommentEditorProps } from "./line-comment"
import { normalize, text, type ViewDiff } from "./session-diff"

const MAX_DIFF_CHANGED_LINES = 500
const REVIEW_MOUNT_MARGIN = 300

export type SessionReviewDiffStyle = "unified" | "split"

export type SessionReviewComment = {
  id: string
  file: string
  selection: SelectedLineRange
  comment: string
}

export type SessionReviewLineComment = {
  file: string
  selection: SelectedLineRange
  comment: string
  preview?: string
}

export type SessionReviewCommentUpdate = SessionReviewLineComment & {
  id: string
}

export type SessionReviewCommentDelete = {
  id: string
  file: string
}

export type SessionReviewCommentActions = {
  moreLabel: string
  editLabel: string
  deleteLabel: string
  saveLabel: string
}

export type SessionReviewFocus = { file: string; id: string }

type ReviewDiff = (SnapshotFileDiff | VcsFileDiff) & { preloaded?: PreloadMultiFileDiffResult<any> }
type Item = ViewDiff & { preloaded?: PreloadMultiFileDiffResult<any> }

function diff(value: unknown): value is ReviewDiff {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  if (!("file" in value) || typeof value.file !== "string") return false
  if (!("additions" in value) || typeof value.additions !== "number") return false
  if (!("deletions" in value) || typeof value.deletions !== "number") return false
  if ("patch" in value && value.patch !== undefined && typeof value.patch !== "string") return false
  if ("before" in value && value.before !== undefined && typeof value.before !== "string") return false
  if ("after" in value && value.after !== undefined && typeof value.after !== "string") return false
  if (!("status" in value) || value.status === undefined) return true
  return value.status === "added" || value.status === "deleted" || value.status === "modified"
}

function list(value: unknown): ReviewDiff[] {
  if (Array.isArray(value) && value.every(diff)) return value
  if (Array.isArray(value)) return value.filter(diff)
  if (diff(value)) return [value]
  if (!value || typeof value !== "object") return []
  return Object.values(value).filter(diff)
}

export interface SessionReviewProps {
  title?: JSX.Element
  empty?: JSX.Element
  split?: boolean
  diffStyle?: SessionReviewDiffStyle
  onDiffStyleChange?: (diffStyle: SessionReviewDiffStyle) => void
  onDiffRendered?: VoidFunction
  onLineComment?: (comment: SessionReviewLineComment) => void
  onLineCommentUpdate?: (comment: SessionReviewCommentUpdate) => void
  onLineCommentDelete?: (comment: SessionReviewCommentDelete) => void
  lineCommentActions?: SessionReviewCommentActions
  comments?: SessionReviewComment[]
  focusedComment?: SessionReviewFocus | null
  onFocusedCommentChange?: (focus: SessionReviewFocus | null) => void
  focusedFile?: string
  open?: string[]
  onOpenChange?: (open: string[]) => void
  scrollRef?: (el: HTMLDivElement) => void
  onScroll?: JSX.EventHandlerUnion<HTMLDivElement, Event>
  class?: string
  classList?: Record<string, boolean | undefined>
  classes?: { root?: string; header?: string; container?: string }
  actions?: JSX.Element
  diffs: ReviewDiff[]
  onViewFile?: (file: string) => void
  readFile?: (path: string) => Promise<FileContent | undefined>
  lineCommentMention?: LineCommentEditorProps["mention"]
}

function ReviewCommentMenu(props: {
  labels: SessionReviewCommentActions
  onEdit: VoidFunction
  onDelete: VoidFunction
}) {
  return (
    <div onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <DropdownMenu gutter={4} placement="bottom-end">
        <DropdownMenu.Trigger
          as={IconButton}
          icon="dot-grid"
          variant="ghost"
          size="small"
          class="size-6 rounded-md"
          aria-label={props.labels.moreLabel}
        />
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <DropdownMenu.Item onSelect={props.onEdit}>
              <DropdownMenu.ItemLabel>{props.labels.editLabel}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={props.onDelete}>
              <DropdownMenu.ItemLabel>{props.labels.deleteLabel}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  )
}

function diffId(file: string): string | undefined {
  const sum = checksum(file)
  if (!sum) return
  return `session-review-diff-${sum}`
}

type SessionReviewSelection = {
  file: string
  range: SelectedLineRange
}

export const SessionReview = (props: SessionReviewProps) => {
  let scroll: HTMLDivElement | undefined
  let focusToken = 0
  let frame: number | undefined
  const i18n = useI18n()
  const fileComponent = useFileComponent()
  const anchors = new Map<string, HTMLElement>()
  const nodes = new Map<string, HTMLDivElement>()
  const [store, setStore] = createStore({
    open: [] as string[],
    visible: {} as Record<string, boolean>,
    force: {} as Record<string, boolean>,
    selection: null as SessionReviewSelection | null,
    commenting: null as SessionReviewSelection | null,
    opened: null as SessionReviewFocus | null,
  })
  const selection = () => store.selection
  const commenting = () => store.commenting
  const opened = () => store.opened

  const open = () => props.open ?? store.open
  const items = createMemo<Item[]>(() =>
    list(props.diffs).map((diff) => ({ ...normalize(diff), preloaded: diff.preloaded })),
  )
  const files = createMemo(() => items().map((diff) => diff.file))
  const grouped = createMemo(() => {
    const next = new Map<string, SessionReviewComment[]>()
    for (const comment of props.comments ?? []) {
      const list = next.get(comment.file)
      if (list) {
        list.push(comment)
        continue
      }
      next.set(comment.file, [comment])
    }
    return next
  })
  const diffStyle = () => props.diffStyle ?? (props.split ? "split" : "unified")
  const hasDiffs = () => files().length > 0

  const syncVisible = () => {
    frame = undefined
    if (!scroll) return

    const root = scroll.getBoundingClientRect()
    const top = root.top - REVIEW_MOUNT_MARGIN
    const bottom = root.bottom + REVIEW_MOUNT_MARGIN
    const openSet = new Set(open())
    const next: Record<string, boolean> = {}

    for (const [file, el] of nodes) {
      if (!openSet.has(file)) continue
      const rect = el.getBoundingClientRect()
      if (rect.bottom < top || rect.top > bottom) continue
      next[file] = true
    }

    const prev = untrack(() => store.visible)
    const prevKeys = Object.keys(prev)
    const nextKeys = Object.keys(next)
    if (prevKeys.length === nextKeys.length && nextKeys.every((file) => prev[file])) return
    setStore("visible", next)
  }

  const queue = () => {
    if (frame !== undefined) return
    frame = requestAnimationFrame(syncVisible)
  }

  const pinned = (file: string) =>
    props.focusedComment?.file === file ||
    props.focusedFile === file ||
    selection()?.file === file ||
    commenting()?.file === file ||
    opened()?.file === file

  const handleScroll: JSX.EventHandler<HTMLDivElement, Event> = (event) => {
    queue()
    const next = props.onScroll
    if (!next) return
    if (Array.isArray(next)) {
      const [fn, data] = next as [(data: unknown, event: Event) => void, unknown]
      fn(data, event)
      return
    }
    ;(next as JSX.EventHandler<HTMLDivElement, Event>)(event)
  }

  onCleanup(() => {
    if (frame === undefined) return
    cancelAnimationFrame(frame)
  })

  createEffect(() => {
    props.open
    files()
    queue()
  })

  const handleChange = (next: string[]) => {
    props.onOpenChange?.(next)
    if (props.open === undefined) setStore("open", next)
    queue()
  }

  const handleExpandOrCollapseAll = () => {
    const next = open().length > 0 ? [] : files()
    handleChange(next)
  }

  const openFileLabel = () => i18n.t("ui.sessionReview.openFile")

  const selectionSide = (range: SelectedLineRange) => range.endSide ?? range.side ?? "additions"

  const selectionPreview = (diff: ViewDiff, range: SelectedLineRange) => {
    const side = selectionSide(range)
    const contents = text(diff, side)
    if (contents.length === 0) return undefined

    return previewSelectedLines(contents, range)
  }

  createEffect(() => {
    const focus = props.focusedComment
    if (!focus) return

    untrack(() => {
      focusToken++
      const token = focusToken

      setStore("opened", focus)

      const comment = (props.comments ?? []).find((c) => c.file === focus.file && c.id === focus.id)
      if (comment) setStore("selection", { file: comment.file, range: cloneSelectedLineRange(comment.selection) })

      const current = open()
      if (!current.includes(focus.file)) {
        handleChange([...current, focus.file])
      }

      const scrollTo = (attempt: number) => {
        if (token !== focusToken) return

        const root = scroll
        if (!root) return

        const wrapper = anchors.get(focus.file)
        const anchor = wrapper?.querySelector(`[data-comment-id="${focus.id}"]`)
        const ready =
          anchor instanceof HTMLElement && anchor.style.pointerEvents !== "none" && anchor.style.opacity !== "0"

        const target = ready ? anchor : wrapper
        if (!target) {
          if (attempt >= 120) return
          requestAnimationFrame(() => scrollTo(attempt + 1))
          return
        }

        const rootRect = root.getBoundingClientRect()
        const targetRect = target.getBoundingClientRect()
        const offset = targetRect.top - rootRect.top
        const next = root.scrollTop + offset - rootRect.height / 2 + targetRect.height / 2
        root.scrollTop = Math.max(0, next)

        if (ready) return
        if (attempt >= 120) return
        requestAnimationFrame(() => scrollTo(attempt + 1))
      }

      requestAnimationFrame(() => scrollTo(0))

      requestAnimationFrame(() => props.onFocusedCommentChange?.(null))
    })
  })

  return (
    <div data-component="session-review" class={props.class} classList={props.classList}>
      <div data-slot="session-review-header" class={props.classes?.header}>
        <div data-slot="session-review-title">
          {props.title === undefined ? i18n.t("ui.sessionReview.title") : props.title}
        </div>
        <div data-slot="session-review-actions">
          <Show when={hasDiffs() && props.onDiffStyleChange}>
            <RadioGroup
              options={["unified", "split"] as const}
              current={diffStyle()}
              size="small"
              value={(style) => style}
              label={(style) =>
                i18n.t(style === "unified" ? "ui.sessionReview.diffStyle.unified" : "ui.sessionReview.diffStyle.split")
              }
              onSelect={(style) => style && props.onDiffStyleChange?.(style)}
            />
          </Show>
          <Show when={hasDiffs()}>
            <Button
              size="small"
              icon="chevron-grabber-vertical"
              class="w-[106px] justify-start"
              onClick={handleExpandOrCollapseAll}
            >
              <Switch>
                <Match when={open().length > 0}>{i18n.t("ui.sessionReview.collapseAll")}</Match>
                <Match when={true}>{i18n.t("ui.sessionReview.expandAll")}</Match>
              </Switch>
            </Button>
          </Show>
          {props.actions}
        </div>
      </div>

      <ScrollView
        data-slot="session-review-scroll"
        viewportRef={(el) => {
          scroll = el
          props.scrollRef?.(el)
          queue()
        }}
        onScroll={handleScroll}
        classList={{
          [props.classes?.root ?? ""]: !!props.classes?.root,
        }}
      >
        <div data-slot="session-review-container" class={props.classes?.container}>
          <Show when={hasDiffs()} fallback={props.empty}>
            <div class="pb-6">
              <Accordion multiple value={open()} onChange={handleChange}>
                <For each={items()}>
                  {(diff) => {
                    let wrapper: HTMLDivElement | undefined
                    const file = diff.file

                    const expanded = createMemo(() => open().includes(file))
                    const mounted = createMemo(() => expanded() && (!!store.visible[file] || pinned(file)))
                    const force = () => !!store.force[file]

                    const comments = createMemo(() => grouped().get(file) ?? [])
                    const commentedLines = createMemo(() => comments().map((c) => c.selection))

                    const beforeText = () => text(diff, "deletions")
                    const afterText = () => text(diff, "additions")
                    const changedLines = () => diff.additions + diff.deletions
                    const mediaKind = createMemo(() => mediaKindFromPath(file))

                    const tooLarge = createMemo(() => {
                      if (!expanded()) return false
                      if (force()) return false
                      if (mediaKind()) return false
                      return changedLines() > MAX_DIFF_CHANGED_LINES
                    })

                    const isAdded = () =>
                      diff.status === "added" || (beforeText().length === 0 && afterText().length > 0)
                    const isDeleted = () =>
                      diff.status === "deleted" || (afterText().length === 0 && beforeText().length > 0)

                    const selectedLines = createMemo(() => {
                      const current = selection()
                      if (!current || current.file !== file) return null
                      return current.range
                    })

                    const draftRange = createMemo(() => {
                      const current = commenting()
                      if (!current || current.file !== file) return null
                      return current.range
                    })

                    const commentsUi = createLineCommentController<SessionReviewComment>({
                      comments,
                      label: i18n.t("ui.lineComment.submit"),
                      draftKey: () => file,
                      mention: props.lineCommentMention,
                      state: {
                        opened: () => {
                          const current = opened()
                          if (!current || current.file !== file) return null
                          return current.id
                        },
                        setOpened: (id) => setStore("opened", id ? { file, id } : null),
                        selected: selectedLines,
                        setSelected: (range) => setStore("selection", range ? { file, range } : null),
                        commenting: draftRange,
                        setCommenting: (range) => setStore("commenting", range ? { file, range } : null),
                      },
                      getSide: selectionSide,
                      clearSelectionOnSelectionEndNull: false,
                      onSubmit: ({ comment, selection }) => {
                        props.onLineComment?.({
                          file,
                          selection,
                          comment,
                          preview: selectionPreview(diff, selection),
                        })
                      },
                      onUpdate: ({ id, comment, selection }) => {
                        props.onLineCommentUpdate?.({
                          id,
                          file,
                          selection,
                          comment,
                          preview: selectionPreview(diff, selection),
                        })
                      },
                      onDelete: (comment) => {
                        props.onLineCommentDelete?.({
                          id: comment.id,
                          file,
                        })
                      },
                      editSubmitLabel: props.lineCommentActions?.saveLabel,
                      renderCommentActions: props.lineCommentActions
                        ? (comment, controls) => (
                            <ReviewCommentMenu
                              labels={props.lineCommentActions!}
                              onEdit={controls.edit}
                              onDelete={controls.remove}
                            />
                          )
                        : undefined,
                    })

                    onCleanup(() => {
                      anchors.delete(file)
                      nodes.delete(file)
                      queue()
                    })

                    const handleLineSelected = (range: SelectedLineRange | null) => {
                      if (!props.onLineComment) return
                      commentsUi.onLineSelected(range)
                    }

                    const handleLineSelectionEnd = (range: SelectedLineRange | null) => {
                      if (!props.onLineComment) return
                      commentsUi.onLineSelectionEnd(range)
                    }

                    return (
                      <Accordion.Item
                        value={file}
                        id={diffId(file)}
                        data-file={file}
                        data-slot="session-review-accordion-item"
                        data-selected={props.focusedFile === file ? "" : undefined}
                      >
                        <StickyAccordionHeader>
                          <Accordion.Trigger>
                            <div data-slot="session-review-trigger-content">
                              <div data-slot="session-review-file-info">
                                <FileIcon node={{ path: file, type: "file" }} />
                                <div data-slot="session-review-file-name-container">
                                  <Show when={file.includes("/")}>
                                    <span data-slot="session-review-directory">{`\u202A${getDirectory(file)}\u202C`}</span>
                                  </Show>
                                  <span data-slot="session-review-filename">{getFilename(file)}</span>
                                  <Show when={props.onViewFile}>
                                    <Tooltip value={openFileLabel()} placement="top" gutter={4}>
                                      <button
                                        data-slot="session-review-view-button"
                                        type="button"
                                        aria-label={openFileLabel()}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          props.onViewFile?.(file)
                                        }}
                                      >
                                        <Icon name="open-file" size="small" />
                                      </button>
                                    </Tooltip>
                                  </Show>
                                </div>
                              </div>
                              <div data-slot="session-review-trigger-actions">
                                <Switch>
                                  <Match when={isAdded()}>
                                    <div data-slot="session-review-change-group" data-type="added">
                                      <span data-slot="session-review-change" data-type="added">
                                        {i18n.t("ui.sessionReview.change.added")}
                                      </span>
                                      <DiffChanges changes={diff} />
                                    </div>
                                  </Match>
                                  <Match when={isDeleted()}>
                                    <span data-slot="session-review-change" data-type="removed">
                                      {i18n.t("ui.sessionReview.change.removed")}
                                    </span>
                                  </Match>
                                  <Match when={!!mediaKind()}>
                                    <span data-slot="session-review-change" data-type="modified">
                                      {i18n.t("ui.sessionReview.change.modified")}
                                    </span>
                                  </Match>
                                  <Match when={true}>
                                    <DiffChanges changes={diff} />
                                  </Match>
                                </Switch>
                                <span data-slot="session-review-diff-chevron">
                                  <Icon name="chevron-down" size="small" />
                                </span>
                              </div>
                            </div>
                          </Accordion.Trigger>
                        </StickyAccordionHeader>
                        <Accordion.Content data-slot="session-review-accordion-content">
                          <div
                            data-slot="session-review-diff-wrapper"
                            ref={(el) => {
                              wrapper = el
                              anchors.set(file, el)
                              nodes.set(file, el)
                              queue()
                            }}
                          >
                            <Show when={expanded()}>
                              <Switch>
                                <Match when={!mounted() && !tooLarge()}>
                                  <div
                                    data-slot="session-review-diff-placeholder"
                                    class="rounded-lg border border-border-weak-base bg-background-stronger/40"
                                    style={{ height: "160px" }}
                                  />
                                </Match>
                                <Match when={tooLarge()}>
                                  <div data-slot="session-review-large-diff">
                                    <div data-slot="session-review-large-diff-title">
                                      {i18n.t("ui.sessionReview.largeDiff.title")}
                                    </div>
                                    <div data-slot="session-review-large-diff-meta">
                                      {i18n.t("ui.sessionReview.largeDiff.meta", {
                                        limit: MAX_DIFF_CHANGED_LINES.toLocaleString(),
                                        current: changedLines().toLocaleString(),
                                      })}
                                    </div>
                                    <div data-slot="session-review-large-diff-actions">
                                      <Button
                                        size="normal"
                                        variant="secondary"
                                        onClick={() => setStore("force", file, true)}
                                      >
                                        {i18n.t("ui.sessionReview.largeDiff.renderAnyway")}
                                      </Button>
                                    </div>
                                  </div>
                                </Match>
                                <Match when={true}>
                                  <Dynamic
                                    component={fileComponent}
                                    mode="diff"
                                    fileDiff={diff.fileDiff}
                                    preloadedDiff={diff.preloaded}
                                    diffStyle={diffStyle()}
                                    onRendered={() => {
                                      props.onDiffRendered?.()
                                    }}
                                    enableLineSelection={props.onLineComment != null}
                                    enableHoverUtility={props.onLineComment != null}
                                    onLineSelected={handleLineSelected}
                                    onLineSelectionEnd={handleLineSelectionEnd}
                                    onLineNumberSelectionEnd={commentsUi.onLineNumberSelectionEnd}
                                    annotations={commentsUi.annotations()}
                                    renderAnnotation={commentsUi.renderAnnotation}
                                    renderHoverUtility={props.onLineComment ? commentsUi.renderHoverUtility : undefined}
                                    selectedLines={selectedLines()}
                                    commentedLines={commentedLines()}
                                    media={{
                                      mode: "auto",
                                      path: file,
                                      deleted: diff.status === "deleted",
                                      readFile: diff.status === "deleted" ? undefined : props.readFile,
                                    }}
                                  />
                                </Match>
                              </Switch>
                            </Show>
                          </div>
                        </Accordion.Content>
                      </Accordion.Item>
                    )
                  }}
                </For>
              </Accordion>
            </div>
          </Show>
        </div>
      </ScrollView>
    </div>
  )
}
