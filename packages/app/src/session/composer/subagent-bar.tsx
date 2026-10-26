import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Keybind } from "@opencode/ui/keybind"
import { Slash } from "@opencode/ui/slash"
import { SessionProgressIndicatorV2 } from "@opencode/session-ui/v2/session-progress-indicator-v2"
import { createEffect, createSignal, Match, onCleanup, Show, Switch } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { formatKeybind } from "@/shell/commands/command"
import { formatElapsed } from "./activity-chips"

export type SubagentStatus = "running" | "succeeded" | "failed" | "interrupted"

// A subagent session takes no prompts, so its composer slot shows what the run is: the composer's geometry with the
// agent, model and variant where the composer's chips sit, the run's state where the placeholder sits, and the way back
// where the send button sits.
export function SubagentBar(props: {
  agent?: string
  model?: { provider?: string; name: string; variant?: string }
  status?: SubagentStatus
  started: number
  ended?: number
  onBack: () => void
}) {
  const language = useLanguage()
  const [now, setNow] = createSignal(Date.now())

  createEffect(() => {
    if (props.status !== "running") return

    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <div
      data-component="subagent-bar"
      data-dock-border-underlay="true"
      class="w-full overflow-clip rounded-xl bg-v2-background-bg-base text-[13px] font-[440] leading-5 tabular-nums [[data-color-scheme=dark]_&]:bg-v2-background-bg-layer-01"
    >
      <div class="min-h-[60px] px-4 pt-4 pb-2 text-v2-text-text-faint">
        <Show when={props.status}>
          {(status) => (
            <>
              {language.t(`session.child.status.${status()}`)}
              {" · "}
              {formatElapsed((props.ended ?? now()) - props.started, language.t)}
            </>
          )}
        </Show>
      </div>
      <div class="flex h-11 items-center px-2">
        <span class="flex size-7 shrink-0 items-center justify-center text-v2-icon-icon-muted">
          <Switch>
            <Match when={props.status === "running"}>
              <SessionProgressIndicatorV2 />
            </Match>
            <Match when={props.status === "succeeded"}>
              <Icon name="check" size="small" />
            </Match>
            <Match when={props.status === "failed"}>
              <Icon name="circle-xmark" size="small" />
            </Match>
            <Match when={props.status === "interrupted"}>
              <Icon name="outline-xmark" size="small" />
            </Match>
          </Switch>
        </span>
        <div class="ms-1 me-3 flex min-w-0 flex-1 items-center gap-1 whitespace-nowrap text-v2-text-text-muted">
          <Show when={props.agent}>
            {(agent) => <span class="shrink-0 px-[11px] capitalize">{agent()}</span>}
          </Show>
          <Show when={props.model}>
            {(model) => (
              <>
                <span data-slot="subagent-model" class="flex min-w-0 px-[11px]">
                  <Show when={model().provider}>
                    <span class="shrink-0 text-v2-text-text-faint">{model().provider}</span>
                    <Slash />
                    <span class="sr-only">{" / "}</span>
                  </Show>
                  <span class="truncate">{model().name}</span>
                </span>
                <Show when={model().variant !== "default" && model().variant}>
                  <span class="shrink-0 px-[11px] capitalize">{model().variant}</span>
                </Show>
              </>
            )}
          </Show>
        </div>
        <Button type="button" variant="ghost-faint" size="small" class="gap-1.5 px-1.5" onClick={props.onBack}>
          {language.t("session.child.backToParent")}
          <span class="hidden sm:block">
            <Keybind keys={[formatKeybind("esc", language.t)]} variant="neutral" />
          </span>
        </Button>
      </div>
    </div>
  )
}
