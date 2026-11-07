import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeGlobalNode, makeLocationNode } from "@opencode/util/effect/app-node"
import { Global } from "@opencode/util/global"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { Tool } from "@opencode/core/tool"
import { AskTool } from "@opencode/core/tool/plugin/ask"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { withTempDir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolDefinitions, toolIdentity } from "./lib/tool"

const denied = new Set<string>()
const permission = permissionLayer({
  assert: (input) =>
    denied.has(input.action)
      ? Effect.fail(new Permission.BlockedError({ rules: [], permission: input.action, resources: input.resources }))
      : Effect.void,
})

const wakes: Session.ID[] = []
const executionNode = makeGlobalNode({
  service: SessionExecution.Service,
  layer: Layer.succeed(
    SessionExecution.Service,
    SessionExecution.Service.of({
      active: Effect.succeed(new Set<Session.ID>()),
      isActive: () => Effect.succeed(false),
      resume: () => Effect.void,
      wake: (sessionID) => Effect.sync(() => void wakes.push(sessionID)),
      interrupt: () => Effect.succeed(false),
      awaitIdle: () => Effect.void,
    }),
  ),
  deps: [],
})

const askToolNode = makeLocationNode({
  name: "test/ask-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(AskTool.Plugin)),
  deps: [Tool.node, Session.node, Permission.node],
})

const nodes = LayerNode.group([Database.node, Bus.node, Session.node, SessionExecution.node, Tool.node])
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([nodes, askToolNode]), [
    SessionExecution.node.replace(executionNode),
    Global.node.replace(tempGlobalLayer),
    offlineModels,
    Permission.node.replace(permission),
  ]),
)

const createSession = (directory: string, title: string) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    return yield* sessions.create({
      location: Location.Ref.make({ directory: AbsolutePath.make(directory) }),
      title,
    })
  })

const createChild = (parentID: Session.ID, title: string) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    return yield* sessions.create({ parentID, title })
  })

const ask = (registry: Tool.Interface, sessionID: Session.ID, input: { session: string; question: string }) =>
  executeTool(registry, {
    sessionID,
    ...toolIdentity,
    call: { type: "tool-call", id: "call-ask", name: "ask", input },
  })

const answer = (
  registry: Tool.Interface,
  sessionID: Session.ID,
  input: { replyTo: SessionMessage.ID; answer: string },
) =>
  executeTool(registry, {
    sessionID,
    ...toolIdentity,
    call: { type: "tool-call", id: "call-answer", name: "answer", input },
  })

const syntheticInbox = (sessionID: Session.ID) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    return (yield* sessions.inbox(sessionID)).flatMap((item) => (item.type === "synthetic" ? [item] : []))
  })

