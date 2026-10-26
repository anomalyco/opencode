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

// A subagent session takes no prompts, so its composer slot is one quiet status line on the timeline's own surface:
// the run's state and duration, the agent, model and variant, and the way back.
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
    // The timeline scrolls on underneath, so the line keeps its surface and fades the text passing into it.
    <div
      data-component="subagent-bar"
      class="relative flex h-8 w-full min-w-0 items-center gap-2 bg-v2-background-bg-base ps-3 pe-1.5 text-[12px] font-[440] leading-4 tracking-[-0.04px] whitespace-nowrap tabular-nums text-v2-text-text-faint before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-4 before:bg-[linear-gradient(to_top,var(--v2-background-bg-base),transparent)]"
    >
      <span class="flex size-4 shrink-0 items-center justify-center text-v2-icon-icon-faint">
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
      <div class="flex min-w-0 flex-1 items-center gap-1.5">
        <Show when={props.status}>
          {(status) => (
            <>
              <span class="shrink-0">{language.t(`session.child.status.${status()}`)}</span>
              <span aria-hidden="true">·</span>
              <span class="shrink-0">{formatElapsed((props.ended ?? now()) - props.started, language.t)}</span>
            </>
          )}
        </Show>
        <Show when={props.agent}>
          {(agent) => (
            <>
              <span aria-hidden="true">·</span>
              <span class="shrink-0 capitalize">{agent()}</span>
            </>
          )}
        </Show>
        <Show when={props.model}>
          {(model) => (
            <>
              <span aria-hidden="true">·</span>
              <span data-slot="subagent-model" class="flex min-w-0">
                <Show when={model().provider}>
                  <span class="shrink-0">{model().provider}</span>
                  <Slash gap={4} />
                  <span class="sr-only">{" / "}</span>
                </Show>
                <span class="truncate">{model().name}</span>
              </span>
              <Show when={model().variant !== "default" && model().variant}>
                <span aria-hidden="true">·</span>
                <span class="shrink-0 capitalize">{model().variant}</span>
              </Show>
            </>
          )}
        </Show>
      </div>
      <Button type="button" variant="ghost-faint" size="small" class="shrink-0 gap-1.5 px-1.5" onClick={props.onBack}>
        {language.t("session.child.backToParent")}
        <span class="hidden sm:block">
          <Keybind keys={[formatKeybind("esc", language.t)]} variant="neutral" />
        </span>
      </Button>
    </div>
  )
}
