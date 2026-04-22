import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as App from "../../../src/cli/cmd/tui/app"
import { UI } from "../../../src/cli/ui"
import * as Win32 from "../../../src/cli/cmd/tui/win32"

describe("tui attach", () => {
  const originalFetch = globalThis.fetch
  const originalAttachHealthTimeout = process.env.OPENCODE_ATTACH_HEALTH_TIMEOUT_MS

  afterEach(() => {
    globalThis.fetch = originalFetch
    process.exitCode = 0
    if (originalAttachHealthTimeout === undefined) delete process.env.OPENCODE_ATTACH_HEALTH_TIMEOUT_MS
    else process.env.OPENCODE_ATTACH_HEALTH_TIMEOUT_MS = originalAttachHealthTimeout
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

  test("redacts credentials and query params from attach errors", async () => {
    const error = spyOn(UI, "error").mockImplementation(() => {})
    spyOn(App, "tui").mockResolvedValue(undefined)
    spyOn(Win32, "win32DisableProcessedInput").mockImplementation(() => {})
    spyOn(Win32, "win32InstallCtrlCGuard").mockReturnValue(undefined)
    globalThis.fetch = mock(async () => {
      throw new Error("connect ECONNREFUSED")
    }) as unknown as typeof fetch

    await call({ url: "http://user:pass@127.0.0.1:65535/?token=secret" })

    expect(error).toHaveBeenCalledWith(expect.stringContaining("http://127.0.0.1:65535/"))
    expect(error).not.toHaveBeenCalledWith(expect.stringContaining("user"))
    expect(error).not.toHaveBeenCalledWith(expect.stringContaining("pass"))
    expect(error).not.toHaveBeenCalledWith(expect.stringContaining("token"))
    expect(error).not.toHaveBeenCalledWith(expect.stringContaining("secret"))
  })

  test("reports attach health check timeout clearly", async () => {
    const error = spyOn(UI, "error").mockImplementation(() => {})
    spyOn(App, "tui").mockResolvedValue(undefined)
    spyOn(Win32, "win32DisableProcessedInput").mockImplementation(() => {})
    spyOn(Win32, "win32InstallCtrlCGuard").mockReturnValue(undefined)
    process.env.OPENCODE_ATTACH_HEALTH_TIMEOUT_MS = "1"
    globalThis.fetch = mock(async (_input, init) => {
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted", "AbortError"))
        })
      })
    }) as unknown as typeof fetch

    await call()

    expect(error).toHaveBeenCalledWith(expect.stringContaining("timed out after 1ms"))
  })
})
