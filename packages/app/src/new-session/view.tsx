import { Tooltip } from "@opencode/ui/tooltip"
import { Icon } from "@opencode/ui/icon"
import { Keybind } from "@opencode/ui/keybind"
import { useCommand } from "@/shell/commands/command"
import { Match, Show, Switch, createComputed, createMemo, createSignal, onCleanup, untrack } from "solid-js"
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
import { createProviderTip, ProviderTip } from "@/providers/connect/tip"
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
import { BaseBranchPicker } from "./workspace/selector"
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

export const WorkspaceOnboardingSchema = Persistence.struct({
  used: Schema.Boolean,
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

  const location = (project?: PromptProject) =>
    props.location({
      project,
      onWorkspace: (value) => {
        if (value !== "main") setOnboarding("used", true)
      },
    })

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
                      workspace={props.workspace}
                      onDone={props.composer.restoreFocus}
                      onboarding={onboardingReady() && !onboarding.used && props.workspace.bar.visible()}
                      onProjects={() => location()}
                      onWorktree={project().id && project().vcs === "git" ? () => location(project()) : undefined}
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
  const sdk = useWorkspaceLocation()
  const tip = createProviderTip(() => sdk().directory)

  return <ProviderTip tip={tip} selection={props.selection} onDone={props.onDone} />
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

function NewSessionLocation(props: {
  project: PromptProject
  workspace: NewSessionWorkspaceController
  onDone: () => void
  onboarding: boolean
  onProjects: () => void
  onWorktree?: () => void
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
      disabled: !props.onWorktree,
      onSelect: props.onWorktree,
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

  const path = () => {
    const selection = props.workspace.selection.value()

    if (selection === "create") return

    return selection === "main" ? props.workspace.project.root() : selection
  }

  createComputed(() =>
    dispatchCheckout({
      type: "checkout.changed",
      directory: path() ?? props.workspace.project.root(),
      loaded: props.workspace.bar.checkout() !== undefined,
    }),
  )

  onCleanup(() => dispatchCheckout({ type: "disposed" }))

  const label = () => {
    const checkout = props.workspace.bar.checkout()

    return checkout && (checkout.branch || language.t("session.location.noBranch"))
  }

  const fitted = createMemo(() => fitPath(path() ?? "", layout.width, layout.font))

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
              onClick={props.onProjects}
            >
              <ProjectAvatar
                class="shrink-0"
                fallback={displayName(props.project)}
                src={getProjectAvatarSource(props.project.id, props.project.icon)}
                variant={getProjectAvatarVariant(props.project.icon?.color)}
                generated={getProjectAvatarGenerated(props.project)}
              />
              <span class="min-w-0 truncate">{displayName(props.project)}</span>
              <Icon name="chevron-down" class="shrink-0 text-v2-icon-icon-muted" />
            </button>
          </Tooltip>
          <Show when={props.onWorktree}>
            {(onWorktree) => (
              <Show
                when={props.workspace.selection.value() !== "create"}
                fallback={<BaseBranchPicker workspace={props.workspace} onDone={props.onDone} />}
              >
                <Tooltip
                  appearance={props.onboarding ? "large" : undefined}
                  placement="top"
                  openDelay={800}
                  value={
                    <div class="flex flex-col gap-1 text-start">
                      <Show when={props.onboarding}>
                        <div class="flex items-center gap-1.5 font-[530] text-v2-text-text-base">
                          <Icon name="outline-worktree" class="shrink-0 text-v2-text-text-accent" />
                          <span>{language.t("workspace.onboarding.title")}</span>
                        </div>
                        <span class="font-[440] text-v2-text-text-muted">
                          {language.t("workspace.onboarding.description")}
                        </span>
                      </Show>
                      <span
                        class="flex items-center justify-between gap-2"
                        classList={{ "font-[440] text-v2-text-text-muted": props.onboarding }}
                      >
                        {language.t("session.location.worktree")}
                        <Show when={command.keybindParts("session.location.select").length}>
                          <Keybind keys={command.keybindParts("session.location.select")} variant="neutral" />
                        </Show>
                      </span>
                    </div>
                  }
                  contentClass={props.onboarding ? "max-w-[280px]" : undefined}
                  class="flex min-w-0 max-w-[220px]"
                >
                  <button
                    type="button"
                    data-action="prompt-worktree"
                    aria-haspopup="dialog"
                    aria-label={label() ?? language.t("session.location.worktree")}
                    aria-busy={selectCheckoutSkeleton(checkoutLabel())}
                    aria-description={language.t("session.location.worktree")}
                    class={`${TRIGGER} min-w-0`}
                    onClick={onWorktree()}
                  >
                    <Icon name="branch" size="normal" class="shrink-0 text-v2-icon-icon-muted" />
                    <Switch>
                      <Match when={label()}>
                        {(label) => (
                          <span dir="auto" class="min-w-0 truncate">
                            {label()}
                          </span>
                        )}
                      </Match>
                      <Match when={selectCheckoutSkeleton(checkoutLabel())}>
                        <span aria-hidden="true" class="h-2 w-12 shrink-0 rounded-full bg-v2-background-bg-layer-02" />
                      </Match>
                    </Switch>
                    <Show when={props.onboarding}>
                      <span
                        data-slot="workspace-onboarding-dot"
                        aria-hidden="true"
                        class="size-1.5 shrink-0 rounded-full bg-v2-text-text-accent"
                      />
                    </Show>
                  </button>
                </Tooltip>
              </Show>
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
