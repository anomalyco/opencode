import { For, Show, type JSX } from "solid-js"
import type { QuestionRequest } from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import type { QuestionInvalidation } from "./session-question-dock-helpers"

export function SessionSkippedQuestionsDialog(props: {
  requests: () => QuestionRequest[]
  invalidation: (request: QuestionRequest) => QuestionInvalidation | undefined
  sessionEnded: () => boolean
  onClear: () => void
}): JSX.Element {
  const language = useLanguage()
  const dialog = useDialog()

  const clear = () => {
    props.onClear()
    dialog.close()
  }

  return (
    <Dialog
      title={language.t("session.question.skipped.title")}
      class="w-full max-w-[560px] mx-auto"
      fit
      transition
    >
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3 pt-1">
        <Show when={props.sessionEnded()}>
          <div class="mr-3 rounded-xl border border-border-warning-base bg-surface-warning-weak/80 px-3.5 py-3 shadow-xs-border-base">
            <div class="flex items-center gap-2 text-12-medium uppercase tracking-[0.12em] text-icon-warning-active">
              <Icon name="warning" size="small" class="shrink-0" />
              <span>{language.t("session.question.skipped.ended.badge")}</span>
            </div>
            <div class="mt-1 text-13-regular leading-relaxed text-text">
              {language.t("session.question.skipped.ended.description")}
            </div>
          </div>
        </Show>
        <div class="max-h-[360px] overflow-y-auto pr-3 flex flex-col gap-2">
          <For each={props.requests()}>
            {(request) => {
              const ended = () => props.invalidation(request)?.type === "session-ended"
              return (
                <div
                  class="rounded-xl border px-3.5 py-3"
                  classList={{
                    "border-border-warning-base/80 bg-surface-warning-weak/45": ended(),
                    "border-border-weak-base/50 bg-background-base/45": !ended(),
                  }}
                >
                  <div class="flex items-center justify-between gap-3 text-12-regular text-text-weak">
                    <span class="truncate">{request.id}</span>
                    <div class="flex shrink-0 items-center gap-2">
                      <Show when={ended()}>
                        <span class="rounded-full border border-border-warning-base bg-surface-warning-base px-2 py-0.5 text-11-medium text-icon-warning-active">
                          {language.t("session.question.skipped.ended.badge")}
                        </span>
                      </Show>
                      <Show when={request.tool?.messageID}>
                        {(messageID) => <span class="font-mono">{messageID()}</span>}
                      </Show>
                    </div>
                  </div>
                  <div class="mt-2 flex flex-col gap-2">
                    <For each={request.questions}>
                      {(question) => (
                        <div class="text-13-regular text-text">
                          <div class="font-medium text-text-strong">{question.header || question.question}</div>
                          <Show when={question.header && question.question}>
                            <div class="mt-0.5 text-text-weak">{question.question}</div>
                          </Show>
                          <Show when={question.options.length > 0}>
                            <div class="mt-2 flex flex-col items-start gap-1.5">
                              <For each={question.options}>
                                {(option) => (
                                  <span class="block max-w-full cursor-default truncate rounded-full border border-border-weak-base/70 bg-surface-panel px-2.5 py-1 text-12-medium text-text-weak">
                                    {option.label}
                                  </span>
                                )}
                              </For>
                            </div>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              )
            }}
          </For>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="primary" size="large" disabled={props.requests().length === 0} onClick={clear}>
            {language.t("session.question.skipped.clear")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
