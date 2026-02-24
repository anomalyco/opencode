import { createEffect, createMemo, Match, on, onCleanup, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { useParams } from "@solidjs/router"
import { useFileComponent } from "@opencode-ai/ui/context/file"
import { cloneSelectedLineRange, previewSelectedLines } from "@opencode-ai/ui/pierre/selection-bridge"
import { createLineCommentController } from "@opencode-ai/ui/line-comment-annotations"
import { sampledChecksum } from "@opencode-ai/util/encode"
import { showToast } from "@opencode-ai/ui/toast"
import { Mark } from "@opencode-ai/ui/logo"
import { Tabs } from "@opencode-ai/ui/tabs"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { useLayout } from "@/context/layout"
import { selectionFromLines, useFile, type FileSelection, type SelectedLineRange } from "@/context/file"
import { useComments } from "@/context/comments"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { getSessionHandoff } from "@/pages/session/handoff"

export function FileTabContent(props: { tab: string }) {
  const params = useParams()
  const layout = useLayout()
  const file = useFile()
  const comments = useComments()
  const language = useLanguage()
  const prompt = usePrompt()
  const fileComponent = useFileComponent()

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

  const svgToast = { shown: false }
  createEffect(() => {
    path()
    svgToast.shown = false
  })
  const selectedLines = createMemo<SelectedLineRange | null>(() => {
    const p = path()
    if (!p) return null
    if (file.ready()) return (file.selectedLines(p) as SelectedLineRange | undefined) ?? null
    return (getSessionHandoff(sessionKey())?.files[p] as SelectedLineRange | undefined) ?? null
  })

  const selectionPreview = (source: string, selection: FileSelection) => {
    return previewSelectedLines(source, {
      start: selection.startLine,
      end: selection.endLine,
    })
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

  const fileComments = createMemo(() => {
    const p = path()
    if (!p) return []
    return comments.list(p)
  })

  const commentedLines = createMemo(() => fileComments().map((comment) => comment.selection))

  const [note, setNote] = createStore({
    openedComment: null as string | null,
    commenting: null as SelectedLineRange | null,
    selected: null as SelectedLineRange | null,
  })

  const syncSelected = (range: SelectedLineRange | null) => {
    const p = path()
    if (!p) return
    file.setSelectedLines(p, range ? cloneSelectedLineRange(range) : null)
  }

  const activeSelection = () => note.selected ?? selectedLines()

  const commentsUi = createLineCommentController({
    comments: fileComments,
    label: language.t("ui.lineComment.submit"),
    draftKey: () => path() ?? props.tab,
    state: {
      opened: () => note.openedComment,
      setOpened: (id) => setNote("openedComment", id),
      selected: () => note.selected,
      setSelected: (range) => setNote("selected", range),
      commenting: () => note.commenting,
      setCommenting: (range) => setNote("commenting", range),
      syncSelected,
      hoverSelected: syncSelected,
    },
    getHoverSelectedRange: activeSelection,
    cancelDraftOnCommentToggle: true,
    clearSelectionOnSelectionEndNull: true,
    onSubmit: ({ comment, selection }) => {
      const p = path()
      if (!p) return
      addCommentToContext({ file: p, selection, comment, origin: "file" })
    },
    onDraftPopoverFocusOut: (e: FocusEvent) => {
      const current = e.currentTarget as HTMLDivElement
      const target = e.relatedTarget
      if (target instanceof Node && current.contains(target)) return

      setTimeout(() => {
        if (!document.activeElement || !current.contains(document.activeElement)) {
          setNote("commenting", null)
        }
      }, 0)
    },
  })

  createEffect(
    on(
      path,
      () => {
        commentsUi.note.reset()
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const focus = comments.focus()
    const p = path()
    if (!focus || !p) return
    if (focus.file !== p) return
    if (tabs().active() !== props.tab) return

    const target = fileComments().find((comment) => comment.id === focus.id)
    if (!target) return

    commentsUi.note.openComment(target.id, target.selection, { cancelDraft: true })
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

  const renderText = (source: string, wrapperClass: string, key = cacheKey()) => (
    <div class={`relative overflow-hidden ${wrapperClass}`}>
      <Dynamic
        component={fileComponent}
        mode="text"
        file={{
          name: path() ?? "",
          contents: source,
          cacheKey: key,
        }}
        enableLineSelection
        enableHoverUtility
        selectedLines={activeSelection()}
        commentedLines={commentedLines()}
        onRendered={() => {
          requestAnimationFrame(restoreScroll)
        }}
        annotations={commentsUi.annotations()}
        renderAnnotation={commentsUi.renderAnnotation}
        renderHoverUtility={commentsUi.renderHoverUtility}
        onLineSelected={(range: SelectedLineRange | null) => {
          commentsUi.onLineSelected(range)
        }}
        onLineNumberSelectionEnd={commentsUi.onLineNumberSelectionEnd}
        onLineSelectionEnd={(range: SelectedLineRange | null) => {
          commentsUi.onLineSelectionEnd(range)
        }}
        overflow="scroll"
        class="select-text"
        media={{ mode: "off" }}
      />
    </div>
  )

  const renderFile = (source: string, wrapperClass: string) => (
    <div class={`relative overflow-hidden ${wrapperClass}`}>
      <Dynamic
        component={fileComponent}
        mode="text"
        file={{
          name: path() ?? "",
          contents: source,
          cacheKey: cacheKey(),
        }}
        enableLineSelection
        enableHoverUtility
        selectedLines={activeSelection()}
        commentedLines={commentedLines()}
        onRendered={() => {
          requestAnimationFrame(restoreScroll)
        }}
        annotations={commentsUi.annotations()}
        renderAnnotation={commentsUi.renderAnnotation}
        renderHoverUtility={commentsUi.renderHoverUtility}
        onLineSelected={(range: SelectedLineRange | null) => {
          commentsUi.onLineSelected(range)
        }}
        onLineNumberSelectionEnd={commentsUi.onLineNumberSelectionEnd}
        onLineSelectionEnd={(range: SelectedLineRange | null) => {
          commentsUi.onLineSelectionEnd(range)
        }}
        overflow="scroll"
        class="select-text"
        media={{
          mode: "auto",
          path: path(),
          current: state()?.content,
          onLoad: () => requestAnimationFrame(restoreScroll),
          onError: (args: { kind: "image" | "audio" | "svg" }) => {
            if (args.kind !== "svg") return
            if (svgToast.shown) return
            svgToast.shown = true
            showToast({
              variant: "error",
              title: language.t("toast.file.loadFailed.title"),
            })
          },
          renderImage: (args: { src: string; onLoad: () => void }) => (
            <div class="px-6 py-4 pb-40">
              <img src={args.src} alt={path()} class="max-w-full" onLoad={args.onLoad} />
            </div>
          ),
          renderSvg: (args: { src?: string; source: string; onLoad: () => void }) => (
            <div class="flex flex-col gap-4 px-6 py-4">
              {renderText(args.source, "", sampledChecksum(args.source))}
              <Show when={args.src}>
                {(src) => (
                  <div class="flex justify-center pb-40">
                    <img src={src()} alt={path()} class="max-w-full max-h-96" onLoad={args.onLoad} />
                  </div>
                )}
              </Show>
            </div>
          ),
          renderBinaryPlaceholder: () => (
            <div class="h-full px-6 pb-42 flex flex-col items-center justify-center text-center gap-6">
              <Mark class="w-14 opacity-10" />
              <div class="flex flex-col gap-2 max-w-md">
                <div class="text-14-semibold text-text-strong truncate">{path()?.split("/").pop()}</div>
                <div class="text-14-regular text-text-weak">{language.t("session.files.binaryContent")}</div>
              </div>
            </div>
          ),
        }}
      />
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
          <Match when={state()?.loaded}>{renderFile(contents(), "pb-40")}</Match>
          <Match when={state()?.loading}>
            <div class="px-6 py-4 text-text-weak">{language.t("common.loading")}...</div>
          </Match>
          <Match when={state()?.error}>{(err) => <div class="px-6 py-4 text-text-weak">{err()}</div>}</Match>
        </Switch>
      </ScrollView>
    </Tabs.Content>
  )
}
