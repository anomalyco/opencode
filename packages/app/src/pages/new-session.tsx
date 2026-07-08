import { Show, createEffect, createMemo, createResource, onCleanup, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import { useSearchParams } from "@solidjs/router"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { NewSessionDesignView } from "@/components/session"
import { PromptInput } from "@/components/prompt-input"
import { StatusPopoverV2 } from "@/components/status-popover"
import {
  PromptProjectAddButton,
  PromptProjectSelector,
  createPromptProjectController,
} from "@/components/prompt-project-selector"
import { useComments } from "@/context/comments"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useServerSync } from "@/context/server-sync"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { createPromptInputController, createPromptProjectControls } from "@/pages/session/composer"
import { useSessionKey } from "@/pages/session/session-layout"
import { useComposerCommands } from "@/pages/session/use-composer-commands"
import { NEW_SESSION_CONTENT_WIDTH } from "@/pages/session/new-session-layout"
import { PromptWorkspaceSelector } from "@/components/prompt-workspace-selector"
import { useTitlebarRightMount } from "@/components/titlebar"
import { useProviders } from "@/hooks/use-providers"
import { useSettingsDialog } from "@/components/settings-dialog"
import { Persist, persisted } from "@/utils/persist"

const workspaceBarEnabled = import.meta.env.VITE_OPENCODE_CHANNEL !== "prod"
const providerTipDismissalDuration = 30 * 24 * 60 * 60 * 1000
const providerTipExitDuration = 250

/**
 * The `/new-session` draft page. Unlike `session.tsx`, this only renders the prompt
 * composer for a brand-new session — no terminal, review pane, file tree, or message
 * timeline. Submitting promotes the draft into a real session (see prompt-input/submit).
 */
export default function NewSessionPage() {
  const prompt = usePrompt()
  const sdk = useSDK()
  const sync = useSync()
  const serverSync = useServerSync()
  const comments = useComments()
  const language = useLanguage()
  const settings = useSettings()
  const providers = useProviders(() => sdk().directory)
  const openProviderSettings = useSettingsDialog("providers")
  const route = useSessionKey()
  const [searchParams, setSearchParams] = useSearchParams<{ draftId?: string; prompt?: string }>()

  useComposerCommands()

  let inputRef: HTMLDivElement | undefined

  const inputController = createPromptInputController({
    sessionKey: route.sessionKey,
    sessionID: () => route.params.id,
    queryOptions: serverSync().queryOptions,
  })
  const projectControls = createPromptProjectControls()
  const projectController = createPromptProjectController({
    controls: projectControls,
    onDone: () => inputRef?.focus(),
  })

  const [store, setStore] = createStore<{ worktree?: string }>({})
  const rightMount = useTitlebarRightMount()

  const showWorkspaceBar = createMemo(() => workspaceBarEnabled && sync().project?.vcs === "git")
  const newSessionWorktree = createMemo(() => {
    if (!showWorkspaceBar()) return "main"
    if (store.worktree) return store.worktree
    const project = sync().project
    if (project && sdk().directory !== project.worktree) return sdk().directory
    return "main"
  })
  const projectRoot = createMemo(() => sync().project?.worktree ?? sdk().directory)
  const localBranch = createMemo(() => serverSync().child(projectRoot())[0].vcs?.branch)
  const selectedBranch = createMemo(() => {
    const worktree = newSessionWorktree()
    if (worktree === "main" || worktree === "create") return localBranch()
    return serverSync().child(worktree)[0].vcs?.branch ?? localBranch()
  })

  createEffect(() => {
    if (!prompt.ready()) return
    untrack(() => {
      const text = searchParams.prompt
      if (!text) return
      prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
      setSearchParams({ ...searchParams, prompt: undefined })
    })
  })

  createEffect(() => {
    if (!prompt.ready()) return
    requestAnimationFrame(() => inputRef?.focus())
  })
  const ready = Promise.resolve()
  const [promptReady] = createResource(
    () => prompt.ready.promise ?? ready,
    (promise) => promise.then(() => true),
  )

  return (
    <div class="relative size-full overflow-hidden flex flex-col">
      <Show when={rightMount()}>
        {(mount) => (
          <Portal mount={mount()}>
            <Show when={settings.visibility.status()}>
              <Tooltip placement="bottom" value={language.t("status.popover.trigger")}>
                <StatusPopoverV2 />
              </Tooltip>
            </Show>
          </Portal>
        )}
      </Show>
      <div class="flex-1 min-h-0 flex flex-col gap-2 p-2">
        <div class="@container relative flex flex-col min-h-0 h-full flex-1">
          <div class="flex-1 min-h-0 overflow-hidden rounded-[10px]">
            <NewSessionDesignView
              footer={
                <ProviderTip
                  ready={() => serverSync().child(sdk().directory)[0].provider_ready}
                  connected={() => providers.paid().length > 0}
                  openProviders={openProviderSettings}
                />
              }
            >
              <div class={NEW_SESSION_CONTENT_WIDTH}>
                <Show
                  when={prompt.ready() || promptReady()}
                  fallback={
                    <div class="w-full min-h-32 md:min-h-40 rounded-md border border-border-weak-base bg-background-base/50 px-4 py-3 text-text-weak pointer-events-none">
                      {language.t("prompt.loading")}
                    </div>
                  }
                >
                  <div class="flex flex-col" classList={{ "gap-8": showWorkspaceBar(), "gap-3": !showWorkspaceBar() }}>
                    <PromptInput
                      controls={inputController()}
                      variant="new-session"
                      ref={(el) => {
                        inputRef = el
                      }}
                      newSessionWorktree={newSessionWorktree()}
                      onNewSessionWorktreeReset={() => setStore("worktree", undefined)}
                      onSubmit={() => comments.clear()}
                      toolbar={
                        <Show when={!projectController.selected()}>
                          <PromptProjectAddButton controller={projectController} />
                        </Show>
                      }
                    />
                    <Show when={projectController.selected()}>
                      <div
                        class="flex min-h-7 min-w-0 items-center gap-0 text-v2-text-text-faint"
                        classList={{
                          "flex-col justify-center sm:flex-row": showWorkspaceBar(),
                          "justify-start": !showWorkspaceBar(),
                        }}
                      >
                        <PromptProjectSelector
                          controller={projectController}
                          placement={showWorkspaceBar() ? "bottom" : "bottom-start"}
                        />
                        <Show when={showWorkspaceBar()}>
                          <PromptWorkspaceSelector
                            value={newSessionWorktree()}
                            projectRoot={projectRoot()}
                            workspaces={sync().project?.sandboxes ?? []}
                            branch={selectedBranch()}
                            onChange={(value) =>
                              setStore(
                                "worktree",
                                value === "main" && sync().project?.worktree !== sdk().directory
                                  ? sync().project?.worktree
                                  : value,
                              )
                            }
                            onDone={() => inputRef?.focus()}
                          />
                        </Show>
                      </div>
                    </Show>
                  </div>
                </Show>
              </div>
            </NewSessionDesignView>
          </div>
        </div>
      </div>
    </div>
  )
}

