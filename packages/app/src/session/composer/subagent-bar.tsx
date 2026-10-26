import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import { SessionProgressIndicatorV2 } from "@opencode/session-ui/v2/session-progress-indicator-v2"
import { createEffect, createSignal, Match, on, onCleanup, Show, Switch } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { formatKeybind } from "@/shell/commands/command"
import { formatElapsed } from "./activity-chips"

export type SubagentStatus = "running" | "succeeded" | "failed" | "interrupted"

// A subagent session takes no prompts, so its composer slot says what the run is on one line: which subagent, its
// task, how it is going, and the way back. The model can't be changed here, so it only shows in the task's tooltip.
export function SubagentBar(props: {
  agent?: string
  title?: string
  model?: { provider?: string; name: string; variant?: string }
  status?: SubagentStatus
  started: number
  ended?: number
  onBack: () => void
}) {
  const language = useLanguage()
  const [now, setNow] = createSignal(Date.now())
  // A finished run opens at rest; only a change seen while open fades in.
  const [changed, setChanged] = createSignal(false)

  createEffect(on(() => props.status, () => setChanged(true), { defer: true }))

  createEffect(() => {
    if (props.status !== "running") return

    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })

  const agent = () =>
    props.agent
      ? language.t("session.child.agent", { agent: `${props.agent[0].toUpperCase()}${props.agent.slice(1)}` })
      : language.t("session.child.subagent")

  return (
    <div
      data-component="subagent-bar"
      data-status={props.status}
      data-dock-border-underlay="true"
      class="@container flex h-11 w-full items-center gap-3 overflow-clip rounded-xl bg-v2-background-bg-base ps-4 pe-2 text-[13px] font-[440] leading-text-compact whitespace-nowrap tabular-nums [[data-color-scheme=dark]_&]:bg-v2-background-bg-layer-01"
    >
      <Tooltip
        placement="top"
        class="min-w-0 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-border-border-focus"
        triggerTabIndex={0}
        inactive={!props.title && !props.model}
        contentClass="max-w-80"
        value={
          <span class="flex flex-col items-start gap-1">
            <Show when={props.title}>{(title) => <span dir="auto">{title()}</span>}</Show>
            <Show when={props.model}>
              {(model) => (
                <span class="text-v2-text-text-muted">
                  {[model().provider, model().name].filter(Boolean).join(" / ")}
                  <Show when={model().variant !== "default" && model().variant}>
                    {(variant) => <span class="capitalize">{` · ${variant()}`}</span>}
                  </Show>
                </span>
              )}
            </Show>
          </span>
        }
      >
        <span class="flex min-w-0 items-center gap-2">
          <span class="shrink-0 font-[530] text-v2-text-text-base">
            <bdi>{agent()}</bdi>
          </span>
          <Show when={props.title}>
            {(title) => (
              <span data-slot="subagent-title" dir="auto" class="min-w-0 truncate text-v2-text-text-muted">
                {title()}
              </span>
            )}
          </Show>
        </span>
      </Tooltip>
      <Show when={props.status} keyed>
        {(status) => (
          <span
            data-slot="subagent-state"
            class="flex shrink-0 items-center gap-1.5 text-v2-text-text-faint duration-150 ease-out [:root[data-motion=reduce]_&]:animate-none"
            classList={{ "animate-in fade-in": changed() }}
          >
            <span class="flex size-4 items-center justify-center text-v2-icon-icon-muted">
              <Switch>
                <Match when={status === "running"}>
                  <SessionProgressIndicatorV2 />
                </Match>
                <Match when={status === "succeeded"}>
                  <Icon name="check" size="small" />
                </Match>
                <Match when={status === "failed"}>
                  <Icon name="circle-xmark" size="small" />
                </Match>
                <Match when={status === "interrupted"}>
                  <Icon name="outline-xmark" size="small" />
                </Match>
              </Switch>
            </span>
            <span class="hidden @sm:inline">{language.t(`session.child.status.${status}`)}</span>
            <span class="hidden @sm:inline">·</span>
            <bdi>{formatElapsed((props.ended ?? now()) - props.started, language.t)}</bdi>
          </span>
        )}
      </Show>
      <Button
        type="button"
        variant="ghost-faint"
        size="small"
        class="ms-auto shrink-0 gap-1.5 px-1.5"
        onClick={props.onBack}
      >
        {language.t("session.child.backToParent")}
        <span class="hidden sm:block">
          <Keybind keys={[formatKeybind("esc", language.t)]} variant="neutral" />
        </span>
      </Button>
    </div>
  )
}
