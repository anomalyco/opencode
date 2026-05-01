import "@/index.css"
import * as Sentry from "@sentry/solid"
import { I18nProvider } from "@opencode-ai/ui/context"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { FileComponentProvider } from "@opencode-ai/ui/context/file"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { File } from "@opencode-ai/ui/file"
import { Font } from "@opencode-ai/ui/font"
import { Splash } from "@opencode-ai/ui/logo"
import { ThemeProvider } from "@opencode-ai/ui/theme/context"
import { MetaProvider } from "@solidjs/meta"
import { type BaseRouterProps, Navigate, Route, Router } from "@solidjs/router"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { Effect } from "effect"
import {
  type Accessor,
  type Component,
  createMemo,
  createEffect,
  createResource,
  createSignal,
  ErrorBoundary,
  For,
  type JSX,
  lazy,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
  Suspense,
} from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { CommandProvider } from "@/context/command"
import { CommentsProvider } from "@/context/comments"
import { FileProvider } from "@/context/file"
import { GlobalSDKProvider } from "@/context/global-sdk"
import { GlobalSyncProvider } from "@/context/global-sync"
import { HighlightsProvider } from "@/context/highlights"
import { LanguageProvider, type Locale, useLanguage } from "@/context/language"
import { LayoutProvider } from "@/context/layout"
import { ModelsProvider } from "@/context/models"
import { NotificationProvider } from "@/context/notification"
import { PermissionProvider } from "@/context/permission"
import { PromptProvider } from "@/context/prompt"
import { ServerConnection, ServerProvider, serverName, useServer } from "@/context/server"
import { SessionHistoryProvider } from "@/context/session-history"
import { SettingsProvider } from "@/context/settings"
import { TerminalProvider } from "@/context/terminal"
import DirectoryLayout from "@/pages/directory-layout"
import Layout from "@/pages/layout"
import { ErrorPage } from "./pages/error"
import { useCheckServerHealth } from "./utils/server-health"

const HomeRoute = lazy(() => import("@/pages/home"))
const Session = lazy(() => import("@/pages/session"))
const Config = lazy(() => import("@/pages/config"))
const Loading = () => <div class="size-full" />

const SessionRoute = Object.assign(
  () => (
    <SessionProviders>
      <Session />
    </SessionProviders>
  ),
  { preload: Session.preload },
)

const SessionIndexRoute = () => <Navigate href="session" />

const ConfigRoute = () => (
  <ErrorBoundary
    fallback={(error, reset) => {
      // 捕获 context 相关错误，提供重试机制
      if (error.message?.includes("GlobalSyncProvider")) {
        return (
          <div class="flex size-full items-center justify-center">
            <div class="flex flex-col items-center gap-4">
              <div class="text-sm text-muted-foreground">配置页面加载失败</div>
              <button
                class="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
                onClick={() => reset()}
              >
                重试
              </button>
            </div>
          </div>
        )
      }
      return <ErrorPage error={error} />
    }}
  >
    <Suspense fallback={<Loading />}>
      <Config />
    </Suspense>
  </ErrorBoundary>
)

function CrashProbe() {
  const [armed, setArmed] = createSignal(false)

  onMount(() => {
    if (!import.meta.env.DEV) return
    if (!new URLSearchParams(location.search).has("force_error")) return
    requestAnimationFrame(() => setArmed(true))
  })

  if (armed()) throw new Error("Forced error page")
  return null
}

function UiI18nBridge(props: ParentProps) {
  const language = useLanguage()
  return <I18nProvider value={{ locale: language.intl, t: language.t }}>{props.children}</I18nProvider>
}

declare global {
  interface Window {
    __OPENCODE__?: {
      updaterEnabled?: boolean
      serverPassword?: string
      deepLinks?: string[]
      initialPath?: string | null
    }
  }
}

function MarkedProviderWithNativeParser(props: ParentProps) {
  const platform = usePlatform()
  return (
    <MarkedProvider
      nativeParser={platform.platform === "desktop" ? platform.parseMarkdown : undefined}
      mathOutput={platform.platform === "desktop" ? "html" : "htmlAndMathml"}
    >
      {props.children}
    </MarkedProvider>
  )
}

