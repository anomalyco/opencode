import { beforeAll, describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import type { FileDiff } from "@opencode-ai/sdk/v2/client"
import type { State } from "./global-sync/types"

type SyncValue = {
  session: {
    diff: (sessionID: string, opts?: { force?: boolean }) => Promise<void> | undefined
  }
}

let initSyncForTest: () => SyncValue
let currentGlobalSync: unknown
let currentSDK: unknown

beforeAll(async () => {
  let capturedInit: (() => SyncValue) | undefined

  mock.module("@opencode-ai/ui/context", () => ({
    createSimpleContext: (input: { init: () => SyncValue }) => {
      capturedInit = input.init
      return {
        use: () => undefined,
        provider: () => undefined,
      }
    },
  }))

  mock.module("./global-sync", () => ({
    useGlobalSync: () => currentGlobalSync,
  }))

  mock.module("./sdk", () => ({
    useSDK: () => currentSDK,
  }))

  await import("./sync")
  if (!capturedInit) throw new Error("Failed to capture sync context init")
  initSyncForTest = capturedInit
})

function baseState(): State {
  return {
    status: "complete",
    agent: [],
    command: [],
    project: "",
    projectMeta: undefined,
    icon: undefined,
    provider_ready: false,
    provider: { all: [], connected: [], default: {} },
    config: {},
    path: { state: "", config: "", worktree: "", directory: "/tmp/project", home: "" },
    session: [],
    sessionTotal: 0,
    session_status: {},
    session_diff: {},
    todo: {},
    permission: {},
    question: {},
    mcp_ready: false,
    mcp: {},
    lsp_ready: false,
    lsp: [],
    vcs: undefined,
    limit: 5,
    message: {},
    part: {},
  }
}

describe("sync session diff recovery", () => {
  test("re-fetches malformed cached diffs until a valid array is stored", async () => {
    const sessionID = "ses_1"
    const valid = [{ file: "a.ts", before: "", after: "", additions: 1, deletions: 0 }] as FileDiff[]
    const [store, setStore] = createStore({
      ...baseState(),
      session_diff: { [sessionID]: {} as State["session_diff"][string] },
    })

    const diff = mock(async () => {
      const count = diff.mock.calls.length
      return count === 1 ? ({ data: {} } as const) : ({ data: valid } as const)
    })

    currentGlobalSync = {
      child: () => [store, setStore],
      data: {
        project: [],
        session_todo: {},
      },
      todo: {
        set() {},
      },
    }

    currentSDK = {
      directory: "/tmp/project",
      client: {
        session: {
          diff,
        },
      },
    }

    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        const sync = initSyncForTest()
        void (async () => {
          try {
            await sync.session.diff(sessionID)
            expect(diff).toHaveBeenCalledTimes(1)
            expect(store.session_diff[sessionID]).toBeUndefined()

            await sync.session.diff(sessionID)
            expect(diff).toHaveBeenCalledTimes(2)
            expect(store.session_diff[sessionID]).toEqual(valid)

            await sync.session.diff(sessionID)
            expect(diff).toHaveBeenCalledTimes(2)
            resolve()
          } catch (error) {
            reject(error)
          } finally {
            dispose()
          }
        })()
      })
    })
  })
})
