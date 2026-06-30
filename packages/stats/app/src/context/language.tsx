import { createEffect } from "solid-js"
import { getRequestEvent } from "solid-js/web"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import {
  LOCALES,
  detectFromLanguages,
  dir,
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
      },
    }
  },
})
