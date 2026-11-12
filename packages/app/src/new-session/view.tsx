import { useDialog } from "@opencode/ui/context/dialog"
import { Tooltip } from "@opencode/ui/tooltip"
import { Icon } from "@opencode/ui/icon"
import { Keybind } from "@opencode/ui/keybind"
import { useCommand } from "@/shell/commands/command"
import { Show, createComputed, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import {
  displayName,
  getProjectAvatarGenerated,
  getProjectAvatarSource,
  getProjectAvatarVariant,
  ProjectAvatar,
} from "@opencode/ui/project-avatar"
import { Schema } from "effect"
import { createPresence } from "@/runtime/presence"
import { Composer } from "@/composer/composer"
import { ComposerDropzone } from "@/composer/dropzone"
import type { ComposerModel } from "@/composer/model"
import {
  PromptProjectAddButton,
  type PromptProject,
  type PromptProjectController,
} from "@/new-session/project/selector"
import type { useNewSessionLocationDialog } from "@/new-session/location/dialog"
import { useLanguage } from "@/runtime/i18n/language"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useProviders } from "@/providers/catalog/providers"
import { NEW_SESSION_CONTENT_WIDTH } from "@/new-session/layout"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { useSettings } from "@/settings/model"
import type { NewSessionWorkspaceController } from "./workspace/controller"
import {
  CHECKOUT_PLACEHOLDER_DELAY_MS,
  INITIAL_CHECKOUT_LABEL_STATE,
  selectCheckoutSkeleton,
  transitionCheckoutLabel,
  type CheckoutLabelEvent,
} from "./workspace/checkout-machine"
import { NewSessionBranch } from "./workspace/selector"
import { NewSessionBrickBreaker } from "./brick-breaker"
import { NewSessionPinBoard } from "./pin-board"
import { NewSessionWordmark } from "./wordmark"
import {
  createWordmarkState,
  selectBrickBreaker,
  selectPinBoard,
  transitionWordmark,
  type WordmarkEvent,
} from "./wordmark-machine"

const providerTipDismissalDuration = 30 * 24 * 60 * 60 * 1000

export const WorkspaceOnboardingSchema = Persistence.struct({
  used: Schema.Boolean,
})

export const ProviderTipSchema = Persistence.struct({
  dismissedAt: Schema.Finite,
})

