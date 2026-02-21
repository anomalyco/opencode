import { Accordion } from "./accordion"
import { Button } from "./button"
import { RadioGroup } from "./radio-group"
import { DiffChanges } from "./diff-changes"
import { FileIcon } from "./file-icon"
import { Icon } from "./icon"
import { LineComment, LineCommentEditor } from "./line-comment"
import { StickyAccordionHeader } from "./sticky-accordion-header"
import { Tooltip } from "./tooltip"
import { ScrollView } from "./scroll-view"
import { useDiffComponent } from "../context/diff"
import { useI18n } from "../context/i18n"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { checksum } from "@opencode-ai/util/encode"
import { createEffect, createMemo, createSignal, For, Match, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { type FileContent, type FileDiff } from "@opencode-ai/sdk/v2"
import { PreloadMultiFileDiffResult } from "@pierre/diffs/ssr"
import { type SelectedLineRange } from "@pierre/diffs"
import { Dynamic } from "solid-js/web"

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

export type SessionReviewFocus = { file: string; id: string }

export interface SessionReviewProps {
  title?: JSX.Element
  empty?: JSX.Element
  split?: boolean
  diffStyle?: SessionReviewDiffStyle
  onDiffStyleChange?: (diffStyle: SessionReviewDiffStyle) => void
  onDiffRendered?: () => void
  onLineComment?: (comment: SessionReviewLineComment) => void
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

const imageExtensions = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "tif", "tiff", "heic"])
const audioExtensions = new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac", "opus"])

function normalizeMimeType(type: string | undefined): string | undefined {
  if (!type) return

  const mime = type.split(";", 1)[0]?.trim().toLowerCase()
  if (!mime) return

  if (mime === "audio/x-aac") return "audio/aac"
  if (mime === "audio/x-m4a") return "audio/mp4"

  return mime
}

function getExtension(file: string): string {
  const idx = file.lastIndexOf(".")
  if (idx === -1) return ""
  return file.slice(idx + 1).toLowerCase()
}

function isImageFile(file: string): boolean {
  return imageExtensions.has(getExtension(file))
}

function isAudioFile(file: string): boolean {
  return audioExtensions.has(getExtension(file))
}

function dataUrl(content: FileContent | undefined): string | undefined {
  if (!content) return
  if (content.encoding !== "base64") return
  const mime = normalizeMimeType(content.mimeType)
  if (!mime) return
  if (!mime.startsWith("image/") && !mime.startsWith("audio/")) return
  return `data:${mime};base64,${content.content}`
}

function dataUrlFromValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    if (value.startsWith("data:image/")) return value
    if (value.startsWith("data:audio/x-aac;")) return value.replace("data:audio/x-aac;", "data:audio/aac;")
    if (value.startsWith("data:audio/x-m4a;")) return value.replace("data:audio/x-m4a;", "data:audio/mp4;")
    if (value.startsWith("data:audio/")) return value
    return
  }
  if (!value || typeof value !== "object") return

  const content = (value as { content?: unknown }).content
  const encoding = (value as { encoding?: unknown }).encoding
  const mimeType = (value as { mimeType?: unknown }).mimeType

  if (typeof content !== "string") return
  if (encoding !== "base64") return
  if (typeof mimeType !== "string") return
  const mime = normalizeMimeType(mimeType)
  if (!mime) return
  if (!mime.startsWith("image/") && !mime.startsWith("audio/")) return

  return `data:${mime};base64,${content}`
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

function findSide(element: HTMLElement): "additions" | "deletions" | undefined {
  const typed = element.closest("[data-line-type]")
  if (typed instanceof HTMLElement) {
    const type = typed.dataset.lineType
    if (type === "change-deletion") return "deletions"
    if (type === "change-addition" || type === "change-additions") return "additions"
  }

  const code = element.closest("[data-code]")
  if (!(code instanceof HTMLElement)) return
  return code.hasAttribute("data-deletions") ? "deletions" : "additions"
}

function findMarker(root: ShadowRoot, range: SelectedLineRange) {
  const marker = (line: number, side?: "additions" | "deletions") => {
    const nodes = Array.from(root.querySelectorAll(`[data-line="${line}"], [data-alt-line="${line}"]`)).filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    )
    if (nodes.length === 0) return
    if (!side) return nodes[0]
    const match = nodes.find((node) => findSide(node) === side)
    return match ?? nodes[0]
  }

  const a = marker(range.start, range.side)
  const b = marker(range.end, range.endSide ?? range.side)
  if (!a) return b
  if (!b) return a
  return a.getBoundingClientRect().top > b.getBoundingClientRect().top ? a : b
}

