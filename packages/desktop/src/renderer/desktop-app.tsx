/// <reference path="./env.d.ts" />

// Load the complete preload contract before App's optional browser bridge declaration.
import {
  AppBaseProviders,
  AppInterface,
  PlatformProvider,
  preloadRoute,
  ServerConnection,
  useCommand,
  useLanguage,
  useWslServers,
  type UpdaterPlatform,
} from "@opencode-ai/app"
import { useTheme } from "@opencode-ai/ui/theme/context"
import type { BaseRouterProps } from "@solidjs/router"
import { createEffect, createMemo, createResource, lazy, Show, Suspense } from "solid-js"
import type { ElectronAPI } from "../preload/types"
import { DesktopFirstLaunchOnboarding } from "./onboarding"
import { createDesktopPlatform, type DesktopWindowState } from "./platform"
import { bindDesktopMenu } from "./platform/menu"
import { initializationData } from "./startup/initialization"
import { preloadStoredLocale } from "./startup/locale"
import { LoadingSplash } from "./startup/splash"
import { getLastActiveUrl } from "./window/route-storage"
import { DesktopMemoryRouter } from "./window/router"
import { availableStartupServer, readyWslConnections } from "./wsl/connections"

const MigrationStatus = lazy(() => import("./migration-status").then((module) => ({ default: module.MigrationStatus })))

export function DesktopApp(props: { api: ElectronAPI; updater: UpdaterPlatform; version: string }) {
  const [windowState] = createResource(() => props.api.getWindowID().then((id) => ({ id, version: props.version })))
  return (
    <Show when={windowState.latest} fallback={<LoadingSplash />} keyed>
      {(state) => <DesktopWindow api={props.api} updater={props.updater} windowState={state} />}
    </Show>
  )
}

function DesktopWindow(props: { api: ElectronAPI; updater: UpdaterPlatform; windowState: DesktopWindowState }) {
  const platform = createDesktopPlatform(props.api, props.windowState, props.updater)
  const initialUrl = getLastActiveUrl(props.windowState.id)
  const [sidecar] = createResource(() => props.api.awaitInitialization())
  const [defaultServer] = createResource(() => platform.getDefaultServer?.())
  const [locale] = createResource(() => preloadStoredLocale(platform))
  const [route] = createResource(() => preloadRoute(initialUrl))
  const router = (routerProps: BaseRouterProps) => (
    <DesktopMemoryRouter {...routerProps} windowID={props.windowState.id} />
  )

  function ReadyApp() {
    const wslServers = useWslServers()
    const language = useLanguage()
    const ready = createMemo(() => !defaultServer.loading && !sidecar.loading && !locale.loading && !route.loading)
    const servers = createMemo(() => {
      const data = initializationData(sidecar)
      const list: ServerConnection.Any[] = []
      if (data) {
        list.push({
          displayName: language.t("desktop.server.local"),
          type: "sidecar",
          variant: "base",
          http: {
            url: data.url,
            username: data.username ?? undefined,
            password: data.password ?? undefined,
          },
        })
      }
      list.push(...readyWslConnections(wslServers.data, language.t("wsl.server.label")))
      return list
    })
    const effectiveDefaultServer = createMemo(() =>
      ServerConnection.Key.make(availableStartupServer(defaultServer.latest, wslServers.data)),
    )

    return (
      <Show when={ready()} fallback={<LoadingSplash />}>
        <Show when={effectiveDefaultServer()} keyed>
          {(key) => (
            <AppInterface defaultServer={key} servers={servers()} router={router}>
              <DesktopFirstLaunchOnboarding
                api={props.api}
                initialUrl={initialUrl}
                serverKey={key}
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
        onThemeApplied={() => void props.api.themeReady()}
      >
        <Show when={true}>{(_) => <ReadyApp />}</Show>
      </AppBaseProviders>
    </PlatformProvider>
  )
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
