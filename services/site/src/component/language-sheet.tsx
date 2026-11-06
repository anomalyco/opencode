import { For, Show, onCleanup } from "solid-js"
import { useLocation, useNavigate } from "@solidjs/router"
import { Sheet, type SheetControl } from "~/component/site/sheet"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import { loadLanguage } from "~/i18n/content"
import { displayName, route, strip, tag, type Locale } from "~/lib/language"
import "./language-sheet.css"

/**
 * The language list as a bottom sheet, for touch phones (the dropdown is for pointers). One per page,
 * rendered by the site; the footer's LanguagePicker opens it with openLanguageSheet.
 */

let active: SheetControl | undefined

/** Opens the sheet from a trigger that gets focus back on close. False when the page has no sheet. */
export function openLanguageSheet(trigger: HTMLElement) {
  if (!active) return false
  active.open(trigger)
  return true
}

export function LanguageSheet() {
  const language = useLanguage()
  const i18n = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const href = (locale: Locale) => `${route(locale, strip(location.pathname))}${location.search}${location.hash}`
  let own: SheetControl | undefined
  onCleanup(() => {
    if (active === own) active = undefined
  })

  return (
    <Sheet name="language" label={i18n.t("nav.language")} control={(control) => (active = own = control)}>
      <ul>
        <For each={language.locales}>
          {(locale) => (
            <li>
              <a
                data-slot="row"
                href={href(locale)}
                hreflang={language.tag(locale)}
                lang={language.tag(locale)}
                aria-current={locale === language.locale() ? "true" : undefined}
                // Fetch the language's text as soon as an option is pointed at, focused or touched,
                // so the click switches without waiting for it.
                onPointerEnter={() => void loadLanguage(locale).catch(() => {})}
                onFocus={() => void loadLanguage(locale).catch(() => {})}
                onTouchStart={() => void loadLanguage(locale).catch(() => {})}
                on:click={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                  event.preventDefault()
                  const next = href(locale)
                  active?.close()
                  // Switch once the language's text has arrived, so the page doesn't show English first;
                  // if it can't arrive, load the page in that language instead.
                  void loadLanguage(locale).then(
                    () => {
                      language.setLocale(locale)
                      if (next !== `${location.pathname}${location.search}${location.hash}`) navigate(next)
                    },
                    () => window.location.assign(next),
                  )
                }}
              >
                <span data-slot="native" lang={tag(locale)} dir={language.dir(locale)}>
                  {language.label(locale)}
                </span>
                <Show when={locale !== "en" && locale !== language.locale()}>
                  <span data-slot="english">{displayName(locale, language.locale())}</span>
                </Show>
                <svg data-slot="check" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M2.5 7.5L5.5 10.5L11.5 3.5" stroke="currentColor" stroke-width="1.5" />
                </svg>
              </a>
            </li>
          )}
        </For>
      </ul>
    </Sheet>
  )
}
