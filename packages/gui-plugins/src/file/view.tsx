import { createMemo, createSignal, Match, on, onCleanup, Show, Switch, untrack } from "solid-js"
import { Dynamic } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { FileSearchHandle } from "@opencode/session-ui/file"
import { useFileComponent } from "@opencode/ui/context/file"
import { previewSelectedLines } from "@opencode/session-ui/pierre/selection-bridge"
import { createLineCommentControllerV2 } from "@opencode/session-ui/v2/line-comment-annotations-v2"
import { sampledChecksum } from "@opencode/util/encode"
import { LineCommentOverflowIcon } from "@opencode/ui/line-comment"
import { Menu } from "@opencode/ui/menu"
import { createKeyed, usePlugin, type LineRange, type MountedSession, type SessionScreen } from "@opencode/plugin/gui"
import { artifactKind } from "@opencode/util/artifact"
import ArtifactView from "./artifact-view"
import { useShared } from "./context"
import { fileTabPath } from "./path"
import {
  FILE_SCROLL_INTERACTED,
  FILE_SCROLL_RESTORE_REQUESTED,
  FILE_SCROLL_REVEAL_REQUESTED,
  canRestoreFileScroll,
  canSaveFileScroll,
  createFileScrollState,
  sameFileScrollContext,
  transitionFileScroll,
  type FileScrollContext,
  type FileScrollEffect,
  type FileScrollEvent,
  type FileScrollPos,
} from "./scroll-machine"

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

/** The code view's scroll element and the animation frame that restores or stores its scroll. */
type ScrollTarget = { element?: HTMLDivElement; frame?: number }

type FindState = { find: FileSearchHandle | null }

/** The session the view shows and the one it showed before a switch, whose unsaved scroll a switch still stores. */
type ShownSessions = { current: MountedSession; previous?: MountedSession }

function createScrollSync(input: {
  context: () => Omit<FileScrollContext, "scroller">
  get: () => FileScrollPos | undefined
  write: (sessionKey: string, scrollKey: string, position: FileScrollPos) => void
}) {
  const scroller: ScrollTarget = {}
  const [hasScroller, setHasScroller] = createSignal(false)
  const [code, setCode] = createSignal<HTMLElement[]>([])
  const [scrollState, setScrollState] = createSignal(createFileScrollState())

  const dispatch = (event: FileScrollEvent) => {
    const next = transitionFileScroll(untrack(scrollState), event)

    setScrollState(next.state)
    next.effects.forEach(run)
  }

  const run = (effect: FileScrollEffect) => {
    if (effect.type === "save.write") return input.write(effect.sessionKey, effect.scrollKey, effect.position)

    if (scroller.frame !== undefined) cancelAnimationFrame(scroller.frame)
    scroller.frame = undefined

    if (effect.type === "frame.cancel") return
    const attempt = effect.attempt

    if (effect.type === "frame.save") {
      scroller.frame = requestAnimationFrame(() => {
        scroller.frame = undefined
        dispatch({ type: "save.stepped", attempt })
      })

      return
    }

    scroller.frame = requestAnimationFrame(() => {
      scroller.frame = undefined

      if (canRestoreFileScroll(untrack(scrollState), attempt)) restore()
      dispatch({ type: "restore.stepped", attempt })
    })
  }

  const interacted = () => dispatch(FILE_SCROLL_INTERACTED)

  const getCode = () => {
    const el = scroller.element

    if (!el) return []

    const host = el.querySelector("diffs-container")

    if (!(host instanceof HTMLElement)) return []

    const root = host.shadowRoot

    if (!root) return []

    return Array.from(root.querySelectorAll("[data-code]")).filter(
      (node): node is HTMLElement => node instanceof HTMLElement && node.clientWidth > 0,
    )
  }

  const onCodeScroll = (event: Event) => {
    const el = scroller.element

    if (!el || !canSaveFileScroll(untrack(scrollState))) return

    const target = event.currentTarget

    if (!(target instanceof HTMLElement)) return

    dispatch({ type: "scrolled", position: { x: target.scrollLeft, y: el.scrollTop } })
  }

  const sync = () => {
    const next = getCode()
    const current = code()

    if (next.length === current.length && next.every((el, i) => el === current[i])) return
    setCode(next)
  }

  const restore = () => {
    const el = scroller.element

    if (!el || el.clientHeight === 0 || el.clientWidth === 0) return

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

  // Scroll events a restore or a layout clamp fires arrive while restoring and are not the user's to store.
  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    if (!canSaveFileScroll(untrack(scrollState))) return

    if (code().length === 0) sync()

    dispatch({
      type: "scrolled",
      position: { x: code()[0]?.scrollLeft ?? event.currentTarget.scrollLeft, y: event.currentTarget.scrollTop },
    })
  }

  // The diff's code columns scroll on their own; listen to the ones on screen.
  createKeyed(code, (items) => items.forEach((item) => makeEventListener(item, "scroll", onCodeScroll)))

  createKeyed(
    () => ({ ...input.context(), scroller: hasScroller() }),
    (context) => dispatch({ type: "context.synced", context }),
    { equals: sameFileScrollContext },
  )

  // The ref runs before the file renders into the element; the machine restores a frame after the mount. The code view
  // unmounts while an artifact shows its preview, and restores again when its source shows.
  const setViewport = (el: HTMLDivElement) => {
    scroller.element = el
    // Input, not the scroll events a restore or a layout change fires, hands the view to the user.
    makeEventListener(el, "wheel", interacted, { passive: true, capture: true })
    makeEventListener(el, "mousewheel", interacted, { passive: true, capture: true })
    makeEventListener(el, "pointerdown", interacted, { passive: true, capture: true })
    makeEventListener(el, "touchstart", interacted, { passive: true, capture: true })
    makeEventListener(el, "keydown", interacted, { capture: true })
    setHasScroller(true)
    onCleanup(() => {
      if (scroller.element !== el) return
      scroller.element = undefined
      setCode([])
      setHasScroller(false)
    })
  }

  onCleanup(() => dispatch({ type: "disposed" }))

  return {
    handleScroll,
    interacted,
    requestRestore: () => dispatch(FILE_SCROLL_RESTORE_REQUESTED),
    reveal: () => dispatch(FILE_SCROLL_REVEAL_REQUESTED),
    setViewport,
  }
}

