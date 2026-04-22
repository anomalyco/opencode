import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as App from "../../../src/cli/cmd/tui/app"
import { UI } from "../../../src/cli/ui"
import * as Win32 from "../../../src/cli/cmd/tui/win32"

describe("tui attach", () => {
  const originalFetch = globalThis.fetch
  const originalExitCode = process.exitCode

  afterEach(() => {
    globalThis.fetch = originalFetch
    process.exitCode = originalExitCode ?? 0
    mock.restore()
  })

  async function call(overrides: Record<string, unknown> = {}) {
    const { AttachCommand } = await import("../../../src/cli/cmd/tui/attach")
    const args: Parameters<NonNullable<typeof AttachCommand.handler>>[0] = {
      _: [],
      $0: "opencode",
      url: "http://127.0.0.1:65535",
      dir: undefined,
      continue: false,
      session: undefined,
      fork: false,
      password: undefined,
      ...overrides,
    }
    return AttachCommand.handler(args)
  }

  test("fails before starting the TUI when the target server is unreachable", async () => {
    const tui = spyOn(App, "tui").mockResolvedValue(undefined)
    const error = spyOn(UI, "error").mockImplementation(() => {})
    spyOn(Win32, "win32DisableProcessedInput").mockImplementation(() => {})
    spyOn(Win32, "win32InstallCtrlCGuard").mockReturnValue(undefined)
    globalThis.fetch = mock(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:65535")
    }) as unknown as typeof fetch

    await call()

    expect(tui).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("Unable to connect to opencode server")
    )
    expect(process.exitCode).toBe(1)
  })
})
