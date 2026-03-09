import { describe, expect, test } from "bun:test"
import { Process } from "../../src/util/process"
import { tmpdir } from "../fixture/fixture"

function node(script: string) {
  return [process.execPath, "-e", script]
}

describe("util.process", () => {
  test("captures stdout and stderr", async () => {
    const out = await Process.run(node('process.stdout.write("out");process.stderr.write("err")'))
    expect(out.code).toBe(0)
    expect(out.stdout.toString()).toBe("out")
    expect(out.stderr.toString()).toBe("err")
  })

  test("returns code when nothrow is enabled", async () => {
    const out = await Process.run(node("process.exit(7)"), { nothrow: true })
    expect(out.code).toBe(7)
  })

  test("throws RunFailedError on non-zero exit", async () => {
    const err = await Process.run(node('process.stderr.write("bad");process.exit(3)')).catch((error) => error)
    expect(err).toBeInstanceOf(Process.RunFailedError)
    if (!(err instanceof Process.RunFailedError)) throw err
    expect(err.code).toBe(3)
    expect(err.stderr.toString()).toBe("bad")
  })

  test("aborts a running process", async () => {
    const abort = new AbortController()
    const started = Date.now()
    setTimeout(() => abort.abort(), 25)

    const out = await Process.run(node("setInterval(() => {}, 1000)"), {
      abort: abort.signal,
      nothrow: true,
    })

    expect(out.code).not.toBe(0)
    expect(Date.now() - started).toBeLessThan(1000)
  }, 3000)

  test("kills after timeout when process ignores terminate signal", async () => {
    if (process.platform === "win32") return

    const abort = new AbortController()
    const started = Date.now()
    setTimeout(() => abort.abort(), 25)

    const out = await Process.run(node('process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'), {
      abort: abort.signal,
      nothrow: true,
      timeout: 25,
    })

    expect(out.code).not.toBe(0)
    expect(Date.now() - started).toBeLessThan(1000)
  }, 3000)

  test("uses cwd when spawning commands", async () => {
    await using tmp = await tmpdir()
    const out = await Process.run(node("process.stdout.write(process.cwd())"), {
      cwd: tmp.path,
    })
    expect(out.stdout.toString()).toBe(tmp.path)
  })

  test("merges environment overrides", async () => {
    const out = await Process.run(node('process.stdout.write(process.env.OPENCODE_TEST ?? "")'), {
      env: {
        OPENCODE_TEST: "set",
      },
    })
    expect(out.stdout.toString()).toBe("set")
  })
})

describe("util.process defensive patterns", () => {
  test("Process.run completes normally", async () => {
    const result = await Process.run(node('process.stdout.write("hello")'))
    expect(result.code).toBe(0)
    expect(result.stdout.toString()).toContain("hello")
  })

  test("Process.run handles failing command", async () => {
    expect(Process.run(node("process.exit(1)"))).rejects.toThrow()
  })

  test("Process.run with nothrow returns non-zero code", async () => {
    const result = await Process.run(node("process.exit(1)"), { nothrow: true })
    expect(result.code).not.toBe(0)
  })

  test("Process.spawn returns valid exited promise", async () => {
    const proc = Process.spawn(node('process.stdout.write("test")'), { stdout: "pipe" })
    const code = await proc.exited
    expect(code).toBe(0)
  })

  test("Process.spawn abort kills process", async () => {
    const controller = new AbortController()
    const proc = Process.spawn(node("setInterval(() => {}, 60000)"), { abort: controller.signal })
    setTimeout(() => controller.abort(), 200)
    const code = await proc.exited
    expect(typeof code).toBe("number")
  })

  test("Process.run completes for fast commands", async () => {
    const result = await Process.run(node("process.exit(0)"))
    expect(result.code).toBe(0)
  })
})
