import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as SDK from "@opencode-ai/sdk/v2"
import * as App from "../../src/cli/cmd/tui/app"
import { AttachCommand } from "../../src/cli/cmd/tui/attach"
import { RunCommand } from "../../src/cli/cmd/run"
import * as Win32 from "../../src/cli/cmd/tui/win32"
import { TuiConfig } from "../../src/config/tui"
import { Instance } from "../../src/project/instance"
import { UI } from "../../src/cli/ui"

const exit = new Error("exit")

afterEach(() => {
  mock.restore()
  process.exitCode = undefined
})

function client(input: unknown) {
  return input as unknown as SDK.OpencodeClient
}

function stopExit() {
  return spyOn(process, "exit").mockImplementation(() => {
    throw exit
  })
}

function mockAttach() {
  spyOn(Win32, "win32DisableProcessedInput").mockImplementation(() => {})
  spyOn(Win32, "win32InstallCtrlCGuard").mockReturnValue(undefined)
  spyOn(TuiConfig, "get").mockResolvedValue({})
  spyOn(Instance, "provide").mockImplementation(async (input) => input.fn())
}

describe("remote preflight", () => {
  test("attach preflights the remote directory before starting tui", async () => {
    mockAttach()
    const get = mock(async () => ({
      data: {
        home: "/home/me",
        state: "/state",
        config: "/config",
        worktree: "/srv/app",
        directory: "/srv/app",
      },
    }))
    const tui = spyOn(App, "tui").mockResolvedValue()
    spyOn(SDK, "createOpencodeClient").mockReturnValue(
      client({
        path: { get },
      }),
    )

    await AttachCommand.handler({
      _: [],
      $0: "opencode",
      url: "http://remote.test",
      dir: "/srv/app",
      continue: false,
      session: undefined,
      fork: false,
      password: undefined,
    })

    expect(get).toHaveBeenCalledTimes(1)
    expect(tui).toHaveBeenCalledTimes(1)
  })

  test("attach fails clearly when the remote directory does not match", async () => {
    stopExit()
    mockAttach()
    const err = spyOn(UI, "error").mockImplementation(() => {})
    const tui = spyOn(App, "tui").mockResolvedValue()
    spyOn(SDK, "createOpencodeClient").mockReturnValue(
      client({
        path: {
          get: mock(async () => ({
            data: {
              home: "/home/me",
              state: "/state",
              config: "/config",
              worktree: "/srv/other",
              directory: "/srv/other",
            },
          })),
        },
      }),
    )

    let thrown: unknown
    try {
      await Promise.resolve(
        AttachCommand.handler({
          _: [],
          $0: "opencode",
          url: "http://remote.test",
          dir: "/srv/app",
          continue: false,
          session: undefined,
          fork: false,
          password: undefined,
        }),
      )
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBe(exit)
    expect(err).toHaveBeenCalled()
    expect(tui).not.toHaveBeenCalled()
  })

  test("attach fails before starting tui when the remote session is missing", async () => {
    stopExit()
    mockAttach()
    const err = spyOn(UI, "error").mockImplementation(() => {})
    const get = mock(async () => {
      throw new Error("not found")
    })
    const tui = spyOn(App, "tui").mockResolvedValue()
    spyOn(SDK, "createOpencodeClient").mockReturnValue(
      client({
        path: {
          get: mock(async () => ({
            data: {
              home: "/home/me",
              state: "/state",
              config: "/config",
              worktree: "/srv/app",
              directory: "/srv/app",
            },
          })),
        },
        session: { get },
      }),
    )

    let thrown: unknown
    try {
      await Promise.resolve(
        AttachCommand.handler({
          _: [],
          $0: "opencode",
          url: "http://remote.test",
          dir: "/srv/app",
          continue: false,
          session: "missing",
          fork: false,
          password: undefined,
        }),
      )
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBe(exit)
    expect(get).toHaveBeenCalledWith({ sessionID: "missing" }, { throwOnError: true })
    expect(err).toHaveBeenCalledWith(expect.stringContaining('Remote session "missing"'))
    expect(tui).not.toHaveBeenCalled()
  })

  test("attach validates the remote session target before starting tui", async () => {
    mockAttach()
    const get = mock(async () => ({
      data: {
        id: "sess_123",
      },
    }))
    const tui = spyOn(App, "tui").mockResolvedValue()
    spyOn(SDK, "createOpencodeClient").mockReturnValue(
      client({
        path: {
          get: mock(async () => ({
            data: {
              home: "/home/me",
              state: "/state",
              config: "/config",
              worktree: "/srv/app",
              directory: "/srv/app",
            },
          })),
        },
        session: { get },
      }),
    )

    await AttachCommand.handler({
      _: [],
      $0: "opencode",
      url: "http://remote.test",
      dir: "/srv/app",
      continue: false,
      session: "sess_123",
      fork: false,
      password: undefined,
    })

    expect(get).toHaveBeenCalledWith({ sessionID: "sess_123" }, { throwOnError: true })
    expect(tui).toHaveBeenCalledTimes(1)
  })

  test("attach announces the remote continue target before starting tui", async () => {
    mockAttach()
    const info = spyOn(UI, "println").mockImplementation(() => {})
    const list = mock(async () => ({
      data: [
        {
          id: "sess_123",
          title: "Remote draft",
          parentID: undefined,
        },
      ],
    }))
    const tui = spyOn(App, "tui").mockResolvedValue()
    spyOn(SDK, "createOpencodeClient").mockReturnValue(
      client({
        path: {
          get: mock(async () => ({
            data: {
              home: "/home/me",
              state: "/state",
              config: "/config",
              worktree: "/srv/app",
              directory: "/srv/app",
            },
          })),
        },
        session: { list },
      }),
    )

    await AttachCommand.handler({
      _: [],
      $0: "opencode",
      url: "http://remote.test",
      dir: "/srv/app",
      continue: true,
      session: undefined,
      fork: false,
      password: undefined,
    })

    expect(list).toHaveBeenCalledWith({ roots: true }, { throwOnError: true })
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("Continuing remote session"),
      expect.stringContaining("Remote draft"),
      expect.stringContaining("sess_123"),
    )
    expect(tui).toHaveBeenCalledTimes(1)
  })

  test("run --attach fails before creating a session when the remote is unreachable", async () => {
    stopExit()
    const err = spyOn(UI, "error").mockImplementation(() => {})
    const create = mock(async () => {
      throw new Error("session.create should not run")
    })
    spyOn(SDK, "createOpencodeClient").mockReturnValue(
      client({
        path: {
          get: mock(async () => {
            throw new Error("connect ECONNREFUSED")
          }),
        },
        session: {
          create,
        },
      }),
    )

    const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    })

    try {
      let thrown: unknown
      try {
        await Promise.resolve(
          RunCommand.handler({
            _: [],
            $0: "opencode",
            message: ["hi"],
            command: undefined,
            continue: false,
            session: undefined,
            fork: false,
            share: false,
            model: undefined,
            agent: undefined,
            format: "default",
            file: undefined,
            title: undefined,
            attach: "http://remote.test",
            password: undefined,
            dir: undefined,
            port: undefined,
            variant: undefined,
            thinking: false,
          }),
        )
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBe(exit)
    } finally {
      if (tty) Object.defineProperty(process.stdin, "isTTY", tty)
      else delete (process.stdin as { isTTY?: boolean }).isTTY
    }

    expect(err).toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  test("run --attach fails before creating a session when the remote continue target is missing", async () => {
    stopExit()
    const err = spyOn(UI, "error").mockImplementation(() => {})
    const create = mock(async () => {
      throw new Error("session.create should not run")
    })
    const list = mock(async () => ({
      data: [],
    }))
    spyOn(SDK, "createOpencodeClient").mockReturnValue(
      client({
        path: {
          get: mock(async () => ({
            data: {
              home: "/home/me",
              state: "/state",
              config: "/config",
              worktree: "/srv/app",
              directory: "/srv/app",
            },
          })),
        },
        session: {
          list,
          create,
        },
      }),
    )

    const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    })

    try {
      let thrown: unknown
      try {
        await Promise.resolve(
          RunCommand.handler({
            _: [],
            $0: "opencode",
            message: ["hi"],
            command: undefined,
            continue: true,
            session: undefined,
            fork: false,
            share: false,
            model: undefined,
            agent: undefined,
            format: "default",
            file: undefined,
            title: undefined,
            attach: "http://remote.test",
            password: undefined,
            dir: "/srv/app",
            port: undefined,
            variant: undefined,
            thinking: false,
          }),
        )
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBe(exit)
    } finally {
      if (tty) Object.defineProperty(process.stdin, "isTTY", tty)
      else delete (process.stdin as { isTTY?: boolean }).isTTY
    }

    expect(list).toHaveBeenCalledWith({ roots: true }, { throwOnError: true })
    expect(err).toHaveBeenCalledWith(expect.stringContaining("No remote session found to continue"))
    expect(create).not.toHaveBeenCalled()
  })

  test("run --attach fails before forking when the remote fork base is missing", async () => {
    stopExit()
    const err = spyOn(UI, "error").mockImplementation(() => {})
    const get = mock(async () => {
      throw new Error("not found")
    })
    const fork = mock(async () => {
      throw new Error("session.fork should not run")
    })
    spyOn(SDK, "createOpencodeClient").mockReturnValue(
      client({
        path: {
          get: mock(async () => ({
            data: {
              home: "/home/me",
              state: "/state",
              config: "/config",
              worktree: "/srv/app",
              directory: "/srv/app",
            },
          })),
        },
        session: {
          get,
          fork,
        },
      }),
    )

    const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    })

    try {
      let thrown: unknown
      try {
        await Promise.resolve(
          RunCommand.handler({
            _: [],
            $0: "opencode",
            message: ["hi"],
            command: undefined,
            continue: false,
            session: "missing",
            fork: true,
            share: false,
            model: undefined,
            agent: undefined,
            format: "default",
            file: undefined,
            title: undefined,
            attach: "http://remote.test",
            password: undefined,
            dir: "/srv/app",
            port: undefined,
            variant: undefined,
            thinking: false,
          }),
        )
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBe(exit)
    } finally {
      if (tty) Object.defineProperty(process.stdin, "isTTY", tty)
      else delete (process.stdin as { isTTY?: boolean }).isTTY
    }

    expect(get).toHaveBeenCalledWith({ sessionID: "missing" }, { throwOnError: true })
    expect(err).toHaveBeenCalledWith(expect.stringContaining('Remote fork base session "missing"'))
    expect(fork).not.toHaveBeenCalled()
  })
})
