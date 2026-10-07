/// <reference path="./env.d.ts" />

// Load the complete preload contract before App's optional browser bridge declaration.
import {
  AppBaseProviders,
  AppInterface,
  currentRoute,
  PlatformProvider,
  preloadRoute,
  ServerConnection,
  useCommand,
  useCurrentRoute,
  useLanguage,
  useExtensionServers,
  useTabs,
  type LayoutRoute,
} from "@opencode/app/desktop"
import { useTheme } from "@opencode/ui/theme/context"
import type { BaseRouterProps } from "@solidjs/router"
import { createEffect, createMemo, createResource, lazy, Show, Suspense } from "solid-js"
import { createStore } from "solid-js/store"
import type { ElectronAPI } from "./api-types"
import { DesktopFirstLaunchOnboarding } from "./onboarding"
import { createDesktopPlatform } from "./platform"
import { bindDesktopMenu } from "./platform/menu"
import { createSidecarResolver, initializationData, sidecarHttp } from "./startup/initialization"
import { preloadStoredLocale } from "./startup/locale"
import { LoadingSplash } from "./startup/splash"
import { getLastActiveUrl } from "./window/route-storage"
import { DesktopMemoryRouter } from "./window/router"

const MigrationStatus = lazy(() => import("./migration-status").then((module) => ({ default: module.MigrationStatus })))

