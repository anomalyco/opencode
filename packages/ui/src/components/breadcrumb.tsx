import { For, Show } from "solid-js"

export interface BreadcrumbProps {
  items: string[]
}

export function Breadcrumb(props: BreadcrumbProps) {
  return (
    <div class="flex gap-1.5 px-3 py-2 leading-none text-11-regular text-text-base whitespace-nowrap overflow-hidden border-b border-border-weak-base">
      <For each={props.items}>
        {(item, index) => (
          <>
            <Show when={index() > 0}>
              <span class="text-text-weakest">/</span>
            </Show>
            <span>{item}</span>
          </>
        )}
      </For>
    </div>
  )
}
