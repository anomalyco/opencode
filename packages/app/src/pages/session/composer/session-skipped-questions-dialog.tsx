import { For, Show, type JSX } from "solid-js"
import type { QuestionRequest } from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useLanguage } from "@/context/language"

export function SessionSkippedQuestionsDialog(props: {
  requests: () => QuestionRequest[]
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
      description={language.t("session.question.skipped.description")}
      class="w-full max-w-[560px] mx-auto"
      fit
      transition
    >
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <div class="max-h-[360px] overflow-y-auto pr-3 flex flex-col gap-2">
          <For each={props.requests()}>
            {(request) => (
              <div class="rounded-md border border-border-subtle bg-background-base/70 px-3 py-2.5">
                <div class="flex items-center justify-between gap-3 text-12-regular text-text-weak">
                  <span class="truncate">{request.id}</span>
                  <Show when={request.tool?.messageID}>
                    {(messageID) => <span class="shrink-0 font-mono">{messageID()}</span>}
                  </Show>
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
                          <div class="mt-1 text-12-regular text-text-weak">
                            {language.t("session.question.skipped.options", {
                              options: question.options.map((option) => option.label).join(", "),
                            })}
                          </div>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            )}
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
