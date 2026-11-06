import { For, Show } from "solid-js"
import type { DocsHeading } from "../rehype-headings"

export function DocsTableOfContents(props: { headings: DocsHeading[] }) {
  const headings = props.headings.filter((heading) => heading.depth === 2 || heading.depth === 3)
  return (
    <Show when={headings.length > 0}>
      <nav class="docs-toc" aria-label="On this page">
        <h2>On this page</h2>
        <ul>
          <For each={headings}>
            {(heading) => (
              <li class={heading.depth === 3 ? "nested" : undefined}>
                <a href={`#${heading.slug}`}>{heading.text}</a>
              </li>
            )}
          </For>
        </ul>
      </nav>
    </Show>
  )
}
