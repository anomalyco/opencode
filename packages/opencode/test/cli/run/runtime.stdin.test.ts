import { describe, expect, test } from "bun:test"
import { Readable } from "node:stream"
import { INTERACTIVE_INPUT_REASON, resolveInteractiveStdin } from "@/cli/cmd/run/runtime.stdin"

function stream(isTTY: boolean) {
  return Object.assign(new Readable({ read() {} }), { isTTY }) as NodeJS.ReadStream
}

function redirect(seen: string[]) {
  return (_stdin: NodeJS.ReadStream, path: string) => {
    seen.push(path)
  }
}

describe("run interactive stdin", () => {
  test("opens the controlling terminal and redirects the original tty stdin", () => {
    const stdin = stream(true)
    const tty = stream(true)
    const opened: string[] = []
    const redirected: string[] = []
    const result = resolveInteractiveStdin(
      stdin,
      (path) => {
        opened.push(path)
        return tty
      },
      "linux",
      redirect(redirected),
    )

    expect(result.stdin).toBe(tty)
    expect(opened).toEqual(["/dev/tty"])
    expect(redirected).toEqual(["/dev/null"])

    result.cleanup?.()
    expect(tty.destroyed).toBe(true)
  })

  test("opens the controlling terminal when stdin is piped", () => {
    const tty = stream(true)
    const opened: string[] = []
    const redirected: string[] = []
    const result = resolveInteractiveStdin(
      stream(false),
      (path) => {
        opened.push(path)
        return tty
      },
      "linux",
      redirect(redirected),
    )

    expect(result.stdin).toBe(tty)
    expect(opened).toEqual(["/dev/tty"])
    expect(redirected).toEqual(["/dev/null"])

    result.cleanup?.()
    expect(tty.destroyed).toBe(true)
  })

  test("uses the windows console and null device", () => {
    const opened: string[] = []
    const redirected: string[] = []
    resolveInteractiveStdin(
      stream(false),
      (path) => {
        opened.push(path)
        return stream(true)
      },
      "win32",
      redirect(redirected),
    )

    expect(opened).toEqual(["CONIN$"])
    expect(redirected).toEqual(["NUL"])
  })

  test("closes the controlling terminal when redirecting stdin fails", () => {
    const tty = stream(true)
    expect(() =>
      resolveInteractiveStdin(
        stream(true),
        () => tty,
        "linux",
        () => {
          throw new Error("redirect failed")
        },
      ),
    ).toThrow(INTERACTIVE_INPUT_REASON)
    expect(tty.destroyed).toBe(true)
  })

  test("throws a clear error when no controlling terminal is available", () => {
    expect(() =>
      resolveInteractiveStdin(
        stream(false),
        () => {
          throw new Error("open failed")
        },
        "linux",
      ),
    ).toThrow(INTERACTIVE_INPUT_REASON)
  })
})
