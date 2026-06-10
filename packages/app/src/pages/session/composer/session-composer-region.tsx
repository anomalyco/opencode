import { Show, createEffect, createMemo, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useSpring } from "@opencode-ai/ui/motion-spring"
import { PromptInput } from "@/components/prompt-input"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { getSessionHandoff, setSessionHandoff } from "@/pages/session/handoff"
import { useSessionKey } from "@/pages/session/session-layout"
import { SessionPermissionDock } from "@/pages/session/composer/session-permission-dock"
import { SessionQuestionDock } from "@/pages/session/composer/session-question-dock"
import { SessionFollowupDock } from "@/pages/session/composer/session-followup-dock"
import { SessionRevertDock } from "@/pages/session/composer/session-revert-dock"
import type { SessionComposerState } from "@/pages/session/composer/session-composer-state"
import { SessionTodoDock } from "@/pages/session/composer/session-todo-dock"
import { SessionComposerShell } from "@/pages/session/composer/session-composer-shell"
import type { FollowupMode } from "@/components/prompt-input/composer-state"
import type { FollowupDraft } from "@/components/prompt-input/submit"

const shellMin = 200

function shellMax(anchorBottom: number) {
  if (typeof window === "undefined") return 600
  return Math.min(window.innerHeight * 0.7, window.innerHeight - anchorBottom)
}

function sessionRow(shell?: HTMLElement | null) {
  const session = shell?.closest('[data-component="codle-session"]')
  if (!session) return undefined
  for (const child of session.children) {
    if (child instanceof HTMLElement && child.classList.contains("flex-1")) return child
  }
  return undefined
}

function layoutRowRect(shell?: HTMLElement | null) {
  const row = sessionRow(shell)
  if (row) return row.getBoundingClientRect()
  const session = shell?.closest('[data-component="codle-session"]')
  if (session) return session.getBoundingClientRect()
  return undefined
}

/** Expanded shell right edge: session flex row (session + gap + preview). */
function layoutRight(shell?: HTMLElement | null) {
  if (typeof window === "undefined") return 0
  return layoutRowRect(shell)?.right ?? window.innerWidth
}

function shellWidth(left: number, shell?: HTMLElement | null) {
  if (typeof window === "undefined") return 480
  return Math.max(shellMin, layoutRight(shell) - left)
}

function clampShell(value: number, anchorBottom: number) {
  return Math.min(shellMax(anchorBottom), Math.max(shellMin, value))
}

