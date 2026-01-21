import { Accordion } from "./accordion"
import { Button } from "./button"
import { RadioGroup } from "./radio-group"
import { DiffChanges } from "./diff-changes"
import { FileIcon } from "./file-icon"
import { Icon } from "./icon"
import { StickyAccordionHeader } from "./sticky-accordion-header"
import { useCodeComponent } from "../context/code"
import { useDiffComponent } from "../context/diff"
import { useI18n } from "../context/i18n"
import { checksum } from "@opencode-ai/util/encode"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { createEffect, createMemo, createSignal, For, Match, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { type FileContent, type FileDiff } from "@opencode-ai/sdk/v2"
import { PreloadMultiFileDiffResult } from "@pierre/diffs/ssr"
import { type DiffLineAnnotation, type SelectedLineRange } from "@pierre/diffs"
import { Dynamic } from "solid-js/web"

export type SessionReviewDiffStyle = "unified" | "split"

export interface SessionReviewProps {
  split?: boolean
  diffStyle?: SessionReviewDiffStyle
  onDiffStyleChange?: (diffStyle: SessionReviewDiffStyle) => void
  onDiffRendered?: () => void
  onLineComment?: (comment: SessionReviewLineComment) => void
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

type SessionReviewSelection = {
  file: string
  range: SelectedLineRange
}

type SessionReviewLineComment = {
  file: string
  selection: SelectedLineRange
  comment: string
  preview?: string
}

type CommentAnnotationMeta = {
  file: string
  selection: SelectedLineRange
  label: string
  preview?: string
}

export const SessionReview = (props: SessionReviewProps) => {
  const i18n = useI18n()
  const diffComponent = useDiffComponent()
  const codeComponent = useCodeComponent()
  const [store, setStore] = createStore({
    open: props.diffs.length > 10 ? [] : props.diffs.map((d) => d.file),
  })
  const [selection, setSelection] = createSignal<SessionReviewSelection | null>(null)
  const [commenting, setCommenting] = createSignal<SessionReviewSelection | null>(null)

  const open = () => props.open ?? store.open
  const diffStyle = () => props.diffStyle ?? (props.split ? "split" : "unified")

  const handleChange = (open: string[]) => {
    props.onOpenChange?.(open)
    if (props.open !== undefined) return
    setStore("open", open)
  }

  const handleExpandOrCollapseAll = () => {
    const next = open().length > 0 ? [] : props.diffs.map((d) => d.file)
    handleChange(next)
  }

  const selectionLabel = (range: SelectedLineRange) => {
    const start = Math.min(range.start, range.end)
    const end = Math.max(range.start, range.end)
    if (start === end) return `line ${start}`
    return `lines ${start}-${end}`
  }

  const isRangeEqual = (a: SelectedLineRange, b: SelectedLineRange) =>
    a.start === b.start && a.end === b.end && a.side === b.side && a.endSide === b.endSide

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

  const renderAnnotation = (annotation: DiffLineAnnotation<CommentAnnotationMeta>) => {
    if (!props.onLineComment) return undefined
    const meta = annotation.metadata
    if (!meta) return undefined

    const wrapper = document.createElement("div")
    wrapper.className = "relative"

    const card = document.createElement("div")
    card.className =
      "min-w-[240px] max-w-[320px] flex flex-col gap-2 rounded-md border border-border-base bg-surface-raised-stronger-non-alpha p-2 shadow-md"

    const textarea = document.createElement("textarea")
    textarea.rows = 3
    textarea.placeholder = "Add a comment"
    textarea.className =
      "w-full resize-none rounded-md border border-border-base bg-surface-base px-2 py-1 text-12-regular text-text-strong placeholder:text-text-subtle"

    const footer = document.createElement("div")
    footer.className = "flex items-center justify-between gap-2 text-11-regular text-text-weak"

    const label = document.createElement("span")
    label.textContent = `Commenting on ${meta.label}`

    const actions = document.createElement("div")
    actions.className = "flex items-center gap-2"

    const cancel = document.createElement("button")
    cancel.type = "button"
    cancel.textContent = "Cancel"
    cancel.className = "text-11-regular text-text-weak hover:text-text-strong"

    const submit = document.createElement("button")
    submit.type = "button"
    submit.textContent = "Comment"
    submit.className =
      "rounded-md border border-border-base bg-surface-base px-2 py-1 text-12-regular text-text-strong hover:bg-surface-raised-base-hover"

    const updateState = () => {
      const active = textarea.value.trim().length > 0
      submit.disabled = !active
      submit.classList.toggle("opacity-50", !active)
      submit.classList.toggle("cursor-not-allowed", !active)
    }

    updateState()
    textarea.addEventListener("input", updateState)
    textarea.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return
      if (event.shiftKey) return
      event.preventDefault()
      submit.click()
    })
    cancel.addEventListener("click", () => {
      setSelection(null)
      setCommenting(null)
    })
    submit.addEventListener("click", () => {
      const value = textarea.value.trim()
      if (!value) return
      props.onLineComment?.({
        file: meta.file,
        selection: meta.selection,
        comment: value,
        preview: meta.preview,
      })
      setSelection(null)
      setCommenting(null)
    })

    actions.appendChild(cancel)
    actions.appendChild(submit)
    footer.appendChild(label)
    footer.appendChild(actions)
    card.appendChild(textarea)
    card.appendChild(footer)
    wrapper.appendChild(card)

    requestAnimationFrame(() => textarea.focus())

    return wrapper
  }

  return (
    <div
      data-component="session-review"
      ref={props.scrollRef}
      onScroll={props.onScroll}
      classList={{
        ...(props.classList ?? {}),
        [props.classes?.root ?? ""]: !!props.classes?.root,
        [props.class ?? ""]: !!props.class,
      }}
    >
      <div
        data-slot="session-review-header"
        classList={{
          [props.classes?.header ?? ""]: !!props.classes?.header,
        }}
      >
        <div data-slot="session-review-title">{i18n.t("ui.sessionReview.title")}</div>
        <div data-slot="session-review-actions">
          <Show when={props.onDiffStyleChange}>
            <RadioGroup
              options={["unified", "split"] as const}
              current={diffStyle()}
              value={(style) => style}
              label={(style) =>
                i18n.t(style === "unified" ? "ui.sessionReview.diffStyle.unified" : "ui.sessionReview.diffStyle.split")
              }
              onSelect={(style) => style && props.onDiffStyleChange?.(style)}
            />
          </Show>
          <Button size="normal" icon="chevron-grabber-vertical" onClick={handleExpandOrCollapseAll}>
            <Switch>
              <Match when={open().length > 0}>{i18n.t("ui.sessionReview.collapseAll")}</Match>
              <Match when={true}>{i18n.t("ui.sessionReview.expandAll")}</Match>
            </Switch>
          </Button>
          {props.actions}
        </div>
      </div>
      <div
        data-slot="session-review-container"
        classList={{
          [props.classes?.container ?? ""]: !!props.classes?.container,
        }}
      >
        <Accordion multiple value={open()} onChange={handleChange}>
          <For each={props.diffs}>
            {(diff) => {
              const beforeText = () => (typeof diff.before === "string" ? diff.before : "")
              const afterText = () => (typeof diff.after === "string" ? diff.after : "")

              const isAdded = () => beforeText().length === 0 && afterText().length > 0
              const isDeleted = () => afterText().length === 0 && beforeText().length > 0
              const isImage = () => isImageFile(diff.file)
              const isAudio = () => isAudioFile(diff.file)

              const diffImageSrc = dataUrlFromValue(diff.after) ?? dataUrlFromValue(diff.before)
              const [imageSrc, setImageSrc] = createSignal<string | undefined>(diffImageSrc)
              const [imageStatus, setImageStatus] = createSignal<"idle" | "loading" | "error">("idle")

              const diffAudioSrc = dataUrlFromValue(diff.after) ?? dataUrlFromValue(diff.before)
              const [audioSrc, setAudioSrc] = createSignal<string | undefined>(diffAudioSrc)
              const [audioStatus, setAudioStatus] = createSignal<"idle" | "loading" | "error">("idle")
              const [audioMime, setAudioMime] = createSignal<string | undefined>(undefined)

              const selectedLines = createMemo(() => {
                const current = selection()
                if (!current || current.file !== diff.file) return null
                return current.range
              })

              const commentingLines = createMemo(() => {
                const current = commenting()
                if (!current || current.file !== diff.file) return null
                return current.range
              })

              const annotations = createMemo<DiffLineAnnotation<CommentAnnotationMeta>[]>(() => {
                const range = commentingLines()
                if (!range) return []
                return [
                  {
                    lineNumber: Math.max(range.start, range.end),
                    side: selectionSide(range),
                    metadata: {
                      file: diff.file,
                      selection: range,
                      label: selectionLabel(range),
                      preview: selectionPreview(diff, range),
                    },
                  },
                ]
              })

              createEffect(() => {
                if (!open().includes(diff.file)) return
                if (!isImage()) return
                if (imageSrc()) return
                if (imageStatus() !== "idle") return

                const reader = props.readFile
                if (!reader) return

                setImageStatus("loading")
                reader(diff.file)
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
                if (!open().includes(diff.file)) return
                if (!isAudio()) return
                if (audioSrc()) return
                if (audioStatus() !== "idle") return

                const reader = props.readFile
                if (!reader) return

                setAudioStatus("loading")
                reader(diff.file)
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

              const fileForCode = () => {
                const contents = afterText() || beforeText()
                return {
                  name: diff.file,
                  contents,
                  cacheKey: checksum(contents),
                }
              }

              const handleLineSelected = (range: SelectedLineRange | null) => {
                if (!props.onLineComment) return

                if (!range) {
                  setSelection(null)
                  setCommenting(null)
                  return
                }

                setSelection({ file: diff.file, range })

                const current = commenting()
                if (!current) return
                if (current.file !== diff.file) return
                if (isRangeEqual(current.range, range)) return
                setCommenting(null)
              }

              const handleLineSelectionEnd = (range: SelectedLineRange | null) => {
                if (!props.onLineComment) return

                if (!range) {
                  setCommenting(null)
                  return
                }

                setSelection({ file: diff.file, range })
                setCommenting({ file: diff.file, range })
              }

              return (
                <Accordion.Item value={diff.file} data-slot="session-review-accordion-item">
                  <StickyAccordionHeader>
                    <Accordion.Trigger>
                      <div data-slot="session-review-trigger-content">
                        <div data-slot="session-review-file-info">
                          <FileIcon node={{ path: diff.file, type: "file" }} />
                          <div data-slot="session-review-file-name-container">
                            <Show when={diff.file.includes("/")}>
                              <span data-slot="session-review-directory">{`\u202A${getDirectory(diff.file)}\u202C`}</span>
                            </Show>
                            <span data-slot="session-review-filename">{getFilename(diff.file)}</span>
                            <Show when={props.onViewFile}>
                              <button
                                data-slot="session-review-view-button"
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  props.onViewFile?.(diff.file)
                                }}
                              >
                                <Icon name="eye" size="small" />
                              </button>
                            </Show>
                          </div>
                        </div>
                        <div data-slot="session-review-trigger-actions">
                          <Switch>
                            <Match when={isAdded()}>
                              <span data-slot="session-review-change" data-type="added">
                                Added
                              </span>
                            </Match>
                            <Match when={isDeleted()}>
                              <span data-slot="session-review-change" data-type="removed">
                                Removed
                              </span>
                            </Match>
                            <Match when={true}>
                              <DiffChanges changes={diff} />
                            </Match>
                          </Switch>
                          <Icon name="chevron-grabber-vertical" size="small" />
                        </div>
                      </div>
                    </Accordion.Trigger>
                  </StickyAccordionHeader>
                  <Accordion.Content data-slot="session-review-accordion-content">
                    <Switch>
                      <Match when={isImage()}>
                        <div data-slot="session-review-image-container">
                          <Show
                            when={imageSrc()}
                            fallback={
                              <div data-slot="session-review-image-placeholder">
                                <Switch>
                                  <Match when={imageStatus() === "loading"}>Loading image...</Match>
                                  <Match when={true}>Image preview unavailable</Match>
                                </Switch>
                              </div>
                            }
                          >
                            <img data-slot="session-review-image" src={imageSrc()!} alt={getFilename(diff.file)} />
                          </Show>
                        </div>
                      </Match>
                      <Match when={isAudio()}>
                        <div data-slot="session-review-audio-container">
                          <Show
                            when={audioSrc() && audioStatus() !== "error"}
                            fallback={
                              <div data-slot="session-review-audio-placeholder">
                                <Switch>
                                  <Match when={audioStatus() === "loading"}>Loading audio...</Match>
                                  <Match when={true}>Audio preview unavailable</Match>
                                </Switch>
                              </div>
                            }
                          >
                            <audio
                              data-slot="session-review-audio"
                              controls
                              preload="metadata"
                              onError={() => {
                                setAudioStatus("error")
                              }}
                            >
                              <source src={audioSrc()!} type={audioMime()} />
                            </audio>
                          </Show>
                        </div>
                      </Match>
                      <Match when={isAdded() || isDeleted()}>
                        <div data-slot="session-review-file-container">
                          <Dynamic component={codeComponent} file={fileForCode()} overflow="scroll" />
                        </div>
                      </Match>
                      <Match when={true}>
                        <Dynamic
                          component={diffComponent}
                          preloadedDiff={diff.preloaded}
                          diffStyle={diffStyle()}
                          onRendered={props.onDiffRendered}
                          enableLineSelection={props.onLineComment != null}
                          onLineSelected={handleLineSelected}
                          onLineSelectionEnd={handleLineSelectionEnd}
                          selectedLines={selectedLines()}
                          annotations={annotations()}
                          renderAnnotation={renderAnnotation}
                          before={{
                            name: diff.file!,
                            contents: beforeText(),
                          }}
                          after={{
                            name: diff.file!,
                            contents: afterText(),
                          }}
                        />
                      </Match>
                    </Switch>
                  </Accordion.Content>
                </Accordion.Item>
              )
            }}
          </For>
        </Accordion>
      </div>
    </div>
  )
}
