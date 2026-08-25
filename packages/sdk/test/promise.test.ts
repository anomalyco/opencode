import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { OpenCode, Session } from "../src"

test("Promise host uses the embedded router and releases plugins", async () => {
  await using directory = await tmpdir("opencode-promise-sdk-")
  const config = join(directory.path, "config")
  await mkdir(config)
  const ready = Promise.withResolvers<void>()
  let setup = false
  let cleanup = false
  const opencode = await OpenCode.create({
    events: { persist: true },
    config: { directory: config, project: false, content: "{}" },
    plugins: [
      {
        id: `promise-${crypto.randomUUID()}`,
        setup() {
          setup = true
          ready.resolve()
          return () => {
            cleanup = true
          }
        },
      },
    ],
  })

  try {
    const location = { directory: directory.path }
    const session = await opencode.sessions.create({ location })
    await opencode.plugin.list({ location })
    await Promise.race([
      ready.promise,
      Bun.sleep(4_000).then(() => {
        throw new Error("Promise plugin did not start")
      }),
    ])
    const selected = await opencode.sessions.get({ sessionID: session.id })
    const page = await opencode.sessions.list({ directory: directory.path })
    const events = Array.fromAsync(opencode.sessions.log({ sessionID: session.id }))

    expect(selected.id).toBe(session.id)
    expect(page.data.some((item) => item.id === session.id)).toBe(true)
    expect((await events).some((event) => event.type === "session.created")).toBe(true)
    expect(setup).toBe(true)

    const missingSessionID = Session.ID.create()
    const missing = await opencode.sessions.get({ sessionID: missingSessionID }).catch((error: unknown) => error)
    expect(missing).toMatchObject({ _tag: "SessionNotFoundError", sessionID: missingSessionID })
  } finally {
    await opencode.close()
    await opencode.close()
  }

  expect(cleanup).toBe(true)
})

test("Promise event streams support cancellation", async () => {
  await using directory = await tmpdir("opencode-promise-stream-")
  const config = join(directory.path, "config")
  await mkdir(config)
  {
    await using opencode = await OpenCode.create({ config: { directory: config, project: false, content: "{}" } })
    const controller = new AbortController()
    const events = opencode.events.subscribe({ signal: controller.signal })[Symbol.asyncIterator]()
    expect(await events.next()).toMatchObject({ value: { type: "server.connected" }, done: false })
    const pending = events.next()
    controller.abort()
    const error = await pending.catch((error: unknown) => error)
    expect(error).toMatchObject({ name: "ClientError", reason: "Transport" })
    await events.return?.()
  }
})

test("closing cancels active Promise event streams", async () => {
  await using directory = await tmpdir("opencode-promise-stream-close-")
  const config = join(directory.path, "config")
  await mkdir(config)
  const opencode = await OpenCode.create({ config: { directory: config, project: false, content: "{}" } })
  const events = opencode.events.subscribe()[Symbol.asyncIterator]()
  expect(await events.next()).toMatchObject({ value: { type: "server.connected" }, done: false })
  const pending = events.next()

  await opencode.close()
  const error = await pending.catch((error: unknown) => error)
  expect(error).toMatchObject({ name: "ClientError", reason: "Transport" })
})

test("closing waits for pending Promise plugin setup and runs its cleanup", async () => {
  await using directory = await tmpdir("opencode-promise-plugin-close-")
  const config = join(directory.path, "config")
  await mkdir(config)
  await using opencode = await OpenCode.create({ config: { directory: config, project: false, content: "{}" } })
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<() => void>()
  let cleanup = false

  await opencode.plugin({
    id: `pending-${crypto.randomUUID()}`,
    setup() {
      started.resolve()
      return release.promise
    },
  })
  const boot = opencode.plugin.list({ location: { directory: directory.path } })
  await started.promise
  const closing = opencode.close()
  const concurrent = opencode.close()

  try {
    expect(concurrent).toBe(closing)
    expect(await Promise.race([closing.then(() => "closed"), Promise.resolve("pending")])).toBe("pending")
  } finally {
    release.resolve(() => {
      cleanup = true
    })
    await closing
    await boot.catch(() => undefined)
  }
  expect(cleanup).toBe(true)
})
