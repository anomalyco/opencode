import "@/index.css"
import { ErrorBoundary, Show } from "solid-js"
import { Router, Route, Navigate } from "@solidjs/router"
import { MetaProvider } from "@solidjs/meta"
import { Font } from "@opencode-ai/ui/font"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { DiffComponentProvider } from "@opencode-ai/ui/context/diff"
import { CodeComponentProvider } from "@opencode-ai/ui/context/code"
import { Diff } from "@opencode-ai/ui/diff"
import { Code } from "@opencode-ai/ui/code"
import { GlobalSyncProvider } from "@/context/global-sync"
import { LayoutProvider } from "@/context/layout"
import { GlobalSDKProvider } from "@/context/global-sdk"
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

declare global {
  interface Window {
    __OPENCODE__?: { updaterEnabled?: boolean; port?: number }
  }
}

const host = import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "127.0.0.1"
const port = window.__OPENCODE__?.port ?? import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"

const url =
  new URLSearchParams(document.location.search).get("url") ||
  (location.hostname.includes("opencode.ai") || location.hostname.includes("localhost")
    ? `http://${host}:${port}`
    : "/")

export function App() {
  return (
    <ErrorBoundary fallback={ErrorPage}>
      <MetaProvider>
        <Font />
        <DialogProvider>
          <MarkedProvider>
            <DiffComponentProvider component={Diff}>
              <CodeComponentProvider component={Code}>
                <GlobalSDKProvider url={url}>
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
                                <Show when={p.params.id || true} keyed>
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
              </CodeComponentProvider>
            </DiffComponentProvider>
          </MarkedProvider>
        </DialogProvider>
      </MetaProvider>
    </ErrorBoundary>
  )
}
