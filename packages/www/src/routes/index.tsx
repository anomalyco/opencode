import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/")({
  component: Home,
})

function Home() {
  return (
    <main className="home">
      <p className="home-kicker">OpenCode</p>
      <h1>The open source AI coding agent</h1>
      <p className="home-copy">The new opencode.ai SSR site is running. The V2 documentation is available now.</p>
      <a className="home-link" href="/docs">
        Read the docs
      </a>
    </main>
  )
}
