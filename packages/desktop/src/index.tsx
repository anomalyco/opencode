/* @refresh reload */
import "@/index.css"
import { render } from "solid-js/web"
import { Router, Route } from "@solidjs/router"
import { MetaProvider } from "@solidjs/meta"
import { EventProvider, SDKProvider, SyncProvider, LocalProvider, ShikiProvider, MarkedProvider } from "@/context"
import { Fonts } from "@opencode-ai/ui"
import Home from "@/pages"

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
        <SDKProvider>
          <EventProvider>
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
          </EventProvider>
        </SDKProvider>
      </MarkedProvider>
    </ShikiProvider>
  ),
  root!,
)
