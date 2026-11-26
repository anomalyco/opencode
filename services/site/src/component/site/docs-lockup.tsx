import "./docs-lockup.css"
import { For } from "solid-js"
import { useI18n } from "~/context/i18n"
import type { I18n } from "~/context/i18n-context"
import { docsProducts } from "~/lib/docs-content"
import { docsUrl, v1DocsUrl } from "~/lib/docs"

export const docsVersions = [
  { id: "latest", label: "V2", meta: "(latest)" },
  { id: "v1", label: "V1" },
] as const

export type DocsVersion = (typeof docsVersions)[number]["id"]

/** A docs section's name in the page's language: "Docs" and "Build" translate, the product names don't. */
export function docsSectionName(i18n: I18n, section: string) {
  if (section === "Docs") return i18n.t("nav.docs")
  if (section === "Build") return i18n.t("docs.section.build")
  return section
}

/**
 * The docs lockup word beside the OpenCode mark ("DOCS"): a plain link to the docs home with no
 * dropdown, matching the Data and Console headers. Rendered server-side in both the sidebar and
 * the phone top bar so docs pages never hydrate.
 */
export function DocsLockup(props: { inline?: "sidebar" | "topbar" }) {
  const i18n = useI18n()
  const label = () => docsSectionName(i18n, "Docs")

  return (
    <div data-component="docs-lockup" data-host={props.inline}>
      <a data-slot="word" href={docsUrl()} aria-label={i18n.t("docs.lockup.home", { name: label() })}>
        {label()}
      </a>
    </div>
  )
}

/**
 * The flat docs section sub-links in the header (Overview, CLI, Build, API, Console, plus V1):
 * aligned with the article column on desktop, and a sticky horizontal strip under the top bar on
 * phones and tablets.
 */
export function DocsSectionLinks(props: { current: string; v1?: boolean; v1Href?: string }) {
  const i18n = useI18n()
  const sections = () => docsProducts.filter((product) => product.label !== "V1")
  const linkLabel = (label: string) =>
    label === "Docs" ? i18n.t("docs.section.overview") : docsSectionName(i18n, label)

  return (
    <nav data-component="docs-sections" aria-label={i18n.t("docs.navigation")}>
      <div data-slot="inner">
        <ul data-slot="links">
          <For each={sections()}>
            {(product) => (
              <li>
                <a href={product.href} aria-current={!props.v1 && props.current === product.label ? "page" : undefined}>
                  {linkLabel(product.label)}
                </a>
              </li>
            )}
          </For>
        </ul>
        <span data-slot="divider" aria-hidden="true" />
        <a
          data-slot="v1"
          href={props.v1Href ?? v1DocsUrl()}
          aria-label={i18n.t("docs.version.v1Docs")}
          aria-current={props.v1 ? "page" : undefined}
        >
          V1
        </a>
      </div>
    </nav>
  )
}
