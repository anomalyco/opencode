import "./github-link.css"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import { GitHubMark } from "./icons"
import { siteLinks } from "./links"

/**
 * The repo, as a GitHub mark: fixed in the top-right corner beside the sidebar (and at every width on
 * bare pages), in the top bar on small screens (site.tsx), and in the 404 arcade's phone bar.
 */
export function GitHubLink(props: { owner: "corner" | "topbar" }) {
  const i18n = useI18n()
  const language = useLanguage()
  return (
    <a
      href={siteLinks(i18n.t, language.route).github.href}
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
