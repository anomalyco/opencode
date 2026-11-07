import "./github-link.css"
import { config } from "~/config"
import { useI18n } from "~/context/i18n"
import { GitHubMark } from "./icons"

/**
 * The repo, as a GitHub mark: fixed in the top-right corner beside the sidebar (and at every width on
 * bare pages), in the top bar on small screens (site.tsx), and in the 404 arcade's phone bar. It needs
 * no router, so the docs render it too.
 */
export function GitHubLink(props: { owner: "corner" | "topbar" }) {
  const i18n = useI18n()
  return (
    <a
      href={config.github.repoUrl}
      target="_blank"
      rel="noopener"
      data-component="github-link"
      data-owner={props.owner}
      aria-label={i18n.t("site.githubLabel")}
    >
      <GitHubMark />
    </a>
  )
}
