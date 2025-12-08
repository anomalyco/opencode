import "@/index.css"
import { Router, Route, Navigate } from "@solidjs/router"
import { MetaProvider } from "@solidjs/meta"
import { Font } from "@opencode-ai/ui/font"
import { Favicon } from "@opencode-ai/ui/favicon"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { DiffComponentProvider } from "@opencode-ai/ui/context/diff"
import { Diff } from "@opencode-ai/ui/diff"
import { GlobalSyncProvider, useGlobalSync } from "./context/global-sync"
import Layout from "@/pages/layout"
import DirectoryLayout from "@/pages/directory-layout"
import Session from "@/pages/session"
import { LayoutProvider } from "./context/layout"
import { GlobalSDKProvider } from "./context/global-sdk"
import { SessionProvider } from "./context/session"
import { base64Encode } from "@opencode-ai/util/encode"
import { createMemo, Show } from "solid-js"

const host = import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "127.0.0.1"
const port = import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"

const url =
  new URLSearchParams(document.location.search).get("url") ||
  (location.hostname.includes("opencode.ai") || location.hostname.includes("localhost")
    ? `http://${host}:${port}`
    : "/")

export function DesktopInterface() {
  return (
    <MarkedProvider>
      <DiffComponentProvider component={Diff}>
        <GlobalSDKProvider url={url}>
          <GlobalSyncProvider>
            <LayoutProvider>
              <MetaProvider>
                <Font />
                <Router root={Layout}>
                  <Route
                    path="/"
                    component={() => {
                      const globalSync = useGlobalSync()
                      const slug = createMemo(() => base64Encode(globalSync.data.defaultProject!.worktree))
                      return <Navigate href={`${slug()}/session`} />
                    }}
                  />
                  <Route path="/:dir" component={DirectoryLayout}>
                    <Route path="/" component={() => <Navigate href="session" />} />
                    <Route
                      path="/session/:id?"
                      component={(p) => (
                        <Show when={p.params.id || true} keyed>
                          <SessionProvider>
                            <Session />
                          </SessionProvider>
                        </Show>
                      )}
                    />
                  </Route>
                </Router>
              </MetaProvider>
            </LayoutProvider>
          </GlobalSyncProvider>
        </GlobalSDKProvider>
      </DiffComponentProvider>
    </MarkedProvider>
  )
}
