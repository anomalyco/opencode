import { expect } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { OpenCode } from "@opencode-ai/client"
import { Effect } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live(
  "global preferences survive restart and block every new explicit skill admission",
  () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped("opencode-preferences-")
      const config = path.join(tmp.path, "config")
      const first = { directory: path.join(tmp.path, "first") }
      const second = { directory: path.join(tmp.path, "second") }
      yield* Effect.promise(async () => {
        await Promise.all([config, first.directory, second.directory].map((directory) => mkdir(directory)))
        await Bun.write(
          path.join(config, "skills", "toggle-test.md"),
          "---\nname: Toggle test\ndescription: Fixture guidance\n---\nUse this guidance.",
        )
      })
      const options = {
        database: { path: path.join(tmp.path, "test.db") },
        config: { directory: config, project: false },
        models: { fetch: false },
        fs: { filewatcher: false },
      }
      const target = { kind: "skill.activation", id: "toggle-test" } as const

      yield* Effect.gen(function* () {
        const handler = yield* ServerFetch.make(options)
        const client = OpenCode.make({
          baseUrl: "http://opencode.local",
          fetch: Object.assign(
            (input: RequestInfo | URL, init?: RequestInit) =>
              handler(input instanceof Request ? input : new Request(input, init)),
            { preconnect: fetch.preconnect },
          ),
        })
        yield* Effect.promise(async () => {
          await expect(client.preferences.set({ ...target, value: "unknown" })).rejects.toMatchObject({
            _tag: "InvalidRequestError",
            field: "value",
          })
          await Promise.all([first, second].map((location) => client.plugin.awaitActivation({ location })))
          const session = await client.session.create({ location: first })
          await client.session.prompt({
            sessionID: session.id,
            text: "Use @toggle-test",
            skills: [{ id: target.id }],
            resume: false,
          })
          const admitted = await client.session.inbox.list({ sessionID: session.id })
          expect(admitted).toHaveLength(1)

          expect(await client.preferences.get(target)).toBeNull()
          await client.preferences.set({ ...target, value: "disabled" })
          expect(await client.preferences.get(target)).toEqual({ target, value: "disabled" })
          expect(await client.preferences.list()).toEqual([{ target, value: "disabled" }])
          for (const location of [first, second]) {
            const skill = (await client.skill.list({ location })).data.find((skill) => skill.id === target.id)
            expect(skill?.name).toBe("Toggle test")
          }
          await expect(
            client.session.skill({ sessionID: session.id, skill: target.id, resume: false }),
          ).rejects.toMatchObject({ _tag: "SkillDisabledError", message: expect.stringContaining("is disabled") })
          await expect(
            client.session.prompt({
              sessionID: session.id,
              text: "Use it",
              skills: [{ id: target.id }],
              resume: false,
            }),
          ).rejects.toMatchObject({ _tag: "SkillDisabledError", message: expect.stringContaining("is disabled") })
          expect(await client.session.inbox.list({ sessionID: session.id })).toEqual(admitted)
        })
      }).pipe(Effect.scoped)

      yield* Effect.gen(function* () {
        const handler = yield* ServerFetch.make(options)
        const client = OpenCode.make({
          baseUrl: "http://opencode.local",
          fetch: Object.assign(
            (input: RequestInfo | URL, init?: RequestInit) =>
              handler(input instanceof Request ? input : new Request(input, init)),
            { preconnect: fetch.preconnect },
          ),
        })
        yield* Effect.promise(async () => {
          await client.plugin.awaitActivation({ location: second })
          expect(await client.preferences.list()).toEqual([{ target, value: "disabled" }])
          expect((await client.skill.list({ location: second })).data.some((skill) => skill.id === target.id)).toBe(
            true,
          )
          await client.preferences.set({ ...target, value: "enabled" })
          expect(await client.preferences.list()).toEqual([{ target, value: "enabled" }])
          const session = await client.session.create({ location: second })
          await client.session.skill({ sessionID: session.id, skill: target.id, resume: false })
          await client.session.prompt({
            sessionID: session.id,
            text: "Use it",
            skills: [{ id: target.id }],
            resume: false,
          })
          await client.preferences.reset(target)
          expect(await client.preferences.get(target)).toBeNull()
          expect(await client.preferences.list()).toEqual([])
          expect((await client.skill.list({ location: second })).data.some((skill) => skill.id === target.id)).toBe(
            true,
          )
        })
      }).pipe(Effect.scoped)
    }),
  20_000,
)
