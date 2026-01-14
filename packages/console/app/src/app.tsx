import { MetaProvider, Title, Meta } from "@solidjs/meta"
import { Router } from "@solidjs/router"
import { FileRoutes } from "@solidjs/start/router"
import { Suspense } from "solid-js"
import { Favicon } from "@opencode-ai/ui/favicon"
import { Font } from "@opencode-ai/ui/font"
import "@ibm/plex/css/ibm-plex.css"
import "./app.css"

export default function App() {
  return (
    <Router
      explicitLinks={true}
      root={(props) => (
        <MetaProvider>
          <Title>opencode</Title>
          <Meta name="description" content="OpenCode - The open source coding agent." />
          <Favicon />
          <Font />
          <Suspense>{props.children}</Suspense>
        </MetaProvider>
      )}
    >
      <FileRoutes />
    </Router>
  )
}
