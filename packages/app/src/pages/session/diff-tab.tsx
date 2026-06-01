import { Button } from "@opencode-ai/ui/button"
import { useFileComponent } from "@opencode-ai/ui/context/file"
import { createLineCommentController } from "@opencode-ai/ui/line-comment-annotations"
import { mediaKindFromPath } from "@opencode-ai/ui/pierre/media"
import { cloneSelectedLineRange, previewSelectedLines } from "@opencode-ai/ui/pierre/selection-bridge"
import type { SessionReviewCommentActions } from "@opencode-ai/ui/session-review"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Tabs } from "@opencode-ai/ui/tabs"
import type { FileDiff } from "@opencode-ai/sdk/v2"
import { createEffect, createMemo, Match, on, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { selectionFromLines, useFile, type SelectedLineRange } from "@/context/file"
import { useComments } from "@/context/comments"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePrompt } from "@/context/prompt"
import { usePromptDocBridge } from "@/context/prompt-doc-bridge"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { addLineContext } from "@/utils/doc-line-reference"
import { createSessionTabs } from "@/pages/session/helpers"
import { createScrollSync, FileCommentMenu } from "@/pages/session/file-tabs"
import { useSessionLayout } from "@/pages/session/session-layout"

const MAX_DIFF_CHANGED_LINES = 500

function selectionSide(range: SelectedLineRange) {
  return range.endSide ?? range.side ?? "additions"
}

function selectionPreview(diff: FileDiff, range: SelectedLineRange) {
  const side = selectionSide(range)
  const contents = side === "deletions" ? diff.before : diff.after
  if (typeof contents !== "string" || contents.length === 0) return undefined
  return previewSelectedLines(contents, range)
}

