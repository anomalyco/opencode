import { For, Show, type ComponentProps } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { BasicTool } from "@opencode-ai/ui/basic-tool"
import { PromptInput } from "@/components/prompt-input"
import { QuestionDock } from "@/components/question-dock"
import { questionSubtitle } from "@/pages/session/session-prompt-helpers"

const questionDockRequest = (value: unknown) => value as ComponentProps<typeof QuestionDock>["request"]

export function SessionPromptDock(props: {
  centered: boolean
  questionRequest: () => { questions: unknown[] } | undefined
  permissionRequest: () => { patterns: string[]; permission: string } | undefined
  blocked: boolean
  promptReady: boolean
  handoffPrompt?: string
  t: (key: string, vars?: Record<string, string | number | boolean>) => string
  responding: boolean
  onDecide: (response: "once" | "always" | "reject") => void
  inputRef: (el: HTMLDivElement) => void
  newSessionWorktree: string
  onNewSessionWorktreeReset: () => void
  onSubmit: () => void
  setPromptDockRef: (el: HTMLDivElement) => void
}) {
  return (
    <div
      ref={props.setPromptDockRef}
      class="absolute inset-x-0 bottom-0 pt-12 pb-4 flex flex-col justify-center items-center z-50 bg-gradient-to-t from-background-stronger via-background-stronger to-transparent pointer-events-none"
    >
      <div
        classList={{
          "w-full px-4 pointer-events-auto": true,
          "md:max-w-200 md:mx-auto 3xl:max-w-[1200px]": props.centered,
        }}
      >
        <Show when={props.questionRequest()} keyed>
          {(req) => {
            const subtitle = questionSubtitle(req.questions.length, (key) => props.t(key))
            return (
              <div data-component="tool-part-wrapper" data-question="true" class="mb-3">
                <BasicTool
                  icon="bubble-5"
                  locked
                  defaultOpen
                  trigger={{
                    title: props.t("ui.tool.questions"),
                    subtitle,
                  }}
                />
                <QuestionDock request={questionDockRequest(req)} />
              </div>
            )
          }}
        </Show>

        <Show when={props.permissionRequest()} keyed>
          {(perm) => (
            <div data-component="tool-part-wrapper" data-permission="true" class="mb-3">
              <BasicTool
                icon="checklist"
                locked
                defaultOpen
                trigger={{
                  title: props.t("notification.permission.title"),
                  subtitle:
                    perm.permission === "doom_loop"
                      ? props.t("settings.permissions.tool.doom_loop.title")
                      : perm.permission,
                }}
              >
                <Show when={perm.patterns.length > 0}>
                  <div class="flex flex-col gap-1 py-2 px-3 max-h-40 overflow-y-auto no-scrollbar">
                    <For each={perm.patterns}>
                      {(pattern) => <code class="text-12-regular text-text-base break-all">{pattern}</code>}
                    </For>
                  </div>
                </Show>
                <Show when={perm.permission === "doom_loop"}>
                  <div class="text-12-regular text-text-weak pb-2 px-3">
                    {props.t("settings.permissions.tool.doom_loop.description")}
                  </div>
                </Show>
              </BasicTool>
              <div data-component="permission-prompt">
                <div data-slot="permission-actions">
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => props.onDecide("reject")}
                    disabled={props.responding}
                  >
                    {props.t("ui.permission.deny")}
                  </Button>
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={() => props.onDecide("always")}
                    disabled={props.responding}
                  >
                    {props.t("ui.permission.allowAlways")}
                  </Button>
                  <Button
                    variant="primary"
                    size="small"
                    onClick={() => props.onDecide("once")}
                    disabled={props.responding}
                  >
                    {props.t("ui.permission.allowOnce")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Show>

        <Show when={!props.blocked}>
          <Show
            when={props.promptReady}
            fallback={
              <div class="w-full min-h-32 md:min-h-40 rounded-md border border-border-weak-base bg-background-base/50 px-4 py-3 text-text-weak whitespace-pre-wrap pointer-events-none">
                {props.handoffPrompt || props.t("prompt.loading")}
              </div>
            }
          >
            <PromptInput
              ref={props.inputRef}
              newSessionWorktree={props.newSessionWorktree}
              onNewSessionWorktreeReset={props.onNewSessionWorktreeReset}
              onSubmit={props.onSubmit}
            />
          </Show>
        </Show>
      </div>
    </div>
  )
}
