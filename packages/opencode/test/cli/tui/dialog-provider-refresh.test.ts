import { describe, expect, mock, test } from "bun:test"
import { refreshProviderSession } from "../../../src/cli/cmd/tui/component/dialog-provider-refresh"

describe("dialog provider refresh", () => {
  test("forces a session refresh after provider auth inside a session route", async () => {
    const calls: string[] = []
    const sessionSync = mock(async (_sessionID: string, _opts?: { force?: boolean }) => {
      calls.push("sync")
    })

    await refreshProviderSession({
      route: {
        data: {
          type: "session",
          sessionID: "ses_test",
        },
      },
      sdk: {
        client: {
          instance: {
            dispose: async () => {
              calls.push("dispose")
            },
          },
        },
      },
      sync: {
        bootstrap: async () => {
          calls.push("bootstrap")
        },
        session: {
          sync: sessionSync,
        },
      },
    })

    expect(calls).toEqual(["dispose", "bootstrap", "sync"])
    expect(sessionSync).toHaveBeenCalledWith("ses_test", { force: true })
  })

  test("skips session refresh outside a session route", async () => {
    const sessionSync = mock(async () => {})

    await refreshProviderSession({
      route: {
        data: {
          type: "home",
        },
      },
      sdk: {
        client: {
          instance: {
            dispose: async () => {},
          },
        },
      },
      sync: {
        bootstrap: async () => {},
        session: {
          sync: sessionSync,
        },
      },
    })

    expect(sessionSync).not.toHaveBeenCalled()
  })
})
