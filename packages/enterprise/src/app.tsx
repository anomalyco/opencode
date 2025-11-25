import { Router } from "@solidjs/router"
import { FileRoutes } from "@solidjs/start/router"
import { Fonts } from "@opencode-ai/ui/fonts"
import { MetaProvider } from "@solidjs/meta"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { Suspense } from "solid-js"
import "./app.css"

export default function App() {
  return (
    <Router
      root={(props) => (
        <MarkedProvider>
          <MetaProvider>
            <Fonts />
            <Suspense>{props.children}</Suspense>
          </MetaProvider>
        </MarkedProvider>
      )}
    >
      <FileRoutes />
    </Router>
  )
}
