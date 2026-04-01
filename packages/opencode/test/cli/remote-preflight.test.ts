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

    await expect(
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
    ).rejects.toBe(exit)

    expect(err).toHaveBeenCalled()
    expect(tui).not.toHaveBeenCalled()
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
      await expect(
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
      ).rejects.toBe(exit)
    } finally {
      if (tty) Object.defineProperty(process.stdin, "isTTY", tty)
      else delete (process.stdin as { isTTY?: boolean }).isTTY
    }

    expect(err).toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })
})
