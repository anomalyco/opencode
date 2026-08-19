import { expect, test } from "bun:test"
import type { LocationRef } from "@opencode-ai/sdk/v2"
import { createRoot, createSignal } from "solid-js"
import { createUsageResource } from "../../src/component/usage-client"

type UsageSdk = Parameters<typeof createUsageResource>[0]["sdk"]

function usageSdk(calls: LocationRef[], notify: (count: number) => void): UsageSdk {
  return {
    client: {
      usage: {
        get: async (input: { directory?: string; workspace?: string }) => {
          calls.push({ directory: input.directory ?? "", workspaceID: input.workspace })
          notify(calls.length)
          return { data: { results: [] } }
        },
      },
    },
  } as unknown as UsageSdk
}

test("usage resource waits for an active session location", async () => {
  const [location, setLocation] = createSignal<LocationRef | undefined>()
  const calls: LocationRef[] = []
  const ready = Promise.withResolvers<void>()
  const dispose = createRoot((dispose) => {
    createUsageResource({
      sdk: usageSdk(calls, () => ready.resolve()),
      location,
      scope: () => "all",
      modelProviderID: () => null,
    })
    return dispose
  })

  await Bun.sleep(25)
  expect(calls).toEqual([])

  setLocation({ directory: "/workspace", workspaceID: "workspace" })
  await ready.promise
  expect(calls).toEqual([{ directory: "/workspace", workspaceID: "workspace" }])

  setLocation(undefined)
  await Bun.sleep(25)
  expect(calls).toHaveLength(1)
  dispose()
})

test("usage resource follows the active app lifecycle", async () => {
  const [location, setLocation] = createSignal<LocationRef>({ directory: "/first" })
  const firstCalls: LocationRef[] = []
  const firstReady = Promise.withResolvers<void>()
  const disposeFirst = createRoot((dispose) => {
    createUsageResource({
      sdk: usageSdk(firstCalls, () => firstReady.resolve()),
      location,
      scope: () => "all",
      modelProviderID: () => null,
    })
    return dispose
  })

  await firstReady.promise
  expect(firstCalls).toEqual([{ directory: "/first", workspaceID: undefined }])
  disposeFirst()

  setLocation({ directory: "/second" })
  await Bun.sleep(25)
  expect(firstCalls).toHaveLength(1)

  const secondCalls: LocationRef[] = []
  const secondReady = Promise.withResolvers<void>()
  const locationChanged = Promise.withResolvers<void>()
  const disposeSecond = createRoot((dispose) => {
    createUsageResource({
      sdk: usageSdk(secondCalls, (count) => {
        if (count === 1) secondReady.resolve()
        if (count === 2) locationChanged.resolve()
      }),
      location,
      scope: () => "all",
      modelProviderID: () => null,
    })
    return dispose
  })

  await secondReady.promise
  setLocation({ directory: "/third", workspaceID: "workspace" })
  await locationChanged.promise
  expect(secondCalls).toEqual([
    { directory: "/second", workspaceID: undefined },
    { directory: "/third", workspaceID: "workspace" },
  ])

  disposeSecond()
  setLocation({ directory: "/fourth" })
  await Bun.sleep(25)
  expect(secondCalls).toHaveLength(2)
})

test("usage resource keeps readable data after a background failure and recovers", async () => {
  const first = Promise.withResolvers<void>()
  const second = Promise.withResolvers<void>()
  let calls = 0
  let fail = true
  const result = createRoot((dispose) => ({
    dispose,
    resource: createUsageResource({
      sdk: {
        client: {
          usage: {
            get: async () => {
              calls++
              if (calls === 1) first.resolve()
              if (calls === 2) second.resolve()
              if (fail) return { error: { message: "offline" } }
              return { data: { results: [] } }
            },
          },
        },
      } as unknown as UsageSdk,
      location: () => ({ directory: "/workspace" }),
      scope: () => "all",
      modelProviderID: () => null,
    }),
  }))

  await first.promise
  await Bun.sleep(0)
  expect(result.resource.data()).toEqual({ results: [] })

  fail = false
  result.resource.refetch()
  await second.promise
  await Bun.sleep(0)
  expect(result.resource.data()).toEqual({ results: [] })
  expect(calls).toBe(2)
  result.dispose()
})