function markerTop(wrapper: HTMLElement, marker: HTMLElement) {
  const wrapperRect = wrapper.getBoundingClientRect()
  const rect = marker.getBoundingClientRect()
  return rect.top - wrapperRect.top + Math.max(0, (rect.height - 20) / 2)
}

export const SessionReview = (props: SessionReviewProps) => {
  let scroll: HTMLDivElement | undefined
  let focusToken = 0
  const i18n = useI18n()
  const diffComponent = useDiffComponent()
  const anchors = new Map<string, HTMLElement>()
  const [store, setStore] = createStore({
    open: props.diffs.length > 10 ? [] : props.diffs.map((d) => d.file),
  })

  const [selection, setSelection] = createSignal<SessionReviewSelection | null>(null)
  const [commenting, setCommenting] = createSignal<SessionReviewSelection | null>(null)
  const [opened, setOpened] = createSignal<SessionReviewFocus | null>(null)

  const open = () => props.open ?? store.open
  const files = createMemo(() => props.diffs.map((d) => d.file))
  const diffs = createMemo(() => new Map(props.diffs.map((d) => [d.file, d] as const)))
  const diffStyle = () => props.diffStyle ?? (props.split ? "split" : "unified")
  const hasDiffs = () => files().length > 0

  const handleChange = (open: string[]) => {
    props.onOpenChange?.(open)
    if (props.open !== undefined) return
    setStore("open", open)
  }

  const handleExpandOrCollapseAll = () => {
    const next = open().length > 0 ? [] : files()
    handleChange(next)
  }

  const selectionLabel = (range: SelectedLineRange) => {
    const start = Math.min(range.start, range.end)
    const end = Math.max(range.start, range.end)
    if (start === end) return `line ${start}`
    return `lines ${start}-${end}`
  }

  const selectionSide = (range: SelectedLineRange) => range.endSide ?? range.side ?? "additions"

  const selectionPreview = (diff: FileDiff, range: SelectedLineRange) => {
    const side = selectionSide(range)
    const contents = side === "deletions" ? diff.before : diff.after
    if (typeof contents !== "string" || contents.length === 0) return undefined

    const start = Math.max(1, Math.min(range.start, range.end))
    const end = Math.max(range.start, range.end)
    const lines = contents.split("\n").slice(start - 1, end)
    if (lines.length === 0) return undefined
    return lines.slice(0, 2).join("\n")
  }

  createEffect(() => {
    const focus = props.focusedComment
    if (!focus) return

    focusToken++
    const token = focusToken

    setOpened(focus)

    const comment = (props.comments ?? []).find((c) => c.file === focus.file && c.id === focus.id)
    if (comment) setSelection({ file: comment.file, range: comment.selection })

    const current = open()
    if (!current.includes(focus.file)) {
      handleChange([...current, focus.file])
    }

    const scrollTo = (attempt: number) => {
      if (token !== focusToken) return

      const root = scroll
      if (!root) return

      const anchor = root.querySelector(`[data-comment-id="${focus.id}"]`)
      const ready =
        anchor instanceof HTMLElement && anchor.style.pointerEvents !== "none" && anchor.style.opacity !== "0"

      const target = ready ? anchor : anchors.get(focus.file)
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

  return (
    <ScrollView
      data-component="session-review"
      viewportRef={(el) => {
        scroll = el
        props.scrollRef?.(el)
      }}
      onScroll={props.onScroll as any}
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
      <div data-slot="session-review-container" class={props.classes?.container}>
        <Show when={hasDiffs()} fallback={props.empty}>
          <Accordion multiple value={open()} onChange={handleChange}>
            <For each={files()}>
              {(file) => {
                let wrapper: HTMLDivElement | undefined

                const diff = createMemo(() => diffs().get(file))
                const item = () => diff()!

                const expanded = createMemo(() => open().includes(file))
                const [force, setForce] = createSignal(false)

                const comments = createMemo(() => (props.comments ?? []).filter((c) => c.file === file))
                const commentedLines = createMemo(() => comments().map((c) => c.selection))

                const beforeText = () => (typeof item().before === "string" ? item().before : "")
                const afterText = () => (typeof item().after === "string" ? item().after : "")
                const changedLines = () => item().additions + item().deletions

                const tooLarge = createMemo(() => {
                  if (!expanded()) return false
                  if (force()) return false
                  if (isImageFile(file)) return false
                  return changedLines() > MAX_DIFF_CHANGED_LINES
                })

                const isAdded = () => item().status === "added" || (beforeText().length === 0 && afterText().length > 0)
                const isDeleted = () =>
                  item().status === "deleted" || (afterText().length === 0 && beforeText().length > 0)
                const isImage = () => isImageFile(file)
                const isAudio = () => isAudioFile(file)

                const diffImageSrc = createMemo(() => dataUrlFromValue(item().after) ?? dataUrlFromValue(item().before))
                const [imageSrc, setImageSrc] = createSignal<string | undefined>(diffImageSrc())
                const [imageStatus, setImageStatus] = createSignal<"idle" | "loading" | "error">("idle")

                const diffAudioSrc = createMemo(() => dataUrlFromValue(item().after) ?? dataUrlFromValue(item().before))
                const [audioSrc, setAudioSrc] = createSignal<string | undefined>(diffAudioSrc())
                const [audioStatus, setAudioStatus] = createSignal<"idle" | "loading" | "error">("idle")
                const [audioMime, setAudioMime] = createSignal<string | undefined>(undefined)

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

                const [draft, setDraft] = createSignal("")
                const [positions, setPositions] = createSignal<Record<string, number>>({})
                const [draftTop, setDraftTop] = createSignal<number | undefined>(undefined)

                const getRoot = () => {
                  const el = wrapper
                  if (!el) return

                  const host = el.querySelector("diffs-container")
                  if (!(host instanceof HTMLElement)) return
                  return host.shadowRoot ?? undefined
                }

                const updateAnchors = () => {
                  const el = wrapper
                  if (!el) return

                  const root = getRoot()
                  if (!root) return

                  const next: Record<string, number> = {}
                  for (const item of comments()) {
                    const marker = findMarker(root, item.selection)
                    if (!marker) continue
                    next[item.id] = markerTop(el, marker)
                  }
                  setPositions(next)

                  const range = draftRange()
                  if (!range) {
                    setDraftTop(undefined)
                    return
                  }

                  const marker = findMarker(root, range)
                  if (!marker) {
                    setDraftTop(undefined)
                    return
                  }

                  setDraftTop(markerTop(el, marker))
                }

                const scheduleAnchors = () => {
                  requestAnimationFrame(updateAnchors)
                }

                createEffect(() => {
                  if (!isImage()) return
                  const src = diffImageSrc()
                  setImageSrc(src)
                  setImageStatus("idle")
                })

                createEffect(() => {
                  if (!isAudio()) return
                  const src = diffAudioSrc()
                  setAudioSrc(src)
                  setAudioStatus("idle")
                  setAudioMime(undefined)
                })

                createEffect(() => {
                  comments()
                  scheduleAnchors()
                })

                createEffect(() => {
                  const range = draftRange()
                  if (!range) return
                  setDraft("")
                  scheduleAnchors()
                })

                createEffect(() => {
                  if (!open().includes(file)) return
                  if (!isImage()) return
                  if (imageSrc()) return
                  if (imageStatus() !== "idle") return
                  if (isDeleted()) return

                  const reader = props.readFile
                  if (!reader) return

                  setImageStatus("loading")
                  reader(file)
                    .then((result) => {
                      const src = dataUrl(result)
                      if (!src) {
                        setImageStatus("error")
                        return
                      }
                      setImageSrc(src)
                      setImageStatus("idle")
                    })
                    .catch(() => {
                      setImageStatus("error")
                    })
                })

                createEffect(() => {
                  if (!open().includes(file)) return
                  if (!isAudio()) return
                  if (audioSrc()) return
                  if (audioStatus() !== "idle") return

                  const reader = props.readFile
                  if (!reader) return

                  setAudioStatus("loading")
                  reader(file)
                    .then((result) => {
                      const src = dataUrl(result)
                      if (!src) {
                        setAudioStatus("error")
                        return
                      }
                      setAudioMime(normalizeMimeType(result?.mimeType))
                      setAudioSrc(src)
                      setAudioStatus("idle")
                    })
                    .catch(() => {
                      setAudioStatus("error")
                    })
                })

                const handleLineSelected = (range: SelectedLineRange | null) => {
                  if (!props.onLineComment) return

                  if (!range) {
                    setSelection(null)
                    return
                  }

                  setSelection({ file, range })
                }

                const handleLineSelectionEnd = (range: SelectedLineRange | null) => {
                  if (!props.onLineComment) return

                  if (!range) {
                    setCommenting(null)
                    return
                  }

                  setSelection({ file, range })
                  setCommenting({ file, range })
                }

                const openComment = (comment: SessionReviewComment) => {
                  setOpened({ file: comment.file, id: comment.id })
                  setSelection({ file: comment.file, range: comment.selection })
                }

                const isCommentOpen = (comment: SessionReviewComment) => {
                  const current = opened()
                  if (!current) return false
                  return current.file === comment.file && current.id === comment.id
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
                              <Match when={isImage()}>
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
                          scheduleAnchors()
                        }}
                      >
                        <Show when={expanded()}>
                          <Switch>
                            <Match when={isImage() && imageSrc()}>
                              <div data-slot="session-review-image-container">
                                <img data-slot="session-review-image" src={imageSrc()} alt={file} />
                              </div>
                            </Match>
                            <Match when={isImage() && isDeleted()}>
                              <div data-slot="session-review-image-container" data-removed>
                                <span data-slot="session-review-image-placeholder">
                                  {i18n.t("ui.sessionReview.change.removed")}
                                </span>
                              </div>
                            </Match>
                            <Match when={isImage() && !imageSrc()}>
                              <div data-slot="session-review-image-container">
                                <span data-slot="session-review-image-placeholder">
                                  {imageStatus() === "loading"
                                    ? i18n.t("ui.sessionReview.image.loading")
                                    : i18n.t("ui.sessionReview.image.placeholder")}
                                </span>
                              </div>
                            </Match>
                            <Match when={!isImage() && tooLarge()}>
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
                                  <Button size="normal" variant="secondary" onClick={() => setForce(true)}>
                                    {i18n.t("ui.sessionReview.largeDiff.renderAnyway")}
                                  </Button>
                                </div>
                              </div>
                            </Match>
                            <Match when={!isImage()}>
                              <Dynamic
                                component={diffComponent}
                                preloadedDiff={item().preloaded}
                                diffStyle={diffStyle()}
                                onRendered={() => {
                                  props.onDiffRendered?.()
                                  scheduleAnchors()
                                }}
                                enableLineSelection={props.onLineComment != null}
                                onLineSelected={handleLineSelected}
                                onLineSelectionEnd={handleLineSelectionEnd}
                                selectedLines={selectedLines()}
                                commentedLines={commentedLines()}
                                before={{
                                  name: file,
                                  contents: typeof item().before === "string" ? item().before : "",
                                }}
                                after={{
                                  name: file,
                                  contents: typeof item().after === "string" ? item().after : "",
                                }}
                              />
                            </Match>
                          </Switch>

                          <For each={comments()}>
                            {(comment) => (
                              <LineComment
                                id={comment.id}
                                top={positions()[comment.id]}
                                onMouseEnter={() => setSelection({ file: comment.file, range: comment.selection })}
                                onClick={() => {
                                  if (isCommentOpen(comment)) {
                                    setOpened(null)
                                    return
                                  }

                                  openComment(comment)
                                }}
                                open={isCommentOpen(comment)}
                                comment={comment.comment}
                                selection={selectionLabel(comment.selection)}
                              />
                            )}
                          </For>

                          <Show when={draftRange()}>
                            {(range) => (
                              <Show when={draftTop() !== undefined}>
                                <LineCommentEditor
                                  top={draftTop()}
                                  value={draft()}
                                  selection={selectionLabel(range())}
                                  onInput={setDraft}
                                  onCancel={() => setCommenting(null)}
                                  onSubmit={(comment) => {
                                    props.onLineComment?.({
                                      file,
                                      selection: range(),
                                      comment,
                                      preview: selectionPreview(item(), range()),
                                    })
                                    setCommenting(null)
                                  }}
                                />
                              </Show>
                            )}
                          </Show>
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
