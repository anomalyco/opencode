import { MetaProvider, Meta, Title } from "@solidjs/meta"
import { Router } from "@solidjs/router"
import { FileRoutes } from "@solidjs/start/router"
import { Suspense } from "solid-js"
import "./app.css"

function AppMeta() {
  return (
    <>
      <Title>opencode stats</Title>
      <Meta name="description" content="OpenCode usage and stats." />
    </>
  )
}

export default function App() {
  return (
    <Router
      explicitLinks={true}
      root={(props) => (
        <MetaProvider>
          <AppMeta />
          <Suspense>{props.children}</Suspense>
        </MetaProvider>
      )}
    >
      <FileRoutes />
    </Router>
  )
}
