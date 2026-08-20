import "@/index.css"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { FileComponentProvider } from "@opencode-ai/ui/context/file"
import { Font } from "@opencode-ai/ui/font"
import { ThemeProvider } from "@opencode-ai/ui/theme/context"
import { MetaProvider } from "@solidjs/meta"
import { type BaseRouterProps, Route, Router, useParams } from "@solidjs/router"
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
import { LanguageProvider, UiI18nBridge, type Locale, useLanguage } from "@/context/language"
import { LayoutProvider } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { ServerConnection, ServersProvider } from "@/context/servers"
import { SettingsProvider } from "@/context/settings"
import { TabsProvider } from "@/context/tabs"
import { WslServersProvider } from "@/wsl/context"
import Layout from "@/pages/layout"
import { ErrorPage } from "./pages/error"
import { requireServerKey } from "./utils/session-route"

import { Home } from "@/pages/home"
import { ServerProvider } from "./context/server"

const File = lazy(() => import("@opencode-ai/session-ui/file").then((module) => ({ default: module.File })))
const loadDraftRoute = () => Promise.all([import("@/pages/draft-route"), File.preload()]).then(([module]) => module)
const loadSessionRoute = () => Promise.all([import("@/pages/session"), File.preload()]).then(([module]) => module)
const DraftRoute = lazy(() => loadDraftRoute().then((module) => ({ default: module.DraftRoute })))
const TargetSessionRouteContent = lazy(() =>
  loadSessionRoute().then((module) => ({ default: module.TargetSessionRouteContent })),
)

export function preloadRoute(url: string) {
  const pathname = url.split(/[?#]/, 1)[0]
  if (pathname === "/new-session") return DraftRoute.preload().then(() => undefined)
  if (/^\/server\/[^/]+\/session\/[^/]+$/.test(pathname))
    return TargetSessionRouteContent.preload().then(() => undefined)
  return Promise.resolve()
}

function TargetServerRoute(props: ParentProps) {
  const params = useParams<{ serverKey: string }>()
  const global = useGlobal()
  const conn = createMemo(() =>
    global.servers.list().find((item) => ServerConnection.key(item) === requireServerKey(params.serverKey)),
  )

  return (
    // Owns the server-identity remount. Session changes must not remount this subtree.
    <Show when={conn()} keyed>
      {(conn) => <ServerProvider conn={conn}>{props.children}</ServerProvider>}
    </Show>
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

function BodyTypography() {
  createRenderEffect(() => {
    if (typeof document === "undefined") return
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
    onThemeApplied?: () => void
  }>,
) {
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider
        onThemeApplied={(_, mode, scheme) => {
          void window.api?.setTitlebar?.({ mode, scheme })
          props.onThemeApplied?.()
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
}) {
  // The visual layout lives in the router root so it remains mounted across
  // route changes. Draft and session routes override only their server-bound data
  // providers beneath it.
  const Root = (rootProps: ParentProps) => (
    <TabsProvider>
      <BodyTypography />
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
          </Dynamic>
        </GlobalProvider>
      </SettingsProvider>
    </ServersProvider>
  )
}