export function DesktopApp(props: { api: ElectronAPI; version: string }) {
  const windowState = { id: props.api.getWindowID(), version: props.version }
  const initialUrl = getLastActiveUrl(windowState.id)
  const url = new URL(initialUrl, "http://localhost")
  const route = currentRoute(url.pathname, url.search)

  const [startup, setStartup] = createStore({
    ready: false,
    visible: true,
    themeReady: false,
    onboardingReady: false,
    drawingReady: false,
    route,
  })

  // The window was created with the answers the shell gate needs; only a fresh install, which has no
  // onboarding decision yet, asks over IPC and waits for the port.
  const bootstrap = props.api.getWindowBootstrap()

  const [firstLaunch] = createResource(() =>
    bootstrap.firstLaunchPending !== undefined
      ? Promise.resolve(bootstrap.firstLaunchPending)
      : props.api.isFirstLaunchOnboardingPending().catch((error) => {
          console.error("[desktop-onboarding] first launch check failed", error)

          return false
        }),
  )

  const platform = createDesktopPlatform(props.api, windowState)
  const [sidecar, { mutate: setSidecar }] = createResource(() => props.api.awaitInitialization())

  const [defaultServer] = createResource(async () => {
    if (bootstrap.defaultServerUrl === undefined) return platform.getDefaultServer?.()

    return bootstrap.defaultServerUrl ? ServerConnection.Key.make(bootstrap.defaultServerUrl) : null
  })

  const [locale] = createResource(() => preloadStoredLocale(platform))

  const [initialRoute] = createResource(
    () => !firstLaunch.loading && (firstLaunch() && initialUrl === "/" ? "/new-session" : initialUrl),
    preloadRoute,
  )

  const router = (routerProps: BaseRouterProps) => <DesktopMemoryRouter {...routerProps} windowID={windowState.id} />

  const readyToReveal = () =>
    startup.ready &&
    (!import.meta.env.OPENCODE_TEST_ONBOARDING || !firstLaunch() || initialUrl !== "/" || startup.drawingReady)

  // Reveal only after the theme and the first-launch splash choice are both resolved.
  createEffect(() => {
    if (!startup.themeReady || firstLaunch.loading) return
    void props.api.themeReady()
  })

  function ReadyApp() {
    const extensions = useExtensionServers()
    const language = useLanguage()

    const ready = createMemo(
      () => !firstLaunch.loading && !defaultServer.loading && !sidecar.loading && !locale.loading && extensions.ready(),
    )

    const servers = createMemo(() => {
      const data = initializationData(sidecar)
      const list: ServerConnection.Any[] = []

      if (data) {
        list.push({
          displayName: language.t("desktop.server.local"),
          type: "sidecar",
          variant: "base",
          http: sidecarHttp(data),
          reconnect: createSidecarResolver({ api: props.api, current: sidecar, update: setSidecar }),
        })
      }

      list.push(...extensions.list())

      return list
    })

    // Resolved once, when the window first becomes ready, so the app's lifetime never follows live server
    // availability: an extension reloading its server would otherwise remount the whole app. A default that
    // disappears later reads like any unavailable server.
    const startupServer = createMemo<ServerConnection.Key | undefined>((resolved) => {
      if (resolved || !ready()) return resolved
      const key = defaultServer.latest ?? "sidecar"

      // An extension's server that is not listed yet (e.g. a WSL distro still starting) cannot open the window.
      if (key === "sidecar" || /^https?:\/\//.test(key) || extensions.list().some((conn) => conn.key === key))
        return ServerConnection.Key.make(key)

      return ServerConnection.Key.make("sidecar")
    })

    return (
      <Show when={ready()}>
        <Show when={startupServer()} keyed>
          {(key) => (
            <AppInterface defaultServer={key} servers={servers()} router={router}>
              <DesktopStartupReady
                routeReady={!initialRoute.loading && startup.onboardingReady}
                onReady={() => setStartup("ready", true)}
                onRoute={(route) => setStartup("route", route)}
              />
              <DesktopFirstLaunchOnboarding
                api={props.api}
                initialUrl={initialUrl}
                pending={firstLaunch() ?? false}
                onReady={() => setStartup("onboardingReady", true)}
              />
              <DesktopEffects api={props.api} />
              <Suspense fallback={null}>
                <Show when={initializationData(sidecar)} keyed>
                  {(server) => <MigrationStatus server={server} />}
                </Show>
              </Suspense>
            </AppInterface>
          )}
        </Show>
      </Show>
    )
  }

  return (
    <PlatformProvider value={platform}>
      <AppBaseProviders
        locale={locale.latest}
        onNativeTranslations={(bundle) => void props.api.setNativeTranslations(bundle).catch(() => undefined)}
        onThemeApplied={(mode, scheme) => {
          void props.api.setTitlebar({ mode, scheme })
          setStartup("themeReady", true)
        }}
      >
        <Show when={true}>{(_) => <ReadyApp />}</Show>
        <Show when={!firstLaunch.loading && startup.visible}>
          <div
            data-component="startup-overlay"
            class="fixed inset-0 z-[100] transition-opacity duration-300 ease-out"
            classList={{ "pointer-events-none opacity-0": readyToReveal() }}
            onTransitionEnd={(event) => {
              if (event.target !== event.currentTarget || !readyToReveal()) return
              setStartup("visible", false)
            }}
          >
            <LoadingSplash
              firstLaunch={!!firstLaunch() && initialUrl === "/"}
              deep={startup.route.type === "draft"}
              platform={platform}
              preview={import.meta.env.OPENCODE_TEST_ONBOARDING}
              onDrawEnd={() => setStartup("drawingReady", true)}
            />
          </div>
        </Show>
      </AppBaseProviders>
    </PlatformProvider>
  )
}

function DesktopStartupReady(props: {
  routeReady: boolean
  onReady: () => void
  onRoute: (route: LayoutRoute) => void
}) {
  const tabs = useTabs()
  const route = useCurrentRoute()
  createEffect(() => props.onRoute(route()))
  createEffect(() => {
    if (!props.routeReady || !tabs.ready() || !tabs.infoReady()) return
    props.onReady()
  })

  return null
}

function DesktopEffects(props: { api: ElectronAPI }) {
  const command = useCommand()
  bindDesktopMenu((id) => command.trigger(id))
  const theme = useTheme()

  createEffect(() => {
    theme.themeId()
    theme.mode()
    const background = getComputedStyle(document.documentElement).getPropertyValue("--background-base").trim()

    if (background) void props.api.setBackgroundColor(background)
  })

  return null
}
