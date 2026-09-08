import { createEffect, createMemo, on, onCleanup } from "solid-js"
import { createQuery, useQueryClient } from "@tanstack/solid-query"
import { debounce } from "@solid-primitives/scheduled"
import { usePlugin } from "@opencode/plugin/desktop"
import type { FileDiffInfo } from "@opencode/client"
import type {
  SessionReviewLineComment,
  SessionReviewCommentUpdate,
  SessionReviewCommentDelete,
} from "@opencode/session-ui/session-review"
import { previewSelectedLines } from "@opencode/session-ui/pierre/selection-bridge"
import { selectionFromLines, useEnvironment } from "../environment"
import { createReviewPanelState } from "./panel-state"
import { reviewDiffDirectory, reviewDiffNeedsLoad, reviewRootDirectory, reviewDiffKinds } from "./review-diff-kinds"

export function createSessionReview() {
  const ctx = usePlugin()
  const environment = useEnvironment()
  const session = environment.session
  const services = environment.services
  const file = services.files
  const view = services.view
  const queryClient = useQueryClient()
  const [state, update] = ctx.storage.store(`session.${session.key}`, {
    initial: { mode: "git" as "git" | "branch", file: "", diffStyle: "split" as "unified" | "split" },
  })
  const panelState = createReviewPanelState(ctx.storage)
  const vcs = () => session.server.data.location.vcs.info(session.location)
  const options = createMemo(() =>
    services.project?.vcs
      ? vcs()?.branch.current && vcs()?.branch.default && vcs()?.branch.current !== vcs()?.branch.default
        ? (["git", "branch"] as const)
        : (["git"] as const)
      : [],
  )
  const mode = () => (options().some((option) => option === state.mode) ? state.mode : "git")
  const queryKey = () => [
    session.server.id,
    "review-extension",
    file.directory,
    vcs()?.branch.current,
    vcs()?.branch.default,
  ]
  const query = createQuery(() => ({
    queryKey: [...queryKey(), mode()],
    enabled: session.server.compatible && !!services.project?.vcs && (view.panel.opened() || view.sidebar.opened()),
    refetchOnMount: "always" as const,
    refetchOnWindowFocus: true,
    queryFn: () =>
      session.server.client.vcs
        .diff({
          location: session.location ?? { directory: file.directory },
          mode: mode() === "git" ? "working" : "branch",
        })
        .then((result) => result.data),
  }))
  const refresh = debounce(() => {
    void queryClient.invalidateQueries({ queryKey: queryKey() })
  }, 100)
  onCleanup(refresh.clear)
  onCleanup(session.server.data.on("filesystem.changed", refresh))
  createEffect(
    on(
      () => session.server.data.session.status(session.sessionID),
      (next, previous) => {
        if (next === "idle" && previous === "running") refresh()
      },
    ),
  )
  createEffect(() => {
    const tab = view.tabs.active()
    const path = tab && file.pathFromTab(tab)
    if (path) void file.load(path)
    if (view.sidebar.opened()) void file.tree.list("")
  })
  const diffs = () => query.data ?? []
  const activeFile = () => (diffs().some((diff) => diff.file === state.file) ? state.file : diffs()[0]?.file)
  const openFile = (path: string, permanent = true) => {
    const tab = file.tab(path)
    view.sidebar.setTab("all")
    view.panel.open()
    void file.load(path)
    if (permanent) void view.tabs.open(tab)
    if (!permanent) view.tabs.previewTab(tab)
    view.tabs.setActive(tab)
  }
  const focusFile = (path: string) => {
    update((draft) => {
      draft.file = path
    })
    ctx.ui.panel.open("review", session)
  }
  const loadDiff = async (path: string, version?: number): Promise<FileDiffInfo | undefined> => {
    const root = reviewRootDirectory(services.project?.directory ?? file.directory)
    const directory = reviewDiffDirectory(root, path)
    const source = diffs().find((diff) => diff.file === path)
    const request = (scope: string, context?: number) =>
      queryClient
        .fetchQuery({
          queryKey: [...queryKey(), mode(), "directory", scope, context, version],
          staleTime: Number.POSITIVE_INFINITY,
          retry: 2,
          queryFn: () =>
            session.server.client.vcs
              .diff({
                location: { ...session.location, directory: scope },
                mode: mode() === "git" ? "working" : "branch",
                context,
              })
              .then((result) => result.data),
        })
        .then((diffs) =>
          diffs.find(
            (diff) =>
              diff.file === path &&
              diff.additions === source?.additions &&
              diff.deletions === source?.deletions &&
              !reviewDiffNeedsLoad(diff),
          ),
        )
        .catch((error: unknown) => {
          console.debug("[review-extension] failed to load diff", { path, scope, error })
          return undefined
        })
    if (directory !== root) {
      const scoped = await request(directory)
      if (scoped) return scoped
    }
    return request(root, 3)
  }
  return {
    panelState,
    diffs,
    activeFile,
    openFile,
    focusFile,
    loadDiff,
    options,
    mode,
    setMode: (mode: "git" | "branch") =>
      update((draft) => {
        draft.mode = mode
      }),
    ready: () => !services.project?.vcs || !query.isPending,
    diffVersion: () => query.dataUpdatedAt,
    kinds: createMemo(() => reviewDiffKinds(diffs())),
    diffStyle: () => state.diffStyle,
    setDiffStyle: (style: "unified" | "split") =>
      update((draft) => {
        draft.diffStyle = style
      }),
    comments: {
      all: services.annotations.all,
      focus: services.annotations.focus,
      setFocus: services.annotations.setFocus,
      actions: () => ({
        moreLabel: ctx.i18n.t("common.moreOptions"),
        editLabel: ctx.i18n.t("common.edit"),
        deleteLabel: ctx.i18n.t("common.delete"),
        saveLabel: ctx.i18n.t("common.save"),
      }),
      add(comment: SessionReviewLineComment) {
        const saved = services.annotations.add(comment)
        const content = file.get(comment.file)?.content?.content
        services.draft.context.add({
          type: "file",
          path: comment.file,
          selection: selectionFromLines(comment.selection),
          comment: comment.comment,
          commentID: saved.id,
          commentOrigin: "review",
          preview: comment.preview ?? (content ? previewSelectedLines(content, comment.selection) : undefined),
        })
      },
      update(comment: SessionReviewCommentUpdate) {
        services.annotations.update(comment.file, comment.id, comment.comment)
        services.draft.context.updateComment(comment.file, comment.id, {
          comment: comment.comment,
          ...(comment.preview ? { preview: comment.preview } : {}),
        })
      },
      remove(comment: SessionReviewCommentDelete) {
        services.annotations.remove(comment.file, comment.id)
        services.draft.context.removeComment(comment.file, comment.id)
      },
    },
  }
}
export type SessionReviewModel = ReturnType<typeof createSessionReview>
