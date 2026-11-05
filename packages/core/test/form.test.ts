import { describe, expect } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, References } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Form } from "@opencode/core/form"
import { SessionSchema } from "@opencode/core/session/schema"
import { testEffect } from "./lib/effect"

const forms = AppNodeBuilder.build(LayerNode.group([Bus.node, Form.node]))
const it = testEffect(forms)

const formID = Form.ID.create("frm_test")
const input = {
  id: formID,
  sessionID: SessionSchema.ID.make("ses_test"),
  title: "Test form",
  fields: [{ key: "name", type: "string", required: true }],
} satisfies Form.CreateInput

describe("Form", () => {
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

  for (const action of ["reply", "cancel"] as const) {
    it.effect(`keeps forms pending when ${action} event publication fails`, () =>
      Effect.gen(function* () {
        const service = yield* Form.Service
        const bus = yield* Bus.Service
        yield* service.create(input)
        const type = action === "reply" ? Form.Event.Replied.type : Form.Event.Cancelled.type
        const unsubscribe = yield* bus.listen((event) =>
          event.type === type ? Effect.die(new Error("settlement listener failed")) : Effect.void,
        )
        yield* Effect.addFinalizer(() => unsubscribe)
        const settle =
          action === "reply"
            ? service.reply({ id: formID, answer: { name: "Ava" } })
            : service.cancel(formID, { message: "Dismissed" })

        expect(Exit.isFailure(yield* Effect.exit(settle))).toBe(true)
        expect(yield* service.state(formID)).toEqual({ status: "pending" })

        yield* unsubscribe
        yield* settle
        expect(yield* service.state(formID)).toEqual(
          action === "reply"
            ? { status: "answered", answer: { name: "Ava" } }
            : { status: "cancelled", message: "Dismissed" },
        )
      }),
    )
  }

  for (const first of ["reply", "cancel"] as const) {
    for (const second of ["reply", "cancel"] as const) {
      it.effect(`settles once when ${first} races ${second}`, () =>
        Effect.gen(function* () {
          const service = yield* Form.Service
          const bus = yield* Bus.Service
          const created = yield* Deferred.make<void>()
          const entered = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const events: string[] = []
          const unsubscribe = yield* bus.listen((event) => {
            if (event.type === Form.Event.Created.type) return Deferred.succeed(created, undefined).pipe(Effect.asVoid)
            if (event.type !== Form.Event.Replied.type && event.type !== Form.Event.Cancelled.type) return Effect.void
            events.push(event.type)
            if (events.length !== 1) return Effect.void
            return Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.asVoid)
          })
          yield* Effect.addFinalizer(() => unsubscribe)
          const asker = yield* service.ask(input).pipe(Effect.forkScoped)
          yield* Deferred.await(created)
          const winner = yield* (
            first === "reply" ? service.reply({ id: formID, answer: { name: "Ava" } }) : service.cancel(formID)
          ).pipe(Effect.forkScoped)
          const observed = yield* Effect.gen(function* () {
            yield* Deferred.await(entered)
            const loser = yield* (
              second === "reply" ? service.reply({ id: formID, answer: { name: "Bea" } }) : service.cancel(formID)
            ).pipe(Effect.exit, Effect.forkScoped({ startImmediately: true }))
            return { loser, immediate: loser.pollUnsafe() }
          }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)))

          yield* Fiber.join(winner)
          expect(observed.immediate).toBeDefined()
          const result = yield* Fiber.join(observed.loser)
          expect(Exit.isFailure(result) && Cause.squash(result.cause)).toEqual(
            new Form.AlreadySettledError({ id: formID }),
          )
          const terminal: Form.TerminalState =
            first === "reply" ? { status: "answered", answer: { name: "Ava" } } : { status: "cancelled" }
          expect(events).toEqual([first === "reply" ? Form.Event.Replied.type : Form.Event.Cancelled.type])
          expect(yield* service.state(formID)).toEqual(terminal)
          expect(yield* Fiber.join(asker)).toEqual(terminal)
          expect(yield* service.list()).toEqual([])
          expect(yield* service.cancel(formID).pipe(Effect.flip)).toEqual(new Form.AlreadySettledError({ id: formID }))
        }),
      )
    }
  }

  for (const budget of [3, 8, 32]) {
    it.effect(`reads the current form state with a scheduler budget of ${budget}`, () =>
      Effect.gen(function* () {
        const service = yield* Form.Service
        const bus = yield* Bus.Service
        const answers: Form.Answer[] = []
        yield* service.create(input)
        const unsubscribe = yield* bus.listen((event) =>
          Effect.sync(() => {
            if (event.type === Form.Event.Replied.type) answers.push((event.data as { answer: Form.Answer }).answer)
          }),
        )
        yield* Effect.addFinalizer(() => unsubscribe)

        const results = yield* Effect.forEach(
          Array.from({ length: 8 }, (_, index) => ({ name: String(index) })),
          (answer) => service.reply({ id: formID, answer }).pipe(Effect.exit),
          { concurrency: "unbounded" },
        ).pipe(Effect.provideService(References.MaxOpsBeforeYield, budget))

        expect(results.filter(Exit.isSuccess)).toHaveLength(1)
        expect(results.filter(Exit.isFailure).map((result) => Cause.squash(result.cause))).toEqual(
          Array.from({ length: 7 }, () => new Form.AlreadySettledError({ id: formID })),
        )
        expect(answers).toHaveLength(1)
        expect(yield* service.state(formID)).toEqual({ status: "answered", answer: answers[0] })
        expect(yield* service.list()).toEqual([])
      }),
    )
  }

  it.effect("rejects an inline listener cancelling the form being replied to", () =>
    Effect.gen(function* () {
      const service = yield* Form.Service
      const bus = yield* Bus.Service
      yield* service.create(input)
      const results: Array<Exit.Exit<void, Form.AlreadySettledError | Form.NotFoundError>> = []
      const events: string[] = []
      const unsubscribe = yield* bus.listen((event) =>
        Effect.gen(function* () {
          if (event.type !== Form.Event.Replied.type && event.type !== Form.Event.Cancelled.type) return
          events.push(event.type)
          if (event.type === Form.Event.Replied.type) results.push(yield* service.cancel(formID).pipe(Effect.exit))
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)

      yield* service.reply({ id: formID, answer: { name: "Ava" } })

      expect(results.map((result) => Exit.isFailure(result) && Cause.squash(result.cause))).toEqual([
        new Form.AlreadySettledError({ id: formID }),
      ])
      expect(events).toEqual([Form.Event.Replied.type])
      expect(yield* service.state(formID)).toEqual({ status: "answered", answer: { name: "Ava" } })
    }),
  )

  it.effect("settles another form while publication is blocked", () =>
    Effect.gen(function* () {
      const service = yield* Form.Service
      const bus = yield* Bus.Service
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      yield* service.create(input)
      const other = yield* service.create({ ...input, id: Form.ID.create() })
      const unsubscribe = yield* bus.listen((event) =>
        event.type === Form.Event.Replied.type && (event.data as { id: Form.ID }).id === formID
          ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.asVoid)
          : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const first = yield* service.reply({ id: formID, answer: { name: "Ava" } }).pipe(Effect.forkScoped)
      const observed = yield* Effect.gen(function* () {
        yield* Deferred.await(entered)
        const second = yield* service
          .reply({ id: other.id, answer: { name: "Bea" } })
          .pipe(Effect.forkScoped({ startImmediately: true }))
        return { second, immediate: second.pollUnsafe() }
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)))

      yield* Fiber.join(first)
      yield* Fiber.join(observed.second)
      expect(observed.immediate).toEqual(Exit.void)
      expect(yield* service.state(other.id)).toEqual({ status: "answered", answer: { name: "Bea" } })
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("keeps an in-flight reply when close cancels pending forms", () =>
    Effect.gen(function* () {
      const service = yield* Form.Service
      const bus = yield* Bus.Service
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const events: string[] = []
      yield* service.create(input)
      const unsubscribe = yield* bus.listen((event) => {
        if (event.type === Form.Event.Cancelled.type) events.push(event.type)
        if (event.type !== Form.Event.Replied.type) return Effect.void
        events.push(event.type)
        return Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.asVoid)
      })
      yield* Effect.addFinalizer(() => unsubscribe)
      const reply = yield* service.reply({ id: formID, answer: { name: "Ava" } }).pipe(Effect.forkScoped)
      yield* Effect.gen(function* () {
        yield* Deferred.await(entered)
        yield* service.close
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)))
      yield* Fiber.join(reply)

      expect(events).toEqual([Form.Event.Replied.type])
      expect(yield* service.state(formID)).toEqual({ status: "answered", answer: { name: "Ava" } })
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("cancels an in-flight form when publication fails after close", () =>
    Effect.gen(function* () {
      const service = yield* Form.Service
      const bus = yield* Bus.Service
      const created = yield* Deferred.make<void>()
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const defect = new Error("active form publication failed")
      const events: string[] = []
      const unsubscribe = yield* bus.listen((event) => {
        if (event.type === Form.Event.Created.type) return Deferred.succeed(created, undefined).pipe(Effect.asVoid)
        if (event.type === Form.Event.Cancelled.type) events.push(event.type)
        if (event.type !== Form.Event.Replied.type) return Effect.void
        events.push(event.type)
        return Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.andThen(Effect.die(defect)),
        )
      })
      yield* Effect.addFinalizer(() => unsubscribe)
      const asker = yield* service.ask(input).pipe(Effect.forkScoped)
      yield* Deferred.await(created)
      const reply = yield* service.reply({ id: formID, answer: { name: "Ava" } }).pipe(Effect.exit, Effect.forkScoped)
      yield* Effect.gen(function* () {
        yield* Deferred.await(entered)
        yield* service.close
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)))
      const result = yield* Fiber.join(reply)

      expect(Exit.isFailure(result) && Cause.squash(result.cause)).toBe(defect)
      expect(yield* service.state(formID)).toEqual({ status: "cancelled" })
      expect(yield* Fiber.join(asker)).toEqual({ status: "cancelled" })
      expect(events).toEqual([Form.Event.Replied.type, Form.Event.Cancelled.type])
      expect(yield* service.list()).toEqual([])
    }),
  )
})
