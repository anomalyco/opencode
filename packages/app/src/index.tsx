/* @refresh reload */
import { render } from "solid-js/web"
import { Router, Route } from "@solidjs/router"
import "@/index.css"
import Layout from "@/pages/layout"
import Home from "@/pages"
import {
  EventProvider,
  SDKProvider,
  SyncProvider,
  LocalProvider,
  ThemeProvider,
  ShikiProvider,
  MarkedProvider,
} from "@/context"

const root = document.getElementById("root")

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(
    "Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got misspelled?",
  )
}

render(
  () => (
    <div class="h-full bg-background text-text-muted">
      <ThemeProvider defaultTheme="opencode" defaultDarkMode={true}>
        <ShikiProvider>
          <MarkedProvider>
            <SDKProvider>
              <EventProvider>
                <SyncProvider>
                  <LocalProvider>
                    <Router root={Layout}>
                      <Route path="/" component={Home} />
                    </Router>
                  </LocalProvider>
                </SyncProvider>
              </EventProvider>
            </SDKProvider>
          </MarkedProvider>
        </ShikiProvider>
      </ThemeProvider>
    </div>
  ),
  root!,
)
