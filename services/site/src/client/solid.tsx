import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import { I18nContext } from "~/context/i18n-context"
import { loadSlice, translated, translator } from "~/i18n"
import { parseLocale } from "~/lib/language"

// The site's own Solid components that the static pages show only once someone asks for them (the
// search palette, the Markdown view, the orb, the footer's wordmark, the legal cover), rendered into
// the page in the browser: nothing of theirs is in the HTML for them to hydrate. Loaded on intent
// with the component that needs it, so the page's own script carries no framework.

const locale = parseLocale(document.documentElement.dataset.locale) ?? "en"
const i18n = { t: translator(locale), translated: (key: Parameters<typeof translated>[1]) => translated(locale, key) }

/**
 * Renders `view` at the end of `host` with the page language's strings (the shell's, loaded first).
 * With `replace`, it takes the place of what `host` held, in the same task, so nothing blinks.
 */
export async function mount(view: () => JSX.Element, host: Element, replace = false) {
  await loadSlice("shell", locale).catch(() => undefined)
  if (replace) host.textContent = ""
  return render(() => <I18nContext.Provider value={i18n}>{view()}</I18nContext.Provider>, host)
}
