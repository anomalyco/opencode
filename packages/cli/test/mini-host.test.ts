import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"
import { pathToFileURL } from "node:url"
import {
  createMiniHost,
  INTERACTIVE_INPUT_ERROR,
  resolveInteractiveStdin,
  type InteractiveStdin,
  usingInteractiveStdin,
} from "../src/mini-host"

const temporary: string[] = []
const model = { providerID: "openai", modelID: "gpt-5" }

function stream(isTTY: boolean) {
  return Object.assign(new Readable({ read() {} }), { isTTY }) as NodeJS.ReadStream
}

async function root() {
  const directory = await mkdtemp(path.join(import.meta.dir, ".mini-host-"))
  temporary.push(directory)
  return directory
}

function host(terminal: InteractiveStdin, directory: string) {
  return createMiniHost({
    terminal,
    directory,
    paths: { home: directory, state: directory, log: directory },
  })
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("Mini CLI host", () => {
  test("reuses tty stdin without taking ownership", () => {
    const stdin = stream(true)
    const seen: string[] = []
    const terminal = resolveInteractiveStdin(
      stdin,
      (target) => {
        seen.push(target)
        return stream(true)
      },
      "linux",
    )

    expect(terminal.stdin).toBe(stdin)
    terminal.cleanup()
    expect(stdin.destroyed).toBe(false)
    expect(seen).toEqual([])
  })

  test("opens and cleans the controlling terminal exactly once for piped stdin", () => {
    const tty = stream(true)
    const seen: string[] = []
    let destroys = 0
    const destroy = tty.destroy.bind(tty)
    tty.destroy = ((...args: Parameters<typeof tty.destroy>) => {
      destroys++
      return destroy(...args)
    }) as typeof tty.destroy
    const terminal = resolveInteractiveStdin(
      stream(false),
      (target) => {
        seen.push(target)
        return tty
      },
      "linux",
    )

    terminal.cleanup()
    terminal.cleanup()
    expect(seen).toEqual(["/dev/tty"])
    expect(destroys).toBe(1)
  })

  test("uses the platform terminal and reports acquisition failures", () => {
    const seen: string[] = []
    resolveInteractiveStdin(
      stream(false),
      (target) => {
        seen.push(target)
        return stream(true)
      },
      "win32",
    ).cleanup()
    expect(seen).toEqual(["CONIN$"])
    expect(() =>
      resolveInteractiveStdin(
        stream(false),
        () => {
          throw new Error("open failed")
        },
        "linux",
      ),
    ).toThrow(INTERACTIVE_INPUT_ERROR)
  })

  test("cleans the controlling terminal when hosted frontend startup fails", async () => {
    let cleaned = 0
    const order: string[] = []
    const terminal = {
      stdin: stream(true),
      cleanup() {
        order.push("cleanup")
        cleaned++
      },
    }

    await expect(
      usingInteractiveStdin(
        async () => {
          order.push("run")
          throw new Error("frontend failed")
        },
        () => {
          order.push("terminal")
          return terminal
        },
      ),
    ).rejects.toThrow("frontend failed")
    expect(cleaned).toBe(1)
    expect(order).toEqual(["terminal", "run", "cleanup"])
  })

  test("subscribes and unsubscribes process signals through host capabilities", async () => {
    const input = host({ stdin: stream(true), cleanup() {} }, await root())
    const sigint = process.listenerCount("SIGINT")
    const sigusr2 = process.listenerCount("SIGUSR2")
    const offInt = input.signals.sigint.subscribe(() => {})
    const offTheme = input.signals.sigusr2.subscribe(() => {})

    expect(process.listenerCount("SIGINT")).toBe(sigint + 1)
    expect(process.listenerCount("SIGUSR2")).toBe(sigusr2 + 1)
    offInt()
    offInt()
    offTheme()
    offTheme()
    expect(process.listenerCount("SIGINT")).toBe(sigint)
    expect(process.listenerCount("SIGUSR2")).toBe(sigusr2)
  })

  test("passes frontend host capabilities", async () => {
    const directory = await root()
    const input = host({ stdin: stream(true), cleanup() {} }, directory)

    expect(input.paths).toEqual({ home: directory })
    expect(input.platform).toBe(process.platform)
    expect(typeof input.files.readText).toBe("function")
    const file = path.join(directory, "attachment.txt")
    await Bun.write(file, "attachment contents")
    expect(await input.files.readText(pathToFileURL(file).href)).toBe("attachment contents")
    expect(typeof input.startup.showTiming).toBe("boolean")
    expect(typeof input.startup.now()).toBe("number")
  })

  test("delegates model variant preferences", async () => {
    const directory = await root()
    const input = host({ stdin: stream(true), cleanup() {} }, directory)
    const file = path.join(directory, "model.json")

    await input.preferences.saveVariant(model, "high")
    expect(await input.preferences.resolveVariant(model)).toBe("high")

    await input.preferences.saveVariant(model, "default")
    expect(await input.preferences.resolveVariant(model)).toBeUndefined()

    await Bun.write(file, "{")
    await input.preferences.saveVariant(model, "high")
    expect(await input.preferences.resolveVariant(model)).toBe("high")
  })
})
