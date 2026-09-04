import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { Schema } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { OpenCode, Session, SessionMessage } from "../src"

const metadata = Schema.decodeUnknownSync(Schema.Struct({ account: Schema.String }))
const hostOptions = (directory: string) => ({
  database: { path: join(directory, "opencode.sqlite") },
  config: { directory, project: false, content: "{}" },
  models: { fetch: false },
  fs: { filewatcher: false },
})

test("Promise instances are lazy, share by key and Location, and stay isolated between hosts", async () => {
  await using directory = await tmpdir("opencode-promise-instances-")
  const otherDirectory = join(directory.path, "other")
  await mkdir(otherDirectory)
  const configured: string[] = []
  const setups: string[] = []
  const cleanups: string[] = []
  const createHost = (name: string) => {
    const instances: OpenCode.InstanceOptions = {
      key(session) {
        expect(typeof session.time.created).toBe("number")
        return metadata(session.metadata).account
      },
      configure(key): OpenCode.InstanceConfiguration {
        configured.push(`${name}:${key}`)
        return {
          plugins: [
            {
              id: "account-prompts",
              async setup(ctx) {
                const activation = `${name}:${key}@${ctx.location.directory}`
                setups.push(activation)
                await ctx.session.hook("prompt", (event) => {
                  event.prompt.text = `${activation}: ${event.prompt.text}`
                })
                return () => {
                  cleanups.push(activation)
                }
              },
            },
          ],
        }
      },
    }
    return OpenCode.create({
      ...hostOptions(directory.path),
      database: { path: join(directory.path, `${name}.sqlite`) },
      instances,
    })
  }

  await using first = await createHost("first")
  await using second = await createHost("second")
  const sessionID = Session.ID.create()
  const original = await first.sessions.create({
    id: sessionID,
    location: { directory: directory.path },
    metadata: { account: "alpha", labels: ["review", 2] },
  })
  const sameKey = await first.sessions.create({
    location: { directory: directory.path },
    metadata: original.metadata,
  })
  const separateKey = await first.sessions.create({
    location: { directory: directory.path },
    metadata: { account: "beta" },
  })
  const separateLocation = await first.sessions.create({
    location: { directory: otherDirectory },
    metadata: { account: "alpha" },
  })
  const separateHost = await second.sessions.create({
    id: sessionID,
    location: { directory: directory.path },
    metadata: original.metadata,
  })

  expect(await first.sessions.get({ sessionID })).toEqual(original)
  expect((await first.sessions.list()).data).toHaveLength(4)
  expect((await first.message.list({ sessionID })).data).toEqual([])
  expect(await first.sessions.context({ sessionID })).toEqual([])
  expect(await first.sessions.inbox.list({ sessionID })).toEqual([])
  expect(await second.sessions.get({ sessionID })).toEqual(separateHost)
  expect(configured).toEqual([])
  expect(setups).toEqual([])
  // Permission and form lists read instance services, so they acquire the Session's instance.
  expect(await first.permission.list({ sessionID })).toEqual([])
  expect(await first.form.list({ sessionID })).toEqual([])
  expect(configured).toEqual(["first:alpha"])

  await Promise.all(
    [
      { host: first, session: original, prefix: `first:alpha@${directory.path}` },
      { host: first, session: sameKey, prefix: `first:alpha@${directory.path}` },
      { host: first, session: separateKey, prefix: `first:beta@${directory.path}` },
      { host: first, session: separateLocation, prefix: `first:alpha@${otherDirectory}` },
      { host: second, session: separateHost, prefix: `second:alpha@${directory.path}` },
    ].map(async (input) => {
      const admitted = await input.host.sessions.prompt({
        sessionID: input.session.id,
        text: "Review this change",
        resume: false,
      })
      expect(admitted.payload.text).toBe(`${input.prefix}: Review this change`)
      expect(await input.host.sessions.inbox.list({ sessionID: input.session.id })).toEqual([admitted])
    }),
  )

  await first.sessions.switchAgent({ sessionID, agent: "plan" })
  const fork = await first.sessions.fork({ sessionID, boundary: { type: "through" } })
  expect(fork.metadata).toEqual(original.metadata)
  expect(fork.location).toEqual(original.location)
  expect(fork.fork?.sessionID).toBe(sessionID)
  const inherited = await first.sessions.prompt({ sessionID: fork.id, text: "Review the fork", resume: false })
  expect(inherited.payload.text).toBe(`first:alpha@${directory.path}: Review the fork`)
  expect(await first.sessions.inbox.list({ sessionID: fork.id })).toEqual([inherited])

  expect(configured.toSorted()).toEqual(["first:alpha", "first:alpha", "first:beta", "second:alpha"])
  expect(setups.toSorted()).toEqual(
    [
      `first:alpha@${directory.path}`,
      `first:alpha@${otherDirectory}`,
      `first:beta@${directory.path}`,
      `second:alpha@${directory.path}`,
    ].toSorted(),
  )
  expect(cleanups).toEqual([])
  expect(await first.sessions.active()).toEqual({})
  await first.close()
  expect(cleanups.toSorted()).toEqual(setups.filter((activation) => activation.startsWith("first:")).toSorted())

  const continued = await second.sessions.prompt({ sessionID, text: "Keep working", resume: false })
  expect(continued.payload.text).toBe(`second:alpha@${directory.path}: Keep working`)
  expect(await second.sessions.inbox.list({ sessionID })).toHaveLength(2)
  expect(configured).toHaveLength(4)
  await second.close()
  expect(cleanups.toSorted()).toEqual(setups.toSorted())
}, 20_000)

