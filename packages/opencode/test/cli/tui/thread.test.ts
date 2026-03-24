import { describe, expect, mock, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../../fixture/fixture"

const stop = new Error("stop")
const seen = {
  tui: [] as string[],
  inst: [] as string[],
}

mock.module("../../../src/cli/cmd/tui/app", () => ({
  tui: async (input: { directory: string }) => {
    seen.tui.push(input.directory)
    throw stop
  },
}))

mock.module("@/util/rpc", () => ({
  Rpc: {
    client: () => ({
      call: async () => ({ url: "http://127.0.0.1" }),
      on: () => {},
    }),
  },
}))

mock.module("@/cli/ui", () => ({
  UI: {
    error: () => {},
  },
}))

mock.module("@/util/log", () => ({
  Log: {
    init: async () => {},
    create: () => ({
      error: () => {},
      info: () => {},
      warn: () => {},
      debug: () => {},
      time: () => ({ stop: () => {} }),
    }),
    Default: {
      error: () => {},
      info: () => {},
      warn: () => {},
      debug: () => {},
    },
  },
}))

mock.module("@/util/timeout", () => ({
  withTimeout: <T>(input: Promise<T>) => input,
}))

mock.module("@/cli/network", () => ({
  withNetworkOptions: <T>(input: T) => input,
  resolveNetworkOptions: async () => ({
    mdns: false,
    port: 0,
    hostname: "127.0.0.1",
  }),
}))

mock.module("../../../src/cli/cmd/tui/win32", () => ({
  win32DisableProcessedInput: () => {},
  win32InstallCtrlCGuard: () => undefined,
}))

mock.module("@/config/tui", () => ({
  TuiConfig: {
    get: () => ({}),
  },
}))

mock.module("@/project/instance", () => ({
  Instance: {
    provide: async (input: { directory: string; fn: () => Promise<unknown> | unknown }) => {
      seen.inst.push(input.directory)
      return input.fn()
    },
  },
}))

describe("tui thread", () => {
  async function call(project?: string) {
    const { TuiThreadCommand } = await import("../../../src/cli/cmd/tui/thread")
    const args: Parameters<NonNullable<typeof TuiThreadCommand.handler>>[0] = {
      _: [],
      $0: "opencode",
      project,
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
    return TuiThreadCommand.handler(args)
  }

  async function check(project?: string) {
    await using tmp = await tmpdir({ git: true })
    const cwd = process.cwd()
    const pwd = process.env.PWD
    const worker = globalThis.Worker
    const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")
    const link = path.join(path.dirname(tmp.path), path.basename(tmp.path) + "-link")
    const type = process.platform === "win32" ? "junction" : "dir"
    seen.tui.length = 0
    seen.inst.length = 0
    await fs.symlink(tmp.path, link, type)

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
      process.chdir(tmp.path)
      process.env.PWD = link
      await expect(call(project)).rejects.toBe(stop)
      expect(seen.inst[0]).toBe(tmp.path)
      expect(seen.tui[0]).toBe(tmp.path)
    } finally {
      process.chdir(cwd)
      if (pwd === undefined) delete process.env.PWD
      else process.env.PWD = pwd
      if (tty) Object.defineProperty(process.stdin, "isTTY", tty)
      else delete (process.stdin as { isTTY?: boolean }).isTTY
      globalThis.Worker = worker
      await fs.rm(link, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  test("uses the real cwd when PWD points at a symlink", async () => {
    await check()
  })

  test("uses the real cwd after resolving a relative project from PWD", async () => {
    await check(".")
  })
})
