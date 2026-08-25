import { describe, expect, test } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CLOSURE_RECORD_METADATA_KEY } from "@opencode-ai/core/session/closure-record"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Effect, Layer } from "effect"
import { SessionClosureIdentity } from "@/session/closure/identity"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { Session } from "@/session/session"
import { provideInstanceEffect, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { itBounded as it } from "../lib/effect"

// CP-023 Gate 5 slice E1 — §10.3's identity hierarchy.
//
// "During `planning`, for every target transcript the driver resolves identity in this strict order."
// The order is load-bearing rather than a preference: §10.5 records `identity_source` in the frozen
// metadata and `source_user_message_id` ONLY for `prior_user_message`, and `model.ts::validIdentity`
// enforces that as a biconditional — so a resolver picking the wrong source produces an identity the
// model rejects, and one carrying the wrong coordinate produces a record that lies about its origin.
//
// WHY THE DECISION IS TESTED AS A PURE FUNCTION. `select` is the whole of §10.3's logic and the
// production adapter calls exactly it, so these run the SAME code the driver runs — not a parallel
// implementation. The alternative was faking a 28-method `Session.Interface` to exercise two reads,
// which would have been both brittle and unable to reach the pathological branches cheaply: a Session
// row carrying a model but no agent, or a transcript whose only User Message is a closure record.
// `discovery.ts` makes the same argument in the other direction — keep decision logic out of the
// adapter, because logic in an adapter can only be exercised through fixtures with live fibers.
//
// The integration test at the bottom is what keeps that split honest: it proves the adapter really
// reads `Session` and really calls `select`, so the pure suite cannot drift into testing a function
// nothing production uses.

/**
 * TWO SHAPES, DELIBERATELY DISTINCT — and the distinction is the reason this file caught a real bug.
 *
 * A Message carries `{ providerID, modelID, variant }` (`session.shared.ts:139-141`); a Session row
 * carries `{ id, providerID, variant }`, where `id` IS the model identifier. Using one constant for
 * both reads plausibly and makes source 2 permanently unavailable — a fall-through indistinguishable
 * from §10.3's legitimate "unavailable rather than guessed", which would never surface as an error.
 */
const model = { providerID: "anthropic", modelID: "opus", variant: "max" }
const sessionModel = { id: "opus", providerID: "anthropic", variant: "max" }

const userMessage = (id: string, agent: string, parts: readonly unknown[] = []) => ({
  info: { id, role: "user", agent, model },
  parts,
})

describe("closure.identity §10.3 select", () => {
  test("source 1: the newest non-closure User Message wins, carrying its own MessageID", () => {
    const identity = SessionClosureIdentity.select(
      [userMessage("msg_first", "older"), userMessage("msg_second", "newer")],
      { agent: "session-level", model: sessionModel },
    )
    expect(identity?.source).toBe("prior_user_message")
    expect(identity?.agent).toBe("newer")
    // NEWEST, not first. Asserting the id as well as the agent is what discriminates `findLast` from
    // `find`; an implementation reading the oldest turn would still produce a schema-valid identity.
    expect(identity?.sourceMessage).toBe(Model.id("message", "msg_second"))
    // Source 1 outranks a perfectly good Session-level identity. Without this the ordering could
    // invert and every assertion above would still hold for the single-message case.
    expect(identity?.agent).not.toBe("session-level")
  })

  // K88 source-identity clause. Mutant: select the newest key-bearing copy as prior_user_message;
  // red: agent/sourceMessage comes from the closure row instead of the real User control.
  test("§10.3: a User Message whose Parts carry opencode.branch_closure is skipped", () => {
    const identity = SessionClosureIdentity.select(
      [
        userMessage("msg_real", "real-turn"),
        // A closure record IS a synthetic User Message (§10.4) carrying copied agent/model, so
        // without the metadata filter this would be the newest User Message and every subsequent
        // generation would copy identity from the previous generation's COPY rather than from a real
        // user turn. §10.3: "never reads a closure record as the next record's identity source".
        userMessage("msg_closure", "copied", [{ type: "text", metadata: { [CLOSURE_RECORD_METADATA_KEY]: {} } }]),
      ],
      undefined,
    )
    expect(identity?.source).toBe("prior_user_message")
    expect(identity?.agent).toBe("real-turn")
    expect(identity?.sourceMessage).toBe(Model.id("message", "msg_real"))
  })

  test("§10.3: only User Messages are considered", () => {
    const identity = SessionClosureIdentity.select(
      [userMessage("msg_user", "the-user-turn"), { info: { id: "msg_asst", role: "assistant", agent: "assistant-agent", model }, parts: [] }],
      undefined,
    )
    expect(identity?.agent).toBe("the-user-turn")
  })

  test("source 2: Session identity when no User Message qualifies — and NO sourceMessage", () => {
    const identity = SessionClosureIdentity.select([], { agent: "session-agent", model: sessionModel })
    expect(identity?.source).toBe("session_identity")
    expect(identity?.agent).toBe("session-agent")
    // §10.5 omits `source_user_message_id` for this source and `validIdentity` REJECTS an identity
    // that carries one, so its absence is a contract rather than an incidental omission.
    expect(identity?.sourceMessage).toBeUndefined()
  })

  test("§10.3: source 2 is UNAVAILABLE rather than guessed when the model is incomplete", () => {
    // "If the stored Session surface lacks any required model field or variant-presence truth, this
    // branch is unavailable rather than guessed."
    expect(SessionClosureIdentity.select([], { agent: "a", model: { providerID: "anthropic" } })).toBeUndefined()
    expect(SessionClosureIdentity.select([], { agent: "a", model: { id: "opus" } })).toBeUndefined()
    // Agent missing is equally disqualifying: §10.3 requires BOTH present.
    expect(SessionClosureIdentity.select([], { model: sessionModel })).toBeUndefined()
    // The positive control: the same shape with both present does resolve, so the three refusals
    // above are about the missing field rather than about the fixture.
    expect(SessionClosureIdentity.select([], { agent: "a", model: sessionModel })?.source).toBe("session_identity")
  })

  test("§10.3: an incomplete source 1 falls through to source 2 rather than to nothing", () => {
    const identity = SessionClosureIdentity.select(
      [{ info: { id: "msg_broken", role: "user", agent: "no-model-agent" }, parts: [] }],
      { agent: "session-agent", model: sessionModel },
    )
    // Falling through is the whole point of a strict ORDER: an unusable higher source must not
    // consume the resolution and produce nothing.
    expect(identity?.source).toBe("session_identity")
    expect(identity?.agent).toBe("session-agent")
  })

  // K88 source-identity empty-history clause. Mutant: let closure evidence become a source by role;
  // red: an evidence-only transcript fabricates a prior_user_message identity.
  test("I-35: no validated source produces NO identity, and nothing is fabricated", () => {
    expect(SessionClosureIdentity.select([], undefined)).toBeUndefined()
    // A transcript with only a closure record is the case that matters: there IS a User Message, and
    // it still must not seed identity.
    expect(
      SessionClosureIdentity.select(
        [
          userMessage("msg_closure", "copied", [
            { type: "text", metadata: { [CLOSURE_RECORD_METADATA_KEY]: {} } },
          ]),
        ],
        undefined,
      ),
    ).toBeUndefined()
  })

  test("§10.3: variant presence is copied as truth, never invented", () => {
    const withVariant = SessionClosureIdentity.select([], { agent: "a", model: sessionModel })
    expect(withVariant?.model.variant).toEqual({ present: true, value: "max" })
    // Absence is a FACT — "this identity ran without a variant" — not a gap, which is why the union
    // has a `present: false` arm rather than an optional value. §10.3: "never invents a variant".
    const withoutVariant = SessionClosureIdentity.select([], {
      agent: "a",
      model: { id: "opus", providerID: "anthropic" },
    })
    expect(withoutVariant?.model.variant).toEqual({ present: false })
  })
})

describe("closure.identity adapter", () => {
  it.live("resolves through the real Session service, so the pure suite tests production's function", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      return yield* Effect.gen(function* () {
        const session = yield* Session.Service
        const created = yield* session.create({
          title: "identity-adapter",
          agent: "wired-agent",
          // The Session surface brands these (`ModelV2.ID` / `ProviderV2.ID`). Cast at the fixture
          // boundary because this test's concern is the adapter's READ, not brand construction —
          // and note the shape is the SESSION one, which is what the bug above was about.
          model: sessionModel as never,
        })

        const identity = yield* SessionClosureIdentity.Service
        const resolved = yield* identity.resolve([Model.id("session", created.id)])

        // The session is PASSED THROUGH, which `identityFor` depends on: it matches entries by
        // `item.session === session`, so a re-branded value would silently resolve to no identity.
        expect(resolved).toHaveLength(1)
        expect(resolved[0]?.session).toBe(Model.id("session", created.id))
        // A freshly created Session has no User Messages, so this is source 2 through a REAL read —
        // proving the adapter reaches `Session` and hands what it finds to `select`.
        expect(resolved[0]?.identity?.source).toBe("session_identity")
        expect(resolved[0]?.identity?.agent).toBe("wired-agent")
      }).pipe(
        Effect.provide(
          LayerNode.compile(LayerNode.group([Session.node, SessionClosureIdentity.node, SessionProjector.node])),
        ),
        provideInstanceEffect(directory),
      )
    }).pipe(Effect.provide(Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), testInstanceStoreLayer))),
  )
})
