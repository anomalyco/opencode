import { describe, expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../../fixture/fixture"
import * as App from "../../../src/cli/cmd/tui/app"
import { UI } from "../../../src/cli/ui"
import * as Timeout from "../../../src/util/timeout"
import * as Network from "../../../src/cli/network"
import * as Win32 from "../../../src/cli/cmd/tui/win32"
import { Provider } from "../../../src/provider/provider"
import { Effect } from "effect"

const stop = new Error("stop")
const packageRoot = path.resolve(import.meta.dir, "../../..")
const seen = {
  tui: [] as string[],
  model: [] as (string | undefined)[],
  variant: [] as (string | undefined)[],
}

class TestWorker extends EventTarget {
  onerror: Worker["onerror"] = null
  onmessage: Worker["onmessage"] = null
  onmessageerror: Worker["onmessageerror"] = null

  postMessage(data: string) {
    const parsed = JSON.parse(data)
    if (!parsed || typeof parsed !== "object" || !("method" in parsed) || !("id" in parsed)) return
    if (typeof parsed.method !== "string" || typeof parsed.id !== "number") return
    const result =
      parsed.method === "fetch"
        ? { status: 200, headers: {}, body: "" }
        : parsed.method === "server"
          ? { url: "http://127.0.0.1" }
          : parsed.method === "snapshot"
            ? ""
            : undefined
    queueMicrotask(() => {
      this.onmessage?.(
        new MessageEvent("message", { data: JSON.stringify({ type: "rpc.result", result, id: parsed.id }) }),
      )
    })
  }

  terminate() {}
}

function setup() {
  // Intentionally avoid mock.module() here: Bun keeps module overrides in cache
  // and mock.restore() does not reset mock.module values. If this switches back
  // to module mocks, later suites can see mocked @/config/tui and fail (e.g.
  // plugin-loader tests expecting real TuiConfig.waitForDependencies). See:
  // https://github.com/oven-sh/bun/issues/7823 and #12823.
  spyOn(App, "createTuiRenderer").mockImplementation(async () => ({}) as never)
  spyOn(App, "tui").mockImplementation((input) => {
    if (input.directory) seen.tui.push(input.directory)
    seen.model.push(input.args.model)
    seen.variant.push(input.args.variant)
    return {
      ready: Promise.resolve(),
      done: Promise.reject(stop),
      exit: {} as never,
    }
  })
  spyOn(UI, "error").mockImplementation(() => {})
  spyOn(Timeout, "withTimeout").mockImplementation((input) => input)
  spyOn(Network, "resolveNetworkOptions").mockImplementation(() =>
    Effect.succeed({
      mdns: false,
      port: 0,
      hostname: "127.0.0.1",
      mdnsDomain: "opencode.local",
      cors: [],
    }),
  )
  spyOn(Win32, "win32DisableProcessedInput").mockImplementation(() => {})
  spyOn(Win32, "win32InstallCtrlCGuard").mockReturnValue(undefined)
  spyOn(Provider, "resolveSelection").mockImplementation(async (model, variant) => ({
    model: model === "free" ? "opencode/freebie" : model,
    variant: variant === "any" ? "high" : variant,
  }))
}

describe("tui thread", () => {
  setup()

  async function call(project?: string, model?: string, variant?: string) {
    const { TuiThreadCommand } = await import("../../../src/cli/cmd/tui/thread")
    const args: Parameters<NonNullable<typeof TuiThreadCommand.handler>>[0] = {
      _: [],
      $0: "opencode",
      project,
      prompt: "hi",
      model,
      variant,
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

  async function check(
    project?: string,
    model?: string,
    variant?: string,
    expected?: { model?: string; variant?: string },
  ) {
    const pwd = process.env.PWD
    const worker = globalThis.Worker
    const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")
    await using tmp = await tmpdir({ git: true })
    const link = path.join(path.dirname(tmp.path), path.basename(tmp.path) + "-link")
    const type = process.platform === "win32" ? "junction" : "dir"
    seen.tui.length = 0
    seen.model.length = 0
    seen.variant.length = 0
    await fs.symlink(tmp.path, link, type)

    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    })
    Object.defineProperty(globalThis, "Worker", { configurable: true, value: TestWorker })

    try {
      process.chdir(tmp.path)
      process.env.PWD = link
      let error: unknown
      try {
        await call(project, model, variant)
      } catch (caught) {
        error = caught
      }
      expect(error).toBe(stop)
      expect(seen.tui[0]).toBe(tmp.path)
      if (expected?.model) expect(seen.model[0]).toBe(expected.model)
      if (expected?.variant) expect(seen.variant[0]).toBe(expected.variant)
    } finally {
      process.chdir(packageRoot)
      if (pwd === undefined) delete process.env.PWD
      else process.env.PWD = pwd
      if (tty) Object.defineProperty(process.stdin, "isTTY", tty)
      else delete (process.stdin as { isTTY?: boolean }).isTTY
      Object.defineProperty(globalThis, "Worker", { configurable: true, value: worker })
      await fs.rm(link, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  test("uses the real cwd when PWD points at a symlink", async () => {
    await check()
  })

  test("uses the real cwd after resolving a relative project from PWD", async () => {
    await check(".")
  })

  test("resolves the free model alias before launching the tui", async () => {
    await check(undefined, "free", undefined, { model: "opencode/freebie" })
  })

  test("passes the resolved any variant before launching the tui", async () => {
    await check(undefined, "free", "any", { model: "opencode/freebie", variant: "high" })
  })
})
