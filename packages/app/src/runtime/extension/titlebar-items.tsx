import { createMemo, For, Show } from "solid-js"
import { syncSpinPhase } from "@opencode/ui/hooks"
import { Icon } from "@opencode/ui/icon"
import { TitlebarItem } from "@opencode/gui-extensions/sdk"
import { useExtensionHost } from "./host"
import "./titlebar-items.css"

/** TitlebarItem contributions shown in the titlebar. */
export function useTitlebarItems() {
  const host = useExtensionHost()

  const items = createMemo(() => host.list(TitlebarItem))

  // Keyed by id so a pill keeps its element (and hover state) while its item changes.
  const ids = createMemo(() => items().map((item) => item.id), undefined, {
    equals: (a, b) => a.length === b.length && a.every((id, index) => id === b[index]),
  })

  return {
    ids,
    item: (id: string) => items().find((item) => item.id === id),
  }
}

export function TitlebarItems(props: { items: ReturnType<typeof useTitlebarItems>; vertical?: boolean }) {
  return (
    <For each={props.items.ids()}>
      {(id) => (
        <Show when={props.items.item(id)}>
          {(item) => <TitlebarItemButton item={item()} vertical={props.vertical} />}
        </Show>
      )}
    </For>
  )
}

function TitlebarItemButton(props: { item: TitlebarItem; vertical?: boolean }) {
  const label = () => (
    <span
      data-slot="titlebar-update-label"
      class="shrink-0 whitespace-nowrap text-[11px] leading-4 text-v2-text-text-accent [font-weight:530] opacity-0 motion-safe:transition-all duration-150 ease-out group-hover:opacity-100 group-hover:translate-x-0 group-focus-within:opacity-100 group-focus-within:translate-x-0 motion-reduce:translate-x-0"
      classList={{
        "ms-px me-4 -translate-x-2 rtl:translate-x-2": props.vertical,
        "ms-2 me-px translate-x-2 rtl:-translate-x-2": !props.vertical,
      }}
    >
      {props.item.label}
    </span>
  )

  // The pill grows to fit its label, so translated labels of any length show in full.
  return (
    <div
      data-slot="titlebar-update"
      class="group relative shrink-0 rounded-full bg-v2-background-bg-deep transition-[width] duration-150 ease-out [interpolate-size:allow-keywords] hover:z-30 hover:w-fit focus-within:z-30 focus-within:w-fit motion-reduce:transition-none"
      classList={{
        "h-7 w-7 self-start": props.vertical,
        "me-3 h-5 w-5": !props.vertical,
      }}
    >
      <button
        type="button"
        class="relative z-10 flex h-full w-full items-center overflow-hidden rounded-full text-v2-icon-icon-accent transition-[background-color] duration-150 ease-out focus-visible:outline-none disabled:opacity-60 motion-reduce:transition-none [app-region:no-drag]"
        classList={{ "justify-start": props.vertical, "justify-end": !props.vertical }}
        onClick={() => props.item.run?.()}
        disabled={!!props.item.busy}
        aria-busy={!!props.item.busy}
        aria-label={props.item.title ?? props.item.label}
        aria-pressed={props.item.pressed}
      >
        <Show when={!props.vertical}>{label()}</Show>
        <span
          class="flex shrink-0 items-center justify-center"
          classList={{ "size-7": props.vertical, "size-5": !props.vertical }}
        >
          <Show
            when={!props.item.busy}
            fallback={<span ref={syncSpinPhase} data-slot="titlebar-update-loader" aria-hidden="true" />}
          >
            <Show
              when={props.item.icon}
              fallback={
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M7 11V3M3.5 7.63128L7 11L10.5 7.63128" stroke="currentColor" />
                </svg>
              }
            >
              {(icon) => <Icon name={icon()} size="small" />}
            </Show>
          </Show>
        </span>
        <Show when={props.vertical}>{label()}</Show>
      </button>
    </div>
  )
}
