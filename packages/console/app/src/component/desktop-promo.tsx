import "./desktop-promo.css"
import { A, useLocation } from "@solidjs/router"
import { createSignal, Show } from "solid-js"
import { getRequestEvent } from "solid-js/web"
import desktopPromoVideo from "~/asset/lander/desktop-tabs-landscape.mp4"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import { strip } from "~/lib/language"

const DISMISSED_COOKIE = "desktop_promo_dismissed"

export function DesktopPromo() {
  const i18n = useI18n()
  const language = useLanguage()
  const location = useLocation()
  const request = getRequestEvent()?.request
  const cookie = request?.headers.get("cookie") ?? (typeof document === "object" ? document.cookie : "")
  const [visible, setVisible] = createSignal(
    !cookie.split(";").some((value) => value.trim() === `${DISMISSED_COOKIE}=1`),
  )
  const hostname = request ? new URL(request.url).hostname : typeof window === "object" ? window.location.hostname : ""
  const primaryHost =
    hostname === "opencode.ai" || hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"

  return (
    <Show
      when={
        visible() &&
        primaryHost &&
        strip(location.pathname) !== "/download" &&
        !strip(location.pathname).startsWith("/download/")
      }
    >
      <aside data-component="desktop-promo">
        <A href={language.route("/download")} data-slot="desktop-promo-link">
          <video src={desktopPromoVideo} autoplay playsinline loop muted preload="metadata" aria-hidden="true" />
          <span data-slot="desktop-promo-copy">
            <strong>{i18n.t("home.promo.title")}</strong>
            <span>
              {i18n.t("home.promo.body")} {i18n.t("home.promo.cta")}
            </span>
          </span>
        </A>
        <button
          type="button"
          data-slot="desktop-promo-close"
          onClick={() => {
            document.cookie = `${DISMISSED_COOKIE}=1; Path=/; Max-Age=31536000; SameSite=Lax`
            setVisible(false)
          }}
        >
          <span class="sr-only">{i18n.t("home.promo.close")}</span>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" stroke-width="1.5" />
          </svg>
        </button>
      </aside>
    </Show>
  )
}
