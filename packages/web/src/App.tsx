import { createSignal, Match, Switch, createEffect } from "solid-js"

import SessionsList from "./components/SessionsList"
import Share from "./components/Share"

function App() {
  const [currentPage, setCurrentPage] = createSignal<"list" | "share">("list")
  const [shareId, setShareId] = createSignal<string | null>(null)

  // Simple client-side routing based on URL path
  createEffect(() => {
    const path = window.location.pathname

    if (path === "/" || path === "/sessions") {
      setCurrentPage("list")
    } else if (path.startsWith("/s/")) {
      const id = path.slice(3) // Remove '/s/' prefix
      setCurrentPage("share")
      setShareId(id)
    }
  })

  // Update URL when page changes
  createEffect(() => {
    if (currentPage() === "list") {
      window.history.replaceState({}, "", "/")
    } else if (currentPage() === "share" && shareId()) {
      window.history.replaceState({}, "", `/s/${shareId()}`)
    }
  })

  return (
    <Switch>
      <Match when={currentPage() === "list"}>
        <SessionsList />
      </Match>
      <Match when={currentPage() === "share" && shareId()}>
        <Share id={shareId()!} />
      </Match>
    </Switch>
  )
}

export default App
