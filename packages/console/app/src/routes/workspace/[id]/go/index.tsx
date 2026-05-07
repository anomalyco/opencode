import { IconGo } from "~/component/icon"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import { LiteSection } from "./lite-section"

export default function () {
  const i18n = useI18n()
  const language = useLanguage()

  return (
    <div data-page="workspace-[id]">
      <section data-component="header-section">
        <IconGo />
        <p>
          <span>
            {i18n.t("workspace.lite.banner.beforeLink")}{" "}
            <a target="_blank" href={language.route("/docs/go")}>
              {i18n.t("common.learnMore")}
            </a>
            .
          </span>
        </p>
      </section>

      <div data-slot="sections">
        <LiteSection />
      </div>
    </div>
  )
}
