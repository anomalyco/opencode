import { Show, createMemo, createSignal, createEffect } from "solid-js"
import { useParams } from "@solidjs/router"
import { useSpring } from "@opencode-ai/ui/motion-spring"
import { useElementHeight } from "@opencode-ai/ui/hooks"
import { PromptInput } from "@/components/prompt-input"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { getSessionHandoff, setSessionHandoff } from "@/pages/session/handoff"
import { SessionPermissionDock } from "@/pages/session/composer/session-permission-dock"
import { SessionQuestionDock } from "@/pages/session/composer/session-question-dock"
import type { SessionComposerState } from "@/pages/session/composer/session-composer-state"
import { SessionTodoDock, COLLAPSED_HEIGHT } from "@/pages/session/composer/session-todo-dock"

const DOCK_SPRING = { visualDuration: 0.3, bounce: 0 }

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

  const open = createMemo(() => props.state.dock() && !props.state.closing())
  const progress = useSpring(
    () => (open() ? 1 : 0),
    DOCK_SPRING,
  )
  const dock = createMemo(() => props.state.dock() || progress() > 0.001)
  const [contentRef, setContentRef] = createSignal<HTMLDivElement>()
  const height = useElementHeight(contentRef, 320)
  const full = createMemo(() => Math.max(COLLAPSED_HEIGHT, height()))

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
            <Show when={dock()}>
              <div
                classList={{
                  "overflow-hidden": true,
                  "pointer-events-none": progress() < 0.98,
                }}
                style={{
                  "max-height": `${full() * progress()}px`,
                }}
              >
                <div ref={setContentRef}>
                  <SessionTodoDock
                    todos={props.state.todos()}
                    title={language.t("session.todo.title")}
                    collapseLabel={language.t("session.todo.collapse")}
                    expandLabel={language.t("session.todo.expand")}
                    dockProgress={progress()}
                  />
                </div>
              </div>
            </Show>
            <div
              classList={{
                "relative z-10": true,
              }}
              style={{
                "margin-top": `${-36 * progress()}px`,
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
