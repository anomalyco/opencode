import { describe, expect, setDefaultTimeout } from "bun:test"
import path from "path"
import { Deferred, Effect, Fiber, Stream } from "effect"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { Plugin } from "@opencode-ai/core/plugin"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionInbox } from "@opencode-ai/core/session/inbox"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Skill } from "@opencode-ai/core/skill"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Global } from "@opencode-ai/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

// These tests include real Location and plugin startup, not just hook callbacks.
setDefaultTimeout(15_000)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, Session.node, LocationServiceMap.node]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      Global.node.replace(tempGlobalLayer),
      Watcher.node.replace(Watcher.configured({ enabled: false })),
      SessionExecution.node.replace(SessionExecution.noopLayer),
      offlineModels,
    ],
  ),
)

const project = Effect.acquireRelease(
  Effect.promise(() => tmpdir()),
  (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
)

const setup = Effect.gen(function* () {
  const tmp = yield* project
  const sessions = yield* Session.Service
  const session = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
  const services = LocationServiceMap.Service.get(session.location)
  const hooks = yield* Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    yield* plugins.awaitActivation
    return yield* PluginHooks.Service
  }).pipe(Effect.provide(services))
  return { sessions, session, hooks, services }
})

describe("Session prompt hooks", () => {
  it.live("waits for local plugin setup before admitting even a plain-text prompt", () =>
    Effect.gen(function* () {
      const tmp = yield* project
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tmp.path, ".opencode/plugins/prompt.ts"),
          `export default {
            id: "prompt-readiness",
            async setup(ctx) {
              await ctx.session.hook("prompt", (event) => {
                event.prompt.text = "Prepared by plugin"
              })
            },
          }`,
        ),
      )
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
      const admitted = yield* sessions.prompt({ sessionID: session.id, text: "Original", resume: false })
      expect(admitted.payload.text).toBe("Prepared by plugin")
    }),
  )

  it.live("allows cold plugin setup to admit synthetic input during revert staging", () =>
    Effect.gen(function* () {
      const tmp = yield* project
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tmp.path, ".opencode/plugins/revert.ts"),
          `export default {
            id: "revert-setup",
            async setup(ctx) {
              await ctx.session.synthetic({
                sessionID: "${session.id}",
                text: "Plugin activated",
                resume: false,
              })
            },
          }`,
        ),
      )
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      const boundaryID = SessionMessage.ID.create()
      yield* bus.publish(SessionEvent.InboxEnqueued, {
        inboxID: boundaryID,
        sessionID: session.id,
        item: SessionInbox.Item.make({
          type: "user",
          payload: { text: "Boundary" },
          delivery: "steer",
        }),
      })
      yield* SessionInbox.promote(database.db, bus, session.id, "steer")

      yield* sessions.revert.stage({ sessionID: session.id, messageID: boundaryID, files: false })

      expect((yield* sessions.get(session.id)).revert?.messageID).toBe(boundaryID)
      expect(yield* sessions.inbox(session.id)).toMatchObject([
        { type: "synthetic", payload: { text: "Plugin activated" } },
      ])
    }),
  )

  it.live("allows a Promise prompt hook to await same-Session synthetic admission", () =>
    Effect.gen(function* () {
      const tmp = yield* project
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tmp.path, ".opencode/plugins/prompt-synthetic.ts"),
          `export default {
            id: "prompt-synthetic",
            async setup(ctx) {
              await ctx.session.hook("prompt", async (event) => {
                await ctx.session.synthetic({
                  sessionID: event.sessionID,
                  text: "Admitted by Promise hook",
                  resume: false,
                })
                event.prompt.text += " prepared"
              })
            },
          }`,
        ),
      )
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })

      const prompt = yield* sessions.prompt({ sessionID: session.id, text: "Original", resume: false })

      expect(yield* sessions.inbox(session.id)).toMatchObject([
        { type: "synthetic", payload: { text: "Admitted by Promise hook" } },
        { id: prompt.id, type: "user", payload: { text: "Original prepared" } },
      ])
    }),
  )

  it.live("keeps concurrent Promise prompt hooks reentrant for the same Session", () =>
    Effect.gen(function* () {
      const tmp = yield* project
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tmp.path, ".opencode/plugins/concurrent-prompt-synthetic.ts"),
          `export default {
            id: "concurrent-prompt-synthetic",
            async setup(ctx) {
              let entered = 0
              let release
              const ready = new Promise((resolve) => release = resolve)
              await ctx.session.hook("prompt", async (event) => {
                entered++
                if (entered === 2) release()
                await ready
                await ctx.session.synthetic({
                  sessionID: event.sessionID,
                  text: "Hook: " + event.prompt.text,
                  resume: false,
                })
              })
            },
          }`,
        ),
      )
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })

      yield* Effect.all(
        [
          sessions.prompt({ sessionID: session.id, text: "First", resume: false }),
          sessions.prompt({ sessionID: session.id, text: "Second", resume: false }),
        ],
        { concurrency: "unbounded" },
      )

      const inbox = yield* sessions.inbox(session.id)
      const text = inbox.map((item) => ("text" in item.payload ? item.payload.text : undefined))
      expect(inbox.map((item) => item.type)).toEqual(["synthetic", "user", "synthetic", "user"])
      expect(text[0]).toBe(`Hook: ${text[1]}`)
      expect(text[2]).toBe(`Hook: ${text[3]}`)
    }),
  )

  it.live("drains detached Promise hook admissions before the capability expires", () =>
    Effect.gen(function* () {
      const tmp = yield* project
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tmp.path, ".opencode/plugins/detached-prompt-synthetic.ts"),
          `export default {
            id: "detached-prompt-synthetic",
            async setup(ctx) {
              await ctx.session.hook("prompt", (event) => {
                void ctx.session.synthetic({
                  sessionID: event.sessionID,
                  text: "Detached",
                  resume: false,
                })
              })
            },
          }`,
        ),
      )
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })

      const prompt = yield* sessions.prompt({ sessionID: session.id, text: "Prompt", resume: false })

      expect(yield* sessions.inbox(session.id)).toMatchObject([
        { type: "synthetic", payload: { text: "Detached" } },
        { id: prompt.id, type: "user" },
      ])
    }),
  )

  it.live("expires Promise hook admission after draining on success and failure", () =>
    Effect.gen(function* () {
      const tmp = yield* project
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tmp.path, ".opencode/plugins/late-prompt-synthetic.ts"),
          `export default {
            id: "late-prompt-synthetic",
            async setup(ctx) {
              await ctx.session.hook("prompt", (event) => {
                queueMicrotask(() => queueMicrotask(() => void ctx.session.synthetic({
                  sessionID: event.sessionID,
                  text: "Late: " + event.prompt.text,
                  resume: false,
                })))
                if (event.prompt.text === "Fail") throw new Error("Hook failed")
              })
            },
          }`,
        ),
      )
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })

      const prompt = yield* sessions.prompt({ sessionID: session.id, text: "Success", resume: false })
      const firstBarrier = yield* sessions.synthetic({ sessionID: session.id, text: "First barrier", resume: false })
      expect(
        (yield* sessions.prompt({ sessionID: session.id, text: "Fail", resume: false }).pipe(Effect.exit))._tag,
      ).toBe("Failure")
      const secondBarrier = yield* sessions.synthetic({ sessionID: session.id, text: "Second barrier", resume: false })

      expect(yield* sessions.inbox(session.id)).toMatchObject([
        { id: prompt.id, type: "user" },
        { type: "synthetic", payload: { text: "Late: Success" } },
        { id: firstBarrier.id, type: "synthetic" },
        { type: "synthetic", payload: { text: "Late: Fail" } },
        { id: secondBarrier.id, type: "synthetic" },
      ])
    }),
  )

  it.live("does not bridge unrelated Promise work while a prompt hook is active", () =>
    Effect.gen(function* () {
      const tmp = yield* project
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tmp.path, ".opencode/plugins/unrelated-prompt-synthetic.ts"),
          `export default {
            id: "unrelated-prompt-synthetic",
            async setup(ctx) {
              let start
              const started = new Promise((resolve) => start = resolve)
              void started.then(() => ctx.session.synthetic({
                sessionID: "${session.id}",
                text: "Unrelated",
                resume: false,
              }))
              await ctx.session.hook("prompt", async () => {
                start()
                await new Promise((resolve) => setTimeout(resolve, 50))
              })
            },
          }`,
        ),
      )

      const prompt = yield* sessions.prompt({ sessionID: session.id, text: "Prompt", resume: false })
      const barrier = yield* sessions.synthetic({ sessionID: session.id, text: "Barrier", resume: false })

      expect(yield* sessions.inbox(session.id)).toMatchObject([
        { id: prompt.id, type: "user" },
        { type: "synthetic", payload: { text: "Unrelated" } },
        { id: barrier.id, type: "synthetic" },
      ])
    }),
  )

  it.live("persists ordered draft edits and resolves added files and skills without mutating the caller", () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const skills = yield* Skill.Service.pipe(Effect.provide(fixture.services))
      const skill = Skill.Info.make({
        id: Skill.ID.make("policy"),
        name: Skill.Name.make("Policy"),
        description: "Company policy",
        location: AbsolutePath.make(path.join(fixture.session.location.directory, "policy.md")),
        content: "Follow company policy.",
      })
      yield* skills.transform((draft) => draft.add(skill))
      const input = {
        sessionID: fixture.session.id,
        id: SessionMessage.ID.create(),
        text: "secret",
        files: [
          {
            uri: "data:text/plain;base64,b3JpZ2luYWw=",
            name: "original.txt",
            mention: { start: 0, end: 6, text: "secret" },
          },
        ],
        metadata: { source: "api" },
        resume: false,
      }
      yield* fixture.hooks.register("session", "prompt", (event) =>
        Effect.sync(() => {
          expect(event.sessionID).toBe(input.sessionID)
          expect(event.messageID).toBe(input.id)
          event.prompt.text = "Redacted"
          const file = event.prompt.files?.[0]
          if (file) {
            file.uri = "data:text/plain;base64,cG9saWN5"
            file.name = "policy.txt"
            delete file.mention
          }
          event.prompt.skills = [{ id: skill.id }]
          event.prompt.agents = [{ name: "reviewer" }]
          event.metadata ??= {}
          event.metadata.source = "plugin"
          event.delivery = "queue"
        }),
      )
      yield* fixture.hooks.register("session", "prompt", (event) =>
        Effect.sync(() => {
          expect(event.prompt.text).toBe("Redacted")
          event.prompt.text += " with policy"
        }),
      )
      const admitted = yield* fixture.sessions.prompt(input)
      expect(admitted).toMatchObject({
        id: input.id,
        delivery: "queue",
        payload: {
          text: "Redacted with policy",
          metadata: { source: "plugin" },
          files: [{ name: "policy.txt", data: "cG9saWN5", mime: "text/plain" }],
          agents: [{ name: "reviewer" }],
          skills: [{ id: skill.id, name: skill.name, text: Skill.toModelOutput(skill, []) }],
        },
      })
      expect(input.text).toBe("secret")
      expect(input.files).toEqual([
        {
          uri: "data:text/plain;base64,b3JpZ2luYWw=",
          name: "original.txt",
          mention: { start: 0, end: 6, text: "secret" },
        },
      ])
      expect(input.metadata).toEqual({ source: "api" })
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      expect(yield* SessionInbox.find(database.db, input.id)).toEqual(admitted)
      const log = yield* fixture.sessions.log({ sessionID: input.sessionID }).pipe(Stream.runCollect)
      expect(JSON.stringify(log)).not.toContain("secret")
      yield* SessionInbox.promote(database.db, bus, input.sessionID, "input")
      expect(yield* fixture.sessions.messages({ sessionID: input.sessionID })).toMatchObject([
        { id: input.id, type: "user", text: "Redacted with policy", metadata: { source: "plugin" } },
      ])
    }),
  )

  it.live("skips hooks and payload resolution on pending and delivered retries, including conflicts", () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const calls: string[] = []
      yield* fixture.hooks.register("session", "prompt", (event) =>
        Effect.sync(() => {
          calls.push(event.prompt.text)
          event.prompt.text = "First admission"
        }),
      )
      const input = { sessionID: fixture.session.id, id: SessionMessage.ID.create(), text: "Original", resume: false }
      const first = yield* fixture.sessions.prompt(input)
      const retry = { ...input, text: "Ignored", files: [{ uri: "file:///missing-retry-file" }] }
      expect(yield* fixture.sessions.prompt(retry)).toEqual(first)
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      yield* SessionInbox.promote(database.db, bus, input.sessionID, "steer")
      expect((yield* fixture.sessions.prompt(retry)).payload).toEqual(first.payload)
      const other = yield* fixture.sessions.create({ location: fixture.session.location })
      expect((yield* fixture.sessions.prompt({ ...retry, sessionID: other.id }).pipe(Effect.flip))._tag).toBe(
        "Session.PromptConflictError",
      )
      const synthetic = yield* fixture.sessions.synthetic({
        sessionID: input.sessionID,
        text: "Synthetic",
        resume: false,
      })
      expect((yield* fixture.sessions.prompt({ ...retry, id: synthetic.id }).pipe(Effect.flip))._tag).toBe(
        "Session.PromptConflictError",
      )
      expect(calls).toEqual(["Original"])
    }),
  )

  it.live("leaves a staged revert untouched on failed boundary replacement and preparation", () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      const first = yield* fixture.sessions.prompt({ sessionID: fixture.session.id, text: "Boundary", resume: false })
      yield* SessionInbox.promote(database.db, bus, fixture.session.id, "steer")
      yield* bus.publish(SessionEvent.RevertEvent.Staged, {
        sessionID: fixture.session.id,
        revert: { messageID: first.id, files: [] },
      })
      const failing = yield* fixture.hooks.register("session", "prompt", () => Effect.die(new Error("Broken hook")))
      expect(
        (yield* fixture.sessions
          .prompt({
            sessionID: fixture.session.id,
            id: first.id,
            text: "Replacement",
            resume: false,
          })
          .pipe(Effect.exit))._tag,
      ).toBe("Failure")
      expect(
        (yield* fixture.sessions
          .prompt({ sessionID: fixture.session.id, text: "Fail", resume: false })
          .pipe(Effect.exit))._tag,
      ).toBe("Failure")
      expect((yield* fixture.sessions.get(fixture.session.id)).revert?.messageID).toBe(first.id)
      expect(yield* fixture.sessions.messages({ sessionID: fixture.session.id })).toMatchObject([{ id: first.id }])
      yield* failing.dispose
      const next = yield* fixture.sessions.prompt({
        sessionID: fixture.session.id,
        text: "After revert",
        resume: false,
      })
      expect((yield* fixture.sessions.get(fixture.session.id)).revert).toBeUndefined()
      expect(yield* fixture.sessions.messages({ sessionID: fixture.session.id })).toEqual([])
      expect(yield* fixture.sessions.inbox(fixture.session.id)).toEqual([next])
    }),
  )

  it.live("keeps first-admission-wins for concurrent transformed submissions", () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const calls: string[] = []
      yield* fixture.hooks.register("session", "prompt", (event) =>
        Effect.gen(function* () {
          calls.push(event.prompt.text)
          event.prompt.text += " transformed"
          if (calls.length === 2) yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(release)
        }),
      )
      const input = { sessionID: fixture.session.id, id: SessionMessage.ID.create(), text: "First", resume: false }
      const submissions = yield* Effect.all(
        [fixture.sessions.prompt(input), fixture.sessions.prompt({ ...input, text: "Second" })],
        { concurrency: "unbounded" },
      ).pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      expect(yield* fixture.sessions.inbox(input.sessionID)).toEqual([])
      yield* Deferred.succeed(release, undefined)
      const results = yield* Fiber.join(submissions)
      expect(results[0]).toEqual(results[1])
      expect(["First transformed", "Second transformed"]).toContain(results[0]?.payload.text)
      expect(yield* fixture.sessions.inbox(input.sessionID)).toHaveLength(1)
      expect(yield* fixture.sessions.prompt(input)).toEqual(results[0])
      expect(calls).toHaveLength(2)
    }),
  )

  it.live("does not admit failed attachment preparation or an interrupted hook", () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const registration = yield* fixture.hooks.register("session", "prompt", (event) =>
        Effect.sync(() => {
          event.prompt.files = [{ uri: "file:///missing-hook-file" }]
        }),
      )
      expect(
        (yield* fixture.sessions
          .prompt({ sessionID: fixture.session.id, text: "Original", resume: false })
          .pipe(Effect.flip))._tag,
      ).toBe("Session.AttachmentError")
      yield* registration.dispose
      const failing = yield* fixture.hooks.register("session", "prompt", () => Effect.die(new Error("Broken hook")))
      expect(
        (yield* fixture.sessions
          .prompt({ sessionID: fixture.session.id, text: "Fail", resume: false })
          .pipe(Effect.exit))._tag,
      ).toBe("Failure")
      yield* failing.dispose
      const started = yield* Deferred.make<void>()
      yield* fixture.hooks.register("session", "prompt", () =>
        Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      )
      const submission = yield* fixture.sessions
        .prompt({ sessionID: fixture.session.id, text: "Interrupt", resume: false })
        .pipe(Effect.forkChild)
      yield* Deferred.await(started)
      yield* Fiber.interrupt(submission)
      expect(yield* fixture.sessions.inbox(fixture.session.id)).toEqual([])
      expect(yield* fixture.sessions.messages({ sessionID: fixture.session.id })).toEqual([])
    }),
  )

  it.live("applies a Promise plugin to command-generated prompts only in its own location", () =>
    Effect.gen(function* () {
      const tmp = yield* project
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tmp.path, ".opencode/plugins/command.ts"),
          `export default {
        id: "prompt-command",
        async setup(ctx) {
          await ctx.session.hook("prompt", (event) => {
            event.prompt.text += " with plugin"
          })
          await ctx.command.transform((draft) => {
            draft.add({
              name: "review",
              async execute(input) {
                await ctx.session.prompt({ sessionID: input.sessionID, text: "Review", resume: false })
              },
            })
          })
        },
      }`,
        ),
      )
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
      const other = yield* setup
      yield* sessions.command({ sessionID: session.id, command: "review", text: "" })
      expect(yield* sessions.inbox(session.id)).toMatchObject([{ payload: { text: "Review with plugin" } }])
      const untouched = yield* other.sessions.prompt({
        sessionID: other.session.id,
        text: "Other location",
        resume: false,
      })
      expect(untouched.payload.text).toBe("Other location")
    }),
  )
})
