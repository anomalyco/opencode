import type { FileDiffInfo } from "@opencode/client/promise"
import type { SessionReviewLineComment } from "@opencode/session-ui/session-review"
import { previewSelectedLines } from "@opencode/session-ui/pierre/selection-bridge"
import { artifactMime } from "@opencode/util/artifact"
import { bytesToBase64 } from "@opencode/util/base64"
import { checksum } from "@opencode/util/encode"
import { focusManager, useQueryClient } from "@tanstack/solid-query"
import { debounce } from "@solid-primitives/scheduled"
import { createMemo, createSignal, on, onCleanup, untrack, type Accessor } from "solid-js"
import {
  createKeyed,
  type LineRange,
  type MountedSession,
  type SessionScreen,
  type SetupContext,
} from "@opencode/plugin/gui"
import type Review from "./index"
import {
  filterRenderableDiff,
  isReviewFolder,
  normalizePath,
  reviewDiffDirectory,
  reviewDiffKinds,
  reviewDiffNeedsLoad,
  reviewFolderDirectory,
  reviewRootDirectory,
} from "./kinds"
import {
  INITIAL_REVIEW_FOLDER_STATE,
  reviewExpandedDiffs,
  reviewFolderCandidates,
  reviewFolderLabels,
  sameReviewFolderSource,
  transitionReviewFolders,
  type ReviewFolderEffect,
  type ReviewFolderEvent,
  type ReviewFolderSource,
  type ReviewFolderState,
} from "./folder-machine"
import {
  createReviewInitGitState,
  isInitializingGit,
  transitionReviewInitGit,
  type ReviewInitGitEffect,
  type ReviewInitGitEvent,
} from "./init-git-machine"
import {
  INITIAL_REVIEW_RENDER_STATE,
  reviewMobileReady,
  reviewPanelReady,
  transitionReviewRender,
  type ReviewRenderEvent,
  type ReviewRenderState,
} from "./render-machine"
import {
  INITIAL_REVIEW_SCROLL_STATE,
  REVIEW_SCROLL_INTERACTED,
  REVIEW_SCROLL_RESTORE_REQUESTED,
  canRestoreReviewScroll,
  canSaveReviewScroll,
  sameReviewScrollContext,
  transitionReviewScroll,
  type ReviewScrollEvent,
  type ReviewScrollState,
} from "./scroll-machine"
import {
  INITIAL_REVIEW_DIFF_STATE,
  REVIEW_DIFF_TIMEOUT_MS,
  reviewDiffReady,
  reviewDiffView,
  sameReviewDiffTarget,
  transitionReviewDiff,
  type ReviewDiffContext,
  type ReviewDiffEffect,
  type ReviewDiffEvent,
  type ReviewDiffRows,
  type ReviewDiffState,
  type ReviewDiffTarget,
  type ReviewDiffView,
} from "./machine"
import type { ReviewDetailStage, ReviewDetailTarget } from "./detail-machine"

export type ChangeMode = "git" | "branch" | "turn"

type FileSelection = { startLine: number; endLine: number; startChar: number; endChar: number }

export type Demand = { tree: number; files: number; panel: number; details: number }

/** The narrow review's list and the animation frame that restores its scroll or scrolls it to a focused file. */
type ScrollTarget = { element?: HTMLDivElement; frame?: number }

/** The frame, then task, that a session switch waits for before the review renders. */
type RenderGate = { frame?: number; timer?: ReturnType<typeof setTimeout> }

