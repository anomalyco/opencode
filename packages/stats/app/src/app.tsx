import { MetaProvider, Meta, Title } from "@solidjs/meta"
import { Router } from "@solidjs/router"
import { FileRoutes } from "@solidjs/start/router"
import { Suspense } from "solid-js"
import "./app.css"

function AppMeta() {
  return (
    <>
      <Title>OpenCode Data</Title>
      <Meta name="description" content="OpenCode usage data, market share, token cost, and session cost." />
    </>
  )
}

export default function App() {
  return (
    <Router
      base={import.meta.env.BASE_URL.replace(/\/$/, "")}
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
