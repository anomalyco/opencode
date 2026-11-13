import { Show } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { useCommand } from "@/shell/commands/command"

/** The branch of the checkout the session will use. It is the row's one control: it opens the location dialog. */
export function NewSessionBranch(props: {
  branch?: string
  /** The branch is still loading; show the checkout placeholder instead of "No branch". */
  loading: boolean
  onboarding: boolean
  onOpen: () => void
}) {
  const language = useLanguage()
  const command = useCommand()

  return (
    <Tooltip
      appearance={props.onboarding ? "large" : undefined}
      placement="top"
      openDelay={800}
      value={
        <div class="flex flex-col gap-1 text-start">
          <Show when={props.onboarding}>
            <div class="flex items-center gap-1.5 font-[530] text-v2-text-text-base">
              <Icon name="outline-worktree" size="small" class="shrink-0 text-v2-text-text-accent" />
              <span>{language.t("workspace.onboarding.title")}</span>
            </div>
            <span class="font-[440] text-v2-text-text-muted">{language.t("workspace.onboarding.description")}</span>
          </Show>
          <span class="flex items-center justify-between gap-2">
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
        data-action="prompt-branch"
        aria-haspopup="dialog"
        aria-label={
          props.loading
            ? language.t("session.location.worktree")
            : props.branch || language.t("session.location.noBranch")
        }
        aria-busy={props.loading}
        aria-description={language.t("session.location.worktree")}
        class="flex h-7 min-w-0 max-w-[220px] items-center gap-1.5 rounded-sm ps-1.5 pe-2 text-v2-text-text-faint transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-text-text-base focus-visible:outline-none"
        onClick={props.onOpen}
      >
        <Icon name="branch" size="normal" class="shrink-0 text-v2-icon-icon-muted" />
        <Show
          when={!props.loading}
          fallback={<span aria-hidden="true" class="h-2 w-12 shrink-0 rounded-full bg-v2-background-bg-layer-02" />}
        >
          <span dir="auto" class="min-w-0 truncate">
            {props.branch || language.t("session.location.noBranch")}
          </span>
        </Show>
      </button>
    </Tooltip>
  )
}
