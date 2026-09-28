import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../lib/tmp"
import type { AskRequest } from "../../src/contract"
import { config, scriptedAsker, toolset } from "./harness"

const allowBash = (cwd: string) => config(cwd, { permission: [{ permission: "bash", pattern: "*", action: "allow" }] })

function alive(pid: number) {
  // Signal 0 only checks that the process exists.
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe("bash", () => {
  test("runs in cwd or workdir, merges stderr, reports a non-zero exit", async () => {
    await using dir = await tmpdir({ files: { "sub/x.txt": "x" } })
    const tools = await toolset(allowBash(dir.path))
    expect((await tools.call("bash", { command: "pwd" })).text).toBe(dir.path)
    expect((await tools.call("bash", { command: "ls", workdir: "sub" })).text).toBe("x.txt")
    const failed = await tools.call("bash", { command: "echo out; echo err >&2; exit 3" })
    expect(failed.status).toBe("ok")
    expect(failed.text).toBe("out\nerr\n\n(exit code 3)")
  })

  test("timeout kills the whole process group, including children", async () => {
    await using dir = await tmpdir()
    const tools = await toolset(allowBash(dir.path))
    const pidFile = path.join(dir.path, "child.pid")
    const started = Date.now()
    const result = await tools.call("bash", { command: `sleep 30 & echo $! > ${pidFile}; wait`, timeout: 500 })
    expect(result.status).toBe("timeout")
    expect(result.text).toBe("timed out after 0.5 s")
    expect(Date.now() - started).toBeLessThan(5000)
    const child = Number((await Bun.file(pidFile).text()).trim())
    await Bun.sleep(100)
    expect(alive(child)).toBe(false)
  })

  test("default mode asks for bash; headless rejects it", async () => {
    await using dir = await tmpdir()
    const tools = await toolset(config(dir.path))
    const result = await tools.call("bash", { command: "echo hi" })
    expect(result.status).toBe("denied")
    expect(result.text).toBe("permission denied: bash echo hi")
  })

  test("always for a wrapped or complex command persists nothing; for a plain one, the command prefix", async () => {
    await using dir = await tmpdir()
    const seen: AskRequest[] = []
    const tools = await toolset(config(dir.path), { asker: scriptedAsker(["always", "always", "always"], seen) })
    await tools.call("bash", { command: "bash -c 'npm test'" })
    await tools.call("bash", { command: "npm test && echo ok" })
    await tools.call("bash", { command: "npm test" })
    expect(seen.map((request) => request.always)).toEqual([[], [], ["npm test *"]])
    // Neither complex "always" granted anything: the wrapped form asks again.
    await tools.call("bash", { command: "bash -c 'npm test'" })
    expect(seen).toHaveLength(4)
  })

  test("--allowed-tools bash(git *) allows git but not a chained command", async () => {
    await using dir = await tmpdir()
    const { cliRules } = await import("../../src/config/config")
    const tools = await toolset(config(dir.path, { cliRules: cliRules(["bash(git *)"], "allow") }))
    expect((await tools.call("bash", { command: "git --version" })).text).toStartWith("git version")
    const chained = await tools.call("bash", { command: "git status; touch pwned" })
    expect(chained.text).toBe("permission denied: bash <complex> git status touch pwned")
    expect(await Bun.file(path.join(dir.path, "pwned")).exists()).toBe(false)
  })
})
