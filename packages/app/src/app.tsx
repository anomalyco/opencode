import "@/index.css"
import { ErrorBoundary, Show, lazy, type ParentProps } from "solid-js"
import { Router, Route, Navigate } from "@solidjs/router"
import { MetaProvider } from "@solidjs/meta"
import { Font } from "@crazycode-ai/ui/font"
import { MarkedProvider } from "@crazycode-ai/ui/context/marked"
import { DiffComponentProvider } from "@crazycode-ai/ui/context/diff"
import { CodeComponentProvider } from "@crazycode-ai/ui/context/code"
import { Diff } from "@crazycode-ai/ui/diff"
import { Code } from "@crazycode-ai/ui/code"
import { ThemeProvider } from "@crazycode-ai/ui/theme"
import { GlobalSyncProvider } from "@/context/global-sync"
import { PermissionProvider } from "@/context/permission"
import { LayoutProvider } from "@/context/layout"
import { GlobalSDKProvider } from "@/context/global-sdk"
import { ServerProvider, useServer } from "@/context/server"
import { TerminalProvider } from "@/context/terminal"
import { PromptProvider } from "@/context/prompt"
import { FileProvider } from "@/context/file"
import { NotificationProvider } from "@/context/notification"
import { DialogProvider } from "@crazycode-ai/ui/context/dialog"
import { CommandProvider } from "@/context/command"
import { Logo } from "@crazycode-ai/ui/logo"
import Layout from "@/pages/layout"
import DirectoryLayout from "@/pages/directory-layout"
import { ErrorPage } from "./pages/error"
import { iife } from "@crazycode-ai/util/iife"
import { Suspense } from "solid-js"

const Home = lazy(() => import("@/pages/home"))
const Session = lazy(() => import("@/pages/session"))
const Loading = () => <div class="size-full flex items-center justify-center text-text-weak">Loading...</div>

declare global {
  interface Window {
    __CRAZYCODE__?: { updaterEnabled?: boolean; port?: number; serverReady?: boolean; serverUrl?: string }
  }
}

const defaultServerUrl = iife(() => {
  if (location.hostname.includes("crazycode.ai")) return "http://localhost:4096"
  if (window.__CRAZYCODE__?.serverUrl) return window.__CRAZYCODE__.serverUrl
  if (window.__CRAZYCODE__?.port) return `http://127.0.0.1:${window.__CRAZYCODE__.port}`
  if (import.meta.env.DEV)
    return `http://${import.meta.env.VITE_CRAZYCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_CRAZYCODE_SERVER_PORT ?? "4096"}`

  return window.location.origin
})

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

export function AppInterface() {
  return (
    <ServerProvider defaultUrl={defaultServerUrl}>
      <ServerKey>
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
      </ServerKey>
    </ServerProvider>
  )
}
