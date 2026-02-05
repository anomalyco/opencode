import { A } from "@solidjs/router"
import { useI18n } from "~/context/i18n"

export function Legal() {
  const i18n = useI18n()
  return (
    <div data-component="legal">
      <span>
        ©{new Date().getFullYear()} <a href="https://anoma.ly">Anomaly</a>
      </span>
      <span>
        <A href="/brand">{i18n.t("legal.brand")}</A>
      </span>
      <span>
        <A href="/legal/privacy-policy">{i18n.t("legal.privacy")}</A>
      </span>
      <span>
        <A href="/legal/terms-of-service">{i18n.t("legal.terms")}</A>
      </span>
    </div>
  )
}
