import { describe, expect, test } from "bun:test"
import path from "node:path"
import { globalNames } from "../src/interpreter/globals.js"
import { VmEngine } from "../src/vm/index.js"

const fixture = path.join(import.meta.dir, "fixtures/engine-modules.ts")

const run = async (...args: Array<string>) => {
  const child = Bun.spawn([process.execPath, fixture, ...args], { stdout: "pipe", stderr: "inherit" })
  const output = await new Response(child.stdout).text()
  expect(await child.exited).toBe(0)
  return JSON.parse(output) as { result: unknown; vm: Array<string> }
}

describe("engines", () => {
  // `CodeMode.make` checks extension globals against one list, so both engines must bind the same names.
  test("bind the same global names", () => {
    expect([...VmEngine.globalNames].sort()).toEqual([...globalNames].sort())
  })

  test("the default engine loads no VM code", async () => {
    const output = await run()
    expect(output.result).toEqual({ ok: true, value: [2, 4], toolCalls: [] })
    expect(output.vm).toEqual([])
  })

  test("the VM engine loads the VM on first use", async () => {
    const output = await run("vm")
    expect(output.result).toEqual({ ok: true, value: [2, 4], toolCalls: [] })
    expect(output.vm.length).toBeGreaterThan(0)
  })
})