describe("AskTool", () => {
  it.live("delivers one queued question into another top-level session", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const asker = yield* createSession(dir.path, "Asker")
        const target = yield* createSession(dir.path, "Target")
        const registry = yield* Tool.Service

        wakes.length = 0
        const result = yield* ask(registry, asker.id, { session: target.id, question: "Which auth header?" })
        expect(result.status).toBe("completed")
        expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("do not wait or poll") }])
        expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("you are not woken") }])
        expect(wakes).toEqual([target.id])

        const [item] = yield* syntheticInbox(target.id)
        expect(item?.delivery).toBe("queue")
        expect(item?.payload.metadata).toEqual({
          source: "ask",
          kind: "question",
          from: asker.id,
          to: target.id,
          from_title: "Asker",
          question: "Which auth header?",
        })
        expect(item?.payload.text).toContain("It is not from the user")
        expect(item?.payload.text).toContain(`"question_id": "${item?.id}"`)
        expect(item?.payload.text).toContain(`answer(replyTo="${item?.id}"`)
        expect(result).toMatchObject({ output: { to: target.id, questionID: item?.id } })
        expect(yield* syntheticInbox(asker.id)).toHaveLength(0)
      }),
    ),
  )

  it.live("refuses self, child caller, child target, archived, cross-project, and unknown targets", () =>
    withTempDir((first) =>
      withTempDir((second) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const asker = yield* createSession(first.path, "Asker")
          const target = yield* createSession(first.path, "Target")
          const child = yield* createChild(asker.id, "Child")
          const elsewhere = yield* createSession(second.path, "Elsewhere")
          const registry = yield* Tool.Service

          expect(yield* ask(registry, asker.id, { session: asker.id, question: "self" })).toMatchObject({
            status: "error",
            error: { message: expect.stringContaining("cannot ask itself") },
          })
          expect(yield* ask(registry, child.id, { session: target.id, question: "from child" })).toMatchObject({
            status: "error",
            error: { message: expect.stringContaining("Use the subagent tool") },
          })
          expect(yield* ask(registry, asker.id, { session: child.id, question: "to child" })).toMatchObject({
            status: "error",
            error: { message: expect.stringContaining(`Session ${child.id} is a subagent session`) },
          })
          yield* sessions.archive(target.id)
          expect(yield* ask(registry, asker.id, { session: target.id, question: "to archived" })).toMatchObject({
            status: "error",
            error: { message: expect.stringContaining(`Session ${target.id} is archived`) },
          })
          expect(yield* ask(registry, asker.id, { session: elsewhere.id, question: "to other project" })).toMatchObject(
            {
              status: "error",
              error: { message: expect.stringContaining(`Session ${elsewhere.id} belongs to another project`) },
            },
          )
          const unknown = Session.ID.create()
          expect(yield* ask(registry, asker.id, { session: unknown, question: "to nowhere" })).toMatchObject({
            status: "error",
            error: { message: expect.stringContaining(`Session ${unknown} was not found`) },
          })
          expect(yield* syntheticInbox(target.id)).toHaveLength(0)
        }),
      ),
    ),
  )

  it.live("scopes title discovery to this project's top-level sessions", () =>
    withTempDir((mine) =>
      withTempDir((theirs) =>
        Effect.gen(function* () {
          const asker = yield* createSession(mine.path, "Asker")
          const target = yield* createSession(mine.path, "Deploy plan")
          const elsewhere = yield* createSession(theirs.path, "Deploy plan")
          const child = yield* createChild(asker.id, "Deploy plan")
          const registry = yield* Tool.Service

          // A same-title session in another project or a child session is neither an ambiguity nor a candidate.
          expect(yield* ask(registry, asker.id, { session: "Deploy plan", question: "when?" })).toMatchObject({
            status: "completed",
            output: { to: target.id },
          })
          expect(elsewhere.id).not.toBe(target.id)
          expect(child.parentID).toBe(asker.id)

          // A title that only exists outside this project's top level never leaks that session.
          const hidden = yield* createSession(theirs.path, "Their roadmap")
          const hiddenChild = yield* createChild(asker.id, "Child roadmap")
          const missing = yield* ask(registry, asker.id, { session: "Their roadmap", question: "their?" })
          const missingMessage = missing.error?.message ?? ""
          expect(missing.status).toBe("error")
          expect(missingMessage).toContain("No session titled")
          expect(missingMessage).not.toContain(hidden.id)

          const childOnly = yield* ask(registry, asker.id, { session: "Child roadmap", question: "child?" })
          const childOnlyMessage = childOnly.error?.message ?? ""
          expect(childOnly.status).toBe("error")
          expect(childOnlyMessage).toContain("No session titled")
          expect(childOnlyMessage).not.toContain(hiddenChild.id)
          expect(yield* syntheticInbox(target.id)).toHaveLength(1)
        }),
      ),
    ),
  )

  it.live("resolves an exact title and lists ambiguous candidates without transcript content", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const asker = yield* createSession(dir.path, "Asker")
        const named = yield* createSession(dir.path, "Release notes")
        const first = yield* createSession(dir.path, "Twin")
        const second = yield* createSession(dir.path, "Twin")
        yield* sessions.synthetic({ sessionID: first.id, text: "SECRET-TRANSCRIPT-CONTENT" })
        const registry = yield* Tool.Service

        expect(yield* ask(registry, asker.id, { session: "Release notes", question: "when?" })).toMatchObject({
          status: "completed",
          output: { to: named.id },
        })

        const ambiguous = yield* ask(registry, asker.id, { session: "Twin", question: "which twin?" })
        expect(ambiguous.status).toBe("error")
        const message = ambiguous.error?.message ?? ""
        expect(message).toContain('Session title "Twin" is ambiguous')
        expect(message).toContain(first.id)
        expect(message).toContain(second.id)
        expect(message).not.toContain("SECRET-TRANSCRIPT-CONTENT")
        const listed = message.split("\n").slice(2)
        expect(listed).toHaveLength(2)
        listed.forEach((line) => expect(line).toMatch(/^- ses_\w+: Twin$/))
      }),
    ),
  )

  it.live("answers only a question this session was asked", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const asker = yield* createSession(dir.path, "Asker")
        const target = yield* createSession(dir.path, "Target")
        const registry = yield* Tool.Service

        yield* ask(registry, asker.id, { session: target.id, question: "Which auth header?" })
        const [question] = yield* syntheticInbox(target.id)
        if (question === undefined) return yield* Effect.die(new Error("expected a pending question"))

        const forged = yield* answer(registry, target.id, {
          replyTo: SessionMessage.ID.create(),
          answer: "forged",
        })
        expect(forged).toMatchObject({ status: "error", error: { message: expect.stringContaining("No question") } })

        const unrelated = yield* sessions.synthetic({
          sessionID: target.id,
          text: "not a question",
          metadata: { source: "test" },
        })
        const foreign = yield* answer(registry, target.id, { replyTo: unrelated.id, answer: "foreign" })
        expect(foreign).toMatchObject({ status: "error", error: { message: expect.stringContaining("No question") } })

        const sent = yield* answer(registry, target.id, { replyTo: question.id, answer: "Use Bearer." })
        expect(sent.status).toBe("completed")
        const [reply] = yield* syntheticInbox(asker.id)
        expect(reply?.delivery).toBe("steer")
        expect(reply?.payload.metadata).toEqual({
          source: "ask",
          kind: "answer",
          replyTo: question.id,
          from: target.id,
        })
        expect(reply?.payload.text).toContain(`to your question ${question.id}`)
        expect(reply?.payload.text).toContain("do not reply to it")
        expect(reply?.payload.text).toContain('"answer": "Use Bearer."')

        const again = yield* answer(registry, target.id, { replyTo: question.id, answer: "again" })
        expect(again).toMatchObject({
          status: "error",
          error: { message: expect.stringContaining("already has an answer") },
        })
      }),
    ),
  )

  it.live("wakes the target for a question but never wakes the asker for an answer", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const asker = yield* createSession(dir.path, "Asker")
        const target = yield* createSession(dir.path, "Target")
        const registry = yield* Tool.Service

        wakes.length = 0
        yield* ask(registry, asker.id, { session: target.id, question: "Which auth header?" })
        expect(wakes).toEqual([target.id])

        wakes.length = 0
        const [question] = yield* syntheticInbox(target.id)
        if (question === undefined) return yield* Effect.die(new Error("expected a pending question"))
        expect(yield* answer(registry, target.id, { replyTo: question.id, answer: "Use Bearer." })).toMatchObject({
          status: "completed",
        })
        // resume:false keeps the reply from waking the asker into an unattended run.
        expect(wakes).toEqual([])
        const [reply] = yield* syntheticInbox(asker.id)
        expect(reply?.delivery).toBe("steer")
      }),
    ),
  )

  it.live("caps pending questions per pair and refuses a duplicate pending question", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const asker = yield* createSession(dir.path, "Asker")
        const target = yield* createSession(dir.path, "Target")
        const registry = yield* Tool.Service

        expect(yield* ask(registry, asker.id, { session: target.id, question: "q1" })).toMatchObject({
          status: "completed",
        })
        expect(yield* ask(registry, asker.id, { session: target.id, question: "q1" })).toMatchObject({
          status: "error",
          error: { message: expect.stringContaining("already has that exact question unanswered") },
        })
        yield* ask(registry, asker.id, { session: target.id, question: "q2" })
        yield* ask(registry, asker.id, { session: target.id, question: "q3" })
        expect(yield* ask(registry, asker.id, { session: target.id, question: "q4" })).toMatchObject({
          status: "error",
          error: { message: expect.stringContaining("already has 3 unanswered questions") },
        })
        expect(yield* syntheticInbox(target.id)).toHaveLength(3)
      }),
    ),
  )

  it.live("counts delivered questions as unanswered and frees the slot once answered", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const database = yield* Database.Service
        const bus = yield* Bus.Service
        const asker = yield* createSession(dir.path, "Asker")
        const target = yield* createSession(dir.path, "Target")
        const registry = yield* Tool.Service

        yield* ask(registry, asker.id, { session: target.id, question: "q1" })
        yield* ask(registry, asker.id, { session: target.id, question: "q2" })
        yield* ask(registry, asker.id, { session: target.id, question: "q3" })
        yield* SessionInbox.promote(database.db, bus, target.id, "input")
        yield* SessionInbox.promote(database.db, bus, target.id, "input")
        yield* SessionInbox.promote(database.db, bus, target.id, "input")
        const promoted = (yield* sessions.context(target.id)).filter((message) => message.type === "synthetic")
        expect(promoted).toHaveLength(3)
        const answered = promoted[0]
        if (answered === undefined) return yield* Effect.die(new Error("expected three delivered questions"))

        // Promotion does not free a slot: the questions are still unanswered.
        expect(yield* ask(registry, asker.id, { session: target.id, question: "q1" })).toMatchObject({
          status: "error",
          error: { message: expect.stringContaining("already has that exact question unanswered") },
        })
        expect(yield* ask(registry, asker.id, { session: target.id, question: "q4" })).toMatchObject({
          status: "error",
          error: { message: expect.stringContaining("already has 3 unanswered questions") },
        })

        // Answering a delivered question frees its slot and releases its duplicate guard.
        yield* answer(registry, target.id, { replyTo: answered.id, answer: "one" })
        expect(yield* ask(registry, asker.id, { session: target.id, question: "q1" })).toMatchObject({
          status: "completed",
        })
        expect(yield* ask(registry, asker.id, { session: target.id, question: "q4" })).toMatchObject({
          status: "error",
          error: { message: expect.stringContaining("already has 3 unanswered questions") },
        })
      }),
    ),
  )

  it.live("promotes the question at the next boundary and steers the answer into the asker inbox", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const database = yield* Database.Service
        const bus = yield* Bus.Service
        const asker = yield* createSession(dir.path, "Asker")
        const target = yield* createSession(dir.path, "Target")
        const registry = yield* Tool.Service

        yield* ask(registry, asker.id, { session: target.id, question: "Which auth header?" })
        const [queued] = yield* syntheticInbox(target.id)
        if (queued === undefined) return yield* Effect.die(new Error("expected a pending question"))
        yield* SessionInbox.promote(database.db, bus, target.id, "input")

        const promoted = (yield* sessions.context(target.id)).filter((message) => message.type === "synthetic")
        expect(promoted).toHaveLength(1)
        expect(promoted[0]).toMatchObject({
          id: queued.id,
          text: expect.stringContaining(`"question_id": "${queued.id}"`),
          metadata: {
            source: "ask",
            kind: "question",
            from: asker.id,
            to: target.id,
            from_title: "Asker",
          },
        })

        const sent = yield* answer(registry, target.id, { replyTo: queued.id, answer: "Use Bearer." })
        expect(sent.status).toBe("completed")
        const steered = yield* sessions.inbox(asker.id)
        expect(steered).toHaveLength(1)
        expect(steered[0]).toMatchObject({
          type: "synthetic",
          delivery: "steer",
          payload: {
            metadata: {
              source: "ask",
              kind: "answer",
              replyTo: queued.id,
              from: target.id,
            },
            text: expect.stringContaining("Session answer."),
          },
        })
      }),
    ),
  )

  it.live("denies the action through an agent ruleset", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const asker = yield* createSession(dir.path, "Asker")
        const target = yield* createSession(dir.path, "Target")
        const registry = yield* Tool.Service
        denied.add("ask")
        yield* Effect.addFinalizer(() => Effect.sync(() => denied.delete("ask")))

        const listed = (yield* toolDefinitions(registry, [{ action: "ask", resource: "*", effect: "deny" }])).map(
          (tool) => tool.name,
        )
        expect(listed).not.toContain("ask")
        expect(listed).toContain("answer")

        expect(yield* ask(registry, asker.id, { session: target.id, question: "denied" })).toEqual({
          status: "error",
          error: { type: "permission.rejected", message: "Permission denied: ask" },
        })
        expect(yield* syntheticInbox(target.id)).toHaveLength(0)
      }),
    ),
  )
})
