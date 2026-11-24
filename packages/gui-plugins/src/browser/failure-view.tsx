import { usePlugin } from "@opencode/plugin/gui"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { For, Show } from "solid-js"
import type definition from "./index"

/**
 * Where the page would be when it did not load, or when a command failed with no page to keep: what happened in
 * plain words, one sentence of what to do, the actions that can help, and Chromium's code, small, for developers.
 */
export function FailurePage(props: {
  title: string
  description: string
  warning?: boolean
  actions: readonly { label: string; run: () => void }[]
  code?: string
}) {
  return (
    // Add the 40px toolbar to the file empty state's 160px bottom padding to align their centers.
    <div
      dir="auto"
      data-component="browser-failure"
      class="flex size-full flex-col items-center justify-center gap-2 p-6 pb-[200px] text-center"
    >
      <Icon
        name={props.warning ? "outline-hexagonal-warning" : "outline-globe"}
        size="large"
        class="mb-2 shrink-0 text-v2-icon-icon-muted"
      />
      <h2 class="text-[13px] font-[530] leading-[var(--line-height-compact)] text-v2-text-text-base">{props.title}</h2>
      <p class="max-w-[360px] text-[13px] font-[440] leading-[var(--line-height-base)] text-v2-text-text-muted">
        {props.description}
      </p>
      <Show when={props.actions.length > 0}>
        <div class="mt-3 flex flex-wrap items-center justify-center gap-2">
          <For each={props.actions}>
            {(action, index) => (
              <Button size="small" variant={index() === 0 ? "neutral" : "ghost"} onClick={() => action.run()}>
                {action.label}
              </Button>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.code}>
        {(code) => (
          <p
            dir="ltr"
            class="mt-4 select-text text-[11px] leading-[var(--line-height-compact)] text-v2-text-text-faint"
            style={{ "font-family": "var(--font-family-mono)" }}
          >
            {code()}
          </p>
        )}
      </Show>
    </div>
  )
}

/**
 * A line above the page for a command that did not work or an address the pane will not open. The page stays: the
 * person reads it, tries again where that can help, or closes it.
 */
export function FailureBar(props: { text: string; retry?: () => void; dismiss: () => void }) {
  const ctx = usePlugin<typeof definition>()

  return (
    <section
      data-component="browser-failure-bar"
      class="flex shrink-0 items-center gap-3 border-b-[0.5px] border-v2-border-border-muted bg-v2-background-bg-layer-01 px-3 py-2"
    >
      <p role="alert" class="min-w-0 flex-1 text-13-regular text-v2-text-text-base">
        {props.text}
      </p>
      <Show when={props.retry}>
        {(retry) => (
          <Button variant="neutral" size="small" onClick={() => retry()()}>
            {ctx.t("common.retry")}
          </Button>
        )}
      </Show>
      <IconButton
        variant="ghost-muted"
        size="small"
        aria-label={ctx.t("refused.dismiss")}
        icon={<Icon name="close" />}
        onClick={() => props.dismiss()}
      />
    </section>
  )
}
