import "./phone-features.css"
import { createSignal, createUniqueId, For, Show } from "solid-js"
import { Faq } from "~/component/faq"
import { useI18n } from "~/context/i18n"
import { Chevron, ChevronRight } from "./icons"
import { scrollLeftFor, scrollStart } from "~/lib/direction"
import { siteSettings } from "./settings"

type Feature = { title: string; body: string; href: string }

/**
 * Settings › Phone feature list: shorter takes on "What is OpenCode?"'s feature list for phones (40rem
 * and narrower; the grid above stays as it is on wider screens). Every option's parts render and the
 * section's data-phone-features (set before first paint for a saved value) shows one, so nothing
 * moves after load. "show more", "highlights" and "highlights + list" trim the grid itself (its
 * first five or four items); "accordion" (the default) and "swipe deck" replace it. Production
 * renders only the default's parts (script/fold-settings.ts).
 */
export function PhoneFeatures(props: { features: readonly Feature[]; listID: string }) {
  const i18n = useI18n()
  const id = createUniqueId()
  const [expanded, setExpanded] = createSignal(false)
  // Every row starts closed; one opens at a time.
  const [open, setOpen] = createSignal<number>()
  const [card, setCard] = createSignal(0)
  const rest = () => props.features.slice(4)
  // Two features a card, so ten make five full cards.
  const cards = () =>
    Array.from({ length: Math.ceil(props.features.length / 2) }, (_, index) =>
      props.features.slice(index * 2, index * 2 + 2),
    )
  let deck: HTMLUListElement | undefined

  // "show more": the rest of the grid opens below the button's place, so nothing above moves, and
  // focus goes to the first feature that appeared.
  const toggle = (event: MouseEvent & { currentTarget: HTMLButtonElement }) => {
    const next = !expanded()
    setExpanded(next)
    const section = event.currentTarget.closest("section")
    section?.toggleAttribute("data-features-expanded", next)
    if (next) section?.querySelectorAll<HTMLElement>(`#${props.listID} > li > a`)[5]?.focus()
  }

  const step = () => {
    const first = deck?.children[0] as HTMLElement | undefined
    const second = deck?.children[1] as HTMLElement | undefined
    return first && second ? Math.abs(second.offsetLeft - first.offsetLeft) : 1
  }

  return (
    <div data-component="phone-features">
      <Show when={import.meta.env.DEV || siteSettings.phoneFeatures === "show more"}>
        <button
          type="button"
          data-slot="show-more"
          aria-expanded={expanded() ? "true" : "false"}
          aria-controls={props.listID}
          onClick={toggle}
        >
          {expanded() ? i18n.t("home.features.fewer") : i18n.t("home.features.all", { count: props.features.length })}
          <Chevron />
        </button>
      </Show>

      {/* The site's FAQ rows (component/faq.tsx and its styles in site.css), so the plus, its turn
          into a minus and the height animation are the FAQ's own. */}
      <Show when={import.meta.env.DEV || siteSettings.phoneFeatures === "accordion"}>
        <ul data-component="faq" data-slot="accordion">
          <For each={props.features}>
            {(feature, index) => (
              <li>
                <Faq
                  question={feature.title}
                  heading
                  open={open() === index()}
                  onOpenChange={(next) => setOpen(next ? index() : undefined)}
                >
                  <p>{feature.body}</p>
                </Faq>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <Show when={import.meta.env.DEV || siteSettings.phoneFeatures === "highlights"}>
        <p data-slot="also">
          <span>{i18n.t("home.features.also")}</span>{" "}
          <For each={rest()}>
            {(feature, index) => (
              <>
                <Show when={index() > 0}>
                  <span aria-hidden="true"> · </span>
                </Show>
                <a href={feature.href}>{feature.title}</a>
              </>
            )}
          </For>
        </p>
      </Show>

      <Show when={import.meta.env.DEV || siteSettings.phoneFeatures === "highlights + list"}>
        <ul data-slot="index" aria-label={i18n.t("home.features.more")}>
          <For each={rest()}>
            {(feature) => (
              <li>
                <a href={feature.href}>
                  {feature.title}
                  <ChevronRight />
                </a>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <Show when={import.meta.env.DEV || siteSettings.phoneFeatures === "swipe deck"}>
        <div data-slot="deck">
          <ul
            ref={deck}
            aria-label={i18n.t("site.product.features")}
            onScroll={(event) => setCard(Math.round(scrollStart(event.currentTarget) / step()))}
          >
            <For each={cards()}>
              {(group) => (
                <li>
                  <For each={group}>
                    {(feature) => (
                      <a href={feature.href}>
                        <h3>{feature.title}</h3>
                        <p>{feature.body}</p>
                      </a>
                    )}
                  </For>
                </li>
              )}
            </For>
          </ul>
          <div data-slot="dots">
            <For each={cards()}>
              {(_, index) => (
                <button
                  type="button"
                  aria-label={i18n.t("home.features.range", {
                    from: index() * 2 + 1,
                    to: Math.min(index() * 2 + 2, props.features.length),
                  })}
                  aria-current={card() === index() ? "true" : undefined}
                  onClick={() => deck?.scrollTo({ left: scrollLeftFor(deck, index() * step()), behavior: "smooth" })}
                />
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}
