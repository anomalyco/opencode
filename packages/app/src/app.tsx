import "@/index.css"
import { ErrorBoundary, Show, lazy, type ParentProps } from "solid-js"
import { Router, Route, Navigate } from "@solidjs/router"
import { MetaProvider } from "@solidjs/meta"
import { Font } from "@opencode-ai/ui/font"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { DiffComponentProvider } from "@opencode-ai/ui/context/diff"
import { CodeComponentProvider } from "@opencode-ai/ui/context/code"
import { Diff } from "@opencode-ai/ui/diff"
import { Code } from "@opencode-ai/ui/code"
import { ThemeProvider } from "@opencode-ai/ui/theme"
import { GlobalSyncProvider } from "@/context/global-sync"
import { PermissionProvider } from "@/context/permission"
import { LayoutProvider } from "@/context/layout"
import { GlobalSDKProvider } from "@/context/global-sdk"
import { ServerProvider, useServer } from "@/context/server"
import { SessionProvider, useSession } from "@/context/session"
import { SessionExpiredOverlay } from "@/components/session-expired-overlay"
import { TerminalProvider } from "@/context/terminal"
import { PromptProvider } from "@/context/prompt"
import { FileProvider } from "@/context/file"
import { NotificationProvider } from "@/context/notification"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { CommandProvider } from "@/context/command"
import { Logo } from "@opencode-ai/ui/logo"
import Layout from "@/pages/layout"
import DirectoryLayout from "@/pages/directory-layout"
import { ErrorPage } from "./pages/error"
import { iife } from "@opencode-ai/util/iife"
import { Suspense } from "solid-js"

const Home = lazy(() => import("@/pages/home"))
const Session = lazy(() => import("@/pages/session"))
const Loading = () => <div class="size-full" />

declare global {
  interface Window {
    __OPENCODE__?: { updaterEnabled?: boolean; serverPassword?: string }
  }
}

export function AppBaseProviders(props: ParentProps) {
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider>
        <ErrorBoundary fallback={(error) => <ErrorPage error={error} />}>
          <DialogProvider>
            <MarkedProvider>
              <DiffComponentProvider component={Diff}>
                <CodeComponentProvider component={Code}>{props.children}</CodeComponentProvider>
              </DiffComponentProvider>
            </MarkedProvider>
          </DialogProvider>
        </ErrorBoundary>
      </ThemeProvider>
    </MetaProvider>
  )
}

function ServerKey(props: ParentProps) {
  const server = useServer()
  return (
    <Show when={server.url} keyed>
      {props.children}
    </Show>
  )
}

/**
 * Auth gate that waits for session check and redirects to login if needed.
 */
function AuthGate(props: ParentProps) {
  const session = useSession()
  const server = useServer()

  // Wait for initial session check
  // If auth is required but not authenticated, redirect to login
  return (
    <Show
      when={session.ready()}
      fallback={<Loading />}
    >
      <Show
        when={!session.authRequired()}
        fallback={
          <AuthRedirect url={server.url} />
        }
      >
        {props.children}
      </Show>
    </Show>
  )
}

/**
 * Component that redirects to the login page.
 * Passes current URL as returnUrl so user is redirected back after login.
 */
function AuthRedirect(props: { url: string | undefined }) {
  if (props.url) {
    const returnUrl = encodeURIComponent(window.location.href)
    window.location.href = `${props.url}/auth/login?returnUrl=${returnUrl}`
  }
  return <Loading />
}

export function AppInterface(props: { defaultUrl?: string }) {
  const defaultServerUrl = () => {
    if (props.defaultUrl) return props.defaultUrl
    if (location.hostname.includes("opencode.ai")) return "http://localhost:4096"
    if (import.meta.env.DEV)
      return `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`

    return window.location.origin
  }

  return (
    <ServerProvider defaultUrl={defaultServerUrl()}>
      <ServerKey>
        <SessionProvider>
          <SessionExpiredOverlay />
          <AuthGate>
            <GlobalSDKProvider>
              <GlobalSyncProvider>
              <Router
                root={(props) => (
                  <PermissionProvider>
                    <LayoutProvider>
                      <NotificationProvider>
                        <CommandProvider>
                          <Layout>{props.children}</Layout>
                        </CommandProvider>
                      </NotificationProvider>
                    </LayoutProvider>
                  </PermissionProvider>
                )}
              >
              <Route
                path="/"
                component={() => (
                  <Suspense fallback={<Loading />}>
                    <Home />
                  </Suspense>
                )}
              />
              <Route path="/:dir" component={DirectoryLayout}>
                <Route path="/" component={() => <Navigate href="session" />} />
                <Route
                  path="/session/:id?"
                  component={() => (
                    <TerminalProvider>
                      <FileProvider>
                        <PromptProvider>
                          <Suspense fallback={<Loading />}>
                            <Session />
                          </Suspense>
                        </PromptProvider>
                      </FileProvider>
                    </TerminalProvider>
                  )}
                />
              </Route>
            </Router>
              </GlobalSyncProvider>
            </GlobalSDKProvider>
          </AuthGate>
        </SessionProvider>
      </ServerKey>
    </ServerProvider>
  )
}