export function SessionComposerRegion(props: {
  state: SessionComposerState
  ready: boolean
  centered: boolean
  inputRef: (el: HTMLDivElement) => void
  newSessionWorktree: string
  onNewSessionWorktreeReset: () => void
  onSubmit: () => void
  onResponseSubmit: () => void
  followup?: {
    mode: FollowupMode
    items: { id: string; text: string }[]
    sending?: string
    edit?: { id: string; prompt: FollowupDraft["prompt"]; context: FollowupDraft["context"] }
    onQueue: (draft: FollowupDraft) => void
    onAbort: () => void
    onSend: (id: string) => void
    onEdit: (id: string) => void
    onEditLoaded: () => void
  }
  revert?: {
    items: { id: string; text: string }[]
    restoring?: string
    disabled?: boolean
    onRestore: (id: string) => void
  }
  setPromptDockRef: (el: HTMLDivElement) => void
  onExpandedChange?: (expanded: boolean) => void
}) {
  const prompt = usePrompt()
  const language = useLanguage()
  const route = useSessionKey()

  const handoffPrompt = createMemo(() => getSessionHandoff(route.sessionKey())?.prompt)

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
    setSessionHandoff(route.sessionKey(), { prompt: previewPrompt() })
  })

  const [store, setStore] = createStore({
    ready: false,
    height: 320,
    body: undefined as HTMLDivElement | undefined,
    expanded: false,
    shellHeight: undefined as number | undefined,
    anchorLeft: 0,
    anchorBottom: 0,
    shellWidth: undefined as number | undefined,
    shellRight: undefined as number | undefined,
  })
  let timer: number | undefined
  let frame: number | undefined
  let shell: HTMLDialogElement | undefined
  let input: HTMLDivElement | undefined

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
    route.sessionKey()
    const ready = props.ready
    const delay = 140

    clear()
    setStore("ready", false)
    if (!ready) return

    frame = requestAnimationFrame(() => {
      frame = undefined
      timer = window.setTimeout(() => {
        setStore("ready", true)
        timer = undefined
      }, delay)
    })
  })

  onCleanup(clear)

  const open = createMemo(() => store.ready && props.state.dock() && !props.state.closing())
  const progress = useSpring(() => (open() ? 1 : 0), { visualDuration: 0.3, bounce: 0 })
  const value = createMemo(() => Math.max(0, Math.min(1, progress())))
  const dock = createMemo(() => (store.ready && props.state.dock()) || value() > 0.001)
  const rolled = createMemo(() => (props.revert?.items.length ? props.revert : undefined))
  const lift = createMemo(() => (rolled() ? 18 : 36 * value()))
  const full = createMemo(() => Math.max(78, store.height))

  createEffect(() => {
    const el = store.body
    if (!el) return
    const update = () => {
      setStore("height", el.getBoundingClientRect().height)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    onCleanup(() => observer.disconnect())
  })

  const measure = () => {
    const el = shell
    if (!el) return { height: shellMin, left: 0, bottom: 0, width: shellMin }
    const rect = el.getBoundingClientRect()
    return {
      height: rect.height,
      left: rect.left,
      bottom: typeof window === "undefined" ? 0 : window.innerHeight - rect.bottom,
      width: rect.width,
    }
  }

  const syncShellBounds = () => {
    const right = layoutRight(shell)
    setStore({
      shellRight: right,
      shellWidth: shellWidth(store.anchorLeft, shell),
    })
  }

  const expand = () => {
    const box = measure()
    const right = layoutRight(shell)
    setStore({
      expanded: true,
      shellHeight: clampShell(box.height, box.bottom),
      anchorLeft: box.left,
      anchorBottom: box.bottom,
      shellRight: right,
      shellWidth: Math.max(shellMin, right - box.left),
    })
  }

  const collapse = () => {
    setStore({
      expanded: false,
      shellHeight: undefined,
      shellRight: undefined,
      shellWidth: undefined,
    })
  }

  const resize = (height: number) => {
    setStore("shellHeight", clampShell(height, store.anchorBottom))
  }

  createEffect(() => {
    if (!store.expanded) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      collapse()
    }
    document.addEventListener("keydown", onKey, true)
    onCleanup(() => document.removeEventListener("keydown", onKey, true))
  })

  createEffect(() => {
    if (!store.expanded) return
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => input?.focus())
    })
    onCleanup(() => cancelAnimationFrame(id))
  })

  onMount(() => {
    const onWindowResize = () => {
      if (!store.expanded) return
      syncShellBounds()
      if (!store.shellHeight) return
      setStore("shellHeight", (h) => (h === undefined ? h : clampShell(h, store.anchorBottom)))
    }
    window.addEventListener("resize", onWindowResize)
    onCleanup(() => window.removeEventListener("resize", onWindowResize))
  })

  createEffect(() => {
    if (!store.expanded) return
    syncShellBounds()
    const observer = new ResizeObserver(() => syncShellBounds())
    const column = shell?.closest('[data-component="codle-session-column"]')
    const row = sessionRow(shell)
    const side = document.getElementById("review-panel")
    if (column) observer.observe(column)
    if (row) observer.observe(row)
    if (side) observer.observe(side)
    onCleanup(() => observer.disconnect())
  })

  createEffect(() => {
    props.onExpandedChange?.(store.expanded)
  })

  onCleanup(() => props.onExpandedChange?.(false))

  return (
    <div
      ref={props.setPromptDockRef}
      data-component="session-prompt-dock"
      data-variant="codle"
      data-expanded={store.expanded ? "true" : "false"}
      class="shrink-0 w-full pb-4 flex flex-col justify-center items-center pointer-events-none"
    >
      <Show when={store.expanded}>
        <div
          data-component="session-composer-spacer"
          class="w-full px-3 pointer-events-none"
          classList={{
            "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": props.centered,
          }}
          aria-hidden="true"
          style={{
            height: `${store.shellHeight ?? shellMin}px`,
          }}
        />
      </Show>

      <SessionComposerShell
        expanded={store.expanded}
        centered={props.centered}
        anchorLeft={store.anchorLeft}
        anchorBottom={store.anchorBottom}
        shellWidth={store.shellWidth}
        shellRight={store.shellRight}
        shellHeight={store.shellHeight}
        shellMin={shellMin}
        shellRef={(el) => {
          shell = el
        }}
      >
          <div
            classList={{
              "relative flex min-h-0 flex-1 flex-col": store.expanded,
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
              <div
                classList={{
                  "flex min-h-0 flex-1 flex-col": store.expanded,
                }}
              >
              <Show
                when={prompt.ready()}
                fallback={
                  <>
                    <Show when={rolled()} keyed>
                      {(revert) => (
                        <div class="pb-2">
                          <SessionRevertDock
                            items={revert.items}
                            restoring={revert.restoring}
                            disabled={revert.disabled}
                            onRestore={revert.onRestore}
                          />
                        </div>
                      )}
                    </Show>
                    <div class="w-full min-h-32 md:min-h-40 rounded-md border border-border-weak-base bg-background-base/50 px-4 py-3 text-text-weak whitespace-pre-wrap pointer-events-none">
                      {handoffPrompt() || language.t("prompt.loading")}
                    </div>
                  </>
                }
              >
                <Show when={dock()}>
                  <div
                    classList={{
                      "overflow-hidden": true,
                      "pointer-events-none": value() < 0.98,
                      "shrink-0": store.expanded,
                    }}
                    style={
                      store.expanded
                        ? undefined
                        : {
                            "max-height": `${full() * value()}px`,
                          }
                    }
                  >
                    <div ref={(el) => setStore("body", el)}>
                      <SessionTodoDock
                        sessionID={route.params.id}
                        todos={props.state.todos()}
                        collapseLabel={language.t("session.todo.collapse")}
                        expandLabel={language.t("session.todo.expand")}
                        dockProgress={value()}
                      />
                    </div>
                  </div>
                </Show>
                <Show when={rolled()} keyed>
                  {(revert) => (
                    <div
                      classList={{
                        "shrink-0": store.expanded,
                      }}
                      style={
                        store.expanded
                          ? undefined
                          : {
                              "margin-top": `${-36 * value()}px`,
                            }
                      }
                    >
                      <SessionRevertDock
                        items={revert.items}
                        restoring={revert.restoring}
                        disabled={revert.disabled}
                        onRestore={revert.onRestore}
                      />
                    </div>
                  )}
                </Show>
                <div
                  classList={{
                    relative: !store.expanded,
                    "flex min-h-0 flex-1 flex-col": store.expanded,
                  }}
                  style={
                    store.expanded
                      ? undefined
                      : {
                          "margin-top": `${-lift()}px`,
                        }
                  }
                >
                  <Show when={props.followup?.items.length}>
                    <SessionFollowupDock
                      items={props.followup!.items}
                      sending={props.followup!.sending}
                      onSend={props.followup!.onSend}
                      onEdit={props.followup!.onEdit}
                    />
                  </Show>
                  <PromptInput
                    ref={(el) => {
                      input = el
                      props.inputRef(el)
                    }}
                    expanded={store.expanded}
                    onComposerExpand={expand}
                    onComposerCollapse={collapse}
                    composerShell={
                      store.expanded
                        ? {
                            size: store.shellHeight ?? shellMin,
                            min: shellMin,
                            max: shellMax(store.anchorBottom),
                            onResize: resize,
                          }
                        : undefined
                    }
                    newSessionWorktree={props.newSessionWorktree}
                    onNewSessionWorktreeReset={props.onNewSessionWorktreeReset}
                    edit={props.followup?.edit}
                    onEditLoaded={props.followup?.onEditLoaded}
                    followupMode={props.followup?.mode}
                    onQueue={props.followup?.onQueue}
                    onAbort={props.followup?.onAbort}
                    onSubmit={props.onSubmit}
                  />
                </div>
              </Show>
              </div>
            </Show>
          </div>
      </SessionComposerShell>
    </div>
  )
}