test.each(["configuration", "plugin setup"])(
  "Promise instance %s failure admits nothing, preserves healthy instances, and can be retried",
  async (failure) => {
    await using directory = await tmpdir("opencode-promise-instance-failure-")
    const configured: string[] = []
    const setups: string[] = []
    const cleanups: string[] = []
    await using opencode = await OpenCode.create({
      ...hostOptions(directory.path),
      instances: {
        key: (session) => metadata(session.metadata).account,
        async configure(key) {
          configured.push(key)
          if (key === "retry" && failure === "configuration" && configured.filter((item) => item === key).length === 1)
            throw new Error("Account configuration unavailable")
          return {
            plugins: [
              {
                id: "account-prompts",
                async setup(ctx) {
                  setups.push(key)
                  await ctx.session.hook("prompt", (event) => {
                    event.prompt.text = `${key}: ${event.prompt.text}`
                  })
                  if (
                    key === "retry" &&
                    failure === "plugin setup" &&
                    setups.filter((item) => item === key).length === 1
                  )
                    throw new Error("Account plugin unavailable")
                  return () => {
                    cleanups.push(key)
                  }
                },
              },
            ],
          }
        },
      },
    })
    const healthy = await opencode.sessions.create({
      location: { directory: directory.path },
      metadata: { account: "healthy" },
    })
    const retry = await opencode.sessions.create({
      location: { directory: directory.path },
      metadata: { account: "retry" },
    })
    const before = await opencode.sessions.prompt({ sessionID: healthy.id, text: "Before failure", resume: false })
    expect(before.payload.text).toBe("healthy: Before failure")
    const input = { sessionID: retry.id, id: SessionMessage.ID.create(), text: "Retry this input", resume: false }

    expect(await opencode.sessions.prompt(input).catch((error: unknown) => error)).toMatchObject({
      name: "ClientError",
      reason: "UnexpectedStatus",
    })
    expect(await opencode.sessions.inbox.list({ sessionID: retry.id })).toEqual([])
    expect((await opencode.message.list({ sessionID: retry.id })).data).toEqual([])
    expect(await opencode.sessions.get({ sessionID: retry.id })).toEqual(retry)
    expect(configured).toEqual(["healthy", "retry"])
    expect(cleanups).toEqual([])

    const after = await opencode.sessions.prompt({ sessionID: healthy.id, text: "After failure", resume: false })
    expect(after.payload.text).toBe("healthy: After failure")
    expect(await opencode.sessions.inbox.list({ sessionID: healthy.id })).toEqual([before, after])
    const admitted = await opencode.sessions.prompt(input)
    expect(admitted.id).toBe(input.id)
    expect(admitted.payload.text).toBe("retry: Retry this input")
    expect(await opencode.sessions.inbox.list({ sessionID: retry.id })).toEqual([admitted])
    expect(configured).toEqual(["healthy", "retry", "retry"])
    expect(setups).toEqual(failure === "configuration" ? ["healthy", "retry"] : ["healthy", "retry", "retry"])
    expect(cleanups).toEqual([])
    await opencode.close()
    expect(cleanups.toSorted()).toEqual(["healthy", "retry"])
  },
  20_000,
)

