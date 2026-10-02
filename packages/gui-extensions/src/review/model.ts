import type { FileDiffInfo } from "@opencode/client/promise"
import type { SessionReviewLineComment } from "@opencode/session-ui/session-review"
import { previewSelectedLines } from "@opencode/session-ui/pierre/selection-bridge"
import { checksum } from "@opencode/util/encode"
import { showToast } from "@opencode/ui/toast"
import { createQuery, useQueryClient } from "@tanstack/solid-query"
import { debounce } from "@solid-primitives/scheduled"
import { createComputed, createEffect, createMemo, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { Schema, Struct } from "effect"
import { Layout, Storage, type Context, type LineRange, type SessionView } from "../sdk"
import {
  filterRenderableDiff,
  reviewDiffDirectory,
  reviewDiffKinds,
  reviewDiffNeedsLoad,
  reviewRootDirectory,
} from "./kinds"

export type ChangeMode = "git" | "branch" | "turn"
type FileSelection = { startLine: number; endLine: number; startChar: number; endChar: number }

export type Demand = { tree: number; files: number; panel: number; details: number }

const SessionState = Schema.Struct({
  mode: Schema.optional(Schema.Literals(["git", "branch", "turn"])),
  file: Schema.optional(Schema.String),
  open: Schema.mutable(Schema.Array(Schema.String)),
}).mapFields(Struct.map(Schema.mutableKey))

const selectionFromLines = (range: LineRange): FileSelection => ({
  startLine: Math.min(range.start, range.end),
  endLine: Math.max(range.start, range.end),
  startChar: 0,
  endChar: 0,
})

/** The routed session's review: its diffs, selection, and comments. Lives as long as the session screen. */
export function createReviewModel(input: { ctx: Context; view: SessionView; demand: Demand }) {
  const ctx = input.ctx
  const view = input.view
  const layout = ctx.use(Layout)
  const storage = ctx.use(Storage)
  const queryClient = useQueryClient()
  const directory = () => view.file.root
  const [state, setState] = createStore({
    scroll: undefined as HTMLDivElement | undefined,
    pendingFile: undefined as string | undefined,
    deferRender: false,
    initializingGit: false,
    // The filter is transient by design: a persisted filter would silently hide
    // files after a reload.
    filter: "",
  })

  // Per-session review state. The session's storage needs its location, so it opens once that is known.
  const scope = createMemo(() => (view.location ? `${view.key}\n${view.location.directory}` : undefined))
  const saved = createMemo(
    on(scope, (key) =>
      key
        ? storage.store("session", {
            schema: SessionState,
            initial: { open: [] },
            scope: { session: view },
            from: {
              key: "layout",
              sessions: "sessionView",
              pick: (entry: { reviewMode?: unknown; reviewFile?: unknown; reviewOpen?: unknown } | undefined) =>
                entry && { mode: entry.reviewMode, file: entry.reviewFile, open: entry.reviewOpen },
            },
          })
        : undefined,
    ),
  )
  // Desktop loads the store asynchronously. Until it has, its defaults are not the session's choice: nothing shows
  // them, requests their diff, or writes over the stored state.
  const stored = () => {
    const value = saved()
    return value?.[2]() ? value[0] : undefined
  }
  const update = (mutation: (draft: (typeof SessionState)["Type"]) => void) => {
    const value = saved()
    if (value?.[2]()) value[1](mutation)
  }
  // Memos, so the store a session switch reopens does not recompute the diffs, kinds and tree rows it feeds.
  const mode = createMemo(() => stored()?.mode ?? "git")
  const selectedFile = createMemo(() => stored()?.file)

  // After a session switch the review renders a frame later, so the switch paints first.
  const generation = { value: 0, disposed: false }
  createComputed<string | undefined>((previous) => {
    const key = view.key
    if (key !== previous) {
      const captured = ++generation.value
      setState("deferRender", true)
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (generation.disposed || generation.value !== captured) return
          setState("deferRender", false)
        }, 0)
      })
    }
    return key
  })
  onCleanup(() => {
    generation.disposed = true
  })

  const vcs = createMemo(() => view.server.data.location.vcs.info({ directory: directory() }))
  const options = createMemo<ChangeMode[]>(() => {
    const list: ChangeMode[] = []
    const project = view.project
    if (project?.vcs) list.push("git")
    if (
      project?.vcs &&
      vcs()?.branch.current &&
      vcs()?.branch.default &&
      vcs()?.branch.current !== vcs()?.branch.default
    ) {
      list.push("branch")
    }
    // Turn snapshots are captured only for Git sessions.
    if (project?.vcs === "git" && view.id) list.push("turn")
    return list
  })
  const vcsKey = createMemo(
    () =>
      [
        ctx.id,
        view.server.id,
        "session-vcs",
        directory(),
        vcs()?.branch.current ?? "",
        vcs()?.branch.default ?? "",
      ] as const,
  )
  const wantsReview = createMemo(() => {
    const demand = input.demand
    return demand.tree + demand.files + demand.panel > 0
  })
  const turnKey = () => [ctx.id, view.server.id, "session-turn", view.id] as const
  const diffQuery = createQuery(() => {
    const value = mode()
    const turn = value === "turn"
    return {
      queryKey: turn ? turnKey() : ([...vcsKey(), value] as const),
      // Desktop storage loads asynchronously; until this session's mode is known, a request would use the default.
      enabled: !!stored() && view.server.connected && wantsReview() && !!view.project?.vcs,
      refetchOnMount: "always" as const,
      // A finished turn does not change on focus or filesystem events; refresh it when the session goes idle.
      refetchOnWindowFocus: !turn,
      queryFn: turn
        ? () => view.server.client.session.diff({ sessionID: view.id })
        : () =>
            view.server.client.vcs
              .diff({
                location: { directory: directory() },
                mode: value === "git" ? "working" : value,
              })
              .then((result) => result.data),
    }
  })
  // The summary's changes row: the session directory's working tree, loaded only while the summary shows.
  const detailsKey = () => [ctx.id, view.server.id, "session-details", view.directory] as const
  const detailsQuery = createQuery(() => ({
    queryKey: detailsKey(),
    enabled: input.demand.details > 0 && view.server.connected && !!view.project?.vcs,
    queryFn: () =>
      view.server.client.vcs
        .diff({ location: { directory: view.directory }, mode: "working" })
        .then((result) => result.data)
        .catch((error: unknown) => {
          console.debug("[session-review] failed to load session details diff", { error })
          return []
        }),
  }))
  const refresh = debounce(() => {
    void queryClient.invalidateQueries({ queryKey: vcsKey() })
    void queryClient.invalidateQueries({ queryKey: detailsKey() })
  }, 100)
  createEffect(() => {
    const target = directory()
    const stop = view.server.data.listen(({ details }) => {
      if (details.type === "filesystem.changed" && details.location?.directory === target) refresh()
    })
    onCleanup(stop)
  })
  // Opening the side region refreshes changes a tree already shows. Otherwise it loads them once, so the
  // pinned tab reads "Files Changed N": v2 opened the region on the review tab before selecting another.
  // A region restored open does not load them until something shows them.
  createEffect(
    on(
      () => !layout.narrow() && layout.side.opened(view),
      (open, previous) => {
        if (!open || previous || diffQuery.isFetching) return
        if (input.demand.tree > 0) {
          refresh()
          return
        }
        if (view.server.connected && view.project?.vcs) void diffQuery.refetch()
      },
      { defer: true },
    ),
  )
  const diffs = (): FileDiffInfo[] => (diffQuery.isFetched ? (diffQuery.data ?? []) : [])
  const renderable = createMemo(() => diffs().filter(filterRenderableDiff))
  const kinds = createMemo(() => reviewDiffKinds(renderable()))
  const activeFile = () => {
    const list = diffs()
    const selected = selectedFile()
    if (selected && list.some((diff) => diff.file === selected)) return selected
    return list[0]?.file
  }
  const count = () => diffs().length
  const hasChanges = () => count() > 0
  const ready = () => {
    // A project without VCS never enables diffQuery, so its status stays "pending" forever.
    const project = view.project
    if (project && !project.vcs) return true
    if (!stored()) return false
    return !diffQuery.isPending
  }
  const lifetime = { disposed: false }
  onCleanup(() => {
    lifetime.disposed = true
  })
  const initializeGit = () => {
    if (state.initializingGit) return
    const location = view.location
    if (!location || !view.server.connected) {
      showToast({ variant: "error", title: ctx.t("common.requestFailed") })
      return
    }
    const key = view.key
    const sessionID = view.id
    setState("initializingGit", true)
    void view.server.client.vcs
      .init({ location, provider: "git" })
      .then(async () => {
        if (lifetime.disposed || ctx.signal.aborted || view.key !== key) return
        const data = view.server.data
        data.project.invalidate()
        data.session.invalidate(sessionID)
        data.location.invalidate(location)
        data.location.vcs.invalidate(location)
        await data.project.sync()
        await data.session.sync(sessionID)
        await Promise.all([data.location.syncInfo(location), data.location.vcs.sync(location)])
      })
      .catch((error: unknown) => {
        if (lifetime.disposed || ctx.signal.aborted || view.key !== key) return
        showToast({
          variant: "error",
          title: ctx.t("common.requestFailed"),
          description: error instanceof Error ? error.message : undefined,
        })
      })
      .finally(() => {
        if (!lifetime.disposed && !ctx.signal.aborted && view.key === key) setState("initializingGit", false)
      })
  }
  const loadDiff = async (path: string, version?: number): Promise<FileDiffInfo | undefined> => {
    const source = diffs().find((diff) => diff.file === path)
    const valid = (diff: FileDiffInfo | undefined): FileDiffInfo | undefined => {
      if (!diff || !source) return undefined
      if (diff.additions !== source.additions || diff.deletions !== source.deletions) return undefined
      if (reviewDiffNeedsLoad(diff)) return undefined
      return diff
    }
    const value = mode()
    // Oversized full-file patches come back empty; bounded context usually fits.
    if (value === "turn") {
      return queryClient
        .fetchQuery({
          queryKey: [...turnKey(), "bounded", version] as const,
          staleTime: Number.POSITIVE_INFINITY,
          retry: 2,
          queryFn: () => view.server.client.session.diff({ sessionID: view.id, context: 3 }),
        })
        .then((result) => valid(result.find((diff) => diff.file === path)))
        .catch((error: unknown) => {
          console.debug("[session-review] failed to load bounded turn diff", { path, error })
          return undefined
        })
    }
    const root = reviewRootDirectory(view.project?.worktree ?? directory())
    const scoped = reviewDiffDirectory(root, path)
    const request = (scope: string, context?: number) =>
      queryClient
        .fetchQuery({
          queryKey: [ctx.id, ...vcsKey(), value, "directory", scope, context, version] as const,
          staleTime: Number.POSITIVE_INFINITY,
          retry: 2,
          queryFn: () =>
            view.server.client.vcs
              .diff({
                location: { directory: scope },
                mode: value === "git" ? "working" : value,
                context,
              })
              .then((result) => result.data),
        })
        .then((result) => result.find((diff) => diff.file === path))

    if (scoped !== root) {
      const result = await request(scoped).then(valid, (error: unknown) => {
        console.debug("[session-review] failed to load scoped vcs diff", {
          mode: value,
          path,
          directory: scoped,
          error,
        })
        return undefined
      })
      if (result) return result
    }
    return request(root, 3).then(valid, (error: unknown) => {
      console.debug("[session-review] failed to load bounded vcs diff", { mode: value, path, root, error })
      return undefined
    })
  }
  const selectionPreview = (path: string, selection: FileSelection): string | undefined => {
    const content = view.file.get(path)?.content?.content
    if (!content) return undefined
    return previewSelectedLines(content, { start: selection.startLine, end: selection.endLine })
  }
  const addComment = (comment: SessionReviewLineComment) => {
    const selection = selectionFromLines(comment.selection)
    const saved = view.comment.add({ file: comment.file, selection: comment.selection, comment: comment.comment })
    view.composer.attach({
      type: "file",
      path: comment.file,
      selection,
      comment: comment.comment,
      commentID: saved.id,
      commentOrigin: "review",
      preview: comment.preview ?? selectionPreview(comment.file, selection),
    })
  }
  const updateComment = (comment: {
    id: string
    file: string
    selection: LineRange
    comment: string
    preview?: string
  }) => {
    view.comment.update(comment.id, comment.comment)
    view.composer.update(comment.id, {
      comment: comment.comment,
      ...(comment.preview ? { preview: comment.preview } : {}),
    })
  }
  const removeComment = (comment: { id: string; file: string }) => {
    view.comment.remove(comment.id)
    view.composer.detach(comment.id)
  }
  const commentActions = createMemo(() => ({
    moreLabel: ctx.t("common.moreOptions"),
    editLabel: ctx.t("common.edit"),
    deleteLabel: ctx.t("common.delete"),
    saveLabel: ctx.t("common.save"),
  }))
  const open = () => {
    if (!layout.side.opened(view)) layout.side.toggle(view)
  }
  const openPath = (path: string) =>
    update((draft) => {
      if (draft.open.includes(path)) return
      draft.open = [...draft.open, path]
    })
  const reviewDiffId = (path: string): string | undefined => {
    const sum = checksum(path)
    if (!sum) return undefined
    return `session-review-diff-${sum}`
  }
  const reviewDiffTop = (path: string): number | undefined => {
    if (!state.scroll) return undefined
    const id = reviewDiffId(path)
    if (!id) return undefined
    const element = document.getElementById(id)
    if (!(element instanceof HTMLElement) || !state.scroll.contains(element)) return undefined
    const target = element.getBoundingClientRect()
    const root = state.scroll.getBoundingClientRect()
    return target.top - root.top + state.scroll.scrollTop
  }
  const scrollToFile = (path: string) => {
    if (!state.scroll) return false
    const top = reviewDiffTop(path)
    if (top === undefined) return false
    layout.scroll.set(view, "review", { x: state.scroll.scrollLeft, y: top })
    state.scroll.scrollTo({ top, behavior: "auto" })
    return true
  }
  const focusFile = (path: string) => {
    open()
    openPath(path)
    update((draft) => {
      draft.file = path
    })
    setState("pendingFile", path)
  }
  createEffect(() => {
    const pending = state.pendingFile
    if (!pending || !state.scroll || !ready()) return
    const attempt = (count: number) => {
      if (state.pendingFile !== pending) return
      if (count > 60) {
        setState("pendingFile", undefined)
        return
      }
      if (!state.scroll || !scrollToFile(pending)) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }
      const top = reviewDiffTop(pending)
      if (top === undefined || Math.abs(state.scroll.scrollTop - top) > 1) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }
      setState("pendingFile", undefined)
    }
    requestAnimationFrame(() => attempt(0))
  })
  createEffect(() => {
    if (!stored() || !view.server.connected || !view.project) return
    const list = options()
    const value = mode()
    if (list.includes(value)) return
    const next = list[0]
    if (!next) return
    update((draft) => {
      draft.mode = next
    })
  })
  createEffect(
    on(
      () => view.server.data.session.status(view.id),
      (next, previous) => {
        if (next !== "idle" || previous === undefined || previous === "idle") return
        refresh()
        void queryClient.invalidateQueries({ queryKey: turnKey() })
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => view.key,
      () => {
        setState("scroll", undefined)
        setState("pendingFile", undefined)
      },
      { defer: true },
    ),
  )

  const panelRendered = createMemo<boolean>((previous) => previous || !state.deferRender, false)
  return {
    view,
    activeFile,
    // The mode picker waits for the stored mode.
    canReview: () => !!view.project && !!stored(),
    comments: {
      actions: commentActions,
      add: addComment,
      all: () => [...view.comment.list()],
      focus: () => view.comment.focus.current(),
      mentions: (query: string) => view.file.search(query, { kind: "any" }),
      remove: removeComment,
      changeFocus: (focus: { file: string; id: string } | null) => {
        if (!focus) {
          const current = view.comment.focus.current()
          if (current && diffs().some((diff) => diff.file === current.file)) focusFile(current.file)
        }
        view.comment.focus.set(focus)
      },
      setFocus: (focus: { file: string; id: string } | null) => view.comment.focus.set(focus),
      update: updateComment,
    },
    count,
    deferRender: () => state.deferRender,
    details: (): FileDiffInfo[] | undefined => (detailsQuery.isFetched ? (detailsQuery.data ?? []) : undefined),
    diffVersion: () => diffQuery.dataUpdatedAt,
    diffs,
    renderable,
    kinds,
    focusFile,
    hasChanges,
    initializeGit,
    initializingGit: () => state.initializingGit,
    loadDiff,
    mode,
    noGit: createMemo(() => !!view.project && !view.project.vcs),
    filter: () => state.filter,
    setFilter: (value: string) => setState("filter", value),
    open: () => stored()?.open ?? [],
    setOpen: (next: string[]) =>
      update((draft) => {
        const unique = Array.from(new Set(next))
        if (unique.length === draft.open.length && unique.every((path, index) => path === draft.open[index])) return
        draft.open = unique
      }),
    options,
    panelRendered,
    ready,
    setMode: (value: ChangeMode) =>
      update((draft) => {
        draft.mode = value
      }),
    setScroll: (element: HTMLDivElement | undefined) => setState("scroll", element),
  }
}

export type ReviewModel = ReturnType<typeof createReviewModel>
