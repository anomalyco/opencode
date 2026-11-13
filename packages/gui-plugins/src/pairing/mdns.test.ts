import { expect, test } from "bun:test"
import { announce, type Backend, txtEntries } from "./mdns"
import { holdInProcess } from "./mdns-process"

const announcement = { name: "OpenCode on test", type: "opencode", port: 4242, txt: { v: "1", id: "install" } }

function backend(name: string, outcome: "live" | Error): Backend & { calls: number } {
  const result = {
    name,
    calls: 0,
    announce: async () => {
      result.calls++

      if (outcome instanceof Error) throw outcome

      return { backend: name, stop: async () => undefined }
    },
  }

  return result
}

test("the system responder announces when it can", async () => {
  const system = backend("system", "live")
  const fallback = backend("fallback", "live")

  const announced = await announce(announcement, { onError: () => undefined, backends: [system, fallback] })

  expect(announced.backend).toBe("system")
  expect(fallback.calls).toBe(0)
})

test("a responder that refuses hands over to the next, reporting why", async () => {
  const fallbacks: string[] = []

  const announced = await announce(announcement, {
    onError: () => undefined,
    onFallback: (name, error) => fallbacks.push(`${name}: ${error.message}`),
    backends: [backend("system", new Error("no daemon")), backend("fallback", "live")],
  })

  expect(announced.backend).toBe("fallback")
  expect(fallbacks).toEqual(["system: no daemon"])
})

test("with every responder refusing, announcing fails", async () => {
  const attempt = announce(announcement, {
    onError: () => undefined,
    backends: [backend("system", new Error("no daemon")), backend("fallback", new Error("port taken"))],
  })

  await expect(attempt).rejects.toThrow("no mDNS backend")
})

test("TXT entries are key=value", () => {
  expect(txtEntries(announcement.txt)).toEqual(["v=1", "id=install"])
})

test("a held process is live once it confirms, and stopping ends it", async () => {
  const errors: Error[] = []

  const held = await holdInProcess({
    backend: "sh",
    command: "/bin/sh",
    args: ["-c", "echo registered; read line; echo withdrawn"],
    ready: /^registered$/m,
    stopsOnStdinClose: true,
    onError: (error) => errors.push(error),
  })

  await held.stop()
  expect(errors).toEqual([])
})

test("a process that fails or exits before confirming rejects", async () => {
  const options = { backend: "sh", command: "/bin/sh", ready: /^registered$/m, failed: /^failed/m, onError: () => undefined }

  await expect(holdInProcess({ ...options, args: ["-c", "echo failed 9002; sleep 5"] })).rejects.toThrow("failed 9002")
  await expect(holdInProcess({ ...options, args: ["-c", "exit 3"] })).rejects.toThrow("exited (3)")
})

test("a process that dies after confirming reports it", async () => {
  const died = Promise.withResolvers<Error>()

  await holdInProcess({
    backend: "sh",
    command: "/bin/sh",
    args: ["-c", "echo registered; sleep 0.1; exit 2"],
    ready: /^registered$/m,
    onError: (error) => died.resolve(error),
  })

  expect((await died.promise).message).toContain("exited (2)")
})
