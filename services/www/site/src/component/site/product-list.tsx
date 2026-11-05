import "./product-list.css"
import { For, Show, type JSX } from "solid-js"
import { useI18n } from "~/context/i18n"
import { useContent } from "~/i18n/content"
import { HexMark, NewTab, OpenTUIMark, OpenTunnelMark } from "./icons"
import { anomalyProducts } from "./links"
import { SectionHeading } from "./on-this-page"

export type ProductListItem = {
  name: string
  description: string
  href: string
  /** Opens in a new tab (another site). */
  external?: boolean
  /** An image (a product's own icon) or a mark drawn in the tile; none leaves the tile blank. */
  icon?: string | JSX.Element
  action?: string
}

/**
 * The quiet product list, one item per row: an icon tile, the name, a line and a Learn more button
 * (each row links to a page about the item; none of them installs anything itself).
 * Extensions, Integrations and More from Anomaly all use it, so the three can't drift apart.
 */
export function ProductList(props: { items: readonly ProductListItem[] }) {
  const i18n = useI18n()
  const action = (item: ProductListItem) => item.action ?? i18n.t("common.learnMore")
  // The button's name says what it's about: "Learn more about Hex".
  const name = (item: ProductListItem) =>
    item.action ? `${item.action} ${item.name}` : i18n.t("site.action.learnMoreAbout", { name: item.name })
  return (
    <ul data-component="product-list">
      <For each={props.items}>
        {(item) => (
          <li>
            <Show
              when={typeof item.icon === "string" && item.icon}
              fallback={
                <span
                  data-slot="icon"
                  data-empty={item.icon ? undefined : ""}
                  data-mark={item.icon ? "" : undefined}
                  aria-hidden="true"
                >
                  {item.icon}
                </span>
              }
            >
              {(src) => (
                <span data-slot="icon" aria-hidden="true">
                  <img src={src()} width="40" height="40" alt="" />
                </span>
              )}
            </Show>
            <span data-slot="text">
              <span data-slot="name">{item.name}</span>
              <span data-slot="description">{item.description}</span>
            </span>
            <a
              href={item.href}
              target={item.external ? "_blank" : undefined}
              rel={item.external ? "noopener" : undefined}
              data-component="site-button"
              data-slot="get"
              aria-label={item.external ? i18n.t("site.newTab", { label: name(item) }) : name(item)}
            >
              {action(item)}
              <Show when={item.external}>
                <NewTab />
              </Show>
            </a>
          </li>
        )}
      </For>
    </ul>
  )
}

/**
 * "More from Anomaly": Anomaly's other open source products. The same section on /product and on
 * every product and extension page; `slot` is its data-slot, which each page's layout styles. Each
 * shows its flat mark, white on the black tile like GitHub's and GitLab's.
 */
export function MoreFromAnomaly(props: { slot: string }) {
  const i18n = useI18n()
  const content = useContent()
  return (
    <section data-component="block" data-slot={props.slot}>
      <SectionHeading id="more-from-anomaly" title={i18n.t("site.moreFromAnomaly")} label />
      <div data-slot="body">
        <ProductList
          items={anomalyProducts.map((app) => ({
            name: app.name,
            description: content().apps[app.id].body,
            href: app.href,
            external: true,
            icon: anomalyMarks[app.id](),
          }))}
        />
      </div>
    </section>
  )
}

/** Each Anomaly product's mark in the list: the one place to switch a mark. */
const anomalyMarks: Record<(typeof anomalyProducts)[number]["id"], () => JSX.Element> = {
  hex: () => <HexMark />,
  opentunnel: () => <OpenTunnelMark />,
  opentui: () => <OpenTUIMark />,
}