/** The diff request the driver runs: its abort controller and its timeout. */
type DiffRequest = { controller?: AbortController; timer?: ReturnType<typeof setTimeout> }

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
  const [filter, setFilter] = createSignal("")

  // The machines keep numbers, not the visit objects that tell routing visits apart.
  const visits = { ids: new WeakMap<MountedSession["visit"], number>(), last: 0 }

  const visitID = (visit: MountedSession["visit"]) => {
    const existing = visits.ids.get(visit)

    if (existing !== undefined) return existing
    visits.last += 1
    visits.ids.set(visit, visits.last)

    return visits.last
  }

  const [renderState, setRenderState] = createSignal<ReviewRenderState>(INITIAL_REVIEW_RENDER_STATE)
  const renderGate: RenderGate = {}

  const dispatchRender = (event: ReviewRenderEvent) => {
    const next = transitionReviewRender(untrack(renderState), event)

    setRenderState(next.state)
    next.effects.forEach((effect) => {
      if (renderGate.frame !== undefined) cancelAnimationFrame(renderGate.frame)
      clearTimeout(renderGate.timer)
      renderGate.frame = undefined
      renderGate.timer = undefined

      if (effect.type === "frame.cancel") return

      renderGate.frame = requestAnimationFrame(() => {
        renderGate.frame = undefined
        renderGate.timer = setTimeout(() => {
          renderGate.timer = undefined
          dispatchRender({ type: "frame.settled", attempt: effect.attempt })
        }, 0)
      })
    })
  }

  // After a session switch the review renders a frame later, so the switch paints first. The gate follows the model's
  // own routed session, which a panel can hold before the route publishes it, and keeps it while no session routes.
  createKeyed(
    () => visitID(view().visit),
    (id) => dispatchRender({ type: "visit.synced", visitID: id }),
  )
  onCleanup(() => dispatchRender({ type: "disposed" }))

  // The routed session's review state. Desktop loads it asynchronously; until it has, its defaults are not the
  // session's choice, so nothing shows them or requests their diff, and changes wait to apply over the stored state.
  const saved = createMemo(() => ctx.stores.session(view()))
  const stored = () => saved().value

  const update: ReturnType<typeof ctx.stores.session>["update"] = (mutation) => saved().update(mutation)

  // A memo, so the store a session switch reopens does not recompute the diffs, kinds and tree rows it feeds.
  const selectedFile = createMemo(() => stored()?.file)

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

  const wantsReview = createMemo(() => {
    const demand = input.demand

    return demand.tree + demand.files + demand.panel > 0
  })

  const turnKey = () => [ctx.id, view().server.id, "session-turn", view().id] as const

  const diffContext = createMemo(
    (): ReviewDiffContext => {
      const project = view().project

      if (project && !project.vcs) return { kind: "no-vcs" }

      // Desktop storage loads asynchronously; until this session's mode is known, a request would use the default.
      if (!stored()) return { kind: "waiting" }
      const connected = view().server.connected

      if (!project) return connected ? { kind: "waiting" } : { kind: "offline" }
      const value = mode()
      const serverID = view().server.id

      const target: ReviewDiffTarget =
        value === "turn"
          ? { kind: "turn", serverID, sessionID: view().id }
          : {
              kind: "vcs",
              serverID,
              directory: directory(),
              mode: value,
              branch: vcs()?.branch.current ?? "",
              defaultBranch: vcs()?.branch.default ?? "",
            }

      return { kind: "ready", target, connected, demanded: wantsReview() }
    },
    undefined,
    { equals: sameDiffContext },
  )

  // One diff machine and its driver. The diffs a target last loaded stay in the query cache under `key`, so returning
  // to a mode or directory shows them at once.
  const createDiffSlice = (input: {
    key: (target: ReviewDiffTarget) => readonly unknown[]
    request: (target: ReviewDiffTarget, signal: AbortSignal) => Promise<readonly FileDiffInfo[]>
  }) => {
    const [state, setState] = createSignal<ReviewDiffState>(INITIAL_REVIEW_DIFF_STATE)
    const request: DiffRequest = {}

    const dispatch = (event: ReviewDiffEvent) => {
      const next = transitionReviewDiff(untrack(state), event)

      setState(next.state)
      next.effects.forEach(run)
    }

    const run = (effect: ReviewDiffEffect) => {
      clearTimeout(request.timer)
      request.controller?.abort()

      if (effect.type === "abort") return
      const attempt = effect.attempt
      const controller = new AbortController()

      const timer = setTimeout(() => {
        controller.abort()
        dispatch({ type: "fetch.timed-out", attempt })
      }, REVIEW_DIFF_TIMEOUT_MS)

      request.controller = controller
      request.timer = timer
      // The machine drops the answer of a request it no longer waits for, aborted or not.
      void input.request(effect.target, AbortSignal.any([ctx.signal, controller.signal])).then(
        (rows) => {
          clearTimeout(timer)
          const loaded: ReviewDiffRows = { rows, version: Date.now() }

          queryClient.setQueryData(input.key(effect.target), loaded)
          dispatch({ type: "fetch.succeeded", attempt, rows: loaded })
        },
        (cause: unknown) => {
          clearTimeout(timer)
          dispatch({ type: "fetch.failed", attempt, message: cause instanceof Error ? cause.message : String(cause) })
        },
      )
    }

    const sync = (context: ReviewDiffContext) =>
      dispatch({
        type: "context.changed",
        context:
          context.kind === "ready"
            ? { ...context, cached: queryClient.getQueryData<ReviewDiffRows>(input.key(context.target)) }
            : context,
      })

    onCleanup(() => dispatch({ type: "disposed" }))

    // A connection or demand change alone keeps the view, so the diffs it shows are not computed again.
    return {
      dispatch,
      sync,
      ready: () => reviewDiffReady(state()),
      view: createMemo(() => reviewDiffView(state()), undefined, { equals: sameDiffView }),
    }
  }

  const changes = createDiffSlice({
    key: (target) =>
      target.kind === "turn"
        ? [ctx.id, target.serverID, "session-turn", target.sessionID]
        : [ctx.id, target.serverID, "session-vcs", target.directory, target.branch, target.defaultBranch, target.mode],
    request: (target, signal) => {
      const client = view().server.client

      if (target.kind === "turn") return client.session.diff({ sessionID: target.sessionID }, { signal })

      return client.vcs
        .diff(
          {
            location: { directory: target.directory },
            mode: target.mode === "git" ? "working" : target.mode,
            untracked: "folders",
          },
          { signal },
        )
        .then((result) => result.data)
    },
  })

  const dispatchDiff = changes.dispatch
  const diffView = changes.view

  createKeyed(diffContext, changes.sync)

  // The session details' changes row: the session directory's working tree, whatever the review mode, loaded only
  // while the details show. Untracked files list their own line counts.
  const details = createDiffSlice({
    key: (target) => [ctx.id, target.serverID, "session-details", target.kind === "vcs" ? target.directory : ""],
    request: (target, signal) =>
      view()
        .server.client.vcs.diff(
          { location: { directory: target.kind === "vcs" ? target.directory : directory() }, mode: "working" },
          { signal },
        )
        .then((result) => result.data),
  })

  const detailsContext = createMemo(
    (): ReviewDiffContext => {
      const project = view().project

      if (project && !project.vcs) return { kind: "no-vcs" }
      const connected = view().server.connected

      if (!project) return connected ? { kind: "waiting" } : { kind: "offline" }

      return {
        kind: "ready",
        target: {
          kind: "vcs",
          serverID: view().server.id,
          directory: view().directory,
          mode: "git",
          branch: "",
          defaultBranch: "",
        },
        connected,
        demanded: input.demand.details > 0,
      }
    },
    undefined,
    { equals: sameDiffContext },
  )

  createKeyed(detailsContext, details.sync)

  // A finished turn does not change on focus or filesystem events; the machines refresh only Git changes then.
  onCleanup(
    focusManager.subscribe((focused) => {
      if (!focused) return
      dispatchDiff({ type: "window.focused" })
      details.dispatch({ type: "window.focused" })
    }),
  )

  const refresh = debounce(() => {
    dispatchDiff({ type: "refresh", source: "vcs" })
    details.dispatch({ type: "refresh", source: "vcs" })
    dispatchFolders({ type: "refresh" })
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
  // pinned tab reads "N files changed": v2 opened the region on the review tab before selecting another.
  // A region restored open does not load them until something shows them.
  const opened = createMemo(
    on(
      () => !layout.narrow() && layout.side.opened(view()),
      (open, previous) => (open && !previous ? {} : undefined),
      { defer: true },
    ),
  )

  createKeyed(opened, () => {
    if (input.demand.tree > 0) {
      refresh()

      return
    }

    dispatchDiff({ type: "side.opened" })
  })

  const noRows: readonly FileDiffInfo[] = []

  const rows = () => {
    const current = diffView()

    return current.status === "ready" ? current.rows : noRows
  }

  // Git lists an untracked folder as one row. Once the change tree opens it, the folder lists its entries one level
  // deep; they stay loaded while it is closed again, until the changes' source changes or the folder goes away.
  const [folderState, setFolderState] = createSignal<ReviewFolderState>(INITIAL_REVIEW_FOLDER_STATE)
  const folderRequests = new Map<number, DiffRequest>()

  const dispatchFolders = (event: ReviewFolderEvent) => {
    const next = transitionReviewFolders(untrack(folderState), event)

    setFolderState(next.state)
    next.effects.forEach(runFolderEffect)
  }

  const runFolderEffect = (effect: ReviewFolderEffect) => {
    if (effect.type === "abort") {
      const request = folderRequests.get(effect.attempt)

      folderRequests.delete(effect.attempt)
      clearTimeout(request?.timer)
      request?.controller?.abort()

      return
    }

    const attempt = effect.attempt
    const request: DiffRequest = {}

    folderRequests.set(attempt, request)
    // A retry waits out its backoff first; the request's own deadline starts with it.
    request.timer = setTimeout(() => {
      const controller = new AbortController()

      request.controller = controller
      request.timer = setTimeout(() => {
        if (!folderRequests.delete(attempt)) return
        controller.abort()
        dispatchFolders({ type: "fetch.timed-out", folder: effect.folder, attempt })
      }, REVIEW_DIFF_TIMEOUT_MS)
      void view()
        .server.client.vcs.diff(
          {
            location: { directory: reviewFolderDirectory(effect.source.root, effect.folder) },
            mode: effect.source.mode === "branch" ? "branch" : "working",
            untracked: "folders",
          },
          { signal: AbortSignal.any([ctx.signal, controller.signal]) },
        )
        .then(
          (result) => {
            if (!folderRequests.delete(attempt)) return
            clearTimeout(request.timer)
            dispatchFolders({ type: "fetch.succeeded", folder: effect.folder, attempt, entries: result.data })
          },
          () => {
            if (!folderRequests.delete(attempt)) return
            clearTimeout(request.timer)
            dispatchFolders({ type: "fetch.failed", folder: effect.folder, attempt })
          },
        )
    }, effect.delay)
  }

  const folderSource = createMemo(
    (): ReviewFolderSource | undefined => {
      const context = diffContext()

      if (context.kind !== "ready" || context.target.kind !== "vcs") return undefined

      return {
        serverID: context.target.serverID,
        root: reviewRootDirectory(view().project?.worktree ?? directory()),
        directory: context.target.directory,
        mode: context.target.mode,
        branch: context.target.branch,
        defaultBranch: context.target.defaultBranch,
      }
    },
    undefined,
    {
      equals: (previous, next) => previous === next || (!!previous && !!next && sameReviewFolderSource(previous, next)),
    },
  )

  // The tree's expanded state belongs to the session screen's file model, which the change tree and the file
  // browser share.
  const expandedFolders = createMemo(
    () =>
      new Set(
        reviewFolderCandidates(rows(), folderState()).filter(
          (folder) => screen.file.tree.state(normalizePath(folder))?.expanded === true,
        ),
      ),
    undefined,
    { equals: (previous, next) => previous.size === next.size && [...previous].every((folder) => next.has(folder)) },
  )

  // Syncs the folders the tree expands, and the changes that list them, into the folder requests.
  createKeyed(
    () => ({
      source: folderSource(),
      connected: view().server.connected,
      rows: rows(),
      expanded: expandedFolders(),
    }),
    (context) => dispatchFolders({ type: "context.changed", context }),
    {
      equals: (previous, next) =>
        previous.source === next.source &&
        previous.connected === next.connected &&
        previous.rows === next.rows &&
        previous.expanded === next.expanded,
    },
  )
  onCleanup(() => dispatchFolders({ type: "disposed" }))

  const diffs = createMemo(() => reviewExpandedDiffs(rows(), folderState()))

  // A loaded folder's entry count, whether its listing stopped before showing or checking every entry, or its failure.
  const folderLabels = createMemo(() =>
    reviewFolderLabels(folderState(), {
      more: (count) => ctx.t("folder.more", { count }),
      failed: ctx.t("folder.failed"),
    }),
  )

  const renderable = createMemo(() => diffs().filter(filterRenderableDiff))
  const kinds = createMemo(() => reviewDiffKinds(renderable()))

  const activeFile = () => {
    const list = diffs()
    const selected = selectedFile()

    if (selected && list.some((diff) => diff.file === selected)) return selected

    return list.find((diff) => !isReviewFolder(diff.file))?.file
  }

  // What `git status` lists: an untracked folder counts once, opened or not.
  const count = () => rows().length
  const hasChanges = () => count() > 0

  const ready = changes.ready

  // Git initialization per session. Each request keeps its session's object, so its server and location stay its own;
  // only error feedback depends on which session is routed when it fails.
  const [initGitState, setInitGitState] = createSignal(createReviewInitGitState())
  const initGitRequests = new Map<number, DiffRequest>()
  const initGitSessions = new Map<string, MountedSession>()

  const dispatchInitGit = (event: ReviewInitGitEvent) => {
    const next = transitionReviewInitGit(untrack(initGitState), event)

    setInitGitState(next.state)

    // The machine releases a session's button; the driver forgets the session object with it.
    if (event.type === "disposed") initGitSessions.clear()

    if (event.type !== "disposed" && !isInitializingGit(next.state, event.sessionKey))
      initGitSessions.delete(event.sessionKey)
    next.effects.forEach(runInitGitEffect)
  }

  const runInitGitEffect = (effect: ReviewInitGitEffect) => {
    if (effect.type === "attempt.abort") {
      const request = initGitRequests.get(effect.attempt)

      initGitRequests.delete(effect.attempt)
      clearTimeout(request?.timer)
      request?.controller?.abort()

      return
    }

    if (effect.type === "toast.failed") {
      ctx.toast.show({
        variant: "error",
        title: ctx.t("common.requestFailed"),
        description: effect.reason === "timeout" ? ctx.t("load.timeout") : effect.message,
      })

      return
    }

    const session = initGitSessions.get(effect.sessionKey)
    const location = session?.location
    const sessionKey = effect.sessionKey
    const attempt = effect.attempt
    const controller = new AbortController()
    const signal = AbortSignal.any([ctx.signal, controller.signal])

    if (effect.type === "vcs.init") {
      initGitRequests.set(attempt, {
        controller,
        timer: setTimeout(
          () => dispatchInitGit({ type: "init.timed-out", sessionKey, attempt, routedSessionKey: untrack(view).key }),
          effect.timeoutMs,
        ),
      })
      void Promise.try(() => {
        if (!session || !location) throw new Error(ctx.t("common.requestFailed"))

        return session.server.client.vcs.init({ location, provider: "git" }, { signal })
      }).then(
        () => dispatchInitGit({ type: "init.succeeded", sessionKey, attempt }),
        (cause: unknown) =>
          dispatchInitGit({
            type: "init.failed",
            sessionKey,
            attempt,
            routedSessionKey: untrack(view).key,
            message: cause instanceof Error ? cause.message : undefined,
          }),
      )

      return
    }

    initGitRequests.set(attempt, {
      controller,
      timer: setTimeout(() => dispatchInitGit({ type: "sync.timed-out", sessionKey, attempt }), effect.timeoutMs),
    })
    // Each refresh runs even when an earlier one fails: the repository exists either way.
    void Promise.try(async () => {
      if (!session || !location) return
      const data = session.server.data

      data.project.invalidate()
      data.session.invalidate(session.id)
      data.location.invalidate(location)
      data.location.vcs.invalidate(location)
      await data.project.sync().catch(() => undefined)

      if (signal.aborted) return
      await data.session.sync(session.id).catch(() => undefined)

      if (signal.aborted) return
      await Promise.allSettled([data.location.syncInfo(location), data.location.vcs.sync(location)])
    })
      .catch(() => undefined)
      .then(() => dispatchInitGit({ type: "sync.settled", sessionKey, attempt }))
  }

  onCleanup(() => dispatchInitGit({ type: "disposed" }))

  // Initializes Git for the routed session.
  const initializeGit = () => {
    const session = view()
    const ready = Boolean(session.location && session.server.connected)

    if (ready && !isInitializingGit(untrack(initGitState), session.key)) initGitSessions.set(session.key, session)
    dispatchInitGit({ type: "init.requested", sessionKey: session.key, ready })
  }

  // Oversized full-file patches come back without hunks; the file's own directory, or bounded context, usually fits.
  // Each request reads only its target, fixed when the file was previewed, so a session switch cannot answer it.
  const detailKey = (target: ReviewDetailTarget, stage: ReviewDetailStage) =>
    target.kind === "turn"
      ? [ctx.id, target.serverID, "session-turn", target.sessionID, "bounded", target.version]
      : [
          ctx.id,
          target.serverID,
          "session-vcs",
          target.mode,
          target.branch,
          target.defaultBranch,
          stage === "scoped" ? target.scoped : target.root,
          stage,
          target.version,
        ]

  const detailStages = (target: ReviewDetailTarget): ReviewDetailStage[] =>
    target.kind === "vcs" && target.scoped !== target.root ? ["scoped", "bounded"] : ["bounded"]

  /** The previewed file's full patch: what its request reads, the patch an earlier request loaded, and the request. */
  const detail = {
    target: (diff: FileDiffInfo, version: number): ReviewDetailTarget => {
      const session = view()
      const value = mode()

      const file = {
        serverID: session.server.id,
        file: diff.file,
        additions: diff.additions,
        deletions: diff.deletions,
        version,
      }

      if (value === "turn") return { kind: "turn", sessionID: session.id, ...file }
      const root = reviewRootDirectory(session.project?.worktree ?? directory())

      return {
        kind: "vcs",
        mode: value,
        branch: vcs()?.branch.current ?? "",
        defaultBranch: vcs()?.branch.default ?? "",
        root,
        scoped: reviewDiffDirectory(root, diff.file),
        ...file,
      }
    },
    cached: (target: ReviewDetailTarget) =>
      detailStages(target)
        .map((stage) => validDetail(queryClient.getQueryData<FileDiffInfo[]>(detailKey(target, stage)), target))
        .find((diff) => diff !== undefined),
    load: (target: ReviewDetailTarget, stage: ReviewDetailStage, signal: AbortSignal) => {
      const server = view().server

      // The routed session moved to another server meanwhile; the preview already asks for another target.
      if (server.id !== target.serverID) return Promise.reject(new Error(ctx.t("common.requestFailed")))
      const both = AbortSignal.any([ctx.signal, signal])

      const rows =
        target.kind === "turn"
          ? server.client.session.diff({ sessionID: target.sessionID, context: 3 }, { signal: both })
          : server.client.vcs
              .diff(
                {
                  location: { directory: stage === "scoped" ? target.scoped : target.root },
                  mode: target.mode === "git" ? "working" : target.mode,
                  context: stage === "bounded" ? 3 : undefined,
                  untracked: "folders",
                },
                { signal: both },
              )
              .then((result) => result.data)

      return rows.then((list) => {
        queryClient.setQueryData(detailKey(target, stage), list)

        return validDetail(list, target)
      })
    },
  }

  // Previews read files only to show images and audio, which need the raw bytes and their MIME type.
  const readFile = (path: string) =>
    view()
      .server.client.file.read({ path, location: { directory: directory() } })
      .then((bytes) => ({
        type: "binary" as const,
        content: bytesToBase64(bytes),
        encoding: "base64" as const,
        mimeType: artifactMime(path),
      }))
      .catch((error) => {
        console.debug("[session-review] failed to read file", { path, error })

        return undefined
      })

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
    dispatchScroll({ type: "file.focused", path })
  }

  // The narrow review's list: the element lives here, the machine knows only whether it is mounted.
  const scroller: ScrollTarget = {}
  const [hasScroller, setHasScroller] = createSignal(false)
  const [scrollState, setScrollState] = createSignal<ReviewScrollState>(INITIAL_REVIEW_SCROLL_STATE)

  const dispatchScroll = (event: ReviewScrollEvent) => {
    const next = transitionReviewScroll(untrack(scrollState), event)

    setScrollState(next.state)
    next.effects.forEach((effect) => {
      if (scroller.frame !== undefined) cancelAnimationFrame(scroller.frame)
      scroller.frame = undefined

      if (effect.type === "frame.cancel") return

      if (effect.type === "frame.restore") {
        scroller.frame = requestAnimationFrame(() => {
          scroller.frame = undefined

          if (canRestoreReviewScroll(untrack(scrollState), effect.attempt)) restoreScroll()
          dispatchScroll({ type: "restore.stepped", attempt: effect.attempt })
        })

        return
      }

      // Scrolls the list to the file's diff, and settles once the diff stays at the top as the list above renders.
      scroller.frame = requestAnimationFrame(() => {
        scroller.frame = undefined
        const element = scroller.element
        const top = element && scrollToFile(element, effect.path) ? reviewDiffTop(element, effect.path) : undefined
        const settled = !!element && top !== undefined && Math.abs(element.scrollTop - top) <= 1

        dispatchScroll({ type: "frame.stepped", attempt: effect.attempt, outcome: settled ? "settled" : "retry" })
      })
    })
  }

  // Returns the narrow list to the stored scroll, as far as the diffs rendered so far reach.
  const restoreScroll = () => {
    const element = scroller.element

    if (!element || element.clientHeight === 0 || element.clientWidth === 0) return
    const stored = layout.scroll.get(view(), "review")

    if (!stored || (stored.x === 0 && stored.y === 0)) return
    const top = Math.min(stored.y, Math.max(0, element.scrollHeight - element.clientHeight))
    const left = Math.min(stored.x, Math.max(0, element.scrollWidth - element.clientWidth))

    if (element.scrollTop !== top) element.scrollTop = top

    if (element.scrollLeft !== left) element.scrollLeft = left
  }

  createKeyed(
    () => ({
      visitID: visitID(view().visit),
      narrow: layout.narrow(),
      scroller: hasScroller(),
      ready: ready(),
      layoutReady: layout.ready(),
      commentFocused: screen.comment.focus.current() !== null,
    }),
    (context) => dispatchScroll({ type: "context.synced", context }),
    { equals: sameReviewScrollContext },
  )
  onCleanup(() => dispatchScroll({ type: "disposed" }))

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
    dispatchDiff({ type: "refresh", source: "turn" })
    void queryClient.invalidateQueries({ queryKey: turnKey() })
  })

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
    detail,
    /** The session details' changes row. */
    details: details.view,
    retryDetails: () => details.dispatch({ type: "retry" }),
    /** What the review shows: diffs, or why there are none yet. */
    diff: diffView,
    diffVersion: () => {
      const current = diffView()

      return current.status === "ready" ? current.version : 0
    },
    diffs,
    folderLabels,
    renderable,
    kinds,
    focusFile,
    hasChanges,
    initializeGit,
    initializingGit: () => isInitializingGit(initGitState(), view().key),
    readFile,
    mode,
    filter,
    setFilter: (value: string) => void setFilter(value),
    open: () => stored()?.open ?? [],
    setOpen: (next: string[]) =>
      update((draft) => {
        const unique = Array.from(new Set(next))

        if (unique.length === draft.open.length && unique.every((path, index) => path === draft.open[index])) return

        draft.open = unique
      }),
    /** The narrow review mounts its list: one paint after each session switch. */
    mobileReady: () => reviewMobileReady(renderState()),
    options,
    /** The wide panel mounts: one paint after the first visit, then across session switches. */
    panelReady: () => reviewPanelReady(renderState()),
    ready,
    retry: () => {
      dispatchDiff({ type: "retry" })
      dispatchFolders({ type: "retry" })
    },
    setMode: (value: ChangeMode) =>
      update((draft) => {
        draft.mode = value
      }),
    /** The narrow review's list mounted, or unmounted with `undefined`. */
    setScroll: (element: HTMLDivElement | undefined) => {
      scroller.element = element
      setHasScroller(!!element)
    },
    /** The user scrolled, touched or keyed the narrow review: it stops restoring and scrolling to a focused file. */
    interacted: () => dispatchScroll(REVIEW_SCROLL_INTERACTED),
    /** The narrow list mounted, or its diffs or wrapping changed: it returns to the stored scroll while restoring. */
    requestRestore: () => dispatchScroll(REVIEW_SCROLL_RESTORE_REQUESTED),
    /** Stores the narrow list's scroll once the user, a focused file or a focused comment placed it. */
    saveScroll: (session: MountedSession, element: HTMLDivElement) => {
      if (!canSaveReviewScroll(untrack(scrollState))) return

      if (element.clientHeight === 0 || element.clientWidth === 0) return
      layout.scroll.set(session, "review", { x: element.scrollLeft, y: element.scrollTop })
    },
  }
}

export type ReviewModel = ReturnType<typeof createReviewModel>

function sameDiffContext(previous: ReviewDiffContext, next: ReviewDiffContext) {
  if (previous.kind !== "ready" || next.kind !== "ready") return previous.kind === next.kind

  return (
    previous.connected === next.connected &&
    previous.demanded === next.demanded &&
    sameReviewDiffTarget(previous.target, next.target)
  )
}

/** The target's patch in a loaded list, when it has hunks and the line counts the review listed. */
function validDetail(list: readonly FileDiffInfo[] | undefined, target: ReviewDetailTarget) {
  const diff = list?.find((item) => item.file === target.file)

  if (!diff || diff.additions !== target.additions || diff.deletions !== target.deletions) return undefined

  return reviewDiffNeedsLoad(diff) ? undefined : diff
}

function sameDiffView(previous: ReviewDiffView, next: ReviewDiffView) {
  if (previous.status === "ready" && next.status === "ready")
    return previous.rows === next.rows && previous.version === next.version

  if (previous.status === "error" && next.status === "error") return previous.failure === next.failure

  return previous.status === next.status
}
