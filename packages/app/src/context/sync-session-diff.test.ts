import { describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import type { FileDiff } from "@opencode-ai/sdk/v2/client"
import type { State } from "./global-sync/types"
import { createSyncContextValue } from "./sync"

type SyncDeps = Parameters<typeof createSyncContextValue>[0]

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

    const globalSync = {
      child: () => [store, setStore],
      data: {
        project: [],
        session_todo: {},
      },
      todo: {
        set() {},
      },
    }

    const sdk = {
      directory: "/tmp/project",
      client: {
        session: {
          diff,
        },
      },
    }

    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        const sync = createSyncContextValue({
          globalSync: globalSync as unknown as SyncDeps["globalSync"],
          sdk: sdk as unknown as SyncDeps["sdk"],
        })
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
