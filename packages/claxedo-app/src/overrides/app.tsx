import "@/index.css"
import { ErrorBoundary, Show, lazy, type ParentProps, type ParentComponent, Suspense, For, type JSX } from "solid-js"
import { Router, Route, Navigate } from "@solidjs/router"
import { MetaProvider } from "@solidjs/meta"
import { Font } from "@opencode-ai/ui/font"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { DiffComponentProvider } from "@opencode-ai/ui/context/diff"
import { CodeComponentProvider } from "@opencode-ai/ui/context/code"
import { I18nProvider } from "@opencode-ai/ui/context"
import { Diff } from "@opencode-ai/ui/diff"
import { Code } from "@opencode-ai/ui/code"
import { ThemeProvider } from "@opencode-ai/ui/theme"
import { GlobalSyncProvider } from "@/context/global-sync"
import { PermissionProvider } from "@/context/permission"
import { LayoutProvider } from "@/context/layout"
import { GlobalSDKProvider } from "@/context/global-sdk"
import { normalizeServerUrl, ServerProvider, useServer } from "@/context/server"
import { SettingsProvider } from "@/context/settings"
import { NotificationProvider } from "@/context/notification"
import { ModelsProvider } from "@/context/models"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { CommandProvider } from "@/context/command"
import { LanguageProvider, useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { HighlightsProvider } from "@/context/highlights"
import DefaultLayout from "@/pages/layout"
import DirectoryLayout from "@/pages/directory-layout"
import { ErrorPage } from "@/pages/error"
import { getExtensions } from "@opencode-ai/app-shared"

const Home = lazy(() => import("@/pages/home"))
const Session = lazy(() => import("@/pages/session"))
const PermissionsPage = lazy(() => import("@claxedo/pages/permissions"))
const ConfigPage = lazy(() => import("@claxedo/pages/config"))
const Loading = () => <div class="size-full" />

// Extension helper: PassThrough component for default auth guard
const PassThrough: ParentComponent = (p) => <>{p.children}</>

// Extension helper: wrap children with a list of providers
function wrapProviders(providers: ParentComponent[] | undefined, children: JSX.Element): JSX.Element {
  return (providers ?? []).reduceRight<JSX.Element>((acc, Provider) => <Provider>{acc}</Provider>, children)
}

function UiI18nBridge(props: ParentProps) {
  const language = useLanguage()
  return <I18nProvider value={{ locale: language.locale, t: language.t }}>{props.children}</I18nProvider>
}

type DesktopPerf = {
  enabled: boolean
  mark: (name: string, data?: unknown) => void
  span: <T>(name: string, fn: () => Promise<T>, data?: unknown) => Promise<T>
}

declare global {
  interface Window {
    __OPENCODE__?: {
      updaterEnabled?: boolean
      serverPassword?: string
      deepLinks?: string[]
      debugTerminal?: boolean
      perfEnabled?: boolean
      perfPath?: string | null
      perf?: DesktopPerf
    }
  }
}

function MarkedProviderWithNativeParser(props: ParentProps) {
  const platform = usePlatform()
  return <MarkedProvider nativeParser={platform.parseMarkdown}>{props.children}</MarkedProvider>
}

import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
// import { PersistQueryClientProvider } from "@tanstack/solid-query-persist-client"
// import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister"
// import { SolidQueryDevtools } from "@tanstack/solid-query-devtools"

// ... (existing imports)

const day = 1000 * 60 * 60 * 24
const week = day * 7

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
      gcTime: week,
    },
  },
})

// const persister = createSyncStoragePersister({
//   storage: window.localStorage,
//   key: "OPENCODE_QUERY_CACHE", // Explicit key for easier debugging
//   throttleTime: 250,
// })

