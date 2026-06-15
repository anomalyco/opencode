import { describe, expect } from "bun:test"
import { Effect, Option } from "effect"
import { Messaging } from "../../src/messaging"
import { SessionID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"
import { Layer } from "effect"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { BackgroundJob } from "../../src/background/job"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"

const it = testEffect(
  Layer.mergeAll(
    Messaging.layer.pipe(Layer.provideMerge(EventV2Bridge.defaultLayer)),
    BackgroundJob.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
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
