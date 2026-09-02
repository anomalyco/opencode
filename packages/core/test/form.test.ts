import { describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Stream } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { Form } from "@opencode-ai/core/form"
import { Location } from "@opencode-ai/core/location"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { Project } from "@opencode-ai/schema/project"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

// No LocationServiceMap or Instance in this graph: the ledger must serve Session-keyed reads
// and route events without booting the Session's Location.
const forms = AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SessionStore.node, Form.node]))
const it = testEffect(forms)

const formID = Form.ID.create("frm_test")
const input = {
  id: formID,
  sessionID: SessionSchema.ID.make("ses_test"),
  title: "Test form",
  fields: [{ key: "name", type: "string", required: true }],
} satisfies Form.CreateInput

const a = Location.Ref.make({ directory: AbsolutePath.make("/a") })
const b = Location.Ref.make({ directory: AbsolutePath.make("/b") })
const Done = Bus.ephemeral({ type: "test.form.done", schema: {} })

const seed = Effect.fn(function* (sessions: ReadonlyArray<{ id: SessionSchema.ID; ref: Location.Ref }>) {
  const database = yield* Database.Service
  yield* database.db.insert(ProjectTable).values({ id: Project.ID.global, worktree: a.directory, sandboxes: [] }).run()
  yield* database.db
    .insert(SessionTable)
    .values(
      sessions.map((session) => ({
        id: session.id,
        project_id: Project.ID.global,
        directory: session.ref.directory,
        workspace_id: session.ref.workspaceID,
        slug: session.id,
        version: "test",
      })),
    )
    .run()
})

// Collects what a client subscribed at `ref` sees until the global Done marker.
const watch = (bus: Bus.Interface, ref: Location.Ref) =>
  bus
    .subscribe()
    .pipe(
      Stream.takeUntil((event) => event.type === Done.type),
      Stream.filter((event) => event.type !== Done.type),
      Stream.runCollect,
      Effect.provideService(Location.Service, location(ref)),
      Effect.forkScoped({ startImmediately: true }),
    )

