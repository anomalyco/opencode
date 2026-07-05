import { createEffect } from "solid-js"
import { getRequestEvent } from "solid-js/web"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import {
  LOCALES,
  cookie,
  detectFromLanguages,
  dir,
  fromPathname,
  label,
  localeFromCookieHeader,
  localeFromRequest,
  parseLocale,
  route,
  tag,
  type Locale,
} from "../lib/language"

function initial() {
  const event = getRequestEvent()
  if (event) return localeFromRequest(event.request)

  if (typeof window === "object") {
    const fromPath = fromPathname(window.location.pathname)
    if (fromPath) return fromPath
  }

  if (typeof document === "object") {
    const fromCookie = localeFromCookieHeader(document.cookie)
    if (fromCookie) return fromCookie
    const fromDom = parseLocale(document.documentElement.dataset.locale)
    if (fromDom) return fromDom
  }

  if (typeof navigator !== "object") return "en" satisfies Locale
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  return detectFromLanguages(languages)
}

export const { use: useLanguage, provider: LanguageProvider } = createSimpleContext({
  name: "StatsLanguage",
  init: () => {
    const [store, setStore] = createStore({
      locale: initial(),
    })

    createEffect(() => {
      document.documentElement.lang = tag(store.locale)
      document.documentElement.dir = dir(store.locale)
      document.documentElement.dataset.locale = store.locale
    })

    return {
      locale: () => store.locale,
      locales: LOCALES,
      label,
      tag,
      dir,
      route(pathname: string) {
        return route(store.locale, pathname)
      },
      setLocale(next: Locale) {
        setStore("locale", next)
        if (typeof document !== "object") return
        document.cookie = cookie(next)
      },
    }
  },
})
