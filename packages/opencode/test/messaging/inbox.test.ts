import { describe, expect } from "bun:test"
import { Effect, Option } from "effect"
import { Messaging } from "../../src/messaging"
import { SessionID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { BackgroundJob } from "../../src/background/job"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      Messaging.node,
      BackgroundJob.node,
      CrossSpawnSpawner.node,
    ]),
  ),
)

it.instance("registry resolves a registered slug; unknown → none", () =>
  Effect.gen(function* () {
    const m = yield* Messaging.Service
    const sid = SessionID.make("ses_aaaaaaaaaaaaaaaaaaaaaaaaaa")
    yield* m.registerSlug("council-rev-1", sid)
    expect(Option.getOrUndefined(yield* m.resolveSlug("council-rev-1"))).toBe(sid)
    expect(Option.isNone(yield* m.resolveSlug("nope"))).toBe(true)
  }),
)

it.instance("setAllow / getAllow round-trips the allow-list", () =>
  Effect.gen(function* () {
    const m = yield* Messaging.Service
    const child = SessionID.make("ses_bbbbbbbbbbbbbbbbbbbbbbbbbb")
    yield* m.setAllow(child, ["council-agg"])
    expect(yield* m.getAllow(child)).toEqual(["council-agg"])
  }),
)

it.instance("slugFor - reverse-lookup returns the slug, falls back to String(sessionID)", () =>
  Effect.gen(function* () {
    const m = yield* Messaging.Service
    const sid = SessionID.make("ses_ccccccccccccccccccccccccc")
    yield* m.registerSlug("council-rev-2", sid)
    expect(yield* m.slugFor(sid)).toBe("council-rev-2")
    const unknown = SessionID.make("ses_ddddddddddddddddddddddddd")
    expect(yield* m.slugFor(unknown)).toBe(String(unknown))
  }),
)

it.instance("enqueue then drain returns FIFO, drains-and-clears, preserves fromSlug", () =>
  Effect.gen(function* () {
    const m = yield* Messaging.Service
    const to = SessionID.make("ses_cccccccccccccccccccccccccc")
    const from = SessionID.make("ses_dddddddddddddddddddddddddd")
    yield* m.registerSlug("rev-b", to)
    yield* m.enqueue({ target: to, from, fromSlug: "rev-a", body: "a" })
    yield* m.enqueue({ target: to, from, fromSlug: "rev-a", body: "b" })
    const drained = yield* m.drain(to)
    expect(drained.map((x) => x.body)).toEqual(["a", "b"])
    expect(drained.map((x) => x.fromSlug)).toEqual(["rev-a", "rev-a"])
    expect(yield* m.drain(to)).toEqual([])
  }),
)

it.instance("dedup drops identical (from,body) within the per-recipient window", () =>
  Effect.gen(function* () {
    const m = yield* Messaging.Service
    const to = SessionID.make("ses_eeeeeeeeeeeeeeeeeeeeeeeeee")
    const from = SessionID.make("ses_ffffffffffffffffffffffffff")
    yield* m.registerSlug("rev-b2", to)
    yield* m.enqueue({ target: to, from, fromSlug: "rev-a", body: "dup" })
    yield* m.enqueue({ target: to, from, fromSlug: "rev-a", body: "dup" })
    expect((yield* m.drain(to)).length).toBe(1)
  }),
)

it.instance("over-budget send (M) fails with AbuseError", () =>
  Effect.gen(function* () {
    const m = yield* Messaging.Service
    const to = SessionID.make("ses_gggggggggggggggggggggggggg")
    const from = SessionID.make("ses_hhhhhhhhhhhhhhhhhhhhhhhhhh")
    yield* m.registerSlug("rev-b3", to)
    for (let i = 0; i < 20; i++) yield* m.enqueue({ target: to, from, fromSlug: "rev-a", body: `m${i}` })
    const r = yield* m.enqueue({ target: to, from, fromSlug: "rev-a", body: "m20" }).pipe(Effect.flip)
    expect(r._tag).toBe("Messaging.AbuseError")
  }),
)

it.instance("sibling-session enqueue is not limited by the subagent outbound budget", () =>
  Effect.gen(function* () {
    const m = yield* Messaging.Service
    const to = SessionID.make("ses_sibling_target_xxxxxxxxxx")
    const from = SessionID.make("ses_sibling_sender_xxxxxxxxxx")
    yield* m.registerSlug("sibling-target", to)

    for (let i = 0; i < 21; i++) {
      yield* m.enqueue({
        target: to,
        from,
        fromSlug: "sibling-peer",
        body: `sibling-${i}`,
        source: "sibling-session",
      })
    }

    expect((yield* m.drain(to)).length).toBe(21)
  }),
)

it.instance("awaitInbox returns true when inbox already has items", () =>
  Effect.gen(function* () {
    const m = yield* Messaging.Service
    const s = SessionID.make("ses_iiiiiiiiiiiiiiiiiiiiiiiiii")
    yield* m.registerSlug("x", s)
    yield* m.enqueue({ target: s, from: s, fromSlug: "x", body: "q" })
    expect(yield* m.awaitInbox(s, { timeoutMs: 50 })).toBe(true)
  }),
)

it.instance("awaitInbox resolves false on timeout when inbox stays empty", () =>
  Effect.gen(function* () {
    const m = yield* Messaging.Service
    const s = SessionID.make("ses_jjjjjjjjjjjjjjjjjjjjjjjjjj")
    yield* m.registerSlug("y", s)
    expect(yield* m.awaitInbox(s, { timeoutMs: 30 })).toBe(false)
  }),
)
