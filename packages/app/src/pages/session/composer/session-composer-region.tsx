import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useParams } from "@solidjs/router"
import { useSpring } from "@opencode-ai/ui/motion-spring"
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
  ready: boolean
  centered: boolean
  inputRef: (el: HTMLDivElement) => void
  newSessionWorktree: string
  onNewSessionWorktreeReset: () => void
  onSubmit: () => void
  onResponseSubmit: () => void
  setPromptDockRef: (el: HTMLDivElement) => void
  visualDuration?: number
  bounce?: number
  dockOpenVisualDuration?: number
  dockOpenBounce?: number
  dockCloseVisualDuration?: number
  dockCloseBounce?: number
  drawerExpandVisualDuration?: number
  drawerExpandBounce?: number
  drawerCollapseVisualDuration?: number
  drawerCollapseBounce?: number
  subtitleDuration?: number
  subtitleTravel?: number
  subtitleEdge?: number
  countDuration?: number
  countMask?: number
  countMaskHeight?: number
  countWidthDuration?: number
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

  const [gate, setGate] = createStore({
    ready: false,
  })
  let timer: number | undefined
  let frame: number | undefined

  const clear = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timer = undefined
    }
    if (frame !== undefined) {
      cancelAnimationFrame(frame)
      frame = undefined
    }
  }

  createEffect(() => {
    sessionKey()
    const ready = props.ready
    const delay = 140

    clear()
    setGate("ready", false)
    if (!ready) return

    frame = requestAnimationFrame(() => {
      frame = undefined
      timer = window.setTimeout(() => {
        setGate("ready", true)
        timer = undefined
      }, delay)
    })
  })

  onCleanup(clear)

  const open = createMemo(() => gate.ready && props.state.dock() && !props.state.closing())
  const config = createMemo(() =>
    open()
      ? {
          visualDuration: props.dockOpenVisualDuration ?? props.visualDuration ?? 0.3,
          bounce: props.dockOpenBounce ?? props.bounce ?? 0,
        }
      : {
          visualDuration: props.dockCloseVisualDuration ?? props.visualDuration ?? 0.3,
          bounce: props.dockCloseBounce ?? props.bounce ?? 0,
        },
  )
  const progress = useSpring(() => (open() ? 1 : 0), config)
  const value = createMemo(() => Math.max(0, Math.min(1, progress())))
  const [height, setHeight] = createSignal(320)
  const dock = createMemo(() => (gate.ready && props.state.dock()) || value() > 0.001)
  const full = createMemo(() => Math.max(78, height()))
  const [contentRef, setContentRef] = createSignal<HTMLDivElement>()

  createEffect(() => {
    const el = contentRef()
    if (!el) return
    const update = () => {
      setHeight(el.getBoundingClientRect().height)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    onCleanup(() => observer.disconnect())
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
            <Show when={dock()}>
              <div
                classList={{
                  "overflow-hidden": true,
                  "pointer-events-none": value() < 0.98,
                }}
                style={{
                  "max-height": `${full() * value()}px`,
                }}
              >
                <div ref={setContentRef}>
                  <SessionTodoDock
                    todos={props.state.todos()}
                    title={language.t("session.todo.title")}
                    collapseLabel={language.t("session.todo.collapse")}
                    expandLabel={language.t("session.todo.expand")}
                    dockProgress={value()}
                    visualDuration={props.visualDuration}
                    bounce={props.bounce}
                    expandVisualDuration={props.drawerExpandVisualDuration}
                    expandBounce={props.drawerExpandBounce}
                    collapseVisualDuration={props.drawerCollapseVisualDuration}
                    collapseBounce={props.drawerCollapseBounce}
                    subtitleDuration={props.subtitleDuration}
                    subtitleTravel={props.subtitleTravel}
                    subtitleEdge={props.subtitleEdge}
                    countDuration={props.countDuration}
                    countMask={props.countMask}
                    countMaskHeight={props.countMaskHeight}
                    countWidthDuration={props.countWidthDuration}
                  />
                </div>
              </div>
            </Show>
            <div
              classList={{
                "relative z-10": true,
              }}
              style={{
                "margin-top": `${-36 * value()}px`,
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
