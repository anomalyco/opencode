import { createMemo, For, Show } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { TitlebarItem } from "@opencode/gui-extensions/sdk"
import { useExtensionHost } from "./host"

/** TitlebarItem contributions placed in the titlebar (the default placement). */
export function useTitlebarItems() {
  const host = useExtensionHost()

  const items = createMemo(() =>
    host.list(TitlebarItem).filter((item) => (item.placement ?? "titlebar") === "titlebar"),
  )

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
      class="shrink-0 text-[11px] leading-4 text-v2-text-text-accent [font-weight:530] opacity-0 motion-safe:transition-all duration-150 ease-out group-hover:opacity-100 group-hover:translate-x-0 group-focus-within:opacity-100 group-focus-within:translate-x-0 motion-reduce:translate-x-0"
      classList={{
        "ms-px me-4 -translate-x-2 rtl:translate-x-2": props.vertical,
        "ms-2 me-px translate-x-2 rtl:-translate-x-2": !props.vertical,
      }}
    >
      {props.item.label}
    </span>
  )

  return (
    <div
      data-slot="titlebar-update"
      class="group relative shrink-0 rounded-full bg-v2-background-bg-deep transition-[width] duration-150 ease-out hover:z-30 focus-within:z-30 motion-reduce:transition-none"
      classList={{
        "h-7 w-7 self-start hover:w-[84px] focus-within:w-[84px]": props.vertical,
        "me-3 h-5 w-5 hover:w-[68px] focus-within:w-[68px]": !props.vertical,
      }}
    >
      <button
        type="button"
        class="absolute top-0 z-10 flex h-full w-full items-center overflow-hidden rounded-full bg-v2-icon-icon-accent/20 text-v2-icon-icon-accent transition-[background-color] duration-150 ease-out group-hover:bg-[color-mix(in_srgb,var(--v2-icon-icon-accent)_20%,var(--v2-background-bg-deep))] group-focus-within:bg-[color-mix(in_srgb,var(--v2-icon-icon-accent)_20%,var(--v2-background-bg-deep))] focus-visible:outline-none disabled:opacity-60 motion-reduce:transition-none [app-region:no-drag]"
        classList={{ "start-0 justify-start": props.vertical, "end-0 justify-end": !props.vertical }}
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
          <Show when={!props.item.busy} fallback={<span data-slot="titlebar-update-loader" aria-hidden="true" />}>
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
