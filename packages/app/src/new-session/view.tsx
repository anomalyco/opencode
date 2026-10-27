import { useDialog } from "@opencode/ui/context/dialog"
import { Tooltip } from "@opencode/ui/tooltip"
import { Icon } from "@opencode/ui/icon"
import { Slash } from "@opencode/ui/slash"
import { Keybind } from "@opencode/ui/keybind"
import { useCommand } from "@/shell/commands/command"
import { Show, createMemo, createSignal, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { getFilename } from "@opencode/util/path"
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
import { NewSessionBranch } from "./workspace/selector"
import { NewSessionBrickBreaker } from "./brick-breaker"
import { NewSessionPinBoard, type PinBoardHandle } from "./pin-board"
import { NewSessionWordmark, type LodgerBall } from "./wordmark"

const providerTipDismissalDuration = 30 * 24 * 60 * 60 * 1000

export const WorkspaceOnboardingSchema = Persistence.struct({
  used: Schema.Boolean,
})

export const ProviderTipSchema = Persistence.struct({
  dismissedAt: Schema.Finite,
})

type WordmarkState = {
  box?: HTMLDivElement
  mode: "flat" | "open" | "closing"
  game: boolean
}

type BrickBreakerHandles = {
  board?: PinBoardHandle
  ball?: LodgerBall
}

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

  const [wordmark, setWordmark] = createStore<WordmarkState>({ mode: "flat", game: false })

  // Imperative handles for the brick breaker; they are not reactive state.
  const handles: BrickBreakerHandles = {}
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
              ref={(box) => setWordmark("box", box)}
              sound={settings.sounds.interfaceEnabled}
              onOpen={() => setWordmark("mode", "open")}
              onClose={() => setWordmark("mode", "closing")}
              onFlat={() => setWordmark("mode", "flat")}
              onPlay={(ball) => {
                handles.ball = ball
                setWordmark("game", true)
              }}
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
                      branch={<NewSessionBranch workspace={props.workspace} onDone={props.composer.restoreFocus} />}
                      onboarding={onboardingReady() && !onboarding.used && props.workspace.bar.visible()}
                      onClick={() =>
                        props.location({
                          onWorkspace: (value) => {
                            if (value !== "main") setOnboarding("used", true)
                          },
                        })
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
        <Show when={wordmark.mode !== "flat" && wordmark.box}>
          {(logo) => (
            <NewSessionPinBoard
              logo={logo()}
              sound={settings.sounds.interfaceEnabled}
              entrance="chain"
              closing={wordmark.mode === "closing"}
              ref={(board) => (handles.board = board)}
            />
          )}
        </Show>
        <Show when={wordmark.game && handles.board && handles.ball && { board: handles.board, ball: handles.ball }}>
          {(game) => (
            <NewSessionBrickBreaker
              panel={panel}
              board={game().board}
              ball={game().ball}
              sound={settings.sounds.interfaceEnabled}
              onDone={() => {
                setWordmark("game", false)
                props.composer.restoreFocus()
              }}
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

/** The composer tray: combined location picker, Git context, and the session's directory. */
function NewSessionLocation(props: {
  project: PromptProject
  /** "main", "create", or a worktree directory. */
  workspace: string
  root: string
  branch?: JSX.Element
  onboarding: boolean
  onClick: () => void
}) {
  const language = useLanguage()
  const command = useCommand()
  const [layout, setLayout] = createStore({ width: 0, font: "" })

  const worktree = () => {
    if (props.workspace === "main") return

    if (props.workspace === "create") return language.t("workspace.new")

    return getFilename(props.workspace)
  }

  const path = () => {
    if (props.workspace === "create") return

    return props.workspace === "main" ? props.root : props.workspace
  }

  const fitted = createMemo(() => fitPath(path() ?? "", layout.width, layout.font))

  return (
    <div class="relative flex min-h-9 min-w-0 items-center gap-3 ps-2 pe-1.5 text-[13px] font-[440] leading-[var(--line-height-compact)] tracking-[-0.04px]">
      <div class="flex min-w-0 max-w-full flex-wrap items-center gap-1 py-1.5">
        <Tooltip
          appearance={props.onboarding ? "large" : undefined}
          placement="top"
          openDelay={800}
          value={
            props.onboarding ? (
              <div class="flex flex-col gap-1 text-start">
                <div class="flex items-center gap-1.5 font-[530] text-v2-text-text-base">
                  <Icon name="outline-worktree" size="small" class="shrink-0 text-v2-text-text-accent" />
                  <span>{language.t("workspace.onboarding.title")}</span>
                </div>
                <span class="font-[440] text-v2-text-text-muted">{language.t("workspace.onboarding.description")}</span>
              </div>
            ) : (
              language.t("session.new.workspace.trigger.tooltip")
            )
          }
          contentClass={props.onboarding ? "max-w-[280px]" : undefined}
          class="flex min-w-0 max-w-full"
        >
          <button
            type="button"
            data-action="prompt-project"
            aria-haspopup="dialog"
            aria-description={language.t("session.new.workspace.trigger.tooltip")}
            class="flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-sm text-start ps-1.5 pe-2 text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-text-text-base focus-visible:outline-none"
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
            <Show when={worktree()}>
              {(name) => (
                <>
                  <Slash gap={0} />
                  <span class="sr-only">{" / "}</span>
                  <span class="min-w-12 shrink-[1000] truncate">{name()}</span>
                </>
              )}
            </Show>
            <Show when={props.onboarding}>
              <span
                data-slot="workspace-onboarding-dot"
                aria-hidden="true"
                class="size-1.5 shrink-0 rounded-full bg-v2-text-text-accent"
              />
            </Show>
          </button>
        </Tooltip>
        {props.branch}
      </div>
      <Show when={path()}>
        {(directory) => (
          <div
            class="flex min-w-0 flex-1 justify-end pe-1.5 @max-[560px]:hidden"
            style={{ "min-width": `min(calc(100% - 12px), ${Math.ceil(fitted().minimum) + 26}px)` }}
          >
            <Tooltip
              placement="top"
              value={directory()}
              disabled={fitted().text === directory() && fitted().minimum <= layout.width}
              class="flex min-w-0 flex-1"
              contentClass="max-w-[calc(100vw-32px)] break-all"
            >
              <span
                ref={(row) =>
                  createResizeObserver(row, () => {
                    const icon = row.querySelector("[data-slot=new-session-location-icon]")
                    const style = getComputedStyle(row)

                    setLayout({
                      width: row.clientWidth - (icon?.clientWidth ?? 0) - parseFloat(style.columnGap),
                      font: style.font,
                    })
                  })
                }
                class="flex min-w-0 flex-1 items-center justify-end gap-1.5"
                dir="ltr"
              >
                <Tooltip
                  placement="top"
                  openDelay={800}
                  value={
                    <span class="flex items-center gap-2">
                      {language.t("session.location.toggle")}
                      <Keybind keys={command.keybindParts("session.location.cycle")} variant="neutral" />
                    </span>
                  }
                >
                  <span class="flex shrink-0" data-slot="new-session-location-icon">
                    <Icon
                      name={worktree() ? "outline-worktree" : "monitor"}
                      size="small"
                      class="text-v2-icon-icon-muted"
                    />
                  </span>
                </Tooltip>
                <span
                  data-slot="new-session-location-path"
                  class="min-w-0 overflow-hidden whitespace-nowrap text-v2-text-text-faint [direction:rtl] [text-align:end]"
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
