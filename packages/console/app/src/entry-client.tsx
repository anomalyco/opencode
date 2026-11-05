// @refresh reload
import { mount, StartClient } from "@solidjs/start/client"
import { loadLanguage } from "~/i18n/content"
import { parseLocale } from "~/lib/language"

// The page's language arrives before hydration, so the first client render matches the server's.
const locale = parseLocale(document.documentElement.dataset.locale) ?? "en"
void loadLanguage(locale)
  .catch(() => undefined)
  .then(() => mount(() => <StartClient />, document.getElementById("app")!))
