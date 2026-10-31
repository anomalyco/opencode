import { expect, test } from "bun:test"
import { decide, type LocalService } from "../src/service-probe"
import { atLeast } from "../src/service-version"

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

// An older CLI launched after Desktop updated used to replace Desktop's newer service with its own.
test.each([
  { client: "2.0.32", service: "2.2.0", kept: true },
  { client: "2.2.0", service: "2.2.0", kept: true },
  { client: "2.2.0", service: "2.0.32", kept: false },
  { client: "2.10.0", service: "2.9.9", kept: false },
  { client: "0.0.0-beta-1200", service: "0.0.0-beta-1234", kept: true },
  { client: "0.0.0-beta-1234", service: "0.0.0-beta-1200", kept: false },
  { client: "0.0.0-beta-1234", service: "0.0.0-beta-1234.2", kept: true },
  { client: "0.0.0-beta-1234.2", service: "0.0.0-beta-1234", kept: false },
  { client: "2.2.0", service: "0.0.0-beta-1", kept: true },
  { client: "0.0.0-beta-1", service: "2.0.0", kept: true },
  { client: "0.0.0-next-5", service: "0.0.0-beta-1", kept: true },
  { client: "local", service: "2.2.0", kept: false },
  { client: "local", service: "local", kept: true },
  { client: "2.2.0", service: "2.3.0-rc.1", kept: false },
])("atLeast($client) keeps a $service service: $kept", (input) => {
  const decision = decide(service({ version: input.service, state: "ready", compatible: true }), {
    version: atLeast(input.client),
  })
  expect(decision._tag).toBe(input.kept ? "reuse" : "replace")
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
