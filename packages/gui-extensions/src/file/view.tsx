import { createMemo, createSignal, Match, on, onCleanup, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { FileSearchHandle } from "@opencode/session-ui/file"
import { useFileComponent } from "@opencode/ui/context/file"
import { cloneSelectedLineRange, previewSelectedLines } from "@opencode/session-ui/pierre/selection-bridge"
import { createLineCommentControllerV2 } from "@opencode/session-ui/v2/line-comment-annotations-v2"
import { sampledChecksum } from "@opencode/util/encode"
import { LineCommentOverflowIcon } from "@opencode/ui/line-comment"
import { Menu } from "@opencode/ui/menu"
import { ScrollView } from "@opencode/ui/scroll-view"
import { createKeyed, useExtension, type LineRange, type MountedSession, type SessionScreen } from "../sdk"
import { artifactKind } from "@opencode/util/artifact"
import ArtifactView from "./artifact-view"
import { useShared } from "./context"
import { fileTabPath } from "./path"

type FileSelection = { startLine: number; endLine: number; startChar: number; endChar: number }

function selectionFromLines(range: LineRange): FileSelection {
  const startLine = Math.min(range.start, range.end)
  const endLine = Math.max(range.start, range.end)

  return {
    startLine,
    endLine,
    startChar: 0,
    endChar: 0,
  }
}

const selectionSide = (range: LineRange) => range.endSide ?? range.side ?? "additions"

function FileCommentMenu(props: {
  moreLabel: string
  editLabel: string
  deleteLabel: string
  onEdit: VoidFunction
  onDelete: VoidFunction
}) {
  return (
    <div onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <Menu gutter={4}>
        <Menu.Trigger as="button" type="button" data-slot="line-comment-v2-overflow" aria-label={props.moreLabel}>
          <LineCommentOverflowIcon />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content>
            <Menu.Item onSelect={props.onEdit}>{props.editLabel}</Menu.Item>
            <Menu.Item onSelect={props.onDelete}>{props.deleteLabel}</Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu>
    </div>
  )
}

type ScrollPos = { x: number; y: number }

type ScrollSyncState = { scroll?: HTMLDivElement; scrollFrame?: number; restoreFrame?: number; pending?: ScrollPos }

type NoteState = { openedComment: string | null; commenting: LineRange | null; selected: LineRange | null }

type FindState = { find: FileSearchHandle | null }

function createScrollSync(input: { get: () => ScrollPos | undefined; set: (pos: ScrollPos) => void }) {
  const state: ScrollSyncState = {}
  const [code, setCode] = createSignal<HTMLElement[]>([])

  const getCode = () => {
    const el = state.scroll

    if (!el) return []

    const host = el.querySelector("diffs-container")

    if (!(host instanceof HTMLElement)) return []

    const root = host.shadowRoot

    if (!root) return []

    return Array.from(root.querySelectorAll("[data-code]")).filter(
      (node): node is HTMLElement => node instanceof HTMLElement && node.clientWidth > 0,
    )
  }

  const save = (next: ScrollPos) => {
    state.pending = next

    if (state.scrollFrame !== undefined) return

    state.scrollFrame = requestAnimationFrame(() => {
      state.scrollFrame = undefined

      const out = state.pending
      state.pending = undefined

      if (!out) return

      input.set(out)
    })
  }

  const onCodeScroll = (event: Event) => {
    const el = state.scroll

    if (!el) return

    const target = event.currentTarget

    if (!(target instanceof HTMLElement)) return

    save({
      x: target.scrollLeft,
      y: el.scrollTop,
    })
  }

  const sync = () => {
    const next = getCode()
    const current = code()

    if (next.length === current.length && next.every((el, i) => el === current[i])) return
    setCode(next)
  }

  const restore = () => {
    const el = state.scroll

    if (!el) return

    const pos = input.get()

    if (!pos) return

    sync()

    if (code().length > 0) {
      for (const item of code()) {
        if (item.scrollLeft !== pos.x) item.scrollLeft = pos.x
      }
    }

    if (el.scrollTop !== pos.y) el.scrollTop = pos.y

    if (code().length > 0) return

    if (el.scrollLeft !== pos.x) el.scrollLeft = pos.x
  }

  const queueRestore = () => {
    if (state.restoreFrame !== undefined) return

    state.restoreFrame = requestAnimationFrame(() => {
      state.restoreFrame = undefined
      restore()
    })
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    if (code().length === 0) sync()

    save({
      x: code()[0]?.scrollLeft ?? event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    })
  }

  // The diff's code columns scroll on their own; listen to the ones on screen.
  createKeyed(code, (items) => items.forEach((item) => makeEventListener(item, "scroll", onCodeScroll)))

  const setViewport = (el: HTMLDivElement) => {
    state.scroll = el
    restore()
  }

  onCleanup(() => {
    if (state.scrollFrame !== undefined) cancelAnimationFrame(state.scrollFrame)

    if (state.restoreFrame !== undefined) cancelAnimationFrame(state.restoreFrame)
  })

  return {
    handleScroll,
    queueRestore,
    setViewport,
  }
}

export function SessionFileView(props: { session: MountedSession; screen: SessionScreen; id: string }) {
  const ctx = useExtension()
  const layout = ctx.layout
  const shared = useShared()
  const fileComponent = useFileComponent()
  const file = props.screen.file
  const comment = props.screen.comment
  const composer = props.screen.composer
  // The stored side tab key doubles as the scroll key, as it did before extensions.
  const key = () => `file:${props.id}`
  const active = () => shared.active(props.session, props.id)

  const state: FindState = { find: null }

  const search = {
    register: (handle: FileSearchHandle | null) => {
      state.find = handle
    },
  }

  const path = createMemo(() => fileTabPath(file, props.id))

  const current = createMemo(() => {
    const p = path()

    if (!p) return

    return file.get(p)
  })

  const contents = createMemo(() => current()?.content?.content ?? "")
  const cacheKey = createMemo(() => sampledChecksum(contents()))

  // Plain text keeps the code view; every other kind is rendered by ArtifactView.
  const artifact = createMemo(() => {
    const content = current()?.content

    return content?.type === "binary" || artifactKind(path() ?? "") !== "text"
  })

  const selectedLines = createMemo<LineRange | null>(() => {
    const p = path()

    if (!p) return null

    if (file.ready()) return file.selection.get(p) ?? null

    return shared.handoff.get(props.session.key, p) ?? null
  })

  const scrollSync = createScrollSync({
    get: () => layout.scroll.get(props.session, key()),
    set: (pos) => layout.scroll.set(props.session, key(), pos),
  })

  const selectionPreview = (source: string, selection: FileSelection) => {
    return previewSelectedLines(source, {
      start: selection.startLine,
      end: selection.endLine,
    })
  }

  const buildPreview = (filePath: string, lines: LineRange) => {
    const source = filePath === path() ? contents() : file.get(filePath)?.content?.content

    if (!source) return undefined

    return selectionPreview(source, selectionFromLines(lines))
  }

  const addCommentToContext = (input: {
    file: string
    selection: LineRange
    comment: string
    preview?: string
    origin?: "review" | "file"
  }) => {
    const selection = selectionFromLines(input.selection)
    const preview = input.preview ?? buildPreview(input.file, input.selection)

    const saved = comment.add({
      file: input.file,
      selection: input.selection,
      comment: input.comment,
    })

    composer.attach({
      type: "file",
      path: input.file,
      selection,
      comment: input.comment,
      commentID: saved.id,
      commentOrigin: input.origin,
      preview,
    })
  }

  const updateCommentInContext = (input: { id: string; file: string; selection: LineRange; comment: string }) => {
    comment.update(input.id, input.comment)
    const preview = input.file === path() ? buildPreview(input.file, input.selection) : undefined
    // The composer keeps a chip's preview unless the update names a new one.
    composer.update(input.id, preview ? { comment: input.comment, preview } : { comment: input.comment })
  }

  const removeCommentFromContext = (input: { id: string; file: string }) => {
    comment.remove(input.id)
    composer.detach(input.id)
  }

  const fileComments = createMemo(() => {
    const p = path()

    if (!p) return []

    return [...comment.list(p)]
  })

  const commentedLines = createMemo(() => fileComments().map((comment) => comment.selection))

  const [note, setNote] = createStore<NoteState>({ openedComment: null, commenting: null, selected: null })

  const syncSelected = (range: LineRange | null) => {
    const p = path()

    if (!p) return
    file.selection.set(p, range ? cloneSelectedLineRange(range) : null)
  }

  const activeSelection = () => note.selected ?? selectedLines()

  const commentsUi = createLineCommentControllerV2({
    comments: fileComments,
    label: ctx.t("ui.lineComment.submit"),
    draftKey: () => path() ?? props.id,
    mention: {
      items: (query) => file.search(query, { kind: "any" }),
    },
    getSide: selectionSide,
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
    onSubmit: ({ comment, selection }) => {
      const p = path()

      if (!p) return
      addCommentToContext({ file: p, selection, comment, origin: "file" })
    },
    onUpdate: ({ id, comment, selection }) => {
      const p = path()

      if (!p) return
      updateCommentInContext({ id, file: p, selection, comment })
    },
    onDelete: (comment) => {
      const p = path()

      if (!p) return
      removeCommentFromContext({ id: comment.id, file: p })
    },
    editSubmitLabel: ctx.t("common.save"),
    renderCommentActions: (_, controls) => (
      <FileCommentMenu
        moreLabel={ctx.t("common.moreOptions")}
        editLabel={ctx.t("common.edit")}
        deleteLabel={ctx.t("common.delete")}
        onEdit={controls.edit}
        onDelete={controls.remove}
      />
    ),
  })

  // Mod+F finds in the shown file.
  makeEventListener(
    window,
    "keydown",
    (event: KeyboardEvent) => {
      if (!active()) return

      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return

      if (event.key.toLowerCase() !== "f") return

      event.preventDefault()
      event.stopPropagation()
      state.find?.focus()
    },
    { capture: true },
  )

  // A new path, e.g. after the workspace directory changes, drops the comment draft and selection of the old one.
  const moved = createMemo(on(path, () => ({}), { defer: true }))

  createKeyed(moved, () => commentsUi.note.reset())

  // A comment focused elsewhere, e.g. from its composer chip, opens here once this file shows.
  createKeyed(
    () => {
      const focus = comment.focus.current()
      const p = path()

      if (!focus || !p || focus.file !== p || !active()) return

      const target = fileComments().find((item) => item.id === focus.id)

      return target && { target }
    },
    (focus) => {
      commentsUi.note.openComment(focus.target.id, focus.target.selection, { cancelDraft: true })
      requestAnimationFrame(() => comment.focus.set(null))
    },
  )

  const previous = { loaded: false, ready: false, active: false }

  // Restores the stored scroll when the file loads, its view state loads, or the tab shows a loaded file again.
  createKeyed(
    () => ({ loaded: !!current()?.loaded, ready: file.ready(), shown: active() }),
    (next) => {
      const restore =
        (next.loaded && !previous.loaded) ||
        (next.ready && !previous.ready) ||
        (next.shown && next.loaded && !previous.active)

      previous.loaded = next.loaded
      previous.ready = next.ready
      previous.active = next.shown

      if (restore) scrollSync.queueRestore()
    },
  )

  const renderFile = (source: string) => (
    <div class="relative overflow-hidden pb-40">
      <Dynamic
        component={fileComponent}
        mode="text"
        file={{
          name: path() ?? "",
          contents: source,
          cacheKey: cacheKey(),
        }}
        enableLineSelection
        enableGutterUtility
        selectedLines={activeSelection()}
        commentedLines={commentedLines()}
        onRendered={() => {
          scrollSync.queueRestore()
        }}
        annotations={commentsUi.annotations()}
        renderAnnotation={commentsUi.renderAnnotation}
        renderGutterUtility={commentsUi.renderGutterUtility}
        onLineSelected={(range: LineRange | null) => {
          commentsUi.onLineSelected(range)
        }}
        onLineSelectionEnd={(range: LineRange | null) => {
          if (!range) {
            commentsUi.note.select(null)
            commentsUi.note.cancelDraft()

            return
          }

          commentsUi.onLineSelectionEnd(range)
        }}
        onLineNumberSelectionEnd={(range: LineRange | null) => {
          commentsUi.onLineNumberSelectionEnd(range)
        }}
        search={search}
        class="select-text"
        // Media and previews have their own viewers below; the code view only ever shows text.
        media={{ mode: "off" }}
      />
    </div>
  )

  // The code view scrolls inside ScrollView so line state and scroll position persist per tab.
  const codeView = (source: string) => (
    <ScrollView class="min-h-0 flex-1" viewportRef={scrollSync.setViewport} onScroll={scrollSync.handleScroll}>
      {renderFile(source)}
    </ScrollView>
  )

  return (
    <div class="mt-3 relative h-full min-h-0 flex flex-col">
      <Switch>
        <Match when={current()?.loaded ? current()?.content : undefined}>
          {(value) => (
            <Show when={artifact()} fallback={codeView(value().content)}>
              <ArtifactView
                session={props.session}
                path={path() ?? ""}
                content={value()}
                cacheKey={cacheKey()}
                source={codeView(value().content)}
              />
            </Show>
          )}
        </Match>
        <Match when={current()?.loading}>
          <div class="px-6 py-4 text-text-weak">{ctx.t("common.loading")}…</div>
        </Match>
        <Match when={current()?.notFound ? current()?.name : undefined}>
          {(name) => <div class="px-6 py-4 text-text-weak">{ctx.t("tab.notFound", { name: name() })}</div>}
        </Match>
        <Match when={current()?.error}>{(err) => <div class="px-6 py-4 text-text-weak">{err()}</div>}</Match>
      </Switch>
    </div>
  )
}