export function DiffTabContent(props: { tab: string }) {
  const file = useFile()
  const comments = useComments()
  const language = useLanguage()
  const layout = useLayout()
  const prompt = usePrompt()
  const bridge = usePromptDocBridge()
  const fileComponent = useFileComponent()
  const sdk = useSDK()
  const sync = useSync()
  const { params, tabs, view } = useSessionLayout()

  const activeFileTab = createSessionTabs({
    tabs,
    pathFromTab: (tab) => file.pathFromTab(tab) ?? file.pathFromDiffTab(tab),
    normalizeTab: (tab) => {
      if (tab.startsWith("file://")) return file.tab(tab)
      if (tab.startsWith("diff://")) {
        const path = file.pathFromDiffTab(tab)
        if (path) return file.diffTab(path)
      }
      return tab
    },
  }).activeFileTab

  const path = createMemo(() => file.pathFromDiffTab(props.tab))
  const diffs = createMemo(() => (params.id ? (sync.data.session_diff[params.id] ?? []) : []))
  const item = createMemo(() => {
    const p = path()
    if (!p) return
    return diffs().find((diff) => file.normalize(diff.file) === file.normalize(p))
  })

  const scrollSync = createScrollSync({
    tab: () => props.tab,
    view,
  })

  const diffStyle = () => layout.review.diffStyle()
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
    force: false,
  })

  const syncSelected = (range: SelectedLineRange | null) => {
    const p = path()
    if (!p) return
    file.setSelectedLines(p, range ? cloneSelectedLineRange(range) : null)
  }

  const selectedLines = createMemo(() => note.selected ?? ((path() ? file.selectedLines(path()!) : null) as SelectedLineRange | null))

  const buildPreview = (filePath: string, selection: SelectedLineRange) => {
    const diff = item()
    if (!diff || filePath !== path()) return
    return selectionPreview(diff, selection)
  }

  const addCommentToContext = (input: {
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
  }) => {
    const selection = selectionFromLines(input.selection)
    const preview = input.preview ?? buildPreview(input.file, input.selection)
    addLineContext(
      bridge,
      { file: input.file, selection: input.selection, comment: input.comment, preview },
      () => {
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
          commentOrigin: "review",
          preview,
        })
      },
    )
  }

  const updateCommentInContext = (input: {
    id: string
    file: string
    selection: SelectedLineRange
    comment: string
  }) => {
    comments.update(input.file, input.id, input.comment)
    const preview = input.file === path() ? buildPreview(input.file, input.selection) : undefined
    prompt.context.updateComment(input.file, input.id, {
      comment: input.comment,
      ...(preview ? { preview } : {}),
    })
  }

  const removeCommentFromContext = (input: { id: string; file: string }) => {
    comments.remove(input.file, input.id)
    prompt.context.removeComment(input.file, input.id)
  }

  const labels = createMemo<SessionReviewCommentActions>(() => ({
    moreLabel: language.t("common.moreOptions"),
    editLabel: language.t("common.edit"),
    deleteLabel: language.t("common.delete"),
    saveLabel: language.t("common.save"),
  }))

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
    getHoverSelectedRange: selectedLines,
    getSide: selectionSide,
    clearSelectionOnSelectionEndNull: false,
    onSubmit: ({ comment, selection }) => {
      const p = path()
      if (!p) return
      const diff = item()
      if (!diff) return
      addCommentToContext({ file: p, selection, comment, preview: selectionPreview(diff, selection) })
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
    editSubmitLabel: labels().saveLabel,
    renderCommentActions: (_, controls) => (
      <FileCommentMenu
        moreLabel={labels().moreLabel}
        editLabel={labels().editLabel}
        deleteLabel={labels().deleteLabel}
        onEdit={controls.edit}
        onDelete={controls.remove}
      />
    ),
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

  const readFile = async (filePath: string) => {
    return sdk.client.file
      .read({ path: filePath })
      .then((x) => x.data)
      .catch(() => undefined)
  }

  const beforeText = () => {
    const diff = item()
    return typeof diff?.before === "string" ? diff.before : ""
  }
  const afterText = () => {
    const diff = item()
    return typeof diff?.after === "string" ? diff.after : ""
  }
  const changedLines = () => (item()?.additions ?? 0) + (item()?.deletions ?? 0)
  const mediaKind = createMemo(() => {
    const p = path()
    if (!p) return
    return mediaKindFromPath(p)
  })
  const tooLarge = createMemo(() => {
    if (note.force) return false
    if (mediaKind()) return false
    return changedLines() > MAX_DIFF_CHANGED_LINES
  })

  return (
    <Tabs.Content value={props.tab} class="relative h-full">
      <ScrollView class="h-full" viewportRef={scrollSync.setViewport} onScroll={scrollSync.handleScroll as any}>
        <Switch>
          <Match when={!path()}>
            <div class="px-6 py-4 text-text-weak">{language.t("session.files.selectToOpen")}</div>
          </Match>
          <Match when={!item()}>
            <div class="px-6 py-4 text-text-weak">
              {sync.data.session_diff[params.id ?? ""] === undefined
                ? `${language.t("common.loading")}${language.t("common.loading.ellipsis")}`
                : language.t("session.review.noChanges")}
            </div>
          </Match>
          <Match when={item()}>
            {(diff) => (
              <div class="relative overflow-hidden pb-40 px-3">
                <Show when={tooLarge()}>
                  <div data-slot="session-review-large-diff" class="py-4">
                    <div data-slot="session-review-large-diff-title">
                      {language.t("ui.sessionReview.largeDiff.title")}
                    </div>
                    <div data-slot="session-review-large-diff-meta">
                      {language.t("ui.sessionReview.largeDiff.meta", {
                        limit: MAX_DIFF_CHANGED_LINES.toLocaleString(),
                        current: changedLines().toLocaleString(),
                      })}
                    </div>
                    <div data-slot="session-review-large-diff-actions" class="mt-3">
                      <Button size="normal" variant="secondary" onClick={() => setNote("force", true)}>
                        {language.t("ui.sessionReview.largeDiff.renderAnyway")}
                      </Button>
                    </div>
                  </div>
                </Show>
                <Show when={!tooLarge()}>
                  <Dynamic
                    component={fileComponent}
                    mode="diff"
                    diffStyle={diffStyle()}
                    onRendered={() => scrollSync.queueRestore()}
                    enableLineSelection
                    enableHoverUtility
                    onLineSelected={commentsUi.onLineSelected}
                    onLineSelectionEnd={commentsUi.onLineSelectionEnd}
                    onLineNumberSelectionEnd={commentsUi.onLineNumberSelectionEnd}
                    annotations={commentsUi.annotations()}
                    renderAnnotation={commentsUi.renderAnnotation}
                    renderHoverUtility={commentsUi.renderHoverUtility}
                    selectedLines={selectedLines()}
                    commentedLines={commentedLines()}
                    before={{
                      name: path() ?? "",
                      contents: beforeText(),
                    }}
                    after={{
                      name: path() ?? "",
                      contents: afterText(),
                    }}
                    media={{
                      mode: "auto",
                      path: path(),
                      before: diff().before,
                      after: diff().after,
                      readFile,
                    }}
                    class="select-text"
                  />
                </Show>
              </div>
            )}
          </Match>
        </Switch>
      </ScrollView>
    </Tabs.Content>
  )
}
