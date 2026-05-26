import { describe, expect, test, beforeEach, afterEach, spyOn, mock } from "bun:test"
import { safeExit } from "@/util/process"

describe("safeExit", () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!
  const originalExitCode = process.exitCode
  let exitSpy: ReturnType<typeof spyOn>
  let setTimeoutSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    exitSpy = spyOn(process, "exit").mockImplementation((() => {}) as any)
    setTimeoutSpy = spyOn(globalThis, "setTimeout").mockImplementation(
      ((_fn: any, _ms: number) => {
        return { unref: () => {} } as any
      }) as any,
    )
  })

  afterEach(() => {
    exitSpy?.mockRestore()
    setTimeoutSpy?.mockRestore()
    Object.defineProperty(process, "platform", originalPlatform)
    process.exitCode = originalExitCode
  })

  test("on non-Windows calls process.exit()", () => {
    Object.defineProperty(process, "platform", { value: "linux", writable: false })
    safeExit(0)
    expect(exitSpy).toHaveBeenCalledWith(0)
    expect(process.exitCode).toBe(originalExitCode)
  })

  test("on non-Windows calls process.exit() with no args", () => {
    Object.defineProperty(process, "platform", { value: "linux", writable: false })
    safeExit()
    expect(exitSpy).toHaveBeenCalledWith(undefined)
  })

  test("on non-Windows respects custom exit code", () => {
    Object.defineProperty(process, "platform", { value: "linux", writable: false })
    safeExit(42)
    expect(exitSpy).toHaveBeenCalledWith(42)
  })

  test("on Windows sets exitCode and does not call process.exit() immediately", () => {
    Object.defineProperty(process, "platform", { value: "win32", writable: false })
    safeExit(0)
    expect(process.exitCode).toBe(0)
    expect(exitSpy).not.toHaveBeenCalled()
  })

  test("on Windows sets exitCode to given value", () => {
    Object.defineProperty(process, "platform", { value: "win32", writable: false })
    safeExit(99)
    expect(process.exitCode).toBe(99)
  })

  test("on Windows does not override existing exitCode if not provided", () => {
    Object.defineProperty(process, "platform", { value: "win32", writable: false })
    process.exitCode = 1
    safeExit()
    expect(process.exitCode).toBe(1)
  })

  test("on Windows schedules a timeout as fallback for hanging subprocesses", () => {
    Object.defineProperty(process, "platform", { value: "win32", writable: false })
    safeExit()
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5000)
  })

  test("on darwin (macOS) calls process.exit() like non-Windows", () => {
    Object.defineProperty(process, "platform", { value: "darwin", writable: false })
    safeExit(1)
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
