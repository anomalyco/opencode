import { useArea } from "~/i18n/content"
import { appsSource } from "~/i18n/content/areas/apps"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import "./companions.css"
import { For, Show } from "solid-js"
import { NewTab } from "./icons"
import { anomalyApps, appLink } from "./links"
import { SectionHeading } from "./on-this-page"
import { siteSettings } from "./settings"

/**
 * "Works great with OpenCode": Anomaly's apps in one row, like an app store shelf (icon, name,
 * category, Free button), the same on every product page. On phones the row scrolls sideways. The
 * `companionStyle` setting swaps the ruled grid for grey tiles or a ruled list.
 */
export function Companions() {
  const i18n = useI18n()
  const language = useLanguage()
  const appCopy = useArea("apps", appsSource)
  return (
    <section data-component="block" data-slot="product-companions" data-section="companions">
      <SectionHeading id="works-with-opencode" title={i18n.t("site.companions")} label />
      <div data-component="companions" data-design="companionStyle" data-style={siteSettings.companionStyle}>
        <ul data-slot="track">
          <For each={anomalyApps}>
            {(app) => {
              const link = appLink(app, language.route)
              const target = link.external ? "_blank" : undefined
              const rel = link.external ? "noopener" : undefined
              return (
                <li data-component="companion">
                  {/* The icon and name are one link, the row's only stop; the row is its target. */}
                  <a data-slot="link" href={link.href} target={target} rel={rel}>
                    <span data-slot="icon" aria-hidden="true">
                      <img src={app.icon} width="56" height="56" alt="" loading="lazy" />
                    </span>
                    <span data-slot="name">
                      {app.name}
                      <Show when={link.external}>
                        <NewTab />
                      </Show>
                    </span>
                  </a>
                  <span data-slot="body">{appCopy()[app.id].category}</span>
                  {/* The same link again, so screen readers and the tab order skip it. */}
                  <a
                    data-slot="get"
                    href={link.href}
                    target={target}
                    rel={rel}
                    tabindex="-1"
                    aria-hidden="true"
                  >
                    {i18n.t("site.companions.free")}
                  </a>
                </li>
              )
            }}
          </For>
        </ul>
      </div>
    </section>
  )
}
