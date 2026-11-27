import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Show, onMount, untrack } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"
import type definition from "./index"
import type { FindAction, FindView } from "./ipc"

export function FindBar(props: {
  view: FindView
  run: (action: FindAction) => void
  input: (el: HTMLInputElement) => void
}) {
  const ctx = usePlugin<typeof definition>()
  let input: HTMLInputElement | undefined
  onMount(() => {
    input?.focus()
    input?.select()
  })

  return (
    <div
      role="search"
      aria-label={ctx.t("find.open")}
      class="flex h-9 shrink-0 items-center gap-1 border-b-[0.5px] border-v2-border-border-muted bg-v2-background-bg-layer-01 px-3"
    >
      <Icon name="magnifying-glass" size="small" class="shrink-0 text-v2-icon-icon-muted" />
      <input
        ref={(el) => {
          input = el
          props.input(el)
        }}
        dir="auto"
        type="text"
        role="searchbox"
        maxLength={4096}
        spellcheck={false}
        autocomplete="off"
        class="ms-1 min-w-0 flex-1 bg-transparent text-13-regular text-v2-text-text-base outline-none"
        aria-label={ctx.t("find.open")}
        placeholder={ctx.t("find.open")}
        value={untrack(() => props.view.query)}
        onInput={(event) => props.run({ type: "query", query: event.currentTarget.value })}
        onKeyDown={(event) => {
          if (event.isComposing || event.keyCode === 229 || (event.key !== "Escape" && event.key !== "Enter")) return
          event.preventDefault()
          event.stopPropagation()
          props.run({ type: event.key === "Escape" ? "close" : event.shiftKey ? "previous" : "next" })
        }}
      />
      <span role="status" class="shrink-0 px-1 text-12-regular tabular-nums text-v2-text-text-muted">
        <Show when={props.view.result}>
          {(result) => <>{ctx.plural("find.matches", result().total, { active: result().active })}</>}
        </Show>
      </span>
      <IconButton
        variant="ghost-muted"
        size="small"
        disabled={!props.view.query}
        aria-label={ctx.t("find.previous")}
        icon={<Icon class="rotate-180" name="chevron-down" />}
        onClick={() => props.run({ type: "previous" })}
      />
      <IconButton
        variant="ghost-muted"
        size="small"
        disabled={!props.view.query}
        aria-label={ctx.t("find.next")}
        icon={<Icon name="chevron-down" />}
        onClick={() => props.run({ type: "next" })}
      />
      <IconButton
        variant="ghost-muted"
        size="small"
        aria-label={ctx.t("find.close")}
        icon={<Icon name="close" />}
        onClick={() => props.run({ type: "close" })}
      />
    </div>
  )
}
