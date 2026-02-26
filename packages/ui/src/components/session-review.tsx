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
import { FileSearchBar } from "./file-search"
import type { FileSearchHandle } from "./file"
import { buildSessionSearchHits, stepSessionSearchIndex, type SessionSearchHit } from "./session-review-search"
import { useFileComponent } from "../context/file"
import { useI18n } from "../context/i18n"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { checksum } from "@opencode-ai/util/encode"
import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { type FileContent, type FileDiff } from "@opencode-ai/sdk/v2"
import { PreloadMultiFileDiffResult } from "@pierre/diffs/ssr"
import { type SelectedLineRange } from "@pierre/diffs"
import { Dynamic } from "solid-js/web"
import { mediaKindFromPath } from "../pierre/media"
import { cloneSelectedLineRange, previewSelectedLines } from "../pierre/selection-bridge"
import { createLineCommentController } from "./line-comment-annotations"

const MAX_DIFF_CHANGED_LINES = 500

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

export interface SessionReviewProps {
  title?: JSX.Element
  empty?: JSX.Element
  split?: boolean
  diffStyle?: SessionReviewDiffStyle
  onDiffStyleChange?: (diffStyle: SessionReviewDiffStyle) => void
  onDiffRendered?: () => void
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
  diffs: (FileDiff & { preloaded?: PreloadMultiFileDiffResult<any> })[]
  onViewFile?: (file: string) => void
  readFile?: (path: string) => Promise<FileContent | undefined>
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
  let searchInput: HTMLInputElement | undefined
  let focusToken = 0
  let revealToken = 0
  let highlightedFile: string | undefined
  const i18n = useI18n()
  const fileComponent = useFileComponent()
  const anchors = new Map<string, HTMLElement>()
  const searchHandles = new Map<string, FileSearchHandle>()
  const readyFiles = new Set<string>()
  const [store, setStore] = createStore<{ open: string[]; force: Record<string, boolean> }>({
    open: props.diffs.length > 10 ? [] : props.diffs.map((d) => d.file),
    force: {},
  })

  const [selection, setSelection] = createSignal<SessionReviewSelection | null>(null)
  const [commenting, setCommenting] = createSignal<SessionReviewSelection | null>(null)
  const [opened, setOpened] = createSignal<SessionReviewFocus | null>(null)
  const [searchOpen, setSearchOpen] = createSignal(false)
  const [searchQuery, setSearchQuery] = createSignal("")
  const [searchActive, setSearchActive] = createSignal(0)
  const [searchPos, setSearchPos] = createSignal({ top: 8, right: 8 })

  const open = () => props.open ?? store.open
  const files = createMemo(() => props.diffs.map((d) => d.file))
  const diffs = createMemo(() => new Map(props.diffs.map((d) => [d.file, d] as const)))
  const diffStyle = () => props.diffStyle ?? (props.split ? "split" : "unified")
  const hasDiffs = () => files().length > 0
  const searchValue = createMemo(() => searchQuery().trim())
  const searchExpanded = createMemo(() => searchValue().length > 0)

  const handleChange = (open: string[]) => {
    props.onOpenChange?.(open)
    if (props.open !== undefined) return
    setStore("open", open)
  }

  const handleExpandOrCollapseAll = () => {
    const next = open().length > 0 ? [] : files()
    handleChange(next)
  }

  const clearViewerSearch = () => {
    for (const handle of searchHandles.values()) handle.clear()
    highlightedFile = undefined
  }

  const focusSearch = () => {
    if (!hasDiffs()) return
    setSearchOpen(true)
    requestAnimationFrame(() => {
      searchInput?.focus()
      searchInput?.select()
    })
  }

  const closeSearch = () => {
    revealToken++
    setSearchOpen(false)
    setSearchQuery("")
    setSearchActive(0)
    clearViewerSearch()
  }

  const positionSearchBar = () => {
    if (typeof window === "undefined") return
    if (!scroll) return

    const rect = scroll.getBoundingClientRect()
    const title = parseFloat(getComputedStyle(scroll).getPropertyValue("--session-title-height"))
    const header = Number.isNaN(title) ? 0 : title
    setSearchPos({
      top: Math.round(rect.top) + header - 4,
      right: Math.round(window.innerWidth - rect.right) + 8,
    })
  }

