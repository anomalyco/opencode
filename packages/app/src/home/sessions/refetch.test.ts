import { describe, expect, setSystemTime, test } from "bun:test"
import { QueryClient, QueryObserver } from "@tanstack/solid-query"
import { HOME_SESSION_INDEX_REFETCH } from "./refetch"

describe("Home session index refetching", () => {
  // The app turns focus, mount, and reconnect refetching off for every query; Home opts back in.
  const appDefaults = {
    queries: { refetchOnMount: false, refetchOnReconnect: false, refetchOnWindowFocus: false },
  }

  const settled = async (done: () => boolean) => {
    for (let attempt = 0; attempt < 50 && !done(); attempt++) await new Promise((resolve) => setTimeout(resolve, 5))
  }

  test("re-reads the index when the window comes back, and only once it is stale", async () => {
    const client = new QueryClient({ defaultOptions: appDefaults })
    let calls = 0

    const options = {
      queryKey: ["home-sessions"] as const,
      queryFn: async () => {
        calls++

        return []
      },
      ...HOME_SESSION_INDEX_REFETCH,
    }

    await client.fetchQuery(options)
    expect(calls).toBe(1)

    client.mount()
    const observer = new QueryObserver(client, options)
    const unsubscribe = observer.subscribe(() => {})

    try {
      // Fresh data: coming back to the window costs nothing.
      window.dispatchEvent(new Event("visibilitychange"))
      await settled(() => calls > 1)
      expect(calls).toBe(1)

      setSystemTime(new Date(Date.now() + HOME_SESSION_INDEX_REFETCH.staleTime + 1))
      window.dispatchEvent(new Event("visibilitychange"))
      await settled(() => calls > 1)
      expect(calls).toBe(2)
    } finally {
      setSystemTime()
      unsubscribe()
      client.unmount()
    }
  })
})