export function NewSessionView(props: {
  composer: ComposerModel
  project: PromptProjectController
  workspace: NewSessionWorkspaceController
  location: ReturnType<typeof useNewSessionLocationDialog>
}) {
  const [onboarding, setOnboarding, , onboardingReady] = persisted(
    Persist.global("workspace-onboarding"),
    WorkspaceOnboardingSchema,
    { used: false },
  )

  const settings = useSettings()

  const [wordmark, setWordmark] = createSignal(createWordmarkState(false))
  const [logo, setLogo] = createSignal<HTMLDivElement>()

  const dispatchWordmark = (event: WordmarkEvent) =>
    untrack(() => {
      const next = transitionWordmark(wordmark(), event)
      setWordmark(next.state)

      if (next.effects.some((effect) => effect.type === "focus.composer")) props.composer.restoreFocus()
    })

  const location = (project?: PromptProject, step?: "worktrees" | "branches") =>
    props.location({
      project,
      step,
      // Only a selected base survives into the dialog; otherwise it starts from the drilled project's own branch.
      base: project && props.workspace.selection.value() === "create" ? props.workspace.bar.branch() : undefined,
      onWorkspace: (value) => {
        if (value !== "main") setOnboarding("used", true)
      },
    })

  const onboardingVisible = () => onboardingReady() && !onboarding.used && props.workspace.bar.visible()

  let panel!: HTMLDivElement

  return (
    <div class="@container relative flex flex-col min-h-0 h-full flex-1">
      <div
        ref={panel}
        data-component="new-session"
        class="relative isolate flex-1 min-h-0 overflow-hidden rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]"
      >
        <ComposerDropzone
          active={props.composer.state.drag === "active"}
          input={props.composer.model.selection.current()?.capabilities.input}
        />
        <div class="absolute inset-x-0 top-[25.375%] flex justify-center px-6">
          <div class={NEW_SESSION_CONTENT_WIDTH}>
            <NewSessionWordmark
              ref={setLogo}
              state={wordmark}
              onEvent={dispatchWordmark}
              play
              sound={settings.sounds.interfaceEnabled}
            />
            <div class="mt-8 flex flex-col gap-3">
              <div data-slot="new-session-composer" class="flex flex-col gap-1">
                <div class="relative z-10">
                  <Composer model={props.composer} />
                </div>
                <Show when={props.project.selected()}>
                  {(project) => (
                    <NewSessionLocation
                      project={project()}
                      workspace={props.workspace.bar.visible() ? props.workspace.selection.value() : "main"}
                      root={props.workspace.project.root()}
                      checkout={props.workspace.bar.checkout()}
                      branch={props.workspace.bar.branch()}
                      onboarding={onboardingVisible()}
                      onClick={() => location()}
                      onOpen={
                        project().id && project().vcs === "git" ? () => location(project(), "worktrees") : undefined
                      }
                      onBase={
                        project().id && project().vcs === "git" ? () => location(project(), "branches") : undefined
                      }
                    />
                  )}
                </Show>
              </div>
              <Show when={props.project.empty()}>
                <PromptProjectAddButton controller={props.project} />
              </Show>
            </div>
          </div>
        </div>
        <Show when={selectPinBoard(wordmark(), logo())}>
          {(board) => (
            <NewSessionPinBoard
              logo={board().logo}
              sound={settings.sounds.interfaceEnabled}
              entrance={board().entrance}
              closing={board().closing}
              ref={(handle) => dispatchWordmark({ type: "board.mounted", board: handle })}
            />
          )}
        </Show>
        <Show when={selectBrickBreaker(wordmark())}>
          {(game) => (
            <NewSessionBrickBreaker
              panel={panel}
              board={game().board}
              ball={game().ball}
              sound={settings.sounds.interfaceEnabled}
              onDone={() => dispatchWordmark({ type: "game.done" })}
            />
          )}
        </Show>
        <NewSessionTips selection={props.composer.model.selection} onDone={props.composer.restoreFocus} />
      </div>
    </div>
  )
}

function NewSessionTips(props: { selection: ComposerModel["model"]["selection"]; onDone: () => void }) {
  const language = useLanguage()
  const dialog = useDialog()
  const sdk = useWorkspaceLocation()
  const providers = useProviders(() => sdk().directory)

  const [providerState, setProviderState, , providerReady] = persisted(
    Persist.global("new-session.provider-tip"),
    ProviderTipSchema,
    { dismissedAt: 0 },
  )

  const providerVisible = createMemo(
    () =>
      providerReady() &&
      providers.anyConnection() === false &&
      Date.now() - providerState.dismissedAt >= providerTipDismissalDuration,
  )

  const tip = providerVisible
  const [ref, setRef] = createSignal<HTMLDivElement>()

  const presence = createPresence({
    show: tip,
    element: () => ref() ?? null,
  })

  const open = () => {
    if (!tip()) return

    void import("@/providers/connect/dialog").then(({ DialogConnectProvider }) => {
      void dialog.show(() => (
        <DialogConnectProvider directory={sdk().directory} selection={props.selection} onDone={props.onDone} />
      ))
    })
  }

  const dismiss = () => {
    if (!tip()) return

    setProviderState("dismissedAt", Date.now())
  }

  return (
    <Show when={presence.present()}>
      <div class="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-10">
        <div
          ref={setRef}
          data-component="new-session-tip"
          data-visible={tip()}
          class="group/new-session-tip pointer-events-auto relative flex h-6 max-w-full items-center transition-[opacity,transform] duration-[250ms] ease-[cubic-bezier(0.215,0.61,0.355,1)] motion-reduce:transition-none"
          classList={{ "data-[visible=false]:animate-out fade-out slide-out-to-bottom-4": true }}
        >
          <button
            type="button"
            class="flex h-6 min-w-0 items-center rounded-[4px] pl-1.5 text-[13px] leading-text-compact tracking-[-0.04px] text-v2-text-text-faint transition-[background-color,color] duration-150 ease-in-out hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-muted focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-text-text-muted focus-visible:outline-none"
            onClick={open}
          >
            <span class="truncate">{language.t("home.providerTip")}</span>
            <span class="flex size-6 shrink-0 items-center justify-center" aria-hidden="true">
              <Icon name="chevron-down" size="small" class="-rotate-90" />
            </span>
          </button>
          <Tooltip
            class="hover-reveal absolute left-full top-0 flex h-6 w-7 items-center justify-end delay-0 duration-0 group-hover/new-session-tip:delay-[250ms] group-hover/new-session-tip:duration-150 group-hover/new-session-tip:opacity-100 focus-within:delay-0 focus-within:duration-0 focus-within:opacity-100"
            placement="top"
            openDelay={800}
            value={language.t("common.dismiss")}
          >
            <button
              type="button"
              class="flex size-6 items-center justify-center rounded-[4px] text-v2-icon-icon-muted transition-[background-color,color] duration-150 ease-in-out hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-icon-icon-base focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-icon-icon-base focus-visible:outline-none"
              aria-label={language.t("common.dismiss")}
              onClick={dismiss}
            >
              <Icon name="xmark-small" />
            </button>
          </Tooltip>
        </div>
      </div>
    </Show>
  )
}

