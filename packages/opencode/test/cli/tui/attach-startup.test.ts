import { afterEach, describe, expect, mock, test } from "bun:test"

afterEach(() => {
  mock.restore()
})

describe("attach startup", () => {
  test("remote browser command exists for remote tui", async () => {
    const mod: Record<string, unknown> = await import("../../../src/cli/cmd/tui/app")
    const fn = mod["getRemoteSessionCommand"]
    expect(fn).toBeTypeOf("function")

    if (typeof fn !== "function") return
    const result = fn({
      remote: true,
      onSelect: mock(async () => {}),
    })

    expect(result).toEqual(
      expect.objectContaining({
        title: "Browse remote sessions",
        value: "remote.session.list",
        category: "Session",
        slash: {
          name: "remote",
        },
      }),
    )
  })

  test("remote browser fetches root remote sessions", async () => {
    const mod: Record<string, unknown> = await import("../../../src/cli/cmd/tui/component/dialog-remote-session-list")
    const fn = mod["listRemoteSessions"]
    expect(fn).toBeTypeOf("function")

    const list = mock(async () => ({
      data: [
        {
          id: "sess_root",
          title: "Root draft",
        },
        {
          id: "sess_child",
          title: "Child fix",
          parentID: "sess_root",
        },
        {
          id: "sess_next",
          title: "Next root",
        },
      ],
    }))

    if (typeof fn !== "function") return
    const result = await fn({
      sdk: {
        client: {
          session: {
            list,
          },
        },
      },
    })

    expect(list).toHaveBeenCalledWith({
      roots: true,
    })
    expect(result).toEqual([
      {
        id: "sess_root",
        title: "Root draft",
      },
      {
        id: "sess_next",
        title: "Next root",
      },
    ])
  })

  test("remote browser selection reuses the existing child browse flow", async () => {
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
    const sdk = {
      client: {
        session: {
          children: mock(async () => ({
            data: [
              {
                id: "sess_child",
                title: "Child fix",
              },
            ],
          })),
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
      route,
      dialog,
      sdk,
      toast,
    })

    expect(dialog.replace).toHaveBeenCalledTimes(1)
    expect(dialog.clear).not.toHaveBeenCalled()
    expect(route.navigate).not.toHaveBeenCalled()
    expect(sdk.client.session.fork).not.toHaveBeenCalled()
  })

  test("fork browse copy makes the fork target explicit", async () => {
    const mod: Record<string, unknown> = await import("../../../src/cli/cmd/tui/component/dialog-remote-session-list")
    const fn = mod["getRemoteBrowse"]
    expect(fn).toBeTypeOf("function")

    if (typeof fn !== "function") return
    const result = fn({
      root: {
        id: "sess_root",
        title: "Root draft",
      },
      sessions: [
        {
          id: "sess_child",
          title: "Child fix",
        },
      ],
      fork: true,
    })

    expect(result).toEqual({
      title: "Fork from remote session",
      options: [
        {
          title: "Root draft",
          value: "sess_root",
          footer: "sess_root",
          description: "Fork from root session",
        },
        {
          title: "Child fix",
          value: "sess_child",
          footer: "sess_child",
          description: "Fork from child session",
        },
      ],
    })
  })

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

  test("fork mode root selection forks from that root", async () => {
    const mod: Record<string, unknown> = await import("../../../src/cli/cmd/tui/component/dialog-remote-session-list")
    const fn = mod["openRemoteSession"]
    expect(fn).toBeTypeOf("function")

    const route = {
      navigate: mock(() => {}),
    }
    const dialog = {
      clear: mock(() => {}),
    }
    const fork = mock(async () => ({
      data: {
        id: "sess_forked_root",
      },
    }))
    const sdk = {
      client: {
        session: {
          fork,
        },
      },
    }
    const toast = {
      show: mock(() => {}),
    }

    if (typeof fn !== "function") return
    await fn({
      id: "sess_root",
      fork: true,
      route,
      dialog,
      sdk,
      toast,
    })

    expect(fork).toHaveBeenCalledWith({
      sessionID: "sess_root",
    })
    expect(route.navigate).toHaveBeenCalledWith({
      type: "session",
      sessionID: "sess_forked_root",
    })
    expect(dialog.clear).toHaveBeenCalledTimes(1)
    expect(toast.show).not.toHaveBeenCalled()
  })

  test("fork mode child selection forks from that child", async () => {
    const mod: Record<string, unknown> = await import("../../../src/cli/cmd/tui/component/dialog-remote-session-list")
    const fn = mod["openRemoteSession"]
    expect(fn).toBeTypeOf("function")

    const route = {
      navigate: mock(() => {}),
    }
    const dialog = {
      clear: mock(() => {}),
    }
    const fork = mock(async () => ({
      data: {
        id: "sess_forked_child",
      },
    }))
    const sdk = {
      client: {
        session: {
          fork,
        },
      },
    }
    const toast = {
      show: mock(() => {}),
    }

    if (typeof fn !== "function") return
    await fn({
      id: "sess_child",
      fork: true,
      route,
      dialog,
      sdk,
      toast,
    })

    expect(fork).toHaveBeenCalledWith({
      sessionID: "sess_child",
    })
    expect(route.navigate).toHaveBeenCalledWith({
      type: "session",
      sessionID: "sess_forked_child",
    })
    expect(dialog.clear).toHaveBeenCalledTimes(1)
    expect(toast.show).not.toHaveBeenCalled()
  })
})
