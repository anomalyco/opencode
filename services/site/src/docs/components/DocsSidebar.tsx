import { For, Show } from "solid-js"
import { docsHref, type DocsNavGroup } from "../lib/navigation"

export function DocsSidebar(props: { groups: DocsNavGroup[]; currentSlug: string }) {
  return (
    <nav class="docs-sidebar" aria-label="Documentation">
      <For each={props.groups}>
        {(group) => (
          <section>
            <Show when={group.title}>
              <h2>{group.title}</h2>
            </Show>
            <ul>
              <For each={group.items}>
                {(item) => (
                  <li>
                    <a href={docsHref(item.slug)} aria-current={item.slug === props.currentSlug ? "page" : undefined}>
                      {item.title}
                    </a>
                  </li>
                )}
              </For>
            </ul>
          </section>
        )}
      </For>
    </nav>
  )
}
