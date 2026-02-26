import { createEffect, createMemo, For, Match, on, onCleanup, Show, Switch } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { useParams } from "@solidjs/router"
import { useCodeComponent } from "@opencode-ai/ui/context/code"
import { sampledChecksum } from "@opencode-ai/util/encode"
import { decode64 } from "@/utils/base64"
import { showToast } from "@opencode-ai/ui/toast"
import { LineComment as LineCommentView, LineCommentEditor } from "@opencode-ai/ui/line-comment"
import { Mark } from "@opencode-ai/ui/logo"
import { Tabs } from "@opencode-ai/ui/tabs"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { useLayout } from "@/context/layout"
import { selectionFromLines, useFile, type FileSelection, type SelectedLineRange } from "@/context/file"
import { useComments } from "@/context/comments"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { getSessionHandoff } from "@/pages/session/handoff"

const formatCommentLabel = (range: SelectedLineRange) => {
  const start = Math.min(range.start, range.end)
  const end = Math.max(range.start, range.end)
  if (start === end) return `line ${start}`
  return `lines ${start}-${end}`
}

export function FileTabContent(props: { tab: string }) {
  const params = useParams()
  const layout = useLayout()
  const file = useFile()
  const comments = useComments()
  const language = useLanguage()
  const prompt = usePrompt()
  const codeComponent = useCodeComponent()

  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const tabs = createMemo(() => layout.tabs(sessionKey))
  const view = createMemo(() => layout.view(sessionKey))

  let scroll: HTMLDivElement | undefined
  let scrollFrame: number | undefined
  let pending: { x: number; y: number } | undefined
  let codeScroll: HTMLElement[] = []

  const path = createMemo(() => file.pathFromTab(props.tab))
  const state = createMemo(() => {
    const p = path()
    if (!p) return
    return file.get(p)
  })
  const contents = createMemo(() => state()?.content?.content ?? "")
  const cacheKey = createMemo(() => sampledChecksum(contents()))
  const isImage = createMemo(() => {
    const c = state()?.content
    return c?.encoding === "base64" && c?.mimeType?.startsWith("image/") && c?.mimeType !== "image/svg+xml"
  })
  const isSvg = createMemo(() => {
    const c = state()?.content
    return c?.mimeType === "image/svg+xml"
  })
  const isBinary = createMemo(() => state()?.content?.type === "binary")
  const svgContent = createMemo(() => {
    if (!isSvg()) return
    const c = state()?.content
    if (!c) return
    if (c.encoding !== "base64") return c.content
    return decode64(c.content)
  })

  const svgDecodeFailed = createMemo(() => {
    if (!isSvg()) return false
    const c = state()?.content
    if (!c) return false
    if (c.encoding !== "base64") return false
    return svgContent() === undefined
  })

  const svgToast = { shown: false }
  createEffect(() => {
    if (!svgDecodeFailed()) return
    if (svgToast.shown) return
    svgToast.shown = true
    showToast({
      variant: "error",
      title: language.t("toast.file.loadFailed.title"),
    })
  })
  const svgPreviewUrl = createMemo(() => {
    if (!isSvg()) return
    const c = state()?.content
    if (!c) return
    if (c.encoding === "base64") return `data:image/svg+xml;base64,${c.content}`
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(c.content)}`
  })
  const imageDataUrl = createMemo(() => {
    if (!isImage()) return
    const c = state()?.content
    return `data:${c?.mimeType};base64,${c?.content}`
  })
  const selectedLines = createMemo(() => {
    const p = path()
    if (!p) return null
    if (file.ready()) return file.selectedLines(p) ?? null
    return getSessionHandoff(sessionKey())?.files[p] ?? null
  })

  const selectionPreview = (source: string, selection: FileSelection) => {
    const start = Math.max(1, Math.min(selection.startLine, selection.endLine))
    const end = Math.max(selection.startLine, selection.endLine)
    const lines = source.split("\n").slice(start - 1, end)
    if (lines.length === 0) return undefined
    return lines.slice(0, 2).join("\n")
  }

  const addCommentToContext = (input: {
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
    origin?: "review" | "file"
  }) => {
    const selection = selectionFromLines(input.selection)
    const preview =
      input.preview ??
      (() => {
        if (input.file === path()) return selectionPreview(contents(), selection)
        const source = file.get(input.file)?.content?.content
        if (!source) return undefined
        return selectionPreview(source, selection)
      })()

    const saved = comments.add({
      file: input.file,
      selection: input.selection,
      comment: input.comment,
    })
    prompt.context.add({
      type: "file",
      path: input.file,
      selection,
      comment: input.comment,
      commentID: saved.id,
      commentOrigin: input.origin,
      preview,
    })
  }

  let wrap: HTMLDivElement | undefined

  const fileComments = createMemo(() => {
    const p = path()
    if (!p) return []
    return comments.list(p)
  })

  const commentLayout = createMemo(() => {
    return fileComments()
      .map((comment) => `${comment.id}:${comment.selection.start}:${comment.selection.end}`)
      .join("|")
  })

  const commentedLines = createMemo(() => fileComments().map((comment) => comment.selection))

  const [note, setNote] = createStore({
    openedComment: null as string | null,
    commenting: null as SelectedLineRange | null,
    draft: "",
    positions: {} as Record<string, number>,
    draftTop: undefined as number | undefined,
  })

  const setCommenting = (range: SelectedLineRange | null) => {
    setNote("commenting", range)
    scheduleComments()
    if (!range) return
    setNote("draft", "")
  }

  const getRoot = () => {
    const el = wrap
    if (!el) return

    const host = el.querySelector("diffs-container")
    if (!(host instanceof HTMLElement)) return

    const root = host.shadowRoot
    if (!root) return

    return root
  }

  const findMarker = (root: ShadowRoot, range: SelectedLineRange) => {
    const line = Math.max(range.start, range.end)
    const node = root.querySelector(`[data-line="${line}"]`)
    if (!(node instanceof HTMLElement)) return
    return node
  }

  const markerTop = (wrapper: HTMLElement, marker: HTMLElement) => {
    const wrapperRect = wrapper.getBoundingClientRect()
    const rect = marker.getBoundingClientRect()
    return rect.top - wrapperRect.top + Math.max(0, (rect.height - 20) / 2)
  }

  const updateComments = () => {
    const el = wrap
    const root = getRoot()
    if (!el || !root) {
      setNote("positions", {})
      setNote("draftTop", undefined)
      return
    }

    const estimateTop = (range: SelectedLineRange) => {
      const line = Math.max(range.start, range.end)
      const height = 24
      const offset = 2
      return Math.max(0, (line - 1) * height + offset)
    }

    const large = contents().length > 500_000

    const next: Record<string, number> = {}
    for (const comment of fileComments()) {
      const marker = findMarker(root, comment.selection)
      if (marker) next[comment.id] = markerTop(el, marker)
      else if (large) next[comment.id] = estimateTop(comment.selection)
    }

    const removed = Object.keys(note.positions).filter((id) => next[id] === undefined)
    const changed = Object.entries(next).filter(([id, top]) => note.positions[id] !== top)
    if (removed.length > 0 || changed.length > 0) {
      setNote(
        "positions",
        produce((draft) => {
          for (const id of removed) {
            delete draft[id]
          }

          for (const [id, top] of changed) {
            draft[id] = top
          }
        }),
      )
    }

    const range = note.commenting
    if (!range) {
      setNote("draftTop", undefined)
      return
    }

    const marker = findMarker(root, range)
    if (marker) {
      setNote("draftTop", markerTop(el, marker))
      return
    }

    setNote("draftTop", large ? estimateTop(range) : undefined)
  }

  const scheduleComments = () => {
    requestAnimationFrame(updateComments)
  }

  createEffect(() => {
    commentLayout()
    scheduleComments()
  })

  createEffect(() => {
    const focus = comments.focus()
    const p = path()
    if (!focus || !p) return
    if (focus.file !== p) return
    if (tabs().active() !== props.tab) return

    const target = fileComments().find((comment) => comment.id === focus.id)
    if (!target) return

    setNote("openedComment", target.id)
    setCommenting(null)
    file.setSelectedLines(p, target.selection)
    requestAnimationFrame(() => comments.clearFocus())
  })

  const getCodeScroll = () => {
    const el = scroll
    if (!el) return []

    const host = el.querySelector("diffs-container")
    if (!(host instanceof HTMLElement)) return []

    const root = host.shadowRoot
    if (!root) return []

    return Array.from(root.querySelectorAll("[data-code]")).filter(
      (node): node is HTMLElement => node instanceof HTMLElement && node.clientWidth > 0,
    )
  }

  const queueScrollUpdate = (next: { x: number; y: number }) => {
    pending = next
    if (scrollFrame !== undefined) return

    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = undefined

      const out = pending
      pending = undefined
      if (!out) return

      view().setScroll(props.tab, out)
    })
  }

  const handleCodeScroll = (event: Event) => {
    const el = scroll
    if (!el) return

    const target = event.currentTarget
    if (!(target instanceof HTMLElement)) return

    queueScrollUpdate({
      x: target.scrollLeft,
      y: el.scrollTop,
    })
  }

  const syncCodeScroll = () => {
    const next = getCodeScroll()
    if (next.length === codeScroll.length && next.every((el, i) => el === codeScroll[i])) return

    for (const item of codeScroll) {
      item.removeEventListener("scroll", handleCodeScroll)
    }

    codeScroll = next

    for (const item of codeScroll) {
      item.addEventListener("scroll", handleCodeScroll)
    }
  }

  const restoreScroll = () => {
    const el = scroll
    if (!el) return

    const s = view().scroll(props.tab)
    if (!s) return

    syncCodeScroll()

    if (codeScroll.length > 0) {
      for (const item of codeScroll) {
        if (item.scrollLeft !== s.x) item.scrollLeft = s.x
      }
    }

    if (el.scrollTop !== s.y) el.scrollTop = s.y
    if (codeScroll.length > 0) return
    if (el.scrollLeft !== s.x) el.scrollLeft = s.x
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    if (codeScroll.length === 0) syncCodeScroll()

    queueScrollUpdate({
      x: codeScroll[0]?.scrollLeft ?? event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    })
  }

  const cancelCommenting = () => {
    const p = path()
    if (p) file.setSelectedLines(p, null)
    setNote("commenting", null)
  }

  createEffect(
    on(
      () => state()?.loaded,
      (loaded) => {
        if (!loaded) return
        requestAnimationFrame(restoreScroll)
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => file.ready(),
      (ready) => {
        if (!ready) return
        requestAnimationFrame(restoreScroll)
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => tabs().active() === props.tab,
      (active) => {
        if (!active) return
        if (!state()?.loaded) return
        requestAnimationFrame(restoreScroll)
      },
    ),
  )

  onCleanup(() => {
    for (const item of codeScroll) {
      item.removeEventListener("scroll", handleCodeScroll)
    }

    if (scrollFrame === undefined) return
    cancelAnimationFrame(scrollFrame)
  })

  const renderCode = (source: string, wrapperClass: string) => (
    <div
      ref={(el) => {
        wrap = el
        scheduleComments()
      }}
      class={`relative overflow-hidden ${wrapperClass}`}
    >
      <Dynamic
        component={codeComponent}
        file={{
          name: path() ?? "",
          contents: source,
          cacheKey: cacheKey(),
        }}
        enableLineSelection
        selectedLines={selectedLines()}
        commentedLines={commentedLines()}
        onRendered={() => {
          requestAnimationFrame(restoreScroll)
          requestAnimationFrame(scheduleComments)
        }}
        onLineSelected={(range: SelectedLineRange | null) => {
          const p = path()
          if (!p) return
          file.setSelectedLines(p, range)
          if (!range) setCommenting(null)
        }}
        onLineSelectionEnd={(range: SelectedLineRange | null) => {
          if (!range) {
            setCommenting(null)
            return
          }

          setNote("openedComment", null)
          setCommenting(range)
        }}
        overflow="scroll"
        class="select-text"
      />
      <For each={fileComments()}>
        {(comment) => (
          <LineCommentView
            id={comment.id}
            top={note.positions[comment.id]}
            open={note.openedComment === comment.id}
            comment={comment.comment}
            selection={formatCommentLabel(comment.selection)}
            onMouseEnter={() => {
              const p = path()
              if (!p) return
              file.setSelectedLines(p, comment.selection)
            }}
            onClick={() => {
              const p = path()
              if (!p) return
              setCommenting(null)
              setNote("openedComment", (current) => (current === comment.id ? null : comment.id))
              file.setSelectedLines(p, comment.selection)
            }}
          />
        )}
      </For>
      <Show when={note.commenting}>
        {(range) => (
          <Show when={note.draftTop !== undefined}>
            <LineCommentEditor
              top={note.draftTop}
              value={note.draft}
              selection={formatCommentLabel(range())}
              onInput={(value) => setNote("draft", value)}
              onCancel={cancelCommenting}
              onSubmit={(value) => {
                const p = path()
                if (!p) return
                addCommentToContext({ file: p, selection: range(), comment: value, origin: "file" })
                setCommenting(null)
              }}
              onPopoverFocusOut={(e: FocusEvent) => {
                const current = e.currentTarget as HTMLDivElement
                const target = e.relatedTarget
                if (target instanceof Node && current.contains(target)) return

                setTimeout(() => {
                  if (!document.activeElement || !current.contains(document.activeElement)) {
                    cancelCommenting()
                  }
                }, 0)
              }}
            />
          </Show>
        )}
      </Show>
    </div>
  )

  return (
    <Tabs.Content value={props.tab} class="mt-3 relative h-full">
      <ScrollView
        class="h-full"
        viewportRef={(el: HTMLDivElement) => {
          scroll = el
          restoreScroll()
        }}
        onScroll={handleScroll as any}
      >
        <Switch>
          <Match when={state()?.loaded && isImage()}>
            <div class="px-6 py-4 pb-40">
              <img
                src={imageDataUrl()}
                alt={path()}
                class="max-w-full"
                onLoad={() => requestAnimationFrame(restoreScroll)}
              />
            </div>
          </Match>
          <Match when={state()?.loaded && isSvg()}>
            <div class="flex flex-col gap-4 px-6 py-4">
              {renderCode(svgContent() ?? "", "")}
              <Show when={svgPreviewUrl()}>
                <div class="flex justify-center pb-40">
                  <img src={svgPreviewUrl()} alt={path()} class="max-w-full max-h-96" />
                </div>
              </Show>
            </div>
          </Match>
          <Match when={state()?.loaded && isBinary()}>
            <div class="h-full px-6 pb-42 flex flex-col items-center justify-center text-center gap-6">
              <Mark class="w-14 opacity-10" />
              <div class="flex flex-col gap-2 max-w-md">
                <div class="text-14-semibold text-text-strong truncate">{path()?.split("/").pop()}</div>
                <div class="text-14-regular text-text-weak">{language.t("session.files.binaryContent")}</div>
              </div>
            </div>
          </Match>
          <Match when={state()?.loaded}>{renderCode(contents(), "pb-40")}</Match>
          <Match when={state()?.loading}>
            <div class="px-6 py-4 text-text-weak">{language.t("common.loading")}...</div>
          </Match>
          <Match when={state()?.error}>{(err) => <div class="px-6 py-4 text-text-weak">{err()}</div>}</Match>
        </Switch>
      </ScrollView>
    </Tabs.Content>
  )
}
