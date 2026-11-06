import { For, Show } from "solid-js"
import { ExternalArrow, NewTab } from "~/component/site/icons"
import { siteLinks } from "~/component/site/links"
import { Wordmark } from "~/component/site/marks"
import { AgentIcon, Bracket, ThemeCycle } from "~/component/site/site-controls"
import { useI18n } from "~/context/i18n"

/**
 * The site's footer as its list layout renders by default (site.tsx): the secondary links and the
 * status, the theme switch with the page's Markdown, the copyright and the wordmark. No language
 * picker: the docs are English. client.ts fills in the status and drives the theme switch.
 */
export function DocsFooter(props: { markdown?: string }) {
  const i18n = useI18n()
  // Settings › Footer links "community" (the default): no X, and Discord as "Community".
  const links = siteLinks(i18n.t, (path) => path).secondary.flatMap((item) =>
    "social" in item
      ? []
      : "community" in item
        ? [{ label: item.community, href: item.href, external: true }]
        : [{ label: item.label, href: item.href, external: "external" in item && !!item.external }],
  )
  return (
    <footer data-component="site-footer" data-layout="list" data-section="footer">
      <div data-slot="secondary">
        <nav data-component="secondary-nav" aria-label={i18n.t("site.landmark.secondary")}>
          <ul>
            <For each={links}>
              {(item) => (
                <li>
                  <a href={item.href} target={item.external ? "_blank" : undefined}>
                    <Bracket />
                    {item.label}
                    <Show when={item.external}>
                      <ExternalArrow />
                      <NewTab />
                    </Show>
                  </a>
                </li>
              )}
            </For>
            <li>
              <a
                href="https://status.opencode.ai"
                target="_blank"
                rel="noopener"
                data-component="status"
                data-state="unknown"
                title={i18n.t("site.status.unknownHeadline")}
              >
                <span data-slot="bars" aria-hidden="true">
                  <For each={[0, 1, 2, 3, 4, 5]}>{() => <span data-state="unknown" />}</For>
                </span>
                <span data-slot="status-label">
                  <span data-slot="sr-only">{i18n.t("site.status.prefix")}</span>
                  <span data-slot="status-text">{i18n.t("site.status.unknown")}</span>
                </span>
                <ExternalArrow />
                <NewTab />
              </a>
            </li>
          </ul>
        </nav>
        <div data-slot="footer-controls">
          <div
            data-component="theme-toggle"
            data-variant="cycle"
            role="group"
            aria-label={i18n.t("site.theme.andView")}
          >
            <ThemeCycle theme="system" onChange={() => undefined} />
            <Show when={props.markdown}>
              {(href) => (
                <a href={href()} aria-label={i18n.t("site.view.markdown")} data-funnel="markdown-view:on">
                  <AgentIcon />
                </a>
              )}
            </Show>
          </div>
        </div>
        <span data-slot="copyright">
          <bdi dir="ltr">
            ©{new Date().getFullYear()}{" "}
            <a href="https://anoma.ly" aria-label="Anomaly">
              Anomaly
            </a>
          </bdi>
        </span>
      </div>
      <div data-slot="main">
        <div data-component="wordmark">
          <Wordmark hatch={1} nodes entrance="off" />
        </div>
      </div>
    </footer>
  )
}
