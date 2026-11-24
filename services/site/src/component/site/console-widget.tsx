import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { ConsoleField } from "./console-field"
import { siteSettings } from "./settings"

/**
 * The Console as a small 4:5 card fixed in the bottom-left corner, under the sidebar nav. When the
 * footer's nav scrolls into view, the card slides down out of the way and the footer nav slides up
 * into its place; scrolling back reverses both.
 */
export function ConsoleWidget(props: { title: string; headline: string; cta: { text: string; href: string } }) {
  const [root, setRoot] = createSignal<HTMLElement>()
  const [away, setAway] = createSignal(false)

  onMount(() => {
    setRoot(document.querySelector<HTMLElement>("[data-site]") ?? undefined)
    const nav = document.querySelector<HTMLElement>('[data-component="site-footer"] [data-component="secondary-nav"]')
    if (!nav) return
    nav.dataset.reveal = "hidden"
    const view = new IntersectionObserver((entries) => {
      const entry = entries.at(-1)
      if (!entry) return
      setAway(entry.isIntersecting)
      nav.dataset.reveal = entry.isIntersecting ? "shown" : "hidden"
    })
    view.observe(nav)
    onCleanup(() => {
      view.disconnect()
      delete nav.dataset.reveal
    })
  })

  return (
    <Show when={root()}>
      {(mount) => (
        <Portal mount={mount()}>
          <aside data-component="console-widget" data-away={away() ? "" : undefined} aria-label={props.title}>
            <ConsoleField />
            <div data-slot="copy">
              <span data-slot="eyebrow">{props.title}</span>
              <p data-slot="headline">{props.headline}</p>
              <div data-slot="actions">
                <a
                  href={props.cta.href}
                  rel="external"
                  data-component="site-button"
                  data-variant={siteSettings.cornerButton === "primary" ? undefined : siteSettings.cornerButton}
                >
                  {props.cta.text}
                </a>
              </div>
            </div>
          </aside>
        </Portal>
      )}
    </Show>
  )
}
