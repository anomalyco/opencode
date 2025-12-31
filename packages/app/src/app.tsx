import "@/index.css"
import { ErrorBoundary, Show, type ParentProps } from "solid-js"
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
import { LayoutProvider } from "@/context/layout"
import { GlobalSDKProvider } from "@/context/global-sdk"
import { ServerProvider, useServer } from "@/context/server"
import { TerminalProvider } from "@/context/terminal"
import { PromptProvider } from "@/context/prompt"
import { NotificationProvider } from "@/context/notification"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { CommandProvider } from "@/context/command"
import Layout from "@/pages/layout"
import Home from "@/pages/home"
import DirectoryLayout from "@/pages/directory-layout"
import Session from "@/pages/session"
import { ErrorPage } from "./pages/error"
import { iife } from "@opencode-ai/util/iife"

declare global {
  interface Window {
    __OPENCODE__?: { updaterEnabled?: boolean; port?: number }
  }
}

const defaultServerUrl = iife(() => {
  const param = new URLSearchParams(document.location.search).get("url")
  if (param) return param

  if (location.hostname.includes("opencode.ai")) return "http://localhost:4096"
  if (window.__OPENCODE__) return `http://127.0.0.1:${window.__OPENCODE__.port}`
  if (import.meta.env.DEV)
    return `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`

  return window.location.origin
})

function ServerKey(props: ParentProps) {
  const server = useServer()
  return (
    <Show when={server.url} keyed>
      {props.children}
    </Show>
  )
}

export function App() {
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider>
        <ErrorBoundary fallback={(error) => <ErrorPage error={error} />}>
          <DialogProvider>
            <MarkedProvider>
              <DiffComponentProvider component={Diff}>
                <CodeComponentProvider component={Code}>
                  <ServerProvider defaultUrl={defaultServerUrl}>
                    <ServerKey>
                      <GlobalSDKProvider>
                        <GlobalSyncProvider>
                          <LayoutProvider>
                            <NotificationProvider>
                              <Router
                                root={(props) => (
                                  <CommandProvider>
                                    <Layout>{props.children}</Layout>
                                  </CommandProvider>
                                )}
                              >
                                <Route path="/" component={Home} />
                                <Route path="/:dir" component={DirectoryLayout}>
                                  <Route path="/" component={() => <Navigate href="session" />} />
                                  <Route
                                    path="/session/:id?"
                                    component={(p) => (
                                      <Show when={p.params.id ?? "new"} keyed>
                                        <TerminalProvider>
                                          <PromptProvider>
                                            <Session />
                                          </PromptProvider>
                                        </TerminalProvider>
                                      </Show>
                                    )}
                                  />
                                </Route>
                              </Router>
                            </NotificationProvider>
                          </LayoutProvider>
                        </GlobalSyncProvider>
                      </GlobalSDKProvider>
                    </ServerKey>
                  </ServerProvider>
                </CodeComponentProvider>
              </DiffComponentProvider>
            </MarkedProvider>
          </DialogProvider>
        </ErrorBoundary>
      </ThemeProvider>
    </MetaProvider>
  )
}
