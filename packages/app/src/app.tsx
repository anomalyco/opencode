import "@/index.css"
import { I18nProvider } from "@opencode-ai/ui/context"
import type { UiI18n } from "@opencode-ai/ui/context/i18n"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { FileComponentProvider } from "@opencode-ai/ui/context/file"
import { Font } from "@opencode-ai/ui/font"
import { ThemeProvider } from "@opencode-ai/ui/theme/context"
import { MetaProvider } from "@solidjs/meta"
import { type BaseRouterProps, Navigate, Route, Router, useParams } from "@solidjs/router"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import {
  type Component,
  createMemo,
  createRenderEffect,
  ErrorBoundary,
  type JSX,
  lazy,
  type ParentProps,
  Show,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import { CommandProvider, useCommand, type CommandOption } from "@/context/command"
import { GlobalProvider, useGlobal } from "@/context/global"
import { HighlightsProvider } from "@/context/highlights"
import { LanguageProvider, type Locale, useLanguage } from "@/context/language"
import { LayoutProvider } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { ServerConnection, ServersProvider, useServers } from "@/context/servers"
import { SettingsProvider } from "@/context/settings"
import { TabsProvider, useTabs } from "@/context/tabs"
import { WslServersProvider } from "@/wsl/context"
import Layout from "@/pages/layout"
import { ErrorPage } from "./pages/error"
import { legacySessionServer, requireServerKey, sessionHref } from "./utils/session-route"

import { Home } from "@/pages/home"
import { ServerProvider } from "./context/server"

const File = lazy(() => import("@opencode-ai/session-ui/file").then((module) => ({ default: module.File })))
const loadDraftRoute = () => Promise.all([import("@/pages/draft-route"), File.preload()]).then(([module]) => module)
const loadSessionRoute = () => Promise.all([import("@/pages/session"), File.preload()]).then(([module]) => module)
const DirectoryDraftRedirect = lazy(() =>
  loadDraftRoute().then((module) => ({ default: module.DirectoryDraftRedirect })),
)
const DraftRoute = lazy(() => loadDraftRoute().then((module) => ({ default: module.DraftRoute })))
const TargetSessionRouteContent = lazy(() =>
  loadSessionRoute().then((module) => ({ default: module.TargetSessionRouteContent })),
)

export function preloadRoute(pathname: string) {
  if (pathname === "/") return Promise.resolve()
  if (pathname.startsWith("/server/") || /\/session\/[^/]+$/.test(pathname))
    return TargetSessionRouteContent.preload().then(() => undefined)
  return Promise.all([DirectoryDraftRedirect.preload(), DraftRoute.preload()]).then(() => undefined)
}

function TargetServerRoute(props: ParentProps) {
  const params = useParams<{ serverKey: string; id: string }>()
  const global = useGlobal()
  const conn = createMemo(() => {
    const key = requireServerKey(params.serverKey)
    return global.servers.list().find((item) => ServerConnection.key(item) === key)
  })

  return (
    // Owns the server-identity remount. Session changes must not remount this subtree.
    <Show when={requireServerKey(params.serverKey)} keyed>
      <Show when={conn()} keyed>
        {(conn) => <ServerProvider conn={conn}>{props.children}</ServerProvider>}
      </Show>
    </Show>
  )
}

function UiI18nBridge(props: ParentProps) {
  const language = useLanguage()
  return (
    <I18nProvider
      value={{
        locale: language.intl,
        layoutLocale: language.layoutLocale,
        t: language.t as UiI18n["t"],
        plural: language.plural,
        pluralForm: language.pluralForm,
      }}
    >
      {props.children}
    </I18nProvider>
  )
}

declare global {
  interface Window {
    __OPENCODE__?: {
      deepLinks?: string[]
    }
    api?: {
      setTitlebar?: (theme: { mode: "light" | "dark"; scheme?: "system" | "light" | "dark" }) => Promise<void>
      exportDebugLogs?: () => Promise<string>
    }
  }
}

function QueryProvider(props: ParentProps) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
      },
    },
  })
  return <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
}

function BodyDesignClass() {
  createRenderEffect(() => {
    if (typeof document === "undefined") return
    document.body.toggleAttribute("data-new-layout", true)
    document.body.classList.remove("text-12-regular")
    document.body.classList.add("font-(family-name:--font-family-text)", "text-[13px]", "font-[440]")
  })

  return null
}

