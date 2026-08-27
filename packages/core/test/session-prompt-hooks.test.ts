import { describe, expect, setDefaultTimeout } from "bun:test"
import path from "path"
import { Deferred, Effect, Fiber, Stream } from "effect"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
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
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

// These tests include real Location and plugin startup, not just hook callbacks.
setDefaultTimeout(15_000)

const runtime = PluginRuntime.makeCell()
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      Session.node,
      LocationServiceMap.node,
      PluginRuntime.providerNodeWithCell(runtime),
    ]),
    [
      [Bus.node, Bus.configured({ persist: true })],
      [Global.node, tempGlobalLayer],
      [Watcher.node, Watcher.configured({ enabled: false })],
      [SessionExecution.node, SessionExecution.noopLayer],
      [PluginRuntime.node, PluginRuntime.layerWithCell(runtime)],
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
  const locations = yield* LocationServiceMap.Service
  const services = locations.get(session.location)
  const hooks = yield* Effect.gen(function* () {
    const plugins = yield* PluginSupervisor.Service
    yield* plugins.flush
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

  it.live("leaves a staged revert untouched on retries and failed preparation", () =>
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
        (yield* fixture.sessions.prompt({
          sessionID: fixture.session.id,
          id: first.id,
          text: "Ignored",
          resume: false,
        })).payload,
      ).toEqual(first.payload)
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
