import { For, Show } from "solid-js"
import { Bracket } from "~/component/site/site-controls"
import { useI18n } from "~/context/i18n"
import type { DocsSet } from "../config"
import { docsHref, type DocsNavGroup } from "../lib/navigation"

/**
 * The current section's pages, in the site's bracket list (the footer's "[ ]", "[-]" on the current
 * page). It scrolls on its own under the logo and lockup (site.css), fading at an edge while items
 * pass under it (client.ts sets data-fade-top and data-fade-bottom).
 */
export function DocsNav(props: { set: DocsSet; section: string; groups: DocsNavGroup[]; currentSlug: string }) {
  // A group named after its section ("API" in the API docs) needs no title under the lockup.
  const i18n = useI18n()
  const title = (group: DocsNavGroup) => (group.title === props.section ? undefined : group.title)
  return (
    <nav data-component="docs-nav" aria-label={i18n.t("docs.navigation")}>
      <For each={props.groups}>
        {(group, index) => (
          <div data-slot="group">
            <Show when={title(group)}>
              {(text) => (
                <span data-slot="group-title" id={`docs-nav-${index()}`}>
                  {text()}
                </span>
              )}
            </Show>
            <ul aria-labelledby={title(group) ? `docs-nav-${index()}` : undefined}>
              <For each={group.items}>
                {(item) => (
                  <li>
                    <a
                      href={item.href ?? docsHref(item.slug, props.set)}
                      aria-current={item.slug === props.currentSlug ? "page" : undefined}
                    >
                      <Bracket />
                      <span data-slot="label">{item.title}</span>
                    </a>
                  </li>
                )}
              </For>
            </ul>
          </div>
        )}
      </For>
    </nav>
  )
}