  const searchHits = createMemo(() =>
    buildSessionSearchHits({
      query: searchQuery(),
      files: props.diffs.flatMap((diff) => {
        if (mediaKindFromPath(diff.file)) return []

        return [
          {
            file: diff.file,
            before: typeof diff.before === "string" ? diff.before : undefined,
            after: typeof diff.after === "string" ? diff.after : undefined,
          },
        ]
      }),
    }),
  )

  const waitForViewer = (file: string, token: number) =>
    new Promise<FileSearchHandle | undefined>((resolve) => {
      let attempt = 0

      const tick = () => {
        if (token !== revealToken) {
          resolve(undefined)
          return
        }

        const handle = searchHandles.get(file)
        if (handle && readyFiles.has(file)) {
          resolve(handle)
          return
        }

        if (attempt >= 180) {
          resolve(undefined)
          return
        }

        attempt++
        requestAnimationFrame(tick)
      }

      tick()
    })

  const waitForFrames = (count: number, token: number) =>
    new Promise<boolean>((resolve) => {
      const tick = (left: number) => {
        if (token !== revealToken) {
          resolve(false)
          return
        }

        if (left <= 0) {
          resolve(true)
          return
        }

        requestAnimationFrame(() => tick(left - 1))
      }

      tick(count)
    })

  const revealSearchHit = async (token: number, hit: SessionSearchHit, query: string) => {
    const diff = diffs().get(hit.file)
    if (!diff) return

    if (!open().includes(hit.file)) {
      handleChange([...open(), hit.file])
    }

    if (!mediaKindFromPath(hit.file) && diff.additions + diff.deletions > MAX_DIFF_CHANGED_LINES) {
      setStore("force", hit.file, true)
    }

    const handle = await waitForViewer(hit.file, token)
    if (!handle || token !== revealToken) return
    if (searchValue() !== query) return
    if (!(await waitForFrames(2, token))) return

    if (highlightedFile && highlightedFile !== hit.file) {
      searchHandles.get(highlightedFile)?.clear()
      highlightedFile = undefined
    }

    anchors.get(hit.file)?.scrollIntoView({ block: "nearest" })

    let done = false
    for (let i = 0; i < 4; i++) {
      if (token !== revealToken) return
      if (searchValue() !== query) return

      handle.setQuery(query)
      if (handle.reveal(hit)) {
        done = true
        break
      }

      const expanded = handle.expand(hit)
      handle.refresh()
      if (!(await waitForFrames(expanded ? 2 : 1, token))) return
    }

    if (!done) return

    if (!(await waitForFrames(1, token))) return
    handle.reveal(hit)

    highlightedFile = hit.file
  }

  const navigateSearch = (dir: 1 | -1) => {
    const total = searchHits().length
    if (total <= 0) return
    setSearchActive((value) => stepSessionSearchIndex(total, value, dir))
  }

  const inReview = (node: unknown, path?: unknown[]) => {
    if (node === searchInput) return true
    if (path?.some((item) => item === scroll || item === searchInput)) return true
    if (path?.some((item) => item instanceof HTMLElement && item.dataset.component === "session-review")) {
      return true
    }
    if (!(node instanceof Node)) return false
    if (searchInput?.contains(node)) return true
    if (node instanceof HTMLElement && node.closest("[data-component='session-review']")) return true
    if (!scroll) return false
    return scroll.contains(node)
  }

