import { expect } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { OpenCode } from "@opencode/client"
import { Effect } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live(
  "global settings survive restart and block every new explicit skill admission",
  () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped("opencode-settings-")
      const config = path.join(tmp.path, "config")
      const first = { directory: path.join(tmp.path, "first") }
      const second = { directory: path.join(tmp.path, "second") }
      yield* Effect.promise(async () => {
        await Promise.all([config, first.directory, second.directory].map((directory) => mkdir(directory)))
        await mkdir(path.join(config, "skills", "toggle-test"), { recursive: true })
        await Bun.write(
          path.join(config, "skills", "toggle-test", "SKILL.md"),
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
          await expect(client.settings.set({ ...target, value: "unknown" })).rejects.toMatchObject({
            _tag: "InvalidRequestError",
            field: "value",
          })
          await Promise.all([first, second].map((location) => client.skill.list({ location })))
          const session = await client.session.create({ location: first })
          await client.session.prompt({
            sessionID: session.id,
            text: "Use @toggle-test",
            skills: [{ id: target.id }],
            resume: false,
          })
          const admitted = await client.session.inbox.list({ sessionID: session.id })
          expect(admitted).toHaveLength(1)

          expect(await client.settings.get(target)).toBeNull()
          await client.settings.set({ ...target, value: "disabled" })
          expect(await client.settings.get(target)).toEqual({ target, value: "disabled" })
          expect(await client.settings.list()).toEqual([{ target, value: "disabled" }])
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
          expect(await client.settings.list()).toEqual([{ target, value: "disabled" }])
          expect(await waitForSkill(client, second, target.id)).toBe(true)
          await client.settings.set({ ...target, value: "enabled" })
          expect(await client.settings.list()).toEqual([{ target, value: "enabled" }])
          const session = await client.session.create({ location: second })
          await client.session.skill({ sessionID: session.id, skill: target.id, resume: false })
          await client.session.prompt({
            sessionID: session.id,
            text: "Use it",
            skills: [{ id: target.id }],
            resume: false,
          })
          await client.settings.reset(target)
          expect(await client.settings.get(target)).toBeNull()
          expect(await client.settings.list()).toEqual([])
          expect(await waitForSkill(client, second, target.id)).toBe(true)
        })
      }).pipe(Effect.scoped)
    }),
  20_000,
)

async function waitForSkill(
  client: ReturnType<typeof OpenCode.make>,
  location: { directory: string },
  id: string,
) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if ((await client.skill.list({ location })).data.some((skill) => skill.id === id)) return true
    await Bun.sleep(25)
  }
  return false
}
