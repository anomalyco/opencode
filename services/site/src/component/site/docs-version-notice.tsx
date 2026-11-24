import "./docs-version-notice.css"
import { useI18n } from "~/context/i18n"
import { Show } from "solid-js"
import { siteSettings } from "./settings"

/**
 * On the V1 docs: a bar with a way back to the latest docs, at the top of the content column, or in the
 * logo row (`placement="header"`, the docs), where the sentence shortens with "…" before the link does.
 * On phones the header placement is a bar on the screen's bottom edge saying only "V1 docs" (docs.css).
 */
export function DocsVersionNotice(props: { latest: string; onLatest?: () => void; placement?: "header" }) {
  const i18n = useI18n()
  return (
    <aside
      data-component="docs-version-notice"
      data-variant={siteSettings.docsVersionNotice}
      data-design="docsVersionNotice"
      data-placement={props.placement}
      aria-label={i18n.t("docs.version.label")}
    >
      <span data-slot="badge">V1</span>
      <Show when={props.placement}>
        <span data-slot="short">{i18n.t("docs.version.v1Docs")}</span>
      </Show>
      <p>
        <span data-slot="sentence">{i18n.t("docs.version.notice")}</span>{" "}
        <a
          href={props.latest}
          onClick={(event) => {
            if (!props.onLatest) return
            event.preventDefault()
            props.onLatest()
          }}
        >
          {i18n.t("docs.version.switchToLatest")}
          <Show when={props.placement}>
            <LinkChevron />
          </Show>
        </a>
      </p>
    </aside>
  )
}

/** The 16px chevron after the logo row's links, toward the reading direction (mirrored in RTL by CSS). */
export function LinkChevron() {
  return (
    <svg data-slot="link-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" />
    </svg>
  )
}
