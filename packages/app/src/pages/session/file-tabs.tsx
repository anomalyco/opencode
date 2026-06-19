import { createEffect, createMemo, createSignal, Match, on, onCleanup, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { FileSearchHandle } from "@opencode-ai/session-ui/file"
import { useFileComponent } from "@opencode-ai/ui/context/file"
import { cloneSelectedLineRange, previewSelectedLines } from "@opencode-ai/session-ui/pierre/selection-bridge"
import { createLineCommentController } from "@opencode-ai/session-ui/line-comment-annotations"
import { sampledChecksum } from "@opencode-ai/core/util/encode"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { CodeEditor } from "@opencode-ai/ui/code-editor"
import { lspExtensions, type LspDiagnostic, type LspExtensionsOptions } from "@opencode-ai/ui/code-editor-lsp"
import { Tabs } from "@opencode-ai/ui/tabs"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@/utils/toast"
import { useSDK } from "@/context/sdk"
import {
  registerActiveEditor,
  clearActiveEditor,
  createFileSaver,
  setPendingEditOpen,
  takePendingEditOpen,
  type PendingEditPos,
} from "@/pages/session/file-save"
import { confirmChoice } from "@/pages/session/file-confirm-dialog"
import { selectionFromLines, useFile, type FileSelection, type SelectedLineRange } from "@/context/file"
import { useComments } from "@/context/comments"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { getSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createSessionTabs } from "@/pages/session/helpers"

function FileCommentMenu(props: {
  moreLabel: string
  editLabel: string
  deleteLabel: string
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
          aria-label={props.moreLabel}
        />
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <DropdownMenu.Item onSelect={props.onEdit}>
              <DropdownMenu.ItemLabel>{props.editLabel}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={props.onDelete}>
              <DropdownMenu.ItemLabel>{props.deleteLabel}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  )
}

type ScrollPos = { x: number; y: number }

function createScrollSync(input: { tab: () => string; view: ReturnType<typeof useSessionLayout>["view"] }) {
  let scroll: HTMLDivElement | undefined
  let scrollFrame: number | undefined
  let restoreFrame: number | undefined
  let pending: ScrollPos | undefined
  const [code, setCode] = createSignal<HTMLElement[]>([])

  const getCode = () => {
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

  const save = (next: ScrollPos) => {
    pending = next
    if (scrollFrame !== undefined) return

    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = undefined

      const out = pending
      pending = undefined
      if (!out) return

      input.view().setScroll(input.tab(), out)
    })
  }

  const onCodeScroll = (event: Event) => {
    const el = scroll
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
    const el = scroll
    if (!el) return

    const pos = input.view().scroll(input.tab())
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
    if (restoreFrame !== undefined) return

    restoreFrame = requestAnimationFrame(() => {
      restoreFrame = undefined
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

  createEffect(() => {
    for (const item of code()) makeEventListener(item, "scroll", onCodeScroll)
  })

  const setViewport = (el: HTMLDivElement) => {
    scroll = el
    restore()
  }

  onCleanup(() => {
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame)
    if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame)
  })

  return {
    handleScroll,
    queueRestore,
    setViewport,
  }
}

export function FileTabContent(props: { tab: string }) {
  const file = useFile()
  const comments = useComments()
  const language = useLanguage()
  const prompt = usePrompt()
  const fileComponent = useFileComponent()
  const sdk = useSDK()
  const dialog = useDialog()
  const { sessionKey, tabs, view } = useSessionLayout()
  const activeFileTab = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab: (tab) => (tab.startsWith("file://") ? file.tab(tab) : tab),
  }).activeFileTab

  let find: FileSearchHandle | null = null

  const search = {
    register: (handle: FileSearchHandle | null) => {
      find = handle
    },
  }

  const path = createMemo(() => file.pathFromTab(props.tab))
  const state = createMemo(() => {
    const p = path()
    if (!p) return
    return file.get(p)
  })
  const contents = createMemo(() => state()?.content?.content ?? "")
  const cacheKey = createMemo(() => sampledChecksum(contents()))

  const [editMode, setEditMode] = createSignal(false)
  const [editorValue, setEditorValue] = createSignal("")

  const isDirty = () => tabs().dirty(props.tab)
  const setDirty = (value: boolean) => tabs().setDirty(props.tab, value)

  const writeFile = async (content: string, expectedSha?: string) => {
    const res = await sdk().client.file.write({
      path: path() ?? "",
      content,
      ...(expectedSha ? { expectedSha } : {}),
    })
    if (res.error) throw res.error
    return (res.data ?? {}) as { conflict?: boolean; sha?: string; written?: boolean }
  }

  const saver = createFileSaver({
    editing: editMode,
    currentText: () => editorValue(),
    isDirty,
    setDirty,
    write: writeFile,
    reloadFromDisk: async () => {
      const p = path()
      if (p) await file.load(p, { force: true })
      seedFromDisk()
    },
    leaveEditMode: () => setEditMode(false),
    promptConflict: async () =>
      (await confirmChoice(dialog, {
        title: language.t("file.conflict.title"),
        description: language.t("file.conflict.description"),
        choices: [
          { value: "reload", label: language.t("common.reload") },
          { value: "overwrite", label: language.t("common.overwrite"), variant: "primary" },
        ],
      })) as "reload" | "overwrite" | undefined,
    promptUnsaved: async () =>
      (await confirmChoice(dialog, {
        title: language.t("file.unsaved.title"),
        description: language.t("file.unsaved.description"),
        choices: [
          { value: "cancel", label: language.t("common.cancel"), variant: "ghost" },
          { value: "discard", label: language.t("common.discard") },
          { value: "save", label: language.t("common.save"), variant: "primary" },
        ],
      })) as "save" | "discard" | "cancel" | undefined,
    onSaved: () => {
      const p = path()
      if (p) void file.load(p, { force: true })
      showToast({ variant: "success", title: language.t("toast.file.saved.title") })
    },
    onError: () => showToast({ variant: "error", title: language.t("toast.file.saveFailed.title") }),
  })

  const save = () => saver.save()
  const guardLeave = () => saver.guard()

  const seedFromDisk = () => {
    const text = contents()
    setEditorValue(text)
    saver.setBaseline(text, undefined)
    setDirty(false)
  }

  const enterEditMode = () => {
    if (editMode()) return
    seedFromDisk()
    setEditMode(true)
  }

  const onEditorChange = (next: string) => {
    setEditorValue(next)
    saver.onChange(next)
  }

  const [pendingSelection, setPendingSelection] = createSignal<PendingEditPos | undefined>(undefined)

  createEffect(() => {
    const p = path()
    if (!p) return
    if (!state()?.loaded) return
    const pos = takePendingEditOpen(file.normalize(p))
    if (!pos) return
    seedFromDisk()
    setEditMode(true)
    setPendingSelection(pos)
    queueMicrotask(() => setPendingSelection(undefined))
  })

  // Per-tab monotonic buffer version; a successful save keeps the buffer open at the same version (no bump, no re-open).
  let bufferVersion = 0
  const diagnosticsSubs = new Set<(list: LspDiagnostic[]) => void>()

  const samePath = (a: string, b: string) => file.normalize(a) === file.normalize(b)

  createEffect(() => {
    const p = path()
    if (!p) return
    const unsub = sdk().event.on("lsp.diagnostics", (e) => {
      const props = e.properties
      if (!samePath(props.path, p)) return
      const list = (props.diagnostics ?? []) as LspDiagnostic[]
      for (const cb of diagnosticsSubs) cb(list)
    })
    onCleanup(unsub)
  })

  const buildLspOptions = (p: string): LspExtensionsOptions => {
    const client = () => sdk().client.lsp
    return {
      path: p,
      bumpVersion: () => ++bufferVersion,
      lsp: {
        buffer: (input) => client().buffer(input).then((r) => r.data),
        bufferClose: (input) => client().bufferClose(input).then((r) => r.data),
        completion: (input) => client().completion(input).then((r) => r.data),
        hover: (input) => client().hover(input).then((r) => r.data),
        definition: (input) => client().definition(input).then((r) => r.data),
        diagnostics: (input) => client().diagnostics(input).then((r) => r.data),
      },
      onOpenLocation: (target, pos) => {
        // Definitions outside the workspace arrive as absolute paths the file API can't read; surface a notice instead of a broken tab.
        if (target.startsWith("/") || target.startsWith("file://")) {
          showToast({ variant: "default", title: language.t("toast.file.definitionExternal.title") })
          return
        }
        const normalized = file.normalize(target)
        if (!normalized) return
        setPendingEditOpen(normalized, pos)
        void (async () => {
          await tabs().open(file.tab(normalized))
          await file.load(normalized)
        })()
      },
      subscribeDiagnostics: (_path, cb) => {
        diagnosticsSubs.add(cb)
        return () => diagnosticsSubs.delete(cb)
      },
    }
  }

  const editorExtensions = createMemo(() => {
    const p = path()
    if (!p) return []
    return lspExtensions(buildLspOptions(p))
  })

  const toggleEditMode = async () => {
    if (!editMode()) {
      enterEditMode()
      return
    }
    if (!(await guardLeave())) return
    setEditMode(false)
  }

  createEffect(() => {
    if (activeFileTab() !== props.tab) return
    registerActiveEditor({
      tab: props.tab,
      editing: editMode,
      dirty: isDirty,
      save,
      guard: guardLeave,
    })
  })
  onCleanup(() => clearActiveEditor(props.tab))

  createEffect(
    on(
      contents,
      (next, prev) => {
        if (prev === undefined) return
        if (next === prev) return
        if (!editMode() || !isDirty()) return
        showToast({ variant: "default", title: language.t("toast.file.changedExternally.title") })
      },
      { defer: true },
    ),
  )
  const selectedLines = createMemo<SelectedLineRange | null>(() => {
    const p = path()
    if (!p) return null
    if (file.ready()) return (file.selectedLines(p) as SelectedLineRange | undefined) ?? null
    return (getSessionHandoff(sessionKey())?.files[p] as SelectedLineRange | undefined) ?? null
  })
  const scrollSync = createScrollSync({
    tab: () => props.tab,
    view,
  })

  const selectionPreview = (source: string, selection: FileSelection) => {
    return previewSelectedLines(source, {
      start: selection.startLine,
      end: selection.endLine,
    })
  }

  const buildPreview = (filePath: string, selection: FileSelection) => {
    const source = filePath === path() ? contents() : file.get(filePath)?.content?.content
    if (!source) return undefined
    return selectionPreview(source, selection)
  }

  const addCommentToContext = (input: {
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
    origin?: "review" | "file"
  }) => {
    const selection = selectionFromLines(input.selection)
    const preview = input.preview ?? buildPreview(input.file, selection)

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

  const updateCommentInContext = (input: {
    id: string
    file: string
    selection: SelectedLineRange
    comment: string
  }) => {
    comments.update(input.file, input.id, input.comment)
    const preview = input.file === path() ? buildPreview(input.file, selectionFromLines(input.selection)) : undefined
    prompt.context.updateComment(input.file, input.id, {
      comment: input.comment,
      ...(preview ? { preview } : {}),
    })
  }

  const removeCommentFromContext = (input: { id: string; file: string }) => {
    comments.remove(input.file, input.id)
    prompt.context.removeComment(input.file, input.id)
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
    mention: {
      items: file.searchFilesAndDirectories,
    },
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
    editSubmitLabel: language.t("common.save"),
    renderCommentActions: (_, controls) => (
      <FileCommentMenu
        moreLabel={language.t("common.moreOptions")}
        editLabel={language.t("common.edit")}
        deleteLabel={language.t("common.delete")}
        onEdit={controls.edit}
        onDelete={controls.remove}
      />
    ),
  })

  createEffect(() => {
    if (typeof window === "undefined") return

    const onKeyDown = (event: KeyboardEvent) => {
      if (activeFileTab() !== props.tab) return
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== "f") return

      event.preventDefault()
      event.stopPropagation()
      find?.focus()
    }

    makeEventListener(window, "keydown", onKeyDown, { capture: true })
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
    if (activeFileTab() !== props.tab) return

    const target = fileComments().find((comment) => comment.id === focus.id)
    if (!target) return

    commentsUi.note.openComment(target.id, target.selection, { cancelDraft: true })
    requestAnimationFrame(() => comments.clearFocus())
  })

  let prev = {
    loaded: false,
    ready: false,
    active: false,
  }

  createEffect(() => {
    const loaded = !!state()?.loaded
    const ready = file.ready()
    const active = activeFileTab() === props.tab
    const restore = (loaded && !prev.loaded) || (ready && !prev.ready) || (active && loaded && !prev.active)
    prev = { loaded, ready, active }
    if (!restore) return
    scrollSync.queueRestore()
  })

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
        onLineSelected={(range: SelectedLineRange | null) => {
          commentsUi.onLineSelected(range)
        }}
        onLineSelectionEnd={(range: SelectedLineRange | null) => {
          commentsUi.onLineSelectionEnd(range)
        }}
        search={search}
        class="select-text"
        media={{
          mode: "auto",
          path: path(),
          current: state()?.content,
          onLoad: scrollSync.queueRestore,
          onError: (args: { kind: "image" | "audio" | "svg" }) => {
            if (args.kind !== "svg") return
            showToast({
              variant: "error",
              title: language.t("toast.file.loadFailed.title"),
            })
          },
        }}
      />
    </div>
  )

  const EditViewToggle = () => (
    <div class="absolute right-3 top-2 z-10 flex items-center gap-x-0.5 rounded-md border border-border-weak bg-surface-base p-0.5">
      <IconButton
        icon="open-file"
        variant={editMode() ? "ghost" : "secondary"}
        size="small"
        class="h-6 px-2 rounded"
        aria-label={language.t("file.edit.toggle.view")}
        aria-pressed={!editMode()}
        onClick={() => void toggleEditMode()}
      />
      <IconButton
        icon="pencil-line"
        variant={editMode() ? "secondary" : "ghost"}
        size="small"
        class="h-6 px-2 rounded"
        aria-label={language.t("file.edit.toggle.edit")}
        aria-pressed={editMode()}
        onClick={() => void toggleEditMode()}
      />
    </div>
  )

  return (
    <Tabs.Content value={props.tab} class="mt-3 relative h-full">
      <Show when={state()?.loaded}>
        <EditViewToggle />
      </Show>
      <Switch>
        <Match when={state()?.loaded && editMode()}>
          <div class="h-full">
            <CodeEditor
              value={editorValue()}
              path={path()}
              onChange={onEditorChange}
              onSaveRequested={() => void save()}
              extensions={editorExtensions()}
              initialSelection={pendingSelection()}
              class="h-full"
            />
          </div>
        </Match>
        <Match when={state()?.loaded}>
          <ScrollView class="h-full" viewportRef={scrollSync.setViewport} onScroll={scrollSync.handleScroll as any}>
            {renderFile(contents())}
          </ScrollView>
        </Match>
        <Match when={state()?.loading}>
          <div class="px-6 py-4 text-text-weak">{language.t("common.loading")}...</div>
        </Match>
        <Match when={state()?.error}>{(err) => <div class="px-6 py-4 text-text-weak">{err()}</div>}</Match>
      </Switch>
    </Tabs.Content>
  )
}
