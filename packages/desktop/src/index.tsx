/* @refresh reload */
import "@/index.css"
import { render } from "solid-js/web"
import { Router, Route } from "@solidjs/router"
import { MetaProvider } from "@solidjs/meta"
import { Fonts } from "@opencode-ai/ui"
import { ShikiProvider } from "./context/shiki"
import { MarkedProvider } from "./context/marked"
import { SDKProvider } from "./context/sdk"
import { SyncProvider } from "./context/sync"
import { LocalProvider } from "./context/local"
import Home from "@/pages"

const host = import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "127.0.0.1"
const port = import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"

const url = new URLSearchParams(document.location.search).get("url") || `http://${host}:${port}`

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(
    "Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got misspelled?",
  )
}

render(
  () => (
    <ShikiProvider>
      <MarkedProvider>
        <SDKProvider url={url}>
          <SyncProvider>
            <LocalProvider>
              <MetaProvider>
                <Fonts />
                <Router>
                  <Route path="/" component={Home} />
                </Router>
              </MetaProvider>
            </LocalProvider>
          </SyncProvider>
        </SDKProvider>
      </MarkedProvider>
    </ShikiProvider>
  ),
  root!,
)
