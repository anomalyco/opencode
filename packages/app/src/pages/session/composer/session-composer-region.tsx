import { For, Show, createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { useSpring } from "@opencode-ai/ui/motion-spring"
import { PromptInput } from "@/components/prompt-input"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { getSessionHandoff, setSessionHandoff } from "@/pages/session/handoff"
import { useSessionKey } from "@/pages/session/session-layout"
import { SessionPermissionDock } from "@/pages/session/composer/session-permission-dock"
import { SessionQuestionDock } from "@/pages/session/composer/session-question-dock"
import { SessionSkippedQuestionsDialog } from "@/pages/session/composer/session-skipped-questions-dialog"
import { SessionFollowupDock } from "@/pages/session/composer/session-followup-dock"
import { SessionRevertDock } from "@/pages/session/composer/session-revert-dock"
import type { SessionComposerState } from "@/pages/session/composer/session-composer-state"
import { SessionTodoDock } from "@/pages/session/composer/session-todo-dock"
import type { FollowupDraft } from "@/components/prompt-input/submit"
import type { SessionChildAgentEntry } from "@/pages/session/session-child-agents"

function formatChildAgentTime(value: number, locale: string): string | undefined {
  if (!Number.isFinite(value) || value <= 0) return
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

function SessionChildAgentMenu(props: {
  entries: SessionChildAgentEntry[]
  onOpen: (entry: SessionChildAgentEntry) => void
}) {
  const language = useLanguage()
  const title = (entry: SessionChildAgentEntry): string => {
    const cleaned = entry.title.replace(/\s+\(@[^)]*\s+subagent\)$/i, "").trim()
    return cleaned || entry.title
  }
  const agent = (entry: SessionChildAgentEntry): string | undefined => {
    const value = entry.agent?.replace(/^@/, "").split(/\s+-\s+/)[0]?.trim()
    return value ? `@${value}` : undefined
  }
  const status = (entry: SessionChildAgentEntry): string | undefined => entry.usage ?? entry.status
  const statusClass = (value: string): string => {
    if (value === "completed") return "text-icon-success-base"
    if (value === "not used") return "text-icon-warning-base"
    if (value === "running") return "text-text-weak"
    return "text-icon-critical-base"
  }

  return (
    <Show when={props.entries.length > 0}>
      <DropdownMenu gutter={6} placement="top-start">
        <DropdownMenu.Trigger
          as={Button}
          variant="ghost"
          size="small"
          icon="branch"
          class="h-7 rounded-md px-2 text-text-weak hover:text-text-strong data-[expanded]:bg-surface-base-active"
          aria-label={language.t("session.childAgents.open")}
          data-testid="session-child-agent-menu-trigger"
        >
          <span>{language.t("session.childAgents.button", { count: props.entries.length })}</span>
          <Icon name="chevron-down" size="small" class="text-icon-weak" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="w-[340px] max-w-[calc(100vw-32px)]">
            <DropdownMenu.Group>
              <DropdownMenu.GroupLabel class="text-11-medium uppercase tracking-[0.08em] text-text-weak">
                {language.t("session.childAgents.menuLabel")}
              </DropdownMenu.GroupLabel>
              <For each={props.entries}>
                {(entry) => {
                  const itemAgent = () => agent(entry)
                  const itemStatus = () => status(entry)
                  const itemTime = () => formatChildAgentTime(entry.created, language.intl())
                  const hasPrefix = () => itemAgent() !== undefined || itemStatus() !== undefined

                  return (
                    <DropdownMenu.Item
                      class="min-w-0"
                      onSelect={() => props.onOpen(entry)}
                      data-testid="session-child-agent-menu-item"
                    >
                      <div class="min-w-0 flex flex-col gap-0.5">
                        <DropdownMenu.ItemLabel class="truncate text-13-medium text-text-strong">
                          {title(entry)}
                        </DropdownMenu.ItemLabel>
                        <DropdownMenu.ItemDescription class="truncate text-11-regular text-text-weak">
                          <Show when={itemAgent()}>
                            {(value) => <span>{value()}</span>}
                          </Show>
                          <Show when={itemStatus()}>
                            {(value) => (
                              <>
                                <Show when={itemAgent()}>
                                  <span> - </span>
                                </Show>
                                <span class={`font-medium ${statusClass(value())}`}>{value()}</span>
                              </>
                            )}
                          </Show>
                          <Show when={itemTime()}>
                            {(time) => (
                              <>
                                <Show when={hasPrefix()}>
                                  <span> - </span>
                                </Show>
                                <span>{time()}</span>
                              </>
                            )}
                          </Show>
                        </DropdownMenu.ItemDescription>
                      </div>
                    </DropdownMenu.Item>
                  )
                }}
              </For>
            </DropdownMenu.Group>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </Show>
  )
}

export function SessionComposerRegion(props: {
  state: SessionComposerState
  ready: boolean
  centered: boolean
  inputRef: (el: HTMLDivElement) => void
  newSessionWorktree: string
  onNewSessionWorktreeReset: () => void
  onSubmit: () => void
  onSubmitted?: () => void
  onResponseSubmit: () => void
  followup?: {
    queue: () => boolean
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
  childAgents?: SessionChildAgentEntry[]
  onOpenChildAgent?: (entry: SessionChildAgentEntry) => void
  setPromptDockRef: (el: HTMLDivElement) => void
}) {
  const prompt = usePrompt()
  const language = useLanguage()
  const dialog = useDialog()
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
  const skippedQuestionCount = createMemo(() => props.state.skippedQuestionRequests().length)
  const childAgentMenu = createMemo(() => {
    const onOpen = props.onOpenChildAgent
    if (!onOpen) return
    return { entries: props.childAgents ?? [], onOpen }
  })
  const showPromptToolbar = createMemo(
    () => (childAgentMenu()?.entries.length ?? 0) > 0 || skippedQuestionCount() > 0,
  )

  const openSkippedQuestions = () => {
    dialog.show(() => (
      <SessionSkippedQuestionsDialog
        requests={props.state.skippedQuestionRequests}
        invalidation={props.state.skippedQuestionInvalidation}
        sessionEnded={props.state.skippedQuestionSessionEnded}
        onClear={props.state.clearSkippedQuestions}
      />
    ))
  }

  createEffect(() => {
    const el = store.body
    if (!el) return
    let raf: number | undefined
    const update = () => {
      if (raf !== undefined) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        raf = undefined
        setStore("height", el.getBoundingClientRect().height)
      })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    onCleanup(() => {
      observer.disconnect()
      if (raf === undefined) return
      cancelAnimationFrame(raf)
    })
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
            <Show when={showPromptToolbar()}>
              <div class="mb-2 flex items-center gap-2">
                <div class="min-w-0 flex-1">
                  <Show when={childAgentMenu()} keyed>
                    {(menu) => <SessionChildAgentMenu entries={menu.entries} onOpen={menu.onOpen} />}
                  </Show>
                </div>
                <Show when={skippedQuestionCount() > 0}>
                  <Button
                    variant="ghost"
                    size="small"
                    class="h-7 shrink-0 rounded-md px-2 text-text-weak hover:text-text-strong"
                    onClick={openSkippedQuestions}
                  >
                    {language.t(
                      props.state.skippedQuestionSessionEnded()
                        ? "session.question.skipped.ended.button"
                        : "session.question.skipped.button",
                      { count: skippedQuestionCount() },
                    )}
                  </Button>
                </Show>
              </div>
            </Show>
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
                  style={{
                    "margin-top": `${-36 * value()}px`,
                  }}
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
                "relative z-10": true,
              }}
              style={{
                "margin-top": `${-lift()}px`,
              }}
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
                ref={props.inputRef}
                newSessionWorktree={props.newSessionWorktree}
                onNewSessionWorktreeReset={props.onNewSessionWorktreeReset}
                edit={props.followup?.edit}
                onEditLoaded={props.followup?.onEditLoaded}
                shouldQueue={props.followup?.queue}
                onQueue={props.followup?.onQueue}
                onAbort={props.followup?.onAbort}
                onSubmit={props.onSubmit}
                onSubmitted={props.onSubmitted}
              />
            </div>
          </Show>
        </Show>
      </div>
    </div>
  )
}