// Keeps as many leading segments as fit, then "…/", then the last two segments. The cut always lands on a slash.
function fitPath(value: string, width: number, font: string) {
  const separator = value.includes("/") ? "/" : "\\"
  const parts = value.split(separator)
  const context = document.createElement("canvas").getContext("2d")

  if (!context) return { text: value, minimum: 0 }
  context.font = font
  const fits = (text: string) => context.measureText(text).width <= width
  const first = parts[0] === "" ? 2 : 1

  const candidates = Array.from({ length: Math.max(0, parts.length - 2 - first) }, (_, index) =>
    [...parts.slice(0, parts.length - 3 - index), "…", ...parts.slice(-2)].join(separator),
  )

  const minimum = candidates.at(-1) ?? value

  return {
    text: !width || fits(value) ? value : (candidates.find(fits) ?? minimum),
    minimum: context.measureText(minimum).width,
  }
}

const TRIGGER =
  "flex h-7 items-center gap-1.5 rounded-sm text-start ps-1.5 pe-2 text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-text-text-base focus-visible:outline-none"

/** The composer tray: the project picker, the checkout branch, and the session's directory. */
function NewSessionLocation(props: {
  project: PromptProject
  /** "main", "create", or a worktree directory. */
  workspace: string
  root: string
  /** Missing while the main checkout's Git info loads. */
  checkout?: { branch?: string }
  branch?: string
  onboarding: boolean
  onClick: () => void
  /** Opens the project's worktree step; without it the project has no worktrees to choose. */
  onOpen?: () => void
  /** Opens the project's base-branch step; without it the project has no branches to choose. */
  onBase?: () => void
}) {
  const language = useLanguage()
  const command = useCommand()
  const [layout, setLayout] = createStore({ width: 0, font: "" })

  command.register("new-session-worktree", () => [
    {
      id: "session.location.select",
      title: language.t("session.location.worktree"),
      category: language.t("command.category.workspace"),
      keybind: "mod+alt+o",
      disabled: !props.onOpen,
      onSelect: props.onOpen,
    },
    {
      id: "session.branch.choose",
      title: language.t("command.session.branch.choose"),
      category: language.t("command.category.workspace"),
      keybind: "mod+alt+b",
      disabled: !props.onBase,
      onSelect: props.onBase,
    },
  ])

  const [checkoutLabel, setCheckoutLabel] = createSignal(INITIAL_CHECKOUT_LABEL_STATE)

  const timers = new Map<number, ReturnType<typeof setTimeout>>()

  const dispatchCheckout = (event: CheckoutLabelEvent) =>
    untrack(() => {
      const next = transitionCheckoutLabel(checkoutLabel(), event)
      setCheckoutLabel(next.state)
      next.effects.forEach((effect) => {
        if (effect.type === "delay.stop") {
          clearTimeout(timers.get(effect.attempt))
          timers.delete(effect.attempt)

          return
        }

        timers.set(
          effect.attempt,
          setTimeout(
            () => dispatchCheckout({ type: "delay.elapsed", attempt: effect.attempt }),
            CHECKOUT_PLACEHOLDER_DELAY_MS,
          ),
        )
      })
    })

  createComputed(() =>
    dispatchCheckout({ type: "checkout.changed", directory: props.root, loaded: props.checkout !== undefined }),
  )

  onCleanup(() => dispatchCheckout({ type: "disposed" }))

  // The checkout placeholder only covers a branch that is still loading; a loaded checkout without one says "No branch".
  const branchLoading = () => !props.branch && selectCheckoutSkeleton(checkoutLabel())

  const path = () => (props.workspace === "main" || props.workspace === "create" ? props.root : props.workspace)

  const fitted = createMemo(() => fitPath(path(), layout.width, layout.font))

  return (
    <div class="relative flex min-h-9 min-w-0 items-center gap-3 ps-2 pe-1.5 text-[13px] font-[440] leading-[var(--line-height-compact)] tracking-[-0.04px]">
      <div class="flex min-w-0 max-w-full flex-wrap items-center gap-x-0 gap-y-1 py-1.5">
        <div class="flex min-w-0 max-w-full items-center">
          <Tooltip
            placement="top"
            openDelay={800}
            value={
              <span class="flex items-center gap-2">
                {language.t("session.new.project.trigger.tooltip")}
                <Show when={command.keybindParts("project.select").length}>
                  <Keybind keys={command.keybindParts("project.select")} variant="neutral" />
                </Show>
              </span>
            }
            class="flex min-w-0"
          >
            <button
              type="button"
              data-action="prompt-project"
              aria-haspopup="dialog"
              aria-description={language.t("session.new.project.trigger.tooltip")}
              class={`${TRIGGER} min-w-0`}
              onClick={props.onClick}
            >
              <ProjectAvatar
                class="shrink-0"
                fallback={displayName(props.project)}
                src={getProjectAvatarSource(props.project.id, props.project.icon)}
                variant={getProjectAvatarVariant(props.project.icon?.color)}
                generated={getProjectAvatarGenerated(props.project)}
              />
              <span class="min-w-0 truncate">{displayName(props.project)}</span>
            </button>
          </Tooltip>
          <Show when={props.onOpen}>
            {(onOpen) => (
              <NewSessionBranch
                branch={props.branch}
                loading={branchLoading()}
                onboarding={props.onboarding}
                onOpen={onOpen()}
              />
            )}
          </Show>
        </div>
      </div>
      {/* An open tooltip can outlive this row; keep its path instead of a stale Show accessor. */}
      <Show when={path()} keyed>
        {(directory) => (
          <div
            class="flex min-w-0 flex-1 justify-end pe-1.5 @max-[560px]:hidden"
            style={{ "min-width": `min(50%, ${Math.ceil(fitted().minimum) + 6}px)` }}
          >
            <Tooltip
              placement="top"
              value={directory}
              disabled={fitted().text === directory && fitted().minimum <= layout.width}
              class="flex min-w-0 flex-1"
              contentClass="max-w-[calc(100vw-32px)] break-all"
            >
              <span
                ref={(row) =>
                  createResizeObserver(row, () =>
                    setLayout({
                      width: row.clientWidth,
                      font: getComputedStyle(row).font,
                    }),
                  )
                }
                class="flex min-w-0 flex-1 items-center justify-end"
                dir="ltr"
              >
                <span
                  data-slot="new-session-location-path"
                  class="min-w-0 cursor-text select-text overflow-hidden whitespace-nowrap text-v2-text-text-faint [direction:rtl] [text-align:end]"
                  onCopy={(event) => {
                    if (!event.clipboardData || window.getSelection()?.toString() !== fitted().text) return
                    event.clipboardData.setData("text/plain", directory)
                    event.preventDefault()
                  }}
                >
                  <bdi dir="ltr">{fitted().text}</bdi>
                </span>
              </span>
            </Tooltip>
          </div>
        )}
      </Show>
    </div>
  )
}
