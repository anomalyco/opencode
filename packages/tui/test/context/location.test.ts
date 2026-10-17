import { expect, test } from "bun:test"
import type { OpenCodeEvent } from "@opencode/client"
import { createData } from "@opencode/client/solid"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { createRoot } from "solid-js"
import { createLocation } from "../../src/context/location"
import { createApi, createFetch, directory } from "../fixture/tui-client"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(check: () => boolean, timeout = 5000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await sleep(10)
  }
}

function setup(options: { failures?: number; delay?: number } = {}) {
  return createRoot((dispose) => {
    const events = createGlobalEmitter<{
      [Type in OpenCodeEvent["type"]]: Extract<OpenCodeEvent, { type: Type }>
    }>()
    let failures = options.failures ?? 0
    let vcsCalls = 0
    const api = createApi(
      createFetch((url) => {
        if (url.pathname === "/api/vcs") {
          vcsCalls++
          if (failures > 0) {
            failures--
            return new Response(null, { status: 502 })
          }
        }
        return undefined
      }).fetch,
    )
    const data = createData({ api: () => api, event: events, directory })
    const location = createLocation({
      data,
      connection: { status: () => "connected" },
      event: events,
      delay: options.delay ?? 20,
    })
    return {
      dispose,
      location,
      vcsCalls: () => vcsCalls,
    }
  })
}

test("a transient sync failure is retried before the recovery prompt surfaces", async () => {
  const scope = setup({ failures: 1 })
  try {
    scope.location.set({ directory })
    await waitFor(() => scope.vcsCalls() >= 2)
    expect(scope.location.error).toBeUndefined()
  } finally {
    scope.dispose()
  }
})

test("a persistent sync failure still surfaces the location error", async () => {
  const scope = setup({ failures: 99 })
  try {
    scope.location.set({ directory })
    await waitFor(() => scope.location.error !== undefined)
    expect(scope.location.error?.location.directory).toBe(directory)
  } finally {
    scope.dispose()
  }
})