function ProviderTip(props: { ready: () => boolean; connected: () => boolean; openProviders: () => void }) {
  const language = useLanguage()
  const [persistedState, setPersistedState, , persistedReady] = persisted(
    Persist.global("new-session.provider-tip"),
    createStore({ dismissedAt: 0 }),
  )
  const [state, setState] = createStore({ dismissing: false, now: Date.now() })
  let dismissTimer: ReturnType<typeof setTimeout> | undefined
  const visible = createMemo(
    () =>
      state.dismissing ||
      (props.ready() &&
        persistedReady() &&
        !props.connected() &&
        state.now - persistedState.dismissedAt >= providerTipDismissalDuration),
  )

  createEffect(() => {
    if (!persistedReady()) return
    const remaining = persistedState.dismissedAt + providerTipDismissalDuration - state.now
    if (remaining <= 0) return
    const timer = setTimeout(() => setState("now", Date.now()), Math.min(remaining, 2_147_483_647))
    onCleanup(() => clearTimeout(timer))
  })

  onCleanup(() => {
    if (dismissTimer) clearTimeout(dismissTimer)
  })

  function dismiss() {
    if (state.dismissing) return
    const dismissedAt = Date.now()
    setState("dismissing", true)
    setState("now", dismissedAt)
    setPersistedState("dismissedAt", dismissedAt)
    dismissTimer = setTimeout(completeDismissal, providerTipExitDuration + 50)
  }

  function completeDismissal() {
    if (!state.dismissing) return
    if (dismissTimer) clearTimeout(dismissTimer)
    dismissTimer = undefined
    setState("dismissing", false)
  }

  return (
    <Show when={visible()}>
      <div class="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-10">
        <div
          data-component="provider-tip"
          class="group/provider-tip pointer-events-auto relative flex h-6 max-w-full items-center transition-[opacity,transform] duration-[250ms] ease-[cubic-bezier(0.215,0.61,0.355,1)] motion-reduce:transition-none"
          classList={{
            "opacity-0 [transform:translate3d(0,24px,0)] will-change-[transform,opacity]": state.dismissing,
          }}
          onTransitionEnd={(event) => {
            if (event.target === event.currentTarget && event.propertyName === "transform") completeDismissal()
          }}
        >
          <button
            type="button"
            class="flex h-6 min-w-0 items-center rounded-[4px] pl-1.5 text-[13px] leading-none tracking-[-0.04px] text-v2-text-text-faint transition-[background-color,color] duration-150 ease-in-out hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-muted focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-text-text-muted focus-visible:outline-none"
            disabled={state.dismissing}
            onClick={props.openProviders}
          >
            <span class="truncate">{language.t("home.providerTip")}</span>
            <span class="flex size-6 shrink-0 items-center justify-center" aria-hidden="true">
              <IconV2 name="chevron-down" size="small" class="-rotate-90" />
            </span>
          </button>
          <Show when={!state.dismissing}>
            <TooltipV2
              class="hover-reveal absolute left-full top-0 flex h-6 w-7 items-center justify-end delay-0 duration-0 group-hover/provider-tip:delay-[250ms] group-hover/provider-tip:duration-150 group-hover/provider-tip:opacity-100 focus-within:delay-0 focus-within:duration-0 focus-within:opacity-100"
              placement="top"
              openDelay={1000}
              value={language.t("common.dismiss")}
            >
              <button
                type="button"
                class="flex size-6 items-center justify-center rounded-[4px] text-v2-icon-icon-muted transition-[background-color,color] duration-150 ease-in-out hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-icon-icon-base focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-icon-icon-base focus-visible:outline-none"
                aria-label={language.t("common.dismiss")}
                onClick={dismiss}
              >
                <IconV2 name="xmark-small" />
              </button>
            </TooltipV2>
          </Show>
        </div>
      </div>
    </Show>
  )
}
