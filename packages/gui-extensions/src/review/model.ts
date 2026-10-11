import type { FileDiffInfo } from "@opencode/client/promise"
import type { SessionReviewLineComment } from "@opencode/session-ui/session-review"
import { previewSelectedLines } from "@opencode/session-ui/pierre/selection-bridge"
import { checksum } from "@opencode/util/encode"
import { showToast } from "@opencode/ui/toast"
import { createQuery, useQueryClient } from "@tanstack/solid-query"
import { debounce } from "@solid-primitives/scheduled"
import { createMemo, on, onCleanup, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import {
  createKeyed,
  createVisitState,
  type LineRange,
  type MountedSession,
  type SessionScreen,
  type SetupContext,
} from "../sdk"
import type Review from "./index"
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

const selectionFromLines = (range: LineRange): FileSelection => ({
  startLine: Math.min(range.start, range.end),
  endLine: Math.max(range.start, range.end),
  startChar: 0,
  endChar: 0,
})

/**
 * The routed session's review: its diffs, selection, and comments. Lives as long as the session screen; `view`
 * returns the screen's routed session, a new object on each switch.
 */
export function createReviewModel(input: {
  ctx: SetupContext<typeof Review>
  screen: SessionScreen
  view: Accessor<MountedSession>
  demand: Demand
}) {
  const ctx = input.ctx
  const screen = input.screen
  const view = input.view
  const layout = ctx.layout
  const queryClient = useQueryClient()
  const directory = () => screen.file.root

  // The filter is transient by design: a persisted filter would silently hide files after a reload.
  const [state, setState] = createStore<{ filter: string; initializingGit: Record<string, true | undefined> }>({
    filter: "",
    initializingGit: {},
  })

  // The review panel's scroller and the file it scrolls to belong to the session the view shows.
  const [scroll, setScroll] = createVisitState<HTMLDivElement | undefined>(undefined)
  const [pendingFile, setPendingFile] = createVisitState<string | undefined>(undefined)
  const [rendered, setRendered] = createVisitState(false)

  // The routed session's review state. Desktop loads it asynchronously; until it has, its defaults are not the
  // session's choice, so nothing shows them or requests their diff, and changes wait to apply over the stored state.
  const saved = createMemo(() => ctx.stores.session(view()))
  const stored = () => saved().value

  const update: ReturnType<typeof ctx.stores.session>["update"] = (mutation) => saved().update(mutation)

  // A memo, so the store a session switch reopens does not recompute the diffs, kinds and tree rows it feeds.
  const selectedFile = createMemo(() => stored()?.file)

  // After a session switch the review renders a frame later, so the switch paints first.
  createKeyed(
    () => view().visit,
    () => {
      const run = { ended: false }

      onCleanup(() => {
        run.ended = true
      })
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (!run.ended) setRendered(true)
        }, 0)
      })
    },
  )

  const vcs = createMemo(() => view().server.data.location.vcs.info({ directory: directory() }))

  const options = createMemo<ChangeMode[]>(() => {
    const list: ChangeMode[] = []
    const project = view().project

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
    if (project?.vcs === "git" && view().id) list.push("turn")

    return list
  })

  // The session's chosen mode while it is offered. One it no longer offers, such as Branch back on the default branch,
  // shows as the first mode offered; the stored choice stays, so it returns once its mode is offered again.
  const mode = createMemo<ChangeMode>(() => {
    const chosen = stored()?.mode ?? "git"

    // Until the server and the project answer, what the session offers is unknown.
    if (!view().server.connected || !view().project) return chosen

    const list = options()

    return list.includes(chosen) ? chosen : (list[0] ?? "git")
  })

  const vcsKey = createMemo(
    () =>
      [
        ctx.id,
        view().server.id,
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

  const turnKey = () => [ctx.id, view().server.id, "session-turn", view().id] as const

  const diffQuery = createQuery(() => {
    const value = mode()
    const turn = value === "turn"

    return {
      queryKey: turn ? turnKey() : ([...vcsKey(), value] as const),
      // Desktop storage loads asynchronously; until this session's mode is known, a request would use the default.
      enabled: !!stored() && view().server.connected && wantsReview() && !!view().project?.vcs,
      refetchOnMount: "always" as const,
      // A finished turn does not change on focus or filesystem events; refresh it when the session goes idle.
      refetchOnWindowFocus: !turn,
      queryFn: turn
        ? () => view().server.client.session.diff({ sessionID: view().id })
        : () =>
            view()
              .server.client.vcs.diff({
                location: { directory: directory() },
                mode: value === "git" ? "working" : value,
              })
              .then((result) => result.data),
    }
  })

  // The session details' changes row: the session directory's working tree, loaded only while the details show.
  const detailsKey = () => [ctx.id, view().server.id, "session-details", view().directory] as const

  const detailsQuery = createQuery(() => ({
    queryKey: detailsKey(),
    enabled: input.demand.details > 0 && view().server.connected && !!view().project?.vcs,
    queryFn: () =>
      view()
        .server.client.vcs.diff({ location: { directory: view().directory }, mode: "working" })
        .then((result) => result.data)
        .catch((error) => {
          console.debug("[session-review] failed to load session details diff", { error })

          return []
        }),
  }))

  const refresh = debounce(() => {
    void queryClient.invalidateQueries({ queryKey: vcsKey() })
    void queryClient.invalidateQueries({ queryKey: detailsKey() })
  }, 100)

  // The server reports file changes in the directory; its event stream follows a restarted server. Routing another
  // session of the same directory and server keeps the listener.
  createKeyed(
    () => ({ directory: directory(), data: view().server.data }),
    (current) =>
      onCleanup(
        current.data.listen(({ details }) => {
          if (details.type === "filesystem.changed" && details.location?.directory === current.directory) refresh()
        }),
      ),
    { equals: (previous, next) => previous.directory === next.directory && previous.data === next.data },
  )

  // Opening the side region refreshes changes a tree already shows. Otherwise it loads them once, so the
  // pinned tab reads "Files Changed N": v2 opened the region on the review tab before selecting another.
  // A region restored open does not load them until something shows them.
  const opened = createMemo(
    on(
      () => !layout.narrow() && layout.side.opened(view()),
      (open, previous) => (open && !previous ? {} : undefined),
      { defer: true },
    ),
  )

  createKeyed(opened, () => {
    if (diffQuery.isFetching) return

    if (input.demand.tree > 0) {
      refresh()

      return
    }

    if (view().server.connected && view().project?.vcs) void diffQuery.refetch()
  })

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
    const project = view().project

    if (project && !project.vcs) return true

    if (!stored()) return false

    return !diffQuery.isPending
  }

  const lifetime = { disposed: false }

  onCleanup(() => {
    lifetime.disposed = true
  })

  const alive = () => !lifetime.disposed && !ctx.signal.aborted

  // Initializes Git for the routed session. The request keeps that session's object, so its server and location stay
  // its own. Cache refresh follows the request's session; only error feedback depends on which session is routed.
  const initializeGit = () => {
    const session = view()

    if (state.initializingGit[session.key]) return
    const location = session.location

    if (!location || !session.server.connected) {
      showToast({ variant: "error", title: ctx.t("common.requestFailed") })

      return
    }

    const current = () => alive() && view().key === session.key

    setState("initializingGit", session.key, true)
    void session.server.client.vcs
      .init({ location, provider: "git" })
      .then(async () => {
        if (!alive()) return

        const data = session.server.data

        data.project.invalidate()
        data.session.invalidate(session.id)
        data.location.invalidate(location)
        data.location.vcs.invalidate(location)
        await data.project.sync()

        if (!alive()) return
        await data.session.sync(session.id)

        if (!alive()) return
        await Promise.all([data.location.syncInfo(location), data.location.vcs.sync(location)])
      })
      .catch((error) => {
        if (!current()) return

        showToast({
          variant: "error",
          title: ctx.t("common.requestFailed"),
          description: error instanceof Error ? error.message : undefined,
        })
      })
      .finally(() => {
        if (alive()) setState("initializingGit", session.key, undefined)
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
          queryFn: () => view().server.client.session.diff({ sessionID: view().id, context: 3 }),
        })
        .then((result) => valid(result.find((diff) => diff.file === path)))
        .catch((error) => {
          console.debug("[session-review] failed to load bounded turn diff", { path, error })

          return undefined
        })
    }

    const root = reviewRootDirectory(view().project?.worktree ?? directory())
    const scoped = reviewDiffDirectory(root, path)

    const request = (scope: string, context?: number) =>
      queryClient
        .fetchQuery({
          queryKey: [ctx.id, ...vcsKey(), value, "directory", scope, context, version] as const,
          staleTime: Number.POSITIVE_INFINITY,
          retry: 2,
          queryFn: () =>
            view()
              .server.client.vcs.diff({
                location: { directory: scope },
                mode: value === "git" ? "working" : value,
                context,
              })
              .then((result) => result.data),
        })
        .then((result) => result.find((diff) => diff.file === path))

    if (scoped !== root) {
      const result = await request(scoped).then(valid, (error) => {
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

    return request(root, 3).then(valid, (error) => {
      console.debug("[session-review] failed to load bounded vcs diff", { mode: value, path, root, error })

      return undefined
    })
  }

  const selectionPreview = (path: string, selection: FileSelection): string | undefined => {
    const content = screen.file.get(path)?.content?.content

    if (!content) return undefined

    return previewSelectedLines(content, { start: selection.startLine, end: selection.endLine })
  }

  const addComment = (comment: SessionReviewLineComment) => {
    const selection = selectionFromLines(comment.selection)
    const saved = screen.comment.add({ file: comment.file, selection: comment.selection, comment: comment.comment })

    screen.composer.attach({
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
    screen.comment.update(comment.id, comment.comment)
    // The composer keeps a chip's preview unless the update names a new one.
    screen.composer.update(
      comment.id,
      comment.preview ? { comment: comment.comment, preview: comment.preview } : { comment: comment.comment },
    )
  }

  const removeComment = (comment: { id: string; file: string }) => {
    screen.comment.remove(comment.id)
    screen.composer.detach(comment.id)
  }

  const commentActions = createMemo(() => ({
    moreLabel: ctx.t("common.moreOptions"),
    editLabel: ctx.t("common.edit"),
    deleteLabel: ctx.t("common.delete"),
    saveLabel: ctx.t("common.save"),
  }))

  const open = () => {
    if (!layout.side.opened(view())) layout.side.toggle(view())
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

  const reviewDiffTop = (element: HTMLDivElement, path: string): number | undefined => {
    const id = reviewDiffId(path)

    if (!id) return undefined

    const target = document.getElementById(id)

    if (!(target instanceof HTMLElement) || !element.contains(target)) return undefined

    return target.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop
  }

  const scrollToFile = (element: HTMLDivElement, path: string) => {
    const top = reviewDiffTop(element, path)

    if (top === undefined) return false

    layout.scroll.set(view(), "review", { x: element.scrollLeft, y: top })
    element.scrollTo({ top, behavior: "auto" })

    return true
  }

  const focusFile = (path: string) => {
    open()
    openPath(path)
    update((draft) => {
      draft.file = path
    })
    setPendingFile(path)
  }

  // Scrolls the review panel to a focused file once its diff has rendered.
  createKeyed(
    () => {
      const pending = pendingFile()

      if (!pending || !scroll() || !ready()) return

      return { pending }
    },
    (current) => {
      const attempt = (count: number) => {
        if (pendingFile() !== current.pending) return

        if (count > 60) {
          setPendingFile(undefined)

          return
        }

        const element = scroll()

        if (!element || !scrollToFile(element, current.pending)) {
          requestAnimationFrame(() => attempt(count + 1))

          return
        }

        const top = reviewDiffTop(element, current.pending)

        if (top === undefined || Math.abs(element.scrollTop - top) > 1) {
          requestAnimationFrame(() => attempt(count + 1))

          return
        }

        setPendingFile(undefined)
      }

      requestAnimationFrame(() => attempt(0))
    },
  )

  const idled = createMemo(
    on(
      () => view().server.data.session.status(view().id),
      (next, previous) => (next === "idle" && previous !== undefined && previous !== "idle" ? {} : undefined),
      { defer: true },
    ),
  )

  // A session that goes idle has finished its turn, which may have changed files.
  createKeyed(idled, () => {
    refresh()
    void queryClient.invalidateQueries({ queryKey: turnKey() })
  })

  const deferRender = () => !rendered()
  const panelRendered = createMemo<boolean>((previous) => previous || !deferRender(), false)

  return {
    screen,
    view,
    activeFile,
    // The mode picker waits for the stored mode.
    canReview: () => !!view().project && !!stored(),
    comments: {
      actions: commentActions,
      add: addComment,
      all: () => [...screen.comment.list()],
      focus: () => screen.comment.focus.current(),
      mentions: (query: string) => screen.file.search(query, { kind: "any" }),
      remove: removeComment,
      changeFocus: (focus: { file: string; id: string } | null) => {
        if (!focus) {
          const current = screen.comment.focus.current()

          if (current && diffs().some((diff) => diff.file === current.file)) focusFile(current.file)
        }

        screen.comment.focus.set(focus)
      },
      setFocus: (focus: { file: string; id: string } | null) => screen.comment.focus.set(focus),
      update: updateComment,
    },
    count,
    deferRender,
    details: (): FileDiffInfo[] | undefined => (detailsQuery.isFetched ? (detailsQuery.data ?? []) : undefined),
    diffVersion: () => diffQuery.dataUpdatedAt,
    diffs,
    renderable,
    kinds,
    focusFile,
    hasChanges,
    initializeGit,
    initializingGit: () => !!state.initializingGit[view().key],
    loadDiff,
    mode,
    noGit: createMemo(() => {
      const project = view().project

      return !!project && !project.vcs
    }),
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
    setScroll,
  }
}

export type ReviewModel = ReturnType<typeof createReviewModel>