export function SessionFileView(props: { session: MountedSession; screen: SessionScreen; id: string }) {
  const ctx = usePlugin()
  const layout = ctx.layout
  const shared = useShared()
  const fileComponent = useFileComponent()
  const file = props.screen.file
  const comment = props.screen.comment
  const composer = props.screen.composer
  // The stored side tab key doubles as the scroll key, as it did before plugins.
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

  // The sessions the view showed last, so a session switch still stores the offset the user left the previous one at.
  const shown: ShownSessions = { current: props.session }

  const scrollSync = createScrollSync({
    context: () => {
      if (props.session.key !== shown.current.key) shown.previous = shown.current
      shown.current = props.session

      return {
        sessionKey: props.session.key,
        scrollKey: key(),
        loaded: Boolean(current()?.loaded),
        fileReady: file.ready(),
        layoutReady: layout.ready() && props.session.location !== undefined,
        shown: active(),
      }
    },
    get: () => layout.scroll.get(props.session, key()),
    write: (sessionKey, scrollKey, position) => {
      const session = [props.session, shown.previous].find((item) => item?.key === sessionKey)

      if (session) layout.scroll.set(session, scrollKey, position)
    },
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

  const commentsUi = createLineCommentControllerV2({
    comments: fileComments,
    label: ctx.t("ui.lineComment.submit"),
    draftKey: () => path() ?? props.id,
    mention: {
      items: (query) => file.search(query, { kind: "any" }),
    },
    getSide: selectionSide,
    onSyncSelected: (range) => {
      const p = path()

      if (!p) return
      file.selection.set(p, range)
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
      // Find scrolls to its matches; the stored scroll must not pull the view back.
      scrollSync.interacted()
      state.find?.focus()
    },
    { capture: true },
  )

  // A new path, e.g. after the workspace directory changes, drops the comment draft and selection of the old one.
  const moved = createMemo(on(path, () => ({}), { defer: true }))

  createKeyed(moved, () => commentsUi.reset())

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
      commentsUi.focusComment(focus.target.id, focus.target.selection)
      requestAnimationFrame(() => comment.focus.set(null))
    },
  )

  createKeyed(
    () => {
      const p = path()

      return p ? { session: props.session.key, path: p } : undefined
    },
    (target) =>
      onCleanup(
        shared.reveal.register(target.session, target.path, () => {
          commentsUi.clearPassive()
          scrollSync.reveal()
        }),
      ),
    { equals: (previous, next) => previous?.session === next?.session && previous?.path === next?.path },
  )

  const renderFile = () => (
    <div class="relative overflow-hidden pb-40">
      <Dynamic
        component={fileComponent}
        mode="text"
        file={{
          name: path() ?? "",
          contents: contents(),
          cacheKey: cacheKey(),
        }}
        enableLineSelection
        enableGutterUtility
        selectedLines={commentsUi.selected() ?? selectedLines()}
        commentedLines={commentedLines()}
        onRendered={scrollSync.requestRestore}
        annotations={commentsUi.annotations()}
        renderAnnotation={commentsUi.renderAnnotation}
        renderGutterUtility={commentsUi.renderGutterUtility}
        onLineSelected={(range: LineRange | null) => {
          commentsUi.onLineSelected(range)
        }}
        onLineSelectionEnd={(range: LineRange | null) => {
          commentsUi.onLineSelectionEnd(range)
        }}
        search={search}
        class="select-text"
        // Media and previews have their own viewers below; the code view only ever shows text.
        media={{ mode: "off" }}
      />
    </div>
  )

  // The code view scrolls in its own container so line state and scroll position persist per tab.
  // It reads the text itself: `Show` tracks its fallback, so passing the content in would rebuild the view, scrolled to
  // the top, each time a reread stores a new content object.
  const codeView = () => (
    <div
      data-scrollable
      class="min-h-0 flex-1 overflow-y-auto"
      ref={scrollSync.setViewport}
      onScroll={scrollSync.handleScroll}
    >
      {renderFile()}
    </div>
  )

  return (
    <div class="relative h-full min-h-0 flex flex-col" classList={{ "mt-3": !artifact() }}>
      <Switch>
        <Match when={current()?.loaded ? current()?.content : undefined}>
          {(value) => (
            <Show when={artifact()} fallback={codeView()}>
              <ArtifactView
                session={props.session}
                screen={props.screen}
                path={path() ?? ""}
                content={value()}
                cacheKey={cacheKey()}
                source={codeView()}
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