export function AppBaseProviders(props: ParentProps) {
  return (
    <MetaProvider>
      <Font />
      <QueryClientProvider client={queryClient}>
        {/* <SolidQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" /> */}
        <ThemeProvider>
          <LanguageProvider>
            <UiI18nBridge>
              <ErrorBoundary fallback={(error) => <ErrorPage error={error} />}>
                <DialogProvider>
                  <MarkedProviderWithNativeParser>
                    <DiffComponentProvider component={Diff}>
                      <CodeComponentProvider component={Code}>{props.children}</CodeComponentProvider>
                    </DiffComponentProvider>
                  </MarkedProviderWithNativeParser>
                </DialogProvider>
              </ErrorBoundary>
            </UiI18nBridge>
          </LanguageProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </MetaProvider>
  )
}

function ServerKey(props: ParentProps) {
  const server = useServer()
  const platform = usePlatform()
  return (
    <Show when={platform.platform === "web" || server.url} keyed>
      {props.children}
    </Show>
  )
}

function AuthenticatedLayout(props: ParentProps & { defaultUrl?: string }) {
  const platform = usePlatform()
  const ext = getExtensions()
  const AuthGuard = ext.app.authGuard ?? PassThrough
  const Layout = ext.app.layoutComponent ?? DefaultLayout

  const stored = (() => {
    if (platform.platform !== "web") return
    const result = platform.getDefaultServerUrl?.()
    if (result instanceof Promise) return
    if (!result) return
    return normalizeServerUrl(result)
  })()

  const defaultServerUrl = () => {
    if (props.defaultUrl) return props.defaultUrl
    if (stored) return stored
    if (location.hostname.includes("opencode.ai")) return "http://localhost:4096"
    if (import.meta.env.DEV) return window.location.origin

    return window.location.origin
  }

  return (
    <ServerProvider defaultUrl={defaultServerUrl()}>
      {wrapProviders(
        ext.app.authenticatedProviders,
        <AuthGuard>
          <ServerKey>
            <GlobalSDKProvider>
              <GlobalSyncProvider>
                <SettingsProvider>
                  <PermissionProvider>
                    <LayoutProvider>
                      <NotificationProvider>
                        <ModelsProvider>
                          <CommandProvider>
                            <HighlightsProvider>
                              <Layout>{props.children}</Layout>
                            </HighlightsProvider>
                          </CommandProvider>
                        </ModelsProvider>
                      </NotificationProvider>
                    </LayoutProvider>
                  </PermissionProvider>
                </SettingsProvider>
              </GlobalSyncProvider>
            </GlobalSDKProvider>
          </ServerKey>
        </AuthGuard>,
      )}
    </ServerProvider>
  )
}

export function AppInterface(props: { defaultUrl?: string }) {
  const ext = getExtensions()
  const routes = ext.app.routes ?? []

  return wrapProviders(
    ext.app.providers,
    <Router>
      {/* Extension routes (e.g. /login from cloud package) */}
      <For each={routes}>
        {(route) => <Route path={route.path} component={route.component} />}
      </For>

      <Route path="/" component={(p) => <AuthenticatedLayout {...p} defaultUrl={props.defaultUrl} />}>
        <Route
          path="/"
          component={() => (
            <Suspense fallback={<Loading />}>
              <Home />
            </Suspense>
          )}
        />
        <Route
          path="/permissions"
          component={() => (
            <Suspense fallback={<Loading />}>
              <PermissionsPage />
            </Suspense>
          )}
        />
        <Route
          path="/config"
          component={() => (
            <Suspense fallback={<Loading />}>
              <ConfigPage />
            </Suspense>
          )}
        />
        <Route path="/:dir" component={DirectoryLayout}>
          <Route path="/" component={() => <Navigate href="session" />} />
        <Route path="/session/new" component={() => <Navigate href=".." />} />
        <Route
          path="/session/:id?"
          component={(p) => (
            <Show when={p.params.id ?? "new"}>
              <Suspense fallback={<Loading />}>
                <Session />
              </Suspense>
            </Show>
          )}
        />
        </Route>
      </Route>
    </Router>,
  )
}
