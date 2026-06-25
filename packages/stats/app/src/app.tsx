import { MetaProvider, Meta, Title } from "@solidjs/meta"
import { Router } from "@solidjs/router"
import { FileRoutes } from "@solidjs/start/router"
import { Suspense } from "solid-js"
import "./app.css"

function stripLocaleDataPrefix(pathname: string) {
  const value = pathname.startsWith("/") ? pathname : `/${pathname}`
  return value.replace(/^\/[^/]+(?=\/data(?:\/|$))/, "")
}

function AppMeta() {
  return (
    <>
      <Title>AI Model Usage Rankings | OpenCode Data</Title>
      <Meta
        name="description"
        content="Explore OpenCode Go usage across AI models, including token volume, rankings, market share, token pricing, session cost, cache ratio, and geo breakdowns."
      />
    </>
  )
}

export default function App() {
  return (
    <Router
      base={import.meta.env.BASE_URL.replace(/\/$/, "")}
      explicitLinks={true}
      transformUrl={stripLocaleDataPrefix}
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
