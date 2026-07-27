import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { Show, createEffect, createMemo, createResource, createSignal, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import createPresence from "solid-presence"
import { NewSessionDesignView } from "@/components/session"
import { PromptGitStatus, PromptWorkspaceSelector } from "@/components/prompt-workspace-selector"
import type { PromptProject } from "@/components/prompt-project-selector"
import { StatusPopoverV2 } from "@/components/status-popover"
import { useLanguage } from "@/context/language"
import { NEW_SESSION_CONTENT_WIDTH } from "@/pages/session/new-session-layout"
import { Persist, persisted } from "@/utils/persist"

const providerTipDismissalDuration = 30 * 24 * 60 * 60 * 1000

export function NewSessionView(props: {
  rightMount: Accessor<HTMLElement | null>
  statusVisible: Accessor<boolean>
  statusLabel: Accessor<string>
  promptReady: Accessor<boolean>
  promptReadyPromise: Accessor<Promise<unknown> | undefined>
  restoreFocus: () => void
  composer: () => JSX.Element
  projectEmpty: Accessor<boolean>
  projectSelected: Accessor<PromptProject | undefined>
  projectAdd: () => JSX.Element
  projectSelector: () => JSX.Element
  workspaceVisible: Accessor<boolean>
  workspaceValue: Accessor<string>
  workspaceRoot: Accessor<string>
  workspaces: Accessor<string[]>
  branch: Accessor<string | undefined>
  noGit: Accessor<boolean>
  onWorkspaceChange: (value: string) => void
  providerReady: Accessor<boolean>
  providerConnected: Accessor<boolean>
  onOpenProviders: () => void
}) {
  createEffect(() => {
    if (!props.promptReady()) return
    props.restoreFocus()
  })

  const ready = Promise.resolve()
  const [suspendUntilPromptReady] = createResource(
    () => props.promptReadyPromise() ?? ready,
    (promise) => promise.then(() => true),
  )

  return (
    <div class="relative size-full overflow-hidden flex flex-col">
      {suspendUntilPromptReady()}
      <Show when={props.rightMount()}>
        {(mount) => (
          <Portal mount={mount()}>
            <Show when={props.statusVisible()}>
              <Tooltip placement="bottom" value={props.statusLabel()}>
                <StatusPopoverV2 />
              </Tooltip>
            </Show>
          </Portal>
        )}
      </Show>
      <div class="flex-1 min-h-0 flex flex-col gap-2 p-2">
        <div class="@container relative flex flex-col min-h-0 h-full flex-1">
          <div class="flex-1 min-h-0 overflow-hidden rounded-[10px]">
            <NewSessionDesignView>
              <div class={NEW_SESSION_CONTENT_WIDTH}>
                <div class="flex flex-col gap-8">
                  {props.composer()}
                  <Show when={props.projectEmpty()}>{props.projectAdd()}</Show>
                  <Show when={props.projectSelected()}>
                    <div class="flex min-h-7 min-w-0 flex-col items-center justify-center gap-0 text-v2-text-text-faint sm:flex-row">
                      {props.projectSelector()}
                      <Show
                        when={props.workspaceVisible()}
                        fallback={<PromptGitStatus branch={props.branch()} noGit={props.noGit()} />}
                      >
                        <PromptWorkspaceSelector
                          value={props.workspaceValue()}
                          projectRoot={props.workspaceRoot()}
                          workspaces={props.workspaces()}
                          branch={props.branch()}
                          onChange={props.onWorkspaceChange}
                          onDone={props.restoreFocus}
                        />
                      </Show>
                    </div>
                  </Show>
                </div>
              </div>
            </NewSessionDesignView>
            <ProviderTip
              ready={props.providerReady}
              connected={props.providerConnected}
              openProviders={props.onOpenProviders}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function ProviderTip(props: { ready: Accessor<boolean>; connected: Accessor<boolean>; openProviders: () => void }) {
  const language = useLanguage()
  const [persistedState, setPersistedState, , persistedReady] = persisted(
    Persist.global("new-session.provider-tip"),
    createStore({ dismissedAt: 0 }),
  )
  const visible = createMemo(
    () =>
      props.ready() &&
      persistedReady() &&
      !props.connected() &&
      Date.now() - persistedState.dismissedAt >= providerTipDismissalDuration,
  )
  const [ref, setRef] = createSignal<HTMLDivElement>()
  const presence = createPresence({
    show: visible,
    element: () => ref() ?? null,
  })

  return (
    <Show when={presence.present()}>
      <div class="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-10">
        <div
          ref={setRef}
          data-component="provider-tip"
          data-visible={visible()}
          class="group/provider-tip pointer-events-auto relative flex h-6 max-w-full items-center transition-[opacity,transform] duration-[250ms] ease-[cubic-bezier(0.215,0.61,0.355,1)] motion-reduce:transition-none"
          classList={{ "data-[visible=false]:animate-out fade-out slide-out-to-bottom-4": true }}
        >
          <button
            type="button"
            class="flex h-6 min-w-0 items-center rounded-[4px] pl-1.5 text-[13px] leading-none tracking-[-0.04px] text-v2-text-text-faint transition-[background-color,color] duration-150 ease-in-out hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-muted focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-text-text-muted focus-visible:outline-none"
            onClick={props.openProviders}
          >
            <span class="truncate">{language.t("home.providerTip")}</span>
            <span class="flex size-6 shrink-0 items-center justify-center" aria-hidden="true">
              <IconV2 name="chevron-down" size="small" class="-rotate-90" />
            </span>
          </button>
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
              onClick={() => setPersistedState("dismissedAt", Date.now())}
            >
              <IconV2 name="xmark-small" />
            </button>
          </TooltipV2>
        </div>
      </div>
    </Show>
  )
}
