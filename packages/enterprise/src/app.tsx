import { Router } from "@solidjs/router"
import { FileRoutes } from "@solidjs/start/router"
import { Fonts } from "@opencode-ai/ui/fonts"
import { MetaProvider } from "@solidjs/meta"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import "./app.css"
import { Suspense } from "solid-js"

export default function App() {
  return (
    <Router
      root={(props) => (
        <Suspense>
          <MarkedProvider>
            <MetaProvider>
              <Fonts />
              {props.children}
            </MetaProvider>
          </MarkedProvider>
        </Suspense>
      )}
    >
      <FileRoutes />
    </Router>
  )
}