function AppShellProviders(props: ParentProps) {
  return (
    <SettingsProvider>
      <PermissionProvider>
        <SessionHistoryProvider>
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
        </SessionHistoryProvider>
      </PermissionProvider>
    </SettingsProvider>
  )
}

function SessionProviders(props: ParentProps) {
  return (
    <TerminalProvider>
      <FileProvider>
        <PromptProvider>
          <CommentsProvider>{props.children}</CommentsProvider>
        </PromptProvider>
      </FileProvider>
    </TerminalProvider>
  )
}

function RouterRoot(props: ParentProps<{ appChildren?: JSX.Element }>) {
  return (
    <AppShellProviders>
      {/*<Suspense fallback={<Loading />}>*/}
      {props.appChildren}
      {props.children}
      {/*</Suspense>*/}
    </AppShellProviders>
  )
}

export function AppBaseProviders(props: ParentProps<{ locale?: Locale }>) {
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider
        onThemeApplied={(_, mode) => {
          void window.api?.setTitlebar?.({ mode })
        }}
      >
        <LanguageProvider locale={props.locale}>
          <UiI18nBridge>
            <ErrorBoundary fallback={(error) => <ErrorPage error={error} />}>
              <CrashProbe />
              <QueryProvider>
                <DialogProvider>
                  <MarkedProvider>
                    <FileComponentProvider component={File}>{props.children}</FileComponentProvider>
                  </MarkedProvider>
                </DialogProvider>
              </QueryProvider>
            </ErrorBoundary>
          </UiI18nBridge>
        </LanguageProvider>
      </ThemeProvider>
    </MetaProvider>
  )
}

const effectMinDuration =
  (duration: Duration.Input) =>
  <A, E, R>(e: Effect.Effect<A, E, R>) =>
    Effect.all([e, Effect.sleep(duration)], { concurrency: "unbounded" }).pipe(Effect.map((v) => v[0]))

function ConnectionGate(props: ParentProps<{ disableHealthCheck?: boolean | Accessor<boolean> }>) {
  const server = useServer()
  const checkServerHealth = useCheckServerHealth()
  const [store, setStore] = createStore({
    message: "",
  })
  let sent = false
  const disabled = () => (typeof props.disableHealthCheck === "function" ? props.disableHealthCheck() : props.disableHealthCheck)

  const [checkMode, setCheckMode] = createSignal<"blocking" | "background">("blocking")

  // performs repeated health check with a grace period for
  // non-http connections, otherwise fails instantly
  const [startupHealthCheck, healthCheckActions] = createResource(() =>
    disabled()
      ? true
      : Effect.gen(function* () {
          if (!server.current) return true
          const { http, type } = server.current

          while (true) {
            const res = yield* Effect.promise(() => checkServerHealth(http))
            setStore("message", res.message ?? "")
            if (res.healthy) return true
            if (checkMode() === "background" || type === "http") return false
          }
        }).pipe(
          Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.succeed(false) }),
          Effect.ensuring(Effect.sync(() => setCheckMode("background"))),
          Effect.runPromise,
        ),
  )

  createEffect(() => {
    if (sent) return
    if (startupHealthCheck.loading) return
    if (!startupHealthCheck()) return
    sent = true
    queueMicrotask(() => window.dispatchEvent(new CustomEvent("opencode:startup-ready")))
  })

  return (
    <Suspense
      fallback={
        <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base">
          <Splash class="w-16 h-20 opacity-50 animate-pulse" />
        </div>
      }
    >
      {/*<Show
        when={checkMode() === "blocking" ? !startupHealthCheck.loading : startupHealthCheck.state !== "pending"}
        fallback={
          <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base">
            <Splash class="w-16 h-20 opacity-50 animate-pulse" />
          </div>
        }
      >*/}
      {checkMode() === "blocking" ? startupHealthCheck() : startupHealthCheck.latest}
      <Show
        when={startupHealthCheck()}
        fallback={
          <ConnectionError
            message={() => store.message}
            onRetry={() => {
              if (checkMode() === "background") void healthCheckActions.refetch()
            }}
            onServerSelected={(key) => {
              setCheckMode("blocking")
              server.setActive(key)
              void healthCheckActions.refetch()
            }}
          />
        }
      >
        {props.children}
      </Show>
      {/*</Show>*/}
    </Suspense>
  )
}

