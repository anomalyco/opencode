import { createAsync } from "@solidjs/router"
import { createMemo } from "solid-js"
import { github } from "~/lib/github"
import { config } from "~/config"
import { useLanguage } from "~/context/language"
import { useI18n } from "~/context/i18n"

export function Footer() {
  const language = useLanguage()
  const i18n = useI18n()
  const zh = createMemo(() => {
    const locale = language.locale()
    return locale === "zh" || locale === "zht"
  })
  const link = createMemo(() => language.route(zh() ? "/feishu" : "/discord"))
  const key = createMemo(() => (zh() ? "footer.feishu" : "footer.discord"))
  const githubData = createAsync(() => github())
  const starCount = createMemo(() =>
    githubData()?.stars
      ? new Intl.NumberFormat(language.tag(language.locale()), {
          notation: "compact",
          compactDisplay: "short",
        }).format(githubData()!.stars!)
      : config.github.starsFormatted.compact,
  )

  return (
    <footer data-component="footer">
      <div data-slot="cell">
        <a href={config.github.repoUrl} target="_blank">
          {i18n.t("footer.github")} <span>[{starCount()}]</span>
        </a>
      </div>
      <div data-slot="cell">
        <a href={language.route("/docs")}>{i18n.t("footer.docs")}</a>
      </div>
      <div data-slot="cell">
        <a href={language.route("/changelog")}>{i18n.t("footer.changelog")}</a>
      </div>
      <div data-slot="cell">
        <a href={link()}>{i18n.t(key())}</a>
      </div>
      <div data-slot="cell">
        <a href={config.social.twitter}>{i18n.t("footer.x")}</a>
      </div>
    </footer>
  )
}
