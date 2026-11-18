import { A } from "@solidjs/router"
import { createSignal, onMount } from "solid-js"
import { LanguagePicker } from "~/component/language-picker"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import "./legal.css"

export function Legal() {
  const i18n = useI18n()
  const language = useLanguage()
  return (
    <div data-component="legal">
      <span>
        ©{new Date().getFullYear()} <a href="https://anoma.ly">Anomaly</a>
      </span>
      <span>
        <SystemStatusLink />
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

const systemStatuses = ["operational", "degraded", "outage", "unknown"] as const
type SystemStatus = (typeof systemStatuses)[number]

function SystemStatusLink() {
  const i18n = useI18n()
  const [status, setStatus] = createSignal<SystemStatus>("unknown")

  onMount(() => {
    fetch("/status/api/summary", { signal: AbortSignal.timeout(10_000) })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((body: unknown) => setStatus(readSystemStatus(body)))
      .catch(() => setStatus("unknown"))
  })

  // The status page lives outside this app and is not localized, so bypass the locale route and client router.
  return (
    <a data-slot="status" data-status={status()} href="/status" rel="external">
      {i18n.t(`legal.status.${status()}`)}
    </a>
  )
}

function readSystemStatus(body: unknown) {
  if (!body || typeof body !== "object" || !("status" in body)) return "unknown"
  return systemStatuses.find((status) => status === body.status) ?? "unknown"
}