function ConnectionError(props: {
  message?: Accessor<string>
  onRetry?: () => void
  onServerSelected?: (key: ServerConnection.Key) => void
}) {
  const language = useLanguage()
  const server = useServer()
  const others = () => server.list.filter((s) => ServerConnection.key(s) !== server.key)
  const name = createMemo(() => server.name || server.key)
  const serverToken = "\u0000server\u0000"
  const unreachable = createMemo(() => language.t("app.server.unreachable", { server: serverToken }).split(serverToken))

  const timer = setInterval(() => props.onRetry?.(), 1000)
  onCleanup(() => clearInterval(timer))

  return (
    <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base gap-6 p-6">
      <div class="flex flex-col items-center max-w-md text-center">
        <Splash class="w-12 h-15 mb-4" />
        <p class="text-14-regular text-text-base">
          {unreachable()[0]}
          <span class="text-text-strong font-medium">{name()}</span>
          {unreachable()[1]}
        </p>
        <p class="mt-1 text-12-regular text-text-weak">{language.t("app.server.retrying")}</p>
        <Show when={props.message?.()}>
          <p class="mt-2 text-12-regular text-text-danger break-words">{props.message?.()}</p>
        </Show>
      </div>
      <Show when={others().length > 0}>
        <div class="flex flex-col gap-2 w-full max-w-sm">
          <span class="text-12-regular text-text-base text-center">{language.t("app.server.otherServers")}</span>
          <div class="flex flex-col gap-1 bg-surface-base rounded-lg p-2">
            <For each={others()}>
              {(conn) => {
                const key = ServerConnection.key(conn)
                return (
                  <button
                    type="button"
                    class="flex items-center gap-3 w-full px-3 py-2 rounded-md hover:bg-surface-raised-base-hover transition-colors text-left"
                    onClick={() => props.onServerSelected?.(key)}
                  >
                    <span class="text-14-regular text-text-strong truncate">{serverName(conn)}</span>
                  </button>
                )
              }}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}

function ServerScopedApp(props: ParentProps<{ disableHealthCheck?: boolean | Accessor<boolean>; router?: Component<BaseRouterProps> }>) {
  const server = useServer()
  return (
    <Show when={server.current}>
      <ConnectionGate disableHealthCheck={props.disableHealthCheck}>
        <GlobalSDKProvider>
          <GlobalSyncProvider>
            <Dynamic
              component={props.router ?? Router}
              root={(routerProps) => <RouterRoot appChildren={props.children}>{routerProps.children}</RouterRoot>}
            >
              <Route path="/" component={HomeRoute} />
              <Route path="/:dir" component={DirectoryLayout}>
                <Route path="/" component={SessionIndexRoute} />
                <Route path="/session/:id?" component={SessionRoute} />
                <Route path="/config" component={ConfigRoute} />
              </Route>
            </Dynamic>
          </GlobalSyncProvider>
        </GlobalSDKProvider>
      </ConnectionGate>
    </Show>
  )
}

export function AppInterface(props: {
  children?: JSX.Element
  defaultServer: ServerConnection.Key
  servers?: Array<ServerConnection.Any>
  router?: Component<BaseRouterProps>
  disableHealthCheck?: boolean | Accessor<boolean>
}) {
  return (
    <ServerProvider defaultServer={props.defaultServer} servers={props.servers}>
      <ServerScopedApp disableHealthCheck={props.disableHealthCheck} router={props.router}>
        {props.children}
      </ServerScopedApp>
    </ServerProvider>
  )
}
