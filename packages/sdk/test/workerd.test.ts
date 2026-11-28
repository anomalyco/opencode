import { expect, test } from "bun:test"
import { makeMemoryDriver } from "@opencode/core/environment/index"
import { WorkspaceDriver } from "@opencode/core/workspace/driver"
import { Effect } from "effect"
import { makeDurableObjectStorage } from "../../core/test/fixture/durable-object-storage"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { OpenCode } from "../src"
import { OpenCodeWorkerd } from "../src/workerd"
import { OpenCodeWorkerd as OpenCodeWorkerdEffect } from "../src/effect/workerd"

const authorization = { authorization: `Basic ${btoa("opencode:secret")}` }
const info = (headers?: Record<string, string>) => new Request("http://opencode.local/api/info", { headers })
const crossSite = (origin: string) => ({ "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors", origin })
const link = (headers?: Record<string, string>) =>
  new Request("http://opencode.local/api/experimental/machine/link", { headers: { upgrade: "websocket", ...headers } })

/**
 * Bun has no `WebSocketPair`; this stands in for workerd's while `f` runs, so an upgrade reaches `WorkerdMachineLink`.
 * `accepted` counts the sockets it accepted.
 */
async function withWebSocketPair<A>(f: () => Promise<A>) {
  const accepted: string[] = []
  const socket = {
    readyState: 1,
    binaryType: "blob",
    accept: () => void accepted.push("accept"),
    send: () => {},
    close: () => {},
    addEventListener: () => {},
  }
  try {
    Object.assign(globalThis, {
      WebSocketPair: class {
        readonly 0 = socket
        readonly 1 = socket
      },
    })
    return { result: await f(), accepted }
  } finally {
    // SAFETY: only this helper adds the key, and Bun's global types do not declare it.
    delete (globalThis as { WebSocketPair?: unknown }).WebSocketPair
  }
}

function recordingDriver() {
  const memory = makeMemoryDriver()
  const calls: string[] = []
  const driver = WorkspaceDriver.make({
    create: (input) => Effect.sync(() => (calls.push(`create ${input.workspaceID}`), { binding: { ok: true } })),
    connect: () => Effect.succeed(memory),
    suspendForIdle: (input) => Effect.sync(() => void calls.push(`suspend ${input.workspaceID}`)),
    destroy: (input) => Effect.sync(() => void calls.push(`destroy ${input.workspaceID}`)),
  })
  return { driver, calls }
}

test("OpenCodeWorkerd serves the API behind its password and site checks, and machine-link upgrades", async () => {
  const { driver, calls } = recordingDriver()
  await using opencode = await OpenCodeWorkerd.create({
    storage: makeDurableObjectStorage(),
    password: "secret",
    app: { version: "sdk-workerd" },
    config: { experimental: { machines: true } },
    models: { fetch: false },
    workspaceProviders: { sandbox: driver },
  })

  expect((await opencode.fetch(info())).status).toBe(401)
  const served = await opencode.fetch(info(authorization))
  expect(served.status).toBe(200)
  expect(await served.json()).toMatchObject({ version: "sdk-workerd" })
  expect((await opencode.fetch(info({ ...authorization, ...crossSite("https://evil.example") }))).status).toBe(403)
  // The in-process client carries the password itself.
  expect(await opencode.server.info()).toMatchObject({ version: "sdk-workerd" })

  // `WorkerdMachineLink` answers the upgrade before the password is checked, as on Node.
  const upgraded = await withWebSocketPair(() => opencode.fetch(link()))
  expect(upgraded.result.status).toBe(101)
  expect(upgraded.accepted).toEqual(["accept"])
  expect("WebSocketPair" in globalThis).toBe(false)

  const created = await opencode.workspace.create({ provider: "sandbox" })
  expect((await opencode.workspace.provision({ workspaceID: created })).id).toBe(created)
  const attached = await opencode.workspace.attach({ provider: "sandbox", binding: { url: "wss://sandbox.example" } })
  expect(await opencode.workspace.suspendIdle()).toEqual([])
  await opencode.alarm()
  expect(await opencode.workspace.destroy({ workspaceID: attached })).toMatchObject({ destroyed: true })
  expect(calls).toEqual([`create ${created}`, `destroy ${attached}`])
  await expect(opencode.workspace.create({ provider: "missing" })).rejects.toMatchObject({
    _tag: "WorkspaceDriver.ProviderNotFound",
  })
})

test("Effect OpenCodeWorkerd serves fetch behind its password and allowed CORS origins", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const opencode = yield* OpenCodeWorkerdEffect.create({
        storage: makeDurableObjectStorage(),
        password: "secret",
        cors: ["https://app.example"],
        config: { experimental: { machines: true } },
        models: { fetch: false },
      })
      const fetch = (request: Request) => Effect.promise(() => opencode.fetch(request))
      expect((yield* fetch(info())).status).toBe(401)
      const allowed = yield* fetch(info({ ...authorization, ...crossSite("https://app.example") }))
      expect(allowed.status).toBe(200)
      expect(allowed.headers.get("access-control-allow-origin")).toBe("https://app.example")
      expect((yield* fetch(info({ ...authorization, ...crossSite("https://evil.example") }))).status).toBe(403)
      // Cross-site machine-link upgrades pass from an allowed origin, as on Node, and get the routes' 403 otherwise.
      const upgrades = yield* Effect.promise(() =>
        withWebSocketPair(async () => {
          const site = (origin: string) => ({ ...crossSite(origin), "sec-fetch-mode": "websocket" })
          return [
            (await opencode.fetch(link(site("https://app.example")))).status,
            (await opencode.fetch(link(site("https://evil.example")))).status,
          ]
        }),
      )
      expect(upgrades.result).toEqual([101, 403])
      expect(upgrades.accepted).toEqual(["accept"])
      expect((yield* opencode.server.info()).version).toBeString()
      yield* opencode.alarm
    }).pipe(Effect.scoped),
  )
})

test("Promise OpenCode.create runs workspaceProviders through sdk.workspace", async () => {
  await using directory = await tmpdir("opencode-promise-workspace-")
  const { driver, calls } = recordingDriver()
  await using opencode = await OpenCode.create({
    config: { directory: directory.path, project: false, content: "{}" },
    models: { fetch: false },
    workspaceProviders: { sandbox: driver },
  })
  const workspaceID = await opencode.workspace.create({ provider: "sandbox" })
  expect((await opencode.workspace.provision({ workspaceID })).id).toBe(workspaceID)
  expect(await opencode.workspace.suspendIdle()).toEqual([])
  expect(await opencode.workspace.destroy({ workspaceID })).toMatchObject({ destroyed: true })
  expect(calls).toEqual([`create ${workspaceID}`, `destroy ${workspaceID}`])
})
