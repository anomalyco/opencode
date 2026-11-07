import { useArea } from "~/i18n/content"
import { appsSource } from "~/i18n/content/areas/apps"
import { useI18n } from "~/context/i18n"
import "./companions.css"
import { For } from "solid-js"
import { NewTab } from "./icons"
import { anomalyApps } from "./links"
import type { PageSlug } from "./product-data"
import { siteSettings } from "./settings"

const [hex, opentunnel] = anomalyApps

export const companions: Record<PageSlug, (typeof anomalyApps)[number][]> = {
  desktop: [hex, opentunnel],
  terminal: [opentunnel, hex],
  mobile: [hex, opentunnel],
  sdk: [opentunnel, hex],
  ide: [opentunnel, hex],
  mini: [opentunnel, hex],
}

/**
 * "More open source products": the apps in one row, like an app store shelf (icon,
 * name, category, Free button). On phones the row scrolls sideways. The `companionStyle` setting
 * swaps the grey tiles for a ruled grid or a ruled list.
 */
export function Companions(props: { product: PageSlug }) {
  const i18n = useI18n()
  const appCopy = useArea("apps", appsSource)
  return (
    <section
      data-component="companions"
      data-section="companions"
      data-design="companionStyle"
      data-style={siteSettings.companionStyle}
      aria-label={i18n.t("site.companions")}
    >
      <ul data-slot="track">
        <For each={companions[props.product]}>
          {(app) => (
            <li data-component="companion">
              <span data-slot="icon" aria-hidden="true" />
              <span data-slot="text">
                <a data-slot="name" href={app.href} target="_blank" rel="noopener">
                  {app.name}
                  <NewTab />
                </a>
                <span data-slot="body">{appCopy()[app.id].category}</span>
              </span>
              <span data-slot="action">
                {/* The same link as the name, so screen readers and the tab order skip it. */}
                <a data-slot="get" href={app.href} target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">
                  {i18n.t("site.companions.free")}
                </a>
              </span>
            </li>
          )}
        </For>
      </ul>
    </section>
  )
}
