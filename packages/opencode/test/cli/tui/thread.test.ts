import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../../fixture/fixture"
import { resolveThreadDirectory } from "../../../src/cli/cmd/tui/thread"

describe("tui thread", () => {
  async function check(project?: string) {
    await using tmp = await tmpdir({ git: true })
    const link = path.join(path.dirname(tmp.path), path.basename(tmp.path) + "-link")
    const type = process.platform === "win32" ? "junction" : "dir"

    try {
      await fs.symlink(tmp.path, link, type)
      expect(resolveThreadDirectory(project, link, tmp.path)).toBe(tmp.path)
    } finally {
      await fs.rm(link, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  test("uses the real cwd when PWD points at a symlink", async () => {
    await check()
  })

  test("uses the real cwd after resolving a relative project from PWD", async () => {
    await check(".")
  })

  test("does not force process.exit after tui exits cleanly", async () => {
    const exit = spyOn(process, "exit").mockImplementation((() => undefined) as typeof process.exit)
    setup()
    ;(App.tui as ReturnType<typeof spyOn>).mockImplementationOnce(async () => {})

    const { TuiThreadCommand } = await import("../../../src/cli/cmd/tui/thread")
    const args: Parameters<NonNullable<typeof TuiThreadCommand.handler>>[0] = {
      _: [],
      $0: "opencode",
      project: undefined,
      prompt: "hi",
      model: undefined,
      agent: undefined,
      session: undefined,
      continue: false,
      fork: false,
      port: 0,
      hostname: "127.0.0.1",
      mdns: false,
      "mdns-domain": "opencode.local",
      mdnsDomain: "opencode.local",
      cors: [],
    }
    const worker = globalThis.Worker
    const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")

    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    })
    globalThis.Worker = class extends EventTarget {
      onerror = null
      onmessage = null
      onmessageerror = null
      postMessage() {}
      terminate() {}
    } as unknown as typeof Worker

    try {
      await TuiThreadCommand.handler(args)
      if (process.platform === "win32") {
        // On Windows, process.exit(0) is required because awaiting the
        // worker shutdown destroys the console window.
        expect(exit).toHaveBeenCalledWith(0)
      } else {
        expect(exit).not.toHaveBeenCalled()
      }
    } finally {
      if (tty) Object.defineProperty(process.stdin, "isTTY", tty)
      else delete (process.stdin as { isTTY?: boolean }).isTTY
      globalThis.Worker = worker
    }
  })
})
