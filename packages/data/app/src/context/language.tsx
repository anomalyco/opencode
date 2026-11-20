import { createEffect } from "solid-js"
import { getRequestEvent } from "solid-js/web"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode/ui/context"
import {
  LOCALES,
  cookie,
  dir,
  fromPathname,
  label,
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
    const fromDom = parseLocale(document.documentElement.dataset.locale)
    if (fromDom) return fromDom
  }

  return "en" satisfies Locale
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
      // Remember a language picked by URL, for the other apps that read the shared cookie.
      if (fromPathname(window.location.pathname)) document.cookie = cookie(store.locale)
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