describe("Form", () => {
  it.effect("serves Session-keyed reads from the global ledger without the Session's Location", () =>
    Effect.gen(function* () {
      const other = SessionSchema.ID.make("ses_other")
      yield* seed([
        { id: input.sessionID, ref: a },
        { id: other, ref: b },
      ])
      const service = yield* Form.Service

      const created = yield* service.create(input)

      expect(yield* service.list({ sessionID: input.sessionID })).toEqual([created])
      expect(yield* service.list({ sessionID: other })).toEqual([])
      expect(yield* service.list({ location: a })).toEqual([created])
      expect(yield* service.list({ location: b })).toEqual([])
    }),
  )

  it.effect("routes events to the owning Session's Location without an ambient Location", () =>
    Effect.gen(function* () {
      yield* seed([{ id: input.sessionID, ref: a }])
      const service = yield* Form.Service
      const bus = yield* Bus.Service
      const atA = yield* watch(bus, a)
      const atB = yield* watch(bus, b)

      const created = yield* service.create(input)
      yield* service.reply({ id: created.id, answer: { name: "Ava" } })
      yield* bus.publish(Done, {}, { global: true })

      const seen = Array.from(yield* Fiber.join(atA))
      expect(seen.map((event) => [event.type, event.location])).toEqual([
        ["form.created", a],
        ["form.replied", a],
      ])
      expect(Array.from(yield* Fiber.join(atB))).toEqual([])
    }),
  )

  it.effect("scopes the global mcp elicitation owner to its ambient Location", () =>
    Effect.gen(function* () {
      const service = yield* Form.Service
      const bus = yield* Bus.Service
      const atA = yield* watch(bus, a)
      const atB = yield* watch(bus, b)

      const created = yield* service
        .create({
          sessionID: "global",
          title: "MCP input",
          fields: [{ key: "name", type: "string", required: true }],
        })
        .pipe(Effect.provideService(Location.Service, location(a)))
      expect(yield* service.list({ sessionID: "global", location: a })).toEqual([created])
      expect(yield* service.list({ sessionID: "global", location: b })).toEqual([])

      // Settling from outside the Location, as the HTTP cancel route does, keeps the creation route.
      yield* service.cancel(created.id)
      yield* bus.publish(Done, {}, { global: true })

      const seen = Array.from(yield* Fiber.join(atA))
      expect(seen.map((event) => [event.type, event.location])).toEqual([
        ["form.created", a],
        ["form.cancelled", a],
      ])
      expect(Array.from(yield* Fiber.join(atB))).toEqual([])
    }),
  )

  it.effect("validates absolute URI formats without restricting schemes", () =>
    Effect.sync(() => {
      const fields = [{ key: "uri", type: "string", format: "uri" }] satisfies ReadonlyArray<Form.Field>

      expect(Form.validateAnswer(fields, { uri: "https://example.com/path" })).toBeUndefined()
      expect(Form.validateAnswer(fields, { uri: "mailto:user@example.com" })).toBeUndefined()
      expect(Form.validateAnswer(fields, { uri: "relative/path" })).toBe("Expected URI for form field: uri")
      expect(Form.validateAnswer(fields, { uri: "://invalid" })).toBe("Expected URI for form field: uri")
    }),
  )

  it.effect("returns a terminal cancelled state from ask", () =>
    Effect.gen(function* () {
      const service = yield* Form.Service
      const bus = yield* Bus.Service
      const created = yield* Deferred.make<Form.Info>()
      const unsubscribe = yield* bus.listen((event) =>
        event.type === Form.Event.Created.type
          ? Deferred.succeed(created, (event.data as { readonly form: Form.Info }).form).pipe(Effect.asVoid)
          : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const fiber = yield* service.ask(input).pipe(Effect.forkScoped)
      const form = yield* Deferred.await(created)

      yield* service.cancel(form.id)

      expect(yield* Fiber.join(fiber)).toEqual({ status: "cancelled" })
      expect(yield* service.state(form.id)).toEqual({ status: "cancelled" })
    }),
  )

  it.effect("supports the temporary global mcp elicitation owner", () =>
    Effect.gen(function* () {
      const service = yield* Form.Service
      const created = yield* service.create({
        sessionID: "global",
        title: "MCP input",
        fields: [{ key: "name", type: "string", required: true }],
      })
      expect(created.sessionID).toBe("global")
      expect(created.title).toBe("MCP input")

      const owned = yield* service.list({ sessionID: "global" })
      expect(owned.map((form) => form.id)).toEqual([created.id])
      expect(yield* service.list({ sessionID: "other" })).toEqual([])

      yield* service.reply({ id: created.id, answer: { name: "Ava" } })
      expect(yield* service.state(created.id)).toEqual({ status: "answered", answer: { name: "Ava" } })

      const externalOnly = yield* service.create({
        sessionID: "global",
        title: "External setup",
        fields: [{ key: "setup", type: "external", url: "https://example.com/setup" }],
      })
      yield* service.reply({ id: externalOnly.id, answer: { setup: true } })
      expect(yield* service.state(externalOnly.id)).toEqual({ status: "answered", answer: { setup: true } })
    }),
  )

  it.effect("gates required fields and rejects inactive answers via when", () =>
    Effect.gen(function* () {
      const service = yield* Form.Service
      const created = yield* service.create({
        sessionID: "global",
        title: "Conditional form",
        fields: [
          { key: "confirm", type: "boolean", required: true },
          { key: "reason", type: "string", required: true, when: [{ key: "confirm", op: "eq", value: false }] },
        ],
      })

      const inactive = yield* service
        .reply({ id: created.id, answer: { confirm: true, reason: "x" } })
        .pipe(Effect.flip)
      expect(inactive).toEqual(
        new Form.InvalidAnswerError({ id: created.id, message: "Form field is not active: reason" }),
      )

      const missing = yield* service.reply({ id: created.id, answer: { confirm: false } }).pipe(Effect.flip)
      expect(missing).toEqual(
        new Form.InvalidAnswerError({ id: created.id, message: "Missing required form field: reason" }),
      )

      yield* service.reply({ id: created.id, answer: { confirm: false, reason: "not ready" } })
      expect(yield* service.state(created.id)).toEqual({
        status: "answered",
        answer: { confirm: false, reason: "not ready" },
      })
    }),
  )

  it.effect("evaluates when against multiselect answers as inclusion", () =>
    Effect.gen(function* () {
      const service = yield* Form.Service
      const options = [
        { value: "go", label: "Go" },
        { value: "ts", label: "TypeScript" },
      ]
      const created = yield* service.create({
        sessionID: "global",
        title: "Multiselect form",
        fields: [
          { key: "langs", type: "multiselect", options },
          { key: "goVersion", type: "string", required: true, when: [{ key: "langs", op: "eq", value: "go" }] },
        ],
      })

      const missing = yield* service.reply({ id: created.id, answer: { langs: ["go", "ts"] } }).pipe(Effect.flip)
      expect(missing).toEqual(
        new Form.InvalidAnswerError({ id: created.id, message: "Missing required form field: goVersion" }),
      )

      yield* service.reply({ id: created.id, answer: { langs: ["ts"] } })
      expect(yield* service.state(created.id)).toEqual({ status: "answered", answer: { langs: ["ts"] } })
    }),
  )

  it.effect("requires every when condition to match and treats empty when as active", () =>
    Effect.gen(function* () {
      const service = yield* Form.Service
      const created = yield* service.create({
        sessionID: "global",
        title: "Dependent form",
        fields: [
          { key: "a", type: "boolean" },
          { key: "b", type: "boolean" },
          {
            key: "x",
            type: "string",
            required: true,
            when: [
              { key: "a", op: "eq", value: true },
              { key: "b", op: "eq", value: true },
            ],
          },
          { key: "z", type: "string", required: true, when: [] },
        ],
      })

      const missingX = yield* service.reply({ id: created.id, answer: { a: true, b: true, z: "ok" } }).pipe(Effect.flip)
      expect(missingX).toEqual(
        new Form.InvalidAnswerError({ id: created.id, message: "Missing required form field: x" }),
      )

      const inactiveX = yield* service
        .reply({ id: created.id, answer: { a: true, b: false, x: "nope", z: "ok" } })
        .pipe(Effect.flip)
      expect(inactiveX).toEqual(new Form.InvalidAnswerError({ id: created.id, message: "Form field is not active: x" }))

      const missingZ = yield* service.reply({ id: created.id, answer: { a: true, b: false } }).pipe(Effect.flip)
      expect(missingZ).toEqual(
        new Form.InvalidAnswerError({ id: created.id, message: "Missing required form field: z" }),
      )

      yield* service.reply({ id: created.id, answer: { a: true, b: false, z: "ok" } })
      expect(yield* service.state(created.id)).toEqual({ status: "answered", answer: { a: true, b: false, z: "ok" } })
    }),
  )

  it.effect("evaluates neq against multiselect answers as non-inclusion", () =>
    Effect.gen(function* () {
      const service = yield* Form.Service
      const options = [
        { value: "go", label: "Go" },
        { value: "ts", label: "TypeScript" },
      ]
      const created = yield* service.create({
        sessionID: "global",
        title: "Selection form",
        fields: [
          { key: "langs", type: "multiselect", options },
          { key: "note", type: "string", required: true, when: [{ key: "langs", op: "neq", value: "go" }] },
        ],
      })

      const missing = yield* service.reply({ id: created.id, answer: { langs: ["ts"] } }).pipe(Effect.flip)
      expect(missing).toEqual(
        new Form.InvalidAnswerError({ id: created.id, message: "Missing required form field: note" }),
      )

      // an answered-but-empty multiselect also satisfies neq
      const missingEmpty = yield* service.reply({ id: created.id, answer: { langs: [] } }).pipe(Effect.flip)
      expect(missingEmpty).toEqual(
        new Form.InvalidAnswerError({ id: created.id, message: "Missing required form field: note" }),
      )

      const inactive = yield* service.reply({ id: created.id, answer: { langs: ["go"], note: "x" } }).pipe(Effect.flip)
      expect(inactive).toEqual(
        new Form.InvalidAnswerError({ id: created.id, message: "Form field is not active: note" }),
      )

      yield* service.reply({ id: created.id, answer: { langs: ["go"] } })
      expect(yield* service.state(created.id)).toEqual({ status: "answered", answer: { langs: ["go"] } })
    }),
  )

  it.effect("treats unanswered when references as false and cascades inactivity", () =>
    Effect.gen(function* () {
      const service = yield* Form.Service
      const created = yield* service.create({
        sessionID: "global",
        title: "Cascading form",
        fields: [
          { key: "a", type: "boolean" },
          { key: "b", type: "string", when: [{ key: "a", op: "eq", value: true }] },
          // neq also fails against an unanswered reference, and hiding b cascades here through
          // the reject-inactive-answers rule: b can never be answered while a is false.
          { key: "c", type: "string", required: true, when: [{ key: "b", op: "neq", value: "x" }] },
        ],
      })

      const inactive = yield* service.reply({ id: created.id, answer: { a: false, b: "yes" } }).pipe(Effect.flip)
      expect(inactive).toEqual(new Form.InvalidAnswerError({ id: created.id, message: "Form field is not active: b" }))

      yield* service.reply({ id: created.id, answer: { a: false } })
      expect(yield* service.state(created.id)).toEqual({ status: "answered", answer: { a: false } })
    }),
  )

  it.effect("rejects invalid when definitions at creation", () =>
    Effect.gen(function* () {
      const service = yield* Form.Service
      const flipCreate = (fields: Form.CreateInput["fields"]) =>
        service.create({ sessionID: "global", title: "Invalid form", fields }).pipe(Effect.flip)

      expect(
        yield* flipCreate([{ key: "b", type: "string", when: [{ key: "missing", op: "eq", value: "x" }] }]),
      ).toEqual(
        new Form.InvalidFormError({ message: "Form field condition must reference an earlier field: b -> missing" }),
      )

      expect(
        yield* flipCreate([
          { key: "a", type: "string" },
          { key: "a", type: "string" },
        ]),
      ).toEqual(new Form.InvalidFormError({ message: "Duplicate form field key: a" }))

      expect(
        yield* flipCreate([
          { key: "a", type: "external", url: "https://example.com" },
          { key: "a", type: "string" },
        ]),
      ).toEqual(new Form.InvalidFormError({ message: "Duplicate form field key: a" }))

      expect(
        yield* flipCreate([
          { key: "a", type: "boolean" },
          { key: "b", type: "string", when: [{ key: "a", op: "eq", value: "yes" }] },
        ]),
      ).toEqual(new Form.InvalidFormError({ message: "Form field condition value must be a boolean: b -> a" }))

      expect(
        yield* flipCreate([
          { key: "a", type: "string", options: [{ value: "x", label: "X" }] },
          { key: "b", type: "string", when: [{ key: "a", op: "eq", value: "y" }] },
        ]),
      ).toEqual(
        new Form.InvalidFormError({
          message: "Form field condition value must be one of the field's options: b -> a",
        }),
      )
    }),
  )

  it.effect("requires external field acknowledgements", () =>
    Effect.gen(function* () {
      const service = yield* Form.Service
      const created = yield* service.create({
        sessionID: "global",
        title: "External setup",
        fields: [
          { key: "authorization", type: "external", url: "https://example.com/setup", title: "Open setup" },
          { key: "name", type: "string", required: true },
        ],
      })

      const invalidAnswers: ReadonlyArray<Form.Answer> = [
        { name: "Ava" },
        { authorization: false, name: "Ava" },
        { authorization: "yes", name: "Ava" },
      ]
      for (const answer of invalidAnswers) {
        expect(yield* service.reply({ id: created.id, answer }).pipe(Effect.flip)).toEqual(
          new Form.InvalidAnswerError({
            id: created.id,
            message: "External form field must be acknowledged: authorization",
          }),
        )
      }

      yield* service.reply({ id: created.id, answer: { authorization: true, name: "Ava" } })
      expect(yield* service.state(created.id)).toEqual({
        status: "answered",
        answer: { authorization: true, name: "Ava" },
      })
    }),
  )

  it.effect("cleans up created forms when event publication fails", () =>
    Effect.gen(function* () {
      const service = yield* Form.Service
      const bus = yield* Bus.Service
      const unsubscribe = yield* bus.listen((event) =>
        event.type === Form.Event.Created.type ? Effect.die("create listener failed") : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)

      expect(Exit.isFailure(yield* Effect.exit(service.create(input)))).toBe(true)
      expect(yield* service.get(formID).pipe(Effect.flip)).toEqual(new Form.NotFoundError({ id: formID }))

      yield* unsubscribe
      expect(yield* service.create(input)).toMatchObject({ id: formID })
    }),
  )

  it.effect("keeps forms pending when reply event publication fails", () =>
    Effect.gen(function* () {
      const service = yield* Form.Service
      const bus = yield* Bus.Service
      yield* service.create(input)
      const unsubscribe = yield* bus.listen((event) =>
        event.type === Form.Event.Replied.type ? Effect.die("reply listener failed") : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)

      expect(Exit.isFailure(yield* Effect.exit(service.reply({ id: formID, answer: { name: "Ava" } })))).toBe(true)
      expect(yield* service.state(formID)).toEqual({ status: "pending" })

      yield* unsubscribe
      yield* service.reply({ id: formID, answer: { name: "Ava" } })
      expect(yield* service.state(formID)).toEqual({ status: "answered", answer: { name: "Ava" } })
    }),
  )
})