test("Promise instances reconstruct callbacks for persisted Sessions only on a cold prompt", async () => {
  await using directory = await tmpdir("opencode-promise-instance-restart-")
  const sessionID = Session.ID.create()
  const configured: string[] = []
  const setups: number[] = []
  const cleanups: number[] = []
  const options: OpenCode.CreateOptions = {
    ...hostOptions(directory.path),
    instances: {
      key: (session) => metadata(session.metadata).account,
      configure(key) {
        configured.push(key)
        const generation = configured.length
        return {
          plugins: [
            {
              id: "account-prompts",
              async setup(ctx) {
                setups.push(generation)
                await ctx.session.hook("prompt", (event) => {
                  event.prompt.text = `${key}/${generation}: ${event.prompt.text}`
                })
                return () => {
                  cleanups.push(generation)
                }
              },
            },
          ],
        }
      },
    },
  }
  await using first = await OpenCode.create(options)
  const created = await first.sessions.create({
    id: sessionID,
    location: { directory: directory.path },
    metadata: { account: "alpha", labels: ["review"] },
  })
  const before = await first.sessions.prompt({ sessionID, text: "Before restart", resume: false })
  expect(before.payload.text).toBe("alpha/1: Before restart")
  await first.close()
  expect(cleanups).toEqual([1])

  await using second = await OpenCode.create(options)
  expect(await second.sessions.get({ sessionID })).toMatchObject({
    id: sessionID,
    location: created.location,
    metadata: created.metadata,
    time: { created: created.time.created },
  })
  expect((await second.sessions.list()).data.map((session) => session.id)).toEqual([sessionID])
  expect(await second.sessions.inbox.list({ sessionID })).toEqual([before])
  expect((await second.message.list({ sessionID })).data).toEqual([])
  expect(configured).toEqual(["alpha"])
  expect(setups).toEqual([1])

  // The HTTP prompt boundary still acquires capabilities, even when Core reconciles an existing admission.
  expect(await second.sessions.prompt({ sessionID, id: before.id, text: "Already admitted", resume: false })).toEqual(
    before,
  )
  expect(configured).toEqual(["alpha", "alpha"])
  expect(setups).toEqual([1, 2])
  expect(await second.sessions.active()).toEqual({})

  const after = await second.sessions.prompt({ sessionID, text: "After restart", resume: false })
  expect(after.payload.text).toBe("alpha/2: After restart")
  expect(await second.sessions.inbox.list({ sessionID })).toEqual([before, after])
  expect(configured).toEqual(["alpha", "alpha"])
  expect(setups).toEqual([1, 2])
  expect(cleanups).toEqual([1])
  await second.close()
  expect(cleanups).toEqual([1, 2])
}, 20_000)

test("Promise instance plugin ID collisions reject admission and reconstruct on retry", async () => {
  await using directory = await tmpdir("opencode-promise-instance-collision-")
  const configured: string[] = []
  const setups: string[] = []
  const cleanups: string[] = []
  await using opencode = await OpenCode.create({
    ...hostOptions(directory.path),
    plugins: [
      {
        id: "account-prompts",
        setup() {
          setups.push("host")
          return () => {
            cleanups.push("host")
          }
        },
      },
    ],
    instances: {
      key: (session) => metadata(session.metadata).account,
      configure(key) {
        configured.push(key)
        return {
          plugins: [
            {
              id: configured.length === 1 ? "account-prompts" : "instance-prompts",
              async setup(ctx) {
                setups.push(key)
                await ctx.session.hook("prompt", (event) => {
                  event.prompt.text = `${key}: ${event.prompt.text}`
                })
              },
            },
          ],
        }
      },
    },
  })
  const session = await opencode.sessions.create({
    location: { directory: directory.path },
    metadata: { account: "alpha" },
  })
  const input = { sessionID: session.id, id: SessionMessage.ID.create(), text: "Retry this input", resume: false }
  expect(configured).toEqual([])

  expect(await opencode.sessions.prompt(input).catch((error: unknown) => error)).toMatchObject({
    name: "ClientError",
    reason: "UnexpectedStatus",
  })
  expect(await opencode.sessions.inbox.list({ sessionID: session.id })).toEqual([])
  expect((await opencode.message.list({ sessionID: session.id })).data).toEqual([])
  expect(configured).toEqual(["alpha"])
  // The host plugin wins the ID and activates inside the instance before the colliding instance plugin
  // is reported failed; rejecting the instance tears that generation down again.
  expect(setups).toEqual(["host"])
  expect(cleanups).toEqual(["host"])

  const admitted = await opencode.sessions.prompt(input)
  expect(admitted.id).toBe(input.id)
  expect(admitted.payload.text).toBe("alpha: Retry this input")
  expect(await opencode.sessions.inbox.list({ sessionID: session.id })).toEqual([admitted])
  expect(configured).toEqual(["alpha", "alpha"])
  // The reconstructed instance runs a fresh generation: host plugin again, then the renamed instance plugin.
  expect(setups).toEqual(["host", "host", "alpha"])
  expect(cleanups).toEqual(["host"])
}, 20_000)