// Server-agnostic providers shared across every route. These live in the shared
// shell (router root) so they stay mounted regardless of the active server/route.
function DesktopCommands() {
  const command = useCommand()
  const language = useLanguage()
  const platform = usePlatform()

  command.register("desktop", () => {
    const commands: CommandOption[] = []
    if (platform.platform === "desktop" && platform.exportDebugLogs) {
      commands.push({
        id: "logs.export",
        title: language.t("command.logs.export"),
        category: language.t("command.category.settings"),
        onSelect: () => {
          void platform.exportDebugLogs?.()
        },
      })
    }
    return commands
  })

  return null
}

function AppLayout(props: ParentProps) {
  return (
    <LayoutProvider>
      <Layout>{props.children}</Layout>
    </LayoutProvider>
  )
}

export function AppBaseProviders(
  props: ParentProps<{
    locale?: Locale
    onNativeTranslations?: Parameters<typeof LanguageProvider>[0]["onNativeTranslations"]
  }>,
) {
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider
        onThemeApplied={(_, mode, scheme) => {
          void window.api?.setTitlebar?.({ mode, scheme })
        }}
      >
        <LanguageProvider locale={props.locale} onNativeTranslations={props.onNativeTranslations}>
          <UiI18nBridge>
            <ErrorBoundary
              fallback={(error) => {
                void import("@sentry/solid").then(({ captureException }) => captureException(error))
                return <ErrorPage error={error} />
              }}
            >
              <QueryProvider>
                <WslServersProvider>
                  <DialogProvider>
                    <FileComponentProvider component={File}>{props.children}</FileComponentProvider>
                  </DialogProvider>
                </WslServersProvider>
              </QueryProvider>
            </ErrorBoundary>
          </UiI18nBridge>
        </LanguageProvider>
      </ThemeProvider>
    </MetaProvider>
  )
}

export function AppInterface(props: {
  children?: JSX.Element
  defaultServer: ServerConnection.Key
  canonicalLocalServer?: ServerConnection.Key
  servers?: Array<ServerConnection.Any>
  router?: Component<BaseRouterProps>
  disableHealthCheck?: boolean
  startup?: Promise<void>
}) {
  // The visual layout lives in the router root so it remains mounted across
  // route changes. Draft and session routes override only their server-bound data
  // providers beneath it.
  const Root = (rootProps: ParentProps) => (
    <TabsProvider>
      <BodyDesignClass />
      <CommandProvider>
        <DesktopCommands />
        <HighlightsProvider>
          {props.children}
          {rootProps.children}
        </HighlightsProvider>
      </CommandProvider>
    </TabsProvider>
  )

  return (
    <ServersProvider
      defaultServer={props.defaultServer}
      canonicalLocalServer={props.canonicalLocalServer}
      servers={props.servers}
    >
      <SettingsProvider>
        <GlobalProvider>
          <Dynamic component={props.router ?? Router} root={Root}>
            {/* Proper Routes */}
            <Route component={AppLayout}>
              <Route path="/" component={Home} />
              <Route
                path="/server/:serverKey/session/:id"
                component={() => (
                  <TargetServerRoute>
                    <TargetSessionRouteContent />
                  </TargetServerRoute>
                )}
              />
              <Route path="/new-session" component={DraftRoute} />
            </Route>
            {/* Legacy Routes */}
            <Route>
              <Route path="/:dir" component={DirectoryDraftRedirect} />
              <Route path="/:dir/session" component={DirectoryDraftRedirect} />
              <Route path="/:dir/session/:id" component={LegacySessionRedirect} />
            </Route>
          </Dynamic>
        </GlobalProvider>
      </SettingsProvider>
    </ServersProvider>
  )
}

function LegacySessionRedirect() {
  const server = useServers()
  const tabs = useTabs()
  const params = useParams<{ id: string }>()

  return (
    <Show when={tabs.ready()}>
      <Navigate
        href={sessionHref(
          legacySessionServer(
            tabs.store.filter((item) => item.type === "session"),
            params.id,
            ServerConnection.key(server.list[0]),
          ),
          params.id,
        )}
      />
    </Show>
  )
}
