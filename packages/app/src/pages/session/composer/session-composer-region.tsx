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
    // 확대/축소 애니메이션 시작값(접힌 상태 크기). expand() 시점에 측정해 보관한다.
    fromWidth: 0,
    fromHeight: 0,
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

  // 확대/축소 애니메이션(300ms). dialog 의 relative↔fixed / auto↔px 전환은 CSS transition 으로
  // 보간되지 않으므로, 스프링으로 0→1 진행도를 만들어 width/height 를 JS 로 직접 보간한다.
  // 진행 중에는 계속 fixed 로 띄워 두고(floating), 완전히 접혔을 때만 in-flow 로 되돌린다.
  const expandSpring = useSpring(() => (store.expanded ? 1 : 0), { visualDuration: 0.3, bounce: 0 })
  const expandValue = createMemo(() => Math.max(0, Math.min(1, expandSpring())))
  const floating = createMemo(() => store.expanded || expandValue() > 0.001)
  const targetWidth = () => {
    const right = store.shellRight ?? (typeof window === "undefined" ? store.anchorLeft + shellMin : window.innerWidth)
    return Math.max(shellMin, right - store.anchorLeft)
  }
  const targetHeight = () => store.shellHeight ?? shellMin
  const animWidth = createMemo(() => store.fromWidth + (targetWidth() - store.fromWidth) * expandValue())
  const animHeight = createMemo(() => store.fromHeight + (targetHeight() - store.fromHeight) * expandValue())

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

  const expand = (opts?: { initialScale?: number }) => {
    // 질문/권한 요청 독은 확대 레이아웃이 없다 — 이때는 확대하지 않고 접힌 상태로 보여준다.
    if (props.state.blocked()) return
    const box = measure()
    const right = layoutRight(shell)
    // 기억된 확대 높이가 있으면 재사용. 없으면(최초) 현재 높이 × initialScale 에서 시작 —
    // 자동 확대는 2배로 더 크게 열림(수동 확대는 scale 미지정 = 1배).
    const initial = box.height * (opts?.initialScale ?? 1)
    setStore({
      expanded: true,
      // 애니메이션 시작값 = 접힌 상태의 실제 크기. 여기서부터 확대 목표 크기로 보간한다.
      fromWidth: box.width,
      fromHeight: box.height,
      shellHeight: clampShell(store.shellHeight ?? initial, box.bottom),
      anchorLeft: box.left,
      anchorBottom: box.bottom,
      shellRight: right,
      shellWidth: Math.max(shellMin, right - box.left),
    })
  }

  const collapse = () => {
    // shellHeight 는 확대 높이로 기억하기 위해 유지(리셋하지 않음). 접힌 동안엔 높이로 쓰이지 않는다.
    setStore({
      expanded: false,
      shellRight: undefined,
      shellWidth: undefined,
    })
  }

  // 질문/권한 요청이 뜨면(확대 레이아웃이 없으므로) 확대 상태를 접어 접힌 위치에서 보여준다.
  createEffect(() => {
    if (props.state.blocked() && store.expanded) collapse()
  })

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
      <Show when={floating()}>
        <div
          data-component="session-composer-spacer"
          class="w-full px-3 pointer-events-none"
          classList={{
            "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": props.centered,
          }}
          aria-hidden="true"
          style={{
            height: `${animHeight()}px`,
          }}
        />
      </Show>

      <SessionComposerShell
        expanded={floating()}
        centered={props.centered}
        anchorLeft={store.anchorLeft}
        anchorBottom={store.anchorBottom}
        shellWidth={animWidth()}
        shellRight={undefined}
        shellHeight={animHeight()}
        shellMin={shellMin}
        shellRef={(el) => {
          shell = el
        }}
      >
          <div
            classList={{
              "relative flex min-h-0 flex-1 flex-col": floating(),
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
                  "flex min-h-0 flex-1 flex-col": floating(),
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
                      "shrink-0": floating(),
                    }}
                    style={
                      floating()
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
                        "shrink-0": floating(),
                      }}
                      style={
                        floating()
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
                    relative: !floating(),
                    "flex min-h-0 flex-1 flex-col": floating(),
                  }}
                  style={
                    floating()
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
                    expanded={floating()}
                    onComposerExpand={expand}
                    onComposerCollapse={collapse}
                    composerShell={
                      floating()
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
