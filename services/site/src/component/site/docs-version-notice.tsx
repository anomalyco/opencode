import "./docs-version-notice.css"
import { useI18n } from "~/context/i18n"
import { siteSettings } from "./settings"

/** On the V1 docs: a bar at the top of the content column, with a way back to the latest docs. */
export function DocsVersionNotice(props: { latest: string; onLatest?: () => void }) {
  const i18n = useI18n()
  return (
    <aside
      data-component="docs-version-notice"
      data-variant={siteSettings.docsVersionNotice}
      data-design="docsVersionNotice"
      aria-label={i18n.t("docs.version.label")}
    >
      <span data-slot="badge">V1</span>
      <p>
        {i18n.t("docs.version.notice")}{" "}
        <a
          href={props.latest}
          onClick={(event) => {
            if (!props.onLatest) return
            event.preventDefault()
            props.onLatest()
          }}
        >
          {i18n.t("docs.version.switchToLatest")}
        </a>
      </p>
    </aside>
  )
}
