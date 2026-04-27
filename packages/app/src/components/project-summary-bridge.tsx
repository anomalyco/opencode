import { PostMessageManagerImpl } from "@team-monolith/post-message-manager"
import { onCleanup, onMount } from "solid-js"

type Summary = {
  title: string
  description: string
  usage: string
}

type Result = { status: "ok"; payload: Summary } | { status: "failed"; error: string }

function currentSessionID(): string | undefined {
  const m = window.location.pathname.match(/\/session\/([^/?#]+)/)
  return m?.[1]
}

export function ProjectSummaryBridge() {
  onMount(() => {
    const pmm = new PostMessageManagerImpl(30_000)
    pmm.register({
      messageType: "project.summary.request",
      callback: async (): Promise<Result> => {
        const sid = currentSessionID()
        if (!sid) return { status: "failed", error: "no session" }
        const res = await fetch(new URL("project-summary/generate", document.baseURI), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionID: sid }),
        })
        if (!res.ok) return { status: "failed", error: `HTTP ${res.status}` }
        const payload = (await res.json()) as Summary
        return { status: "ok", payload }
      },
    })
    onCleanup(() => pmm.unregister("project.summary.request"))
  })
  return null
}
