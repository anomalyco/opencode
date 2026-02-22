import { Show, createEffect, createMemo } from "solid-js"
import { useParams } from "@solidjs/router"
import { PromptInput } from "@/components/prompt-input"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { getSessionHandoff, setSessionHandoff } from "@/pages/session/handoff"
import { SessionPermissionDock } from "@/pages/session/composer/session-permission-dock"
import { SessionQuestionDock } from "@/pages/session/composer/session-question-dock"
import type { SessionComposerState } from "@/pages/session/composer/session-composer-state"
import { SessionTodoDock } from "@/pages/session/composer/session-todo-dock"

export function SessionComposerRegion(props: {
  state: SessionComposerState
  centered: boolean
  inputRef: (el: HTMLDivElement) => void
  newSessionWorktree: string
  onNewSessionWorktreeReset: () => void
  onSubmit: () => void
  onResponseSubmit: () => void
  setPromptDockRef: (el: HTMLDivElement) => void
}) {
  const params = useParams()
  const prompt = usePrompt()
  const language = useLanguage()

  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const handoffPrompt = createMemo(() => getSessionHandoff(sessionKey())?.prompt)

  const previewPrompt = () =>
    prompt
      .current()
      .map((part) => {
        if (part.type === "file") return `[file:${part.path}]`
        if (part.type === "agent") return `@${part.name}`
        if (part.type === "image") return `[image:${part.filename}]`
        return part.content
      })
      .join("")
      .trim()

  createEffect(() => {
    if (!prompt.ready()) return
    setSessionHandoff(sessionKey(), { prompt: previewPrompt() })
  })

  return (
    <div
      ref={props.setPromptDockRef}
      data-component="session-prompt-dock"
      class="shrink-0 w-full pb-3 flex flex-col justify-center items-center bg-background-stronger pointer-events-none"
    >
      <div
        classList={{
          "w-full px-3 pointer-events-auto": true,
          "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": props.centered,
        }}
      >
        <Show when={props.state.questionRequest()} keyed>
          {(request) => (
            <div>
              <SessionQuestionDock request={request} onSubmit={props.onResponseSubmit} />
            </div>
          )}
        </Show>

        <Show when={props.state.permissionRequest()} keyed>
          {(request) => (
            <div>
              <SessionPermissionDock
                request={request}
                responding={props.state.permissionResponding()}
                onDecide={(response) => {
                  props.onResponseSubmit()
                  props.state.decide(response)
                }}
              />
            </div>
          )}
        </Show>

        <Show when={!props.state.blocked()}>
          <Show
            when={prompt.ready()}
            fallback={
              <div class="w-full min-h-32 md:min-h-40 rounded-md border border-border-weak-base bg-background-base/50 px-4 py-3 text-text-weak whitespace-pre-wrap pointer-events-none">
                {handoffPrompt() || language.t("prompt.loading")}
              </div>
            }
          >
            <Show when={props.state.dock()}>
              <div
                classList={{
                  "transition-[max-height,opacity,transform] duration-[400ms] ease-out overflow-hidden": true,
                  "max-h-[320px]": !props.state.closing(),
                  "max-h-0 pointer-events-none": props.state.closing(),
                  "opacity-0 translate-y-9": props.state.closing() || props.state.opening(),
                  "opacity-100 translate-y-0": !props.state.closing() && !props.state.opening(),
                }}
              >
                <SessionTodoDock
                  todos={props.state.todos()}
                  title={language.t("session.todo.title")}
                  collapseLabel={language.t("session.todo.collapse")}
                  expandLabel={language.t("session.todo.expand")}
                />
              </div>
            </Show>
            <div
              classList={{
                "relative z-10": true,
                "transition-[margin] duration-[400ms] ease-out": true,
                "-mt-9": props.state.dock() && !props.state.closing(),
                "mt-0": !props.state.dock() || props.state.closing(),
              }}
            >
              <PromptInput
                ref={props.inputRef}
                newSessionWorktree={props.newSessionWorktree}
                onNewSessionWorktreeReset={props.onNewSessionWorktreeReset}
                onSubmit={props.onSubmit}
              />
            </div>
          </Show>
        </Show>
      </div>
    </div>
  )
}
