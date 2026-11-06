import { createEffect, on } from "solid-js"
import { createStore } from "solid-js/store"
import { getRequestEvent } from "solid-js/web"
import { useLocation } from "@solidjs/router"
import { createSimpleContext } from "@opencode/ui/context"
import {
  LOCALES,
  type Locale,
  clearCookie,
  cookie,
  detectFromLanguages,
  fromPathname,
  dir as localeDir,
  label as localeLabel,
  localeFromCookieHeader,
  localized,
  pageLocale,
  parseLocale,
  route as localeRoute,
  tag as localeTag,
} from "~/lib/language"
import { loadLanguage } from "~/i18n"

function initial() {
  const evt = getRequestEvent()
  if (evt) return pageLocale(evt.request)

  if (typeof document === "object") {
    const fromDom = parseLocale(document.documentElement.dataset.locale)
    if (fromDom) return fromDom

    const fromCookie = localeFromCookieHeader(document.cookie)
    if (fromCookie) return fromCookie
  }

  if (typeof navigator !== "object") return "en" satisfies Locale

  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  return detectFromLanguages(languages)
}

export const { use: useLanguage, provider: LanguageProvider } = createSimpleContext({
  name: "Language",
  init: () => {
    const [store, setStore] = createStore({
      locale: initial(),
    })

    // Back and forward switch to the address's language, as a fresh load would: its locale prefix,
    // else English (an address that never takes a locale, such as the changelog, keeps the current
    // one). The language's strings arrive first; if they can't, the page reloads.
    const location = useLocation()
    createEffect(
      on(
        () => location.pathname,
        (pathname) => {
          const next = fromPathname(pathname) ?? (localized(pathname) ? "en" : store.locale)
          if (next === store.locale) return
          void loadLanguage(next).then(
            () => {
              setStore("locale", next)
              document.cookie = cookie(next)
            },
            () => window.location.reload(),
          )
        },
        { defer: true },
      ),
    )

    createEffect(() => {
      if (typeof document !== "object") return
      document.documentElement.lang = localeTag(store.locale)
      document.documentElement.dir = localeDir(store.locale)
      document.documentElement.dataset.locale = store.locale
    })

    return {
      locale: () => store.locale,
      locales: LOCALES,
      label: localeLabel,
      tag: localeTag,
      dir: localeDir,
      route(pathname: string) {
        return localeRoute(store.locale, pathname)
      },
      setLocale(next: Locale) {
        setStore("locale", next)
        if (typeof document !== "object") return
        document.cookie = cookie(next)
      },
      clear() {
        if (typeof document !== "object") return
        document.cookie = clearCookie()
      },
    }
  },
})
