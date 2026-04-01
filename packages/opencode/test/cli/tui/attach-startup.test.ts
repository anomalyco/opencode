import { afterEach, describe, expect, mock, test } from "bun:test"

afterEach(() => {
  mock.restore()
})

describe("attach startup", () => {
  test("root without children navigates inside the tui flow", async () => {
    const mod: Record<string, unknown> = await import("../../../src/cli/cmd/tui/component/dialog-remote-session-list")
    const fn = mod["selectRemoteSession"]
    expect(fn).toBeTypeOf("function")

    const route = {
      navigate: mock(() => {}),
    }
    const dialog = {
      clear: mock(() => {}),
      replace: mock(() => {}),
    }
    const children = mock(async () => ({
      data: [],
    }))
    const sdk = {
      client: {
        session: {
          children,
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
    expect(children).toHaveBeenCalledWith({
      sessionID: "sess_456",
    })
    expect(dialog.clear).toHaveBeenCalledTimes(1)
    expect(dialog.replace).not.toHaveBeenCalled()
    expect(sdk.client.session.fork).not.toHaveBeenCalled()
    expect(toast.show).not.toHaveBeenCalled()
  })

  test("root with children opens the child browse flow", async () => {
    const mod: Record<string, unknown> = await import("../../../src/cli/cmd/tui/component/dialog-remote-session-list")
    const fn = mod["selectRemoteSession"]
    expect(fn).toBeTypeOf("function")

    const route = {
      navigate: mock(() => {}),
    }
    const dialog = {
      clear: mock(() => {}),
      replace: mock(() => {}),
    }
    const children = mock(async () => ({
      data: [
        {
          id: "sess_child",
          title: "Child fix",
        },
      ],
    }))
    const sdk = {
      client: {
        session: {
          children,
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
      id: "sess_root",
      title: "Root draft",
      fork: false,
      route,
      dialog,
      sdk,
      toast,
    })

    expect(children).toHaveBeenCalledWith({
      sessionID: "sess_root",
    })
    expect(dialog.replace).toHaveBeenCalledTimes(1)
    expect(dialog.clear).not.toHaveBeenCalled()
    expect(route.navigate).not.toHaveBeenCalled()
    expect(sdk.client.session.fork).not.toHaveBeenCalled()
  })

  test("selected child navigates inside the tui flow", async () => {
    const mod: Record<string, unknown> = await import("../../../src/cli/cmd/tui/component/dialog-remote-session-list")
    const fn = mod["openRemoteSession"]
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
      id: "sess_child",
      fork: false,
      route,
      dialog,
      sdk,
      toast,
    })

    expect(route.navigate).toHaveBeenCalledWith({
      type: "session",
      sessionID: "sess_child",
    })
    expect(dialog.clear).toHaveBeenCalledTimes(1)
    expect(sdk.client.session.fork).not.toHaveBeenCalled()
    expect(toast.show).not.toHaveBeenCalled()
  })
})
