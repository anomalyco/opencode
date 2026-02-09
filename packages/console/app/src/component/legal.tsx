import { A } from "@solidjs/router"
import { LanguagePicker } from "~/component/language-picker"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"

export function Legal() {
  const i18n = useI18n()
  const language = useLanguage()
  return (
    <div data-component="legal">
      <span>
        ©{new Date().getFullYear()} <a href="https://anoma.ly">Anomaly</a>
      </span>
      <span>
        <A href={language.route("/brand")}>{i18n.t("legal.brand")}</A>
      </span>
      <span>
        <A href={language.route("/legal/privacy-policy")}>{i18n.t("legal.privacy")}</A>
      </span>
      <span>
        <A href={language.route("/legal/terms-of-service")}>{i18n.t("legal.terms")}</A>
      </span>
      <span>
        <LanguagePicker align="right" />
      </span>
    </div>
  )
}
