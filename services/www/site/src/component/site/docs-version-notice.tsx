import "./docs-version-notice.css"
import { siteSettings } from "./settings"

/** On the V1 docs: a bar at the top of the content column, with a way back to the latest docs. */
export function DocsVersionNotice(props: { latest: string; onLatest?: () => void }) {
  return (
    <aside
      data-component="docs-version-notice"
      data-variant={siteSettings.docsVersionNotice}
      data-design="docsVersionNotice"
      aria-label="Docs version"
    >
      <span data-slot="badge">V1</span>
      <p>
        You're viewing a previous version of the docs.{" "}
        <a
          href={props.latest}
          onClick={(event) => {
            if (!props.onLatest) return
            event.preventDefault()
            props.onLatest()
          }}
        >
          Switch to latest
        </a>
      </p>
    </aside>
  )
}
