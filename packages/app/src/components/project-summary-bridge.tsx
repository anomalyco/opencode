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

const TIMEOUT_MS = 30_000

export function ProjectSummaryBridge() {
  onMount(() => {
    const pmm = new PostMessageManagerImpl(TIMEOUT_MS)
    pmm.register({
      messageType: "project.summary.request",
      callback: async (): Promise<Result> => {
        const sid = currentSessionID()
        if (!sid) return { status: "failed", error: "no session" }
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
        try {
          const res = await fetch(new URL("project-summary/generate", document.baseURI), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionID: sid }),
            signal: controller.signal,
          })
          if (!res.ok) return { status: "failed", error: `HTTP ${res.status}` }
          const payload = (await res.json()) as Summary
          return { status: "ok", payload }
        } catch (e) {
          if (controller.signal.aborted) return { status: "failed", error: "timeout" }
          return { status: "failed", error: e instanceof Error ? e.message : String(e) }
        } finally {
          clearTimeout(timer)
        }
      },
    })
    onCleanup(() => pmm.unregister("project.summary.request"))
  })
  return null
}
