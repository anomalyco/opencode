import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { bindAbort, stop } from "../src/process"

function child(script: string) {
  return spawn(process.execPath, ["-e", script], { stdio: "ignore" })
}

describe("sdk process", () => {
  test("stop waits for the child to exit", async () => {
    const proc = child('process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000)')
    await new Promise((resolve) => proc.once("spawn", resolve))
    let exited = false
    proc.once("exit", () => {
      exited = true
    })

    await stop(proc)

    expect(exited).toBe(true)
  })

  test("coalesces concurrent stop calls into a single signal", async () => {
    if (process.platform === "win32") return
    const proc = child('process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000)')
    await new Promise((resolve) => proc.once("spawn", resolve))

    let kills = 0
    const kill = proc.kill.bind(proc)
    proc.kill = ((signal?: NodeJS.Signals | number) => {
      kills++
      return kill(signal)
    }) as typeof proc.kill

    await Promise.all([stop(proc), stop(proc), stop(proc)])

    expect(kills).toBe(1)
  })

  test("bindAbort leaves an already-exited process untouched", async () => {
    const proc = child("")
    await new Promise((resolve) => proc.once("exit", resolve))
    const before = proc.listenerCount("exit")

    const clear = bindAbort(proc, new AbortController().signal)

    expect(proc.listenerCount("exit")).toBe(before)
    clear()
  })
})
