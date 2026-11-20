import { expect, test } from "bun:test"
import { isZombieState, parseLinuxProcState, parsePsState, processStopped } from "../src/service-process"

test("parses Linux /proc/<pid>/stat state even when comm contains spaces and parentheses", () => {
  expect(parseLinuxProcState("2117 (opencode) Z 1 2117 2117 0 -1")).toBe("Z")
  expect(parseLinuxProcState("2117 (opencode (serve)) Z 1 2117 2117 0 -1")).toBe("Z")
  expect(parseLinuxProcState("2117 (opencode (serve)) S 1 2117 2117 0 -1")).toBe("S")
  expect(parseLinuxProcState("2117 (opencode) D 1 2117 2117 0 -1")).toBe("D")
  expect(parseLinuxProcState("malformed")).toBeUndefined()
})

test("parses ps state output and identifies zombie states", () => {
  expect(parsePsState("Z\n")).toBe("Z")
  expect(parsePsState(" Z+ \n")).toBe("Z")
  expect(parsePsState("ZN\n")).toBe("Z")
  expect(parsePsState("S+\n")).toBe("S")
  expect(parsePsState("")).toBeUndefined()
  expect(isZombieState("Z")).toBe(true)
  expect(isZombieState("S")).toBe(false)
  expect(isZombieState("D")).toBe(false)
  expect(isZombieState(undefined)).toBe(false)
})

test("reports the current process as running and an exited process as stopped", async () => {
  expect(await processStopped(process.pid)).toBe(false)

  const child = Bun.spawn([process.execPath, "-e", "process.exit(0)"], { stdout: "ignore", stderr: "ignore" })
  const pid = child.pid
  await child.exited
  expect(await processStopped(pid)).toBe(true)
})
