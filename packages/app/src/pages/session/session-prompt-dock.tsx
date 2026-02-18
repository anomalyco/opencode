import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import type { QuestionRequest, Todo } from "@opencode-ai/sdk/v2"
import { Button } from "@opencode-ai/ui/button"
import { DockPrompt } from "@opencode-ai/ui/dock-prompt"
import { Icon } from "@opencode-ai/ui/icon"
import { PromptInput } from "@/components/prompt-input"
import { QuestionDock } from "@/components/question-dock"
import { SessionTodoDock } from "@/components/session-todo-dock"

export function SessionPromptDock(props: {
  centered: boolean
  questionRequest: () => QuestionRequest | undefined
  permissionRequest: () => { patterns: string[]; permission: string } | undefined
  blocked: boolean
  todos: Todo[]
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
  const done = createMemo(
    () =>
      props.todos.length > 0 && props.todos.every((todo) => todo.status === "completed" || todo.status === "cancelled"),
  )

  const [dock, setDock] = createSignal(props.todos.length > 0)
  const [closing, setClosing] = createSignal(false)
  const [opening, setOpening] = createSignal(false)
  let timer: number | undefined
  let raf: number | undefined

  const scheduleClose = () => {
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      setDock(false)
      setClosing(false)
      timer = undefined
    }, 400)
  }

  createEffect(
    on(
      () => [props.todos.length, done()] as const,
      ([count, complete], prev) => {
        if (raf) cancelAnimationFrame(raf)
        raf = undefined

        if (count === 0) {
          if (timer) window.clearTimeout(timer)
          timer = undefined
          setDock(false)
          setClosing(false)
          setOpening(false)
          return
        }

        if (!complete) {
          if (timer) window.clearTimeout(timer)
          timer = undefined
          const wasHidden = !dock() || closing()
          setDock(true)
          setClosing(false)
          if (wasHidden) {
            setOpening(true)
            raf = requestAnimationFrame(() => {
              setOpening(false)
              raf = undefined
            })
            return
          }
          setOpening(false)
          return
        }

        if (prev && prev[1]) {
          if (closing() && !timer) scheduleClose()
          return
        }

        setDock(true)
        setOpening(false)
        setClosing(true)
        scheduleClose()
      },
    ),
  )

  onCleanup(() => {
    if (!timer) return
    window.clearTimeout(timer)
  })

  onCleanup(() => {
    if (!raf) return
    cancelAnimationFrame(raf)
  })

  return (
    <div
      ref={props.setPromptDockRef}
      data-component="session-prompt-dock"
      class="shrink-0 w-full pb-4 flex flex-col justify-center items-center bg-background-stronger pointer-events-none"
    >
      <div
        classList={{
          "w-full px-4 pointer-events-auto": true,
          "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": props.centered,
        }}
      >
        <Show when={props.questionRequest()} keyed>
          {(req) => {
            return (
              <div>
                <QuestionDock request={req} />
              </div>
            )
          }}
        </Show>

        <Show when={props.permissionRequest()} keyed>
          {(perm) => {
            const toolDescription = () => {
              const key = `settings.permissions.tool.${perm.permission}.description`
              const value = props.t(key)
              if (value === key) return ""
              return value
            }

            return (
              <div>
                <DockPrompt
                  kind="permission"
                  header={
                    <div data-slot="permission-row" data-variant="header">
                      <span data-slot="permission-icon">
                        <Icon name="warning" size="normal" />
                      </span>
                      <div data-slot="permission-header-title">{props.t("notification.permission.title")}</div>
                    </div>
                  }
                  footer={
                    <>
                      <div />
                      <div data-slot="permission-footer-actions">
                        <Button
                          variant="ghost"
                          size="normal"
                          onClick={() => props.onDecide("reject")}
                          disabled={props.responding}
                        >
                          {props.t("ui.permission.deny")}
                        </Button>
                        <Button
                          variant="secondary"
                          size="normal"
                          onClick={() => props.onDecide("always")}
                          disabled={props.responding}
                        >
                          {props.t("ui.permission.allowAlways")}
                        </Button>
                        <Button
                          variant="primary"
                          size="normal"
                          onClick={() => props.onDecide("once")}
                          disabled={props.responding}
                        >
                          {props.t("ui.permission.allowOnce")}
                        </Button>
                      </div>
                    </>
                  }
                >
                  <Show when={toolDescription()}>
                    <div data-slot="permission-row">
                      <span data-slot="permission-spacer" aria-hidden="true" />
                      <div data-slot="permission-hint">{toolDescription()}</div>
                    </div>
                  </Show>

                  <Show when={perm.patterns.length > 0}>
                    <div data-slot="permission-row">
                      <span data-slot="permission-spacer" aria-hidden="true" />
                      <div data-slot="permission-patterns">
                        <For each={perm.patterns}>
                          {(pattern) => <code class="text-12-regular text-text-base break-all">{pattern}</code>}
                        </For>
                      </div>
                    </div>
                  </Show>
                </DockPrompt>
              </div>
            )
          }}
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
            <Show when={dock()}>
              <div
                classList={{
                  "transition-[max-height,opacity,transform] duration-[400ms] ease-out overflow-hidden": true,
                  "max-h-[320px]": !closing(),
                  "max-h-0 pointer-events-none": closing(),
                  "opacity-0 translate-y-9": closing() || opening(),
                  "opacity-100 translate-y-0": !closing() && !opening(),
                }}
              >
                <SessionTodoDock
                  todos={props.todos}
                  title={props.t("session.todo.title")}
                  collapseLabel={props.t("session.todo.collapse")}
                  expandLabel={props.t("session.todo.expand")}
                />
              </div>
            </Show>
            <div
              classList={{
                "relative z-10": true,
                "transition-[margin] duration-[400ms] ease-out": true,
                "-mt-9": dock() && !closing(),
                "mt-0": !dock() || closing(),
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