  createEffect(() => {
    if (typeof window === "undefined") return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return

      const mod = event.metaKey || event.ctrlKey
      if (!mod) return

      const key = event.key.toLowerCase()
      if (key !== "f" && key !== "g") return

      if (key === "f") {
        if (!hasDiffs()) return
        event.preventDefault()
        event.stopPropagation()
        focusSearch()
        return
      }

      const path = typeof event.composedPath === "function" ? event.composedPath() : undefined
      if (!inReview(event.target, path) && !inReview(document.activeElement, path)) return
      if (!searchOpen()) return
      event.preventDefault()
      event.stopPropagation()
      navigateSearch(event.shiftKey ? -1 : 1)
    }

    window.addEventListener("keydown", onKeyDown, { capture: true })
    onCleanup(() => window.removeEventListener("keydown", onKeyDown, { capture: true }))
  })

  createEffect(() => {
    diffStyle()
    searchExpanded()
    readyFiles.clear()
  })

  createEffect(() => {
    if (!searchOpen()) return
    if (!scroll) return

    const root = scroll

    requestAnimationFrame(positionSearchBar)
    window.addEventListener("resize", positionSearchBar, { passive: true })
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(positionSearchBar)
    observer?.observe(root)

    onCleanup(() => {
      window.removeEventListener("resize", positionSearchBar)
      observer?.disconnect()
    })
  })

  createEffect(() => {
    const total = searchHits().length
    if (total === 0) {
      if (searchActive() !== 0) setSearchActive(0)
      return
    }

    if (searchActive() >= total) setSearchActive(total - 1)
  })

  createEffect(() => {
    diffStyle()
    const query = searchValue()
    const hits = searchHits()
    const token = ++revealToken
    if (!query || hits.length === 0) {
      clearViewerSearch()
      return
    }

    const hit = hits[Math.min(searchActive(), hits.length - 1)]
    if (!hit) return
    void revealSearchHit(token, hit, query)
  })

  onCleanup(() => {
    revealToken++
    clearViewerSearch()
    readyFiles.clear()
    searchHandles.clear()
  })

  const selectionSide = (range: SelectedLineRange) => range.endSide ?? range.side ?? "additions"

  const selectionPreview = (diff: FileDiff, range: SelectedLineRange) => {
    const side = selectionSide(range)
    const contents = side === "deletions" ? diff.before : diff.after
    if (typeof contents !== "string" || contents.length === 0) return undefined

    return previewSelectedLines(contents, range)
  }

  createEffect(() => {
    const focus = props.focusedComment
    if (!focus) return

    focusToken++
    const token = focusToken

    setOpened(focus)

    const comment = (props.comments ?? []).find((c) => c.file === focus.file && c.id === focus.id)
    if (comment) setSelection({ file: comment.file, range: cloneSelectedLineRange(comment.selection) })

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
      const ready = anchor instanceof HTMLElement

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

  const handleReviewKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return

    const mod = event.metaKey || event.ctrlKey
    const key = event.key.toLowerCase()
    const target = event.target
    if (mod && key === "f") {
      event.preventDefault()
      event.stopPropagation()
      focusSearch()
      return
    }

    if (mod && key === "g") {
      if (!searchOpen()) return
      event.preventDefault()
      event.stopPropagation()
      navigateSearch(event.shiftKey ? -1 : 1)
    }
  }

  const handleSearchInputKeyDown = (event: KeyboardEvent) => {
    const mod = event.metaKey || event.ctrlKey
    const key = event.key.toLowerCase()

    if (mod && key === "g") {
      event.preventDefault()
      event.stopPropagation()
      navigateSearch(event.shiftKey ? -1 : 1)
      return
    }

    if (mod && key === "f") {
      event.preventDefault()
      event.stopPropagation()
      focusSearch()
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      closeSearch()
      return
    }

    if (event.key !== "Enter") return
    event.preventDefault()
    event.stopPropagation()
    navigateSearch(event.shiftKey ? -1 : 1)
  }

  return (
    <ScrollView
      data-component="session-review"
      viewportRef={(el) => {
        scroll = el
        props.scrollRef?.(el)
      }}
      onScroll={props.onScroll as any}
      onKeyDown={handleReviewKeyDown}
      classList={{
        ...(props.classList ?? {}),
        [props.classes?.root ?? ""]: !!props.classes?.root,
        [props.class ?? ""]: !!props.class,
      }}
    >
      <div data-slot="session-review-header" class={props.classes?.header}>
        <div data-slot="session-review-title">{props.title ?? i18n.t("ui.sessionReview.title")}</div>
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
      <Show when={searchOpen()}>
        <FileSearchBar
          pos={searchPos}
          query={searchQuery}
          index={() => (searchHits().length ? Math.min(searchActive(), searchHits().length - 1) : 0)}
          count={() => searchHits().length}
          setInput={(el) => {
            searchInput = el
          }}
          onInput={(value) => {
            setSearchQuery(value)
            setSearchActive(0)
          }}
          onKeyDown={(event) => handleSearchInputKeyDown(event)}
          onClose={closeSearch}
          onPrev={() => navigateSearch(-1)}
          onNext={() => navigateSearch(1)}
        />
      </Show>
      <div data-slot="session-review-container" class={props.classes?.container}>
        <Show when={hasDiffs()} fallback={props.empty}>
          <Accordion multiple value={open()} onChange={handleChange}>
            <For each={files()}>
              {(file) => {
                let wrapper: HTMLDivElement | undefined

                const diff = createMemo(() => diffs().get(file))
                const item = () => diff()!

                const expanded = createMemo(() => open().includes(file))
                const force = () => !!store.force[file]

                const comments = createMemo(() => (props.comments ?? []).filter((c) => c.file === file))
                const commentedLines = createMemo(() => comments().map((c) => c.selection))

                const beforeText = () => (typeof item().before === "string" ? item().before : "")
                const afterText = () => (typeof item().after === "string" ? item().after : "")
                const changedLines = () => item().additions + item().deletions
                const mediaKind = createMemo(() => mediaKindFromPath(file))

                const tooLarge = createMemo(() => {
                  if (!expanded()) return false
                  if (force()) return false
                  if (mediaKind()) return false
                  return changedLines() > MAX_DIFF_CHANGED_LINES
                })

                const isAdded = () => item().status === "added" || (beforeText().length === 0 && afterText().length > 0)
                const isDeleted = () =>
                  item().status === "deleted" || (afterText().length === 0 && beforeText().length > 0)

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
                  state: {
                    opened: () => {
                      const current = opened()
                      if (!current || current.file !== file) return null
                      return current.id
                    },
                    setOpened: (id) => setOpened(id ? { file, id } : null),
                    selected: selectedLines,
                    setSelected: (range) => setSelection(range ? { file, range } : null),
                    commenting: draftRange,
                    setCommenting: (range) => setCommenting(range ? { file, range } : null),
                  },
                  getSide: selectionSide,
                  clearSelectionOnSelectionEndNull: false,
                  onSubmit: ({ comment, selection }) => {
                    props.onLineComment?.({
                      file,
                      selection,
                      comment,
                      preview: selectionPreview(item(), selection),
                    })
                  },
                  onUpdate: ({ id, comment, selection }) => {
                    props.onLineCommentUpdate?.({
                      id,
                      file,
                      selection,
                      comment,
                      preview: selectionPreview(item(), selection),
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
                  readyFiles.delete(file)
                  searchHandles.delete(file)
                  if (highlightedFile === file) highlightedFile = undefined
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
                                <Tooltip value="Open file" placement="top" gutter={4}>
                                  <button
                                    data-slot="session-review-view-button"
                                    type="button"
                                    aria-label="Open file"
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
                                  <DiffChanges changes={item()} />
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
                                <DiffChanges changes={item()} />
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
                        }}
                      >
                        <Show when={expanded()}>
                          <Switch>
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
                                preloadedDiff={item().preloaded}
                                diffStyle={diffStyle()}
                                expansionLineCount={searchExpanded() ? Number.MAX_SAFE_INTEGER : 20}
                                onRendered={() => {
                                  readyFiles.add(file)
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
                                search={{
                                  shortcuts: "disabled",
                                  showBar: false,
                                  disableVirtualization: searchExpanded(),
                                  register: (handle: FileSearchHandle | null) => {
                                    if (!handle) {
                                      searchHandles.delete(file)
                                      readyFiles.delete(file)
                                      if (highlightedFile === file) highlightedFile = undefined
                                      return
                                    }

                                    searchHandles.set(file, handle)
                                  },
                                }}
                                before={{
                                  name: file,
                                  contents: typeof item().before === "string" ? item().before : "",
                                }}
                                after={{
                                  name: file,
                                  contents: typeof item().after === "string" ? item().after : "",
                                }}
                                media={{
                                  mode: "auto",
                                  path: file,
                                  before: item().before,
                                  after: item().after,
                                  readFile: props.readFile,
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
        </Show>
      </div>
    </ScrollView>
  )
}
