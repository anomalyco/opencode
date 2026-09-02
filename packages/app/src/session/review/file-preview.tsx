import type { FileDiffInfo } from "@opencode-ai/client/promise"
import { FileEditor } from "@opencode-ai/session-ui/file-editor"
import { mediaKindFromPath } from "@opencode-ai/session-ui/pierre/media"
import {
  SessionReviewFilePreviewV2,
  type SessionReviewFilePreviewV2Props,
} from "@opencode-ai/session-ui/v2/session-review-file-preview-v2"
import { Button } from "@opencode-ai/ui/button"
import { makeEventListener } from "@solid-primitives/event-listener"
import { Show, untrack } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import type { createReviewEditor } from "./editor"

export function ReviewFilePreview(
  props: SessionReviewFilePreviewV2Props & {
    diff: FileDiffInfo
    editor?: ReturnType<typeof createReviewEditor>
  },
) {
  const language = useLanguage()
  const draft = () => props.editor?.get(props.file)
  const dirty = () => draft()?.loaded && draft()?.contents !== draft()?.original
  const canEdit = () => props.editor && props.diff.status !== "deleted" && !mediaKindFromPath(props.file)

  return (
    <SessionReviewFilePreviewV2
      {...props}
      headerActions={
        <Show when={canEdit() || draft()}>
          <div class="flex shrink-0 items-center gap-1" data-slot="review-edit-actions">
            <Show
              when={draft()}
              fallback={
                <Button size="small" variant="ghost" onClick={() => void props.editor?.open(props.diff)}>
                  {language.t("session.review.editFile")}
                </Button>
              }
            >
              <Show when={dirty()}>
                <span class="text-12-regular text-text-weak" role="status">
                  {language.t("session.review.unsaved")}
                </span>
              </Show>
              <Button
                size="small"
                variant="ghost"
                disabled={draft()?.saving}
                onClick={() => props.editor?.discard(props.file)}
              >
                {language.t("session.review.discard")}
              </Button>
              <Button
                size="small"
                aria-keyshortcuts="Control+S Meta+S"
                disabled={!dirty() || draft()?.saving || draft()?.error === "editor"}
                onClick={() => void props.editor?.save(props.file)}
              >
                {language.t(draft()?.saving ? "session.review.saving" : "common.save")}
              </Button>
            </Show>
          </div>
        </Show>
      }
      content={
        <Show when={draft()}>
          <div
            class="flex min-h-full flex-col"
            data-slot="review-file-editor"
            ref={(element) =>
              makeEventListener(
                element,
                "keydown",
                (event) => {
                  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return
                  event.preventDefault()
                  event.stopPropagation()
                  if (dirty()) void props.editor?.save(props.file)
                },
                { capture: true },
              )
            }
          >
            <Show when={draft()?.loading}>
              <div class="p-3 text-13-regular text-text-weak" role="status">
                {language.t("common.loading")}
              </div>
            </Show>
            <Show when={draft()?.error}>
              {(error) => (
                <div class="p-3 text-13-regular text-text-strong" role="alert">
                  {language.t(`session.review.editError.${error()}`)}
                </div>
              )}
            </Show>
            <Show when={draft()?.loaded && draft()} keyed>
              {(value) => {
                // The editor owns its live buffer; parent updates must not reset its undo history.
                const file = untrack(() => ({ name: props.file, contents: value.contents }))
                return (
                  <FileEditor
                    file={file}
                    onChange={(contents) => props.editor?.change(props.file, contents)}
                    onError={() => props.editor?.fail(props.file)}
                    onReady={() => props.editor?.ready(props.file)}
                  />
                )
              }}
            </Show>
          </div>
        </Show>
      }
    />
  )
}
