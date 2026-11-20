import { expect, test } from "bun:test"
import { decide, parseLinuxProcStatState, unresponsiveOwner, type LocalService } from "../src/service-probe"

const protocolError =
  "Background service uses an incompatible health protocol. Update this client or explicitly restart the service."

function service(input: Pick<LocalService, "state" | "compatible" | "version">) {
  return {
    info: { url: "http://127.0.0.1:4096", pid: 4242, version: input.version },
    endpoint: { url: "http://127.0.0.1:4096" },
    ...input,
  } satisfies LocalService
}

test("a missing health endpoint fails unless the caller requires a different version", () => {
  const missing = service({ version: "2.0.0", state: "ready", compatible: false })
  expect(decide(missing, {})).toEqual({ _tag: "fail", error: new Error(protocolError) })
  expect(decide(missing, { version: "2.0.0" })).toEqual({ _tag: "fail", error: new Error(protocolError) })
  expect(decide(missing, { version: (version) => version.startsWith("2.") })).toEqual({
    _tag: "fail",
    error: new Error(protocolError),
  })
  expect(decide(missing, { version: "3.0.0" })).toEqual({ _tag: "replace", pty: "handoff" })
  expect(decide(service({ state: "ready", compatible: false }), { version: "3.0.0" })).toEqual({
    _tag: "replace",
    pty: "handoff",
  })
})

test("a compatible service is reused when ready, awaited while starting, and fails when it failed", () => {
  expect(decide(service({ version: "2.0.0", state: "ready", compatible: true }), {})).toEqual({ _tag: "reuse" })
  expect(decide(service({ version: "2.0.0", state: "waiting", compatible: true }), { version: "2.0.0" })).toEqual({
    _tag: "wait",
  })
  expect(decide(service({ version: "2.0.0", state: "failed", compatible: true }), {})).toEqual({
    _tag: "fail",
    error: new Error("Background service failed to start"),
  })
})

test("a version mismatch replaces the service, handing off terminals only when it is ready", () => {
  expect(decide(service({ version: "1.0.0", state: "ready", compatible: true }), { version: "2.0.0" })).toEqual({
    _tag: "replace",
    pty: "handoff",
  })
  expect(decide(service({ version: "1.0.0", state: "waiting", compatible: true }), { version: "2.0.0" })).toEqual({
    _tag: "replace",
    pty: "clear",
  })
  expect(decide(service({ version: "1.0.0", state: "failed", compatible: true }), { version: "2.0.0" })).toEqual({
    _tag: "replace",
    pty: "clear",
  })
})

test("parseLinuxProcStatState reads the task state after any parenthesized command name", () => {
  expect(parseLinuxProcStatState("3698946 (opencode) D 1 3698946 3698946 0 -1")).toBe("D")
  expect(parseLinuxProcStatState("42 (opencode (worker) 1) D 1 42 42 0 -1")).toBe("D")
  expect(parseLinuxProcStatState("42 (opencode (worker) 1) S 1 42 42 0 -1")).toBe("S")
  expect(parseLinuxProcStatState("42 (opencode) Z 1 42 42 0 -1")).toBe("Z")
  expect(parseLinuxProcStatState("42 (opencode)")).toBeUndefined()
  expect(parseLinuxProcStatState("malformed")).toBeUndefined()
})

const owner = { url: "http://127.0.0.1:4096", pid: 4242, version: "2.0.0" }

test("disk sleep pauses the unresponsive budget, so an owner is not evicted the moment the disk catches up", () => {
  const unresponsive = unresponsiveOwner(3_000)
  // In disk sleep for 15s: none of it counts.
  for (let at = 0; at < 15_000; at += 500) expect(unresponsive.observe(owner, at, at + 500, true)).toBeUndefined()
  // The probe in flight when the disk caught up times out with the process running again.
  expect(unresponsive.observe(owner, 15_000, 15_500, false)).toBeUndefined()
  // Running but silent for the whole budget is a hang.
  expect(unresponsive.observe(owner, 15_500, 18_500, false)).toBe(owner)
})

test("an unresponsive owner holds the startup deadline until a probe sees its budget pass, even in disk sleep", () => {
  const unresponsive = unresponsiveOwner(3_000)
  expect(unresponsive.waiting()).toBe(false)
  unresponsive.observe(owner, 0, 2_000, true)
  expect(unresponsive.waiting()).toBe(true)
  unresponsive.observe(owner, 2_000, 4_000, true)
  expect(unresponsive.waiting()).toBe(false)
  unresponsive.observe(undefined, 4_000, 4_100, false)
  expect(unresponsive.waiting()).toBe(false)
})
