import { afterEach, describe, expect, mock, test } from "bun:test"

afterEach(() => {
  mock.restore()
})

describe("attach startup", () => {
  test("selected remote session navigates inside the tui flow", async () => {
    const mod: Record<string, unknown> = await import("../../../src/cli/cmd/tui/app")
    const fn = mod["selectRemoteSession"]
    expect(fn).toBeTypeOf("function")

    const route = {
      navigate: mock(() => {}),
    }
    const dialog = {
      clear: mock(() => {}),
    }
    const sdk = {
      client: {
        session: {
          fork: mock(async () => ({
            data: {
              id: "sess_forked",
            },
          })),
        },
      },
    }
    const toast = {
      show: mock(() => {}),
    }

    if (typeof fn !== "function") return
    await fn({
      id: "sess_456",
      fork: false,
      route,
      dialog,
      sdk,
      toast,
    })

    expect(route.navigate).toHaveBeenCalledWith({
      type: "session",
      sessionID: "sess_456",
    })
    expect(dialog.clear).toHaveBeenCalledTimes(1)
    expect(sdk.client.session.fork).not.toHaveBeenCalled()
    expect(toast.show).not.toHaveBeenCalled()
  })
})
