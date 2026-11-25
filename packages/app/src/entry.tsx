// @refresh reload

import "@/runtime/polyfills"
import { init } from "@sentry/solid"
import { createEffect } from "solid-js"
import { render } from "solid-js/web"
import { AppBaseProviders, AppInterface } from "@/app"
import { loadInitialLocale } from "@/runtime/i18n/language"
import { PlatformProvider } from "@/runtime/platform/platform"
import { createWebPlatform } from "@/runtime/platform/web"
import { isStandalone, PwaRoutePersistence, restorePwaRoute } from "@/runtime/platform/pwa"
import { KeyboardInsets } from "@/runtime/platform/keyboard"
import en from "@/runtime/i18n/en"
import zh from "@/runtime/i18n/zh"
import {
  hydrateServerPreferences,
  recordPreference,
  serverPreferencesSignedIn,
} from "@/runtime/persistence/server-preferences"
import { authFromToken } from "@/runtime/server/api"
import { isServerHealthy } from "@/runtime/server/health-machine"
import { useGlobal } from "@/runtime/server/runtime"
import pkg from "../package.json"
import { ServerConnection, useServers } from "@/runtime/server/registry"

const getLocale = () => {
  if (typeof navigator === "undefined") return "en" as const
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]

  for (const language of languages) {
    if (!language) continue

    if (language.toLowerCase().startsWith("zh")) return "zh" as const
  }

  return "en" as const
}

const getRootNotFoundError = () => {
  const key = "error.dev.rootNotFound" as const
  const locale = getLocale()

  return locale === "zh" ? (zh[key] ?? en[key]) : en[key]
}

const root = document.getElementById("root")

if (!(root instanceof HTMLElement) && import.meta.env.DEV) {
  throw new Error(getRootNotFoundError())
}

const clearAuthToken = () => {
  const params = new URLSearchParams(location.search)

  if (!params.has("auth_token")) return
  params.delete("auth_token")
  history.replaceState(null, "", location.pathname + (params.size ? `?${params}` : "") + location.hash)
}

// package.json carries the last stable version on every channel, so the server's build passes its own release.
const web = createWebPlatform(import.meta.env.VITE_OPENCODE_VERSION ?? pkg.version)

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`), {
    once: true,
  })
}

if (import.meta.env.VITE_SENTRY_DSN) {
  init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE ?? `web@${pkg.version}`,
    initialScope: {
      tags: {
        platform: "web",
      },
    },
    integrations: (integrations) => {
      return integrations.filter(
        (i) =>
          i.name !== "Breadcrumbs" && !(import.meta.env.OPENCODE_CHANNEL === "prod" && i.name === "GlobalHandlers"),
      )
    },
  })
}

// A server that refused the stored password answers once the user signs in; its preferences then load.
function ServerPreferencesSignIn(props: { server: ServerConnection.Key }) {
  const global = useGlobal()
  const servers = useServers()

  createEffect(() => {
    if (!isServerHealthy(global.servers.health[props.server])) return
    const conn = servers.list.find((item) => ServerConnection.key(item) === props.server)
    serverPreferencesSignedIn(conn && ServerConnection.http(conn)?.password)
  })

  return null
}

if (root instanceof HTMLElement && root.dataset.opencodeMounted === undefined) {
  // Lazy chunks can import the entry chunk back under a distinct URL, so claim the root before async startup.
  root.dataset.opencodeMounted = ""
  const auth = authFromToken(new URLSearchParams(location.search).get("auth_token"))
  clearAuthToken()
  // The server's preferences land in localStorage before anything reads it.
  void (
    web.currentServerUrl
      ? hydrateServerPreferences({ url: web.currentServerUrl, password: auth?.password })
      : Promise.resolve()
  )
    .then(() => loadInitialLocale())
    .then((locale) => {
      const standalone = isStandalone()
      root.dataset.standalone = String(standalone)

      if (standalone) restorePwaRoute()

      const server: ServerConnection.Http | undefined = web.currentServerUrl
        ? {
            type: "http",
            authToken: !!auth,
            http: {
              url: web.currentServerUrl,
              ...auth,
            },
          }
        : undefined

      render(
        () => (
          <PlatformProvider value={web.platform}>
            <AppBaseProviders locale={locale} onThemeStored={(key, value) => recordPreference(undefined, key, value)}>
              <AppInterface
                canonicalLocalServer={server ? ServerConnection.key(server) : undefined}
                servers={server ? [server] : []}
              >
                <KeyboardInsets />
                {standalone && <PwaRoutePersistence />}
                {server && <ServerPreferencesSignIn server={ServerConnection.key(server)} />}
              </AppInterface>
            </AppBaseProviders>
          </PlatformProvider>
        ),
        root,
      )
    })
}
