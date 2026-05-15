import { beforeAll, describe, expect, mock, test } from "bun:test"
import type { ServerConnection } from "./server"

let isLocalConnection: (conn: ServerConnection.Any) => boolean

beforeAll(async () => {
  mock.module("@opencode-ai/ui/context", () => ({
    createSimpleContext: () => ({
      use: () => undefined,
      provider: () => undefined,
    }),
  }))
  mock.module("solid-js", () => {
    const noop = () => () => {}
    return {
      $DEVCOMP: false,
      $PROXY: false,
      $TRACK: false,
      DEV: {},
      ErrorBoundary: noop,
      For: noop,
      Index: noop,
      Match: noop,
      Show: noop,
      Suspense: noop,
      SuspenseList: noop,
      Switch: noop,
      batch: (fn: () => void) => fn(),
      catchError: noop,
      children: noop,
      createComponent: noop,
      createComputed: noop,
      createContext: noop,
      createDeferred: noop,
      createEffect: noop,
      createMemo: (fn: () => unknown) => fn,
      createReaction: noop,
      createRenderEffect: noop,
      createResource: () => [undefined, { refetch: () => {} }],
      createRoot: (fn: () => unknown) => fn(),
      createSelector: noop,
      createSignal: () => [() => undefined, () => {}],
      createUniqueId: () => "",
      enableExternalSource: noop,
      enableHydration: noop,
      enableScheduling: noop,
      equalFn: noop,
      from: noop,
      getListener: noop,
      getOwner: () => null,
      indexArray: noop,
      lazy: noop,
      mapArray: noop,
      mergeProps: () => ({}),
      observable: noop,
      on: noop,
      onCleanup: noop,
      onError: noop,
      onMount: noop,
      requestCallback: noop,
      resetErrorBoundaries: noop,
      runWithOwner: noop,
      sharedConfig: {},
      splitProps: () => [],
      startTransition: noop,
      untrack: (fn: () => unknown) => fn(),
      useContext: noop,
      useTransition: () => [false, noop],
    }
  })
  mock.module("solid-js/store", () => ({
    createStore: () => [{}, () => {}],
  }))
  mock.module("@/utils/persist", () => ({
    Persist: { global: () => "" },
    persisted: () => [{}, () => {}, () => {}, () => true],
  }))
  mock.module("@/utils/server-health", () => ({
    useCheckServerHealth: () => () => ({ subscribe: () => () => {} }),
  }))
  const mod = await import("./server")
  isLocalConnection = mod.isLocalConnection
})

describe("isLocalConnection", () => {
  test("returns true for sidecar base variant", () => {
    const conn: ServerConnection.Sidecar = {
      type: "sidecar",
      variant: "base",
      http: { url: "http://127.0.0.1:4096" },
    }
    expect(isLocalConnection(conn)).toBe(true)
  })

  test("returns false for sidecar wsl variant", () => {
    const conn: ServerConnection.Sidecar = {
      type: "sidecar",
      variant: "wsl",
      distro: "Ubuntu",
      http: { url: "http://127.0.0.1:4096" },
    }
    expect(isLocalConnection(conn)).toBe(false)
  })

  test("returns false for http localhost", () => {
    const conn: ServerConnection.Http = {
      type: "http",
      http: { url: "http://localhost:4096" },
    }
    expect(isLocalConnection(conn)).toBe(false)
  })

  test("returns false for http 127.0.0.1", () => {
    const conn: ServerConnection.Http = {
      type: "http",
      http: { url: "http://127.0.0.1:4096" },
    }
    expect(isLocalConnection(conn)).toBe(false)
  })

  test("returns false for http remote IP", () => {
    const conn: ServerConnection.Http = {
      type: "http",
      http: { url: "http://192.168.1.100:4096" },
    }
    expect(isLocalConnection(conn)).toBe(false)
  })

  test("returns false for http remote hostname", () => {
    const conn: ServerConnection.Http = {
      type: "http",
      http: { url: "http://remote.example.com:4096" },
    }
    expect(isLocalConnection(conn)).toBe(false)
  })
})
