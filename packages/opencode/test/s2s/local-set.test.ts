// Session-to-Session — Task 4 (local-session-set + cross-session hourly outbound counter).
//
// Unit tests for the additive Messaging.Interface members added for the
// SessionV2 S2S coordinator:
//   - registerLocal / isLocal / localSet: track which session IDs are owned
//     by THIS process, so the cross-process poller knows which session is
//     "local" (and can be woken by an in-process inbox drain) vs "remote"
//     (and must be poked via the cross-session inbox table).
//
// Mirrors the harness from `test/messaging/inbox.test.ts`:
//   - composes Messaging.layer over EventV2Bridge.defaultLayer

import { afterEach, describe, expect } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Messaging } from "../../src/messaging"
import { SessionID } from "../../src/session/schema"
import { testEffectShared } from "../lib/effect"
import { BackgroundJob } from "../../src/background/job"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { disposeAllInstances } from "../fixture/fixture"

const it = testEffectShared(
  LayerNode.compile(
    LayerNode.group([
      Messaging.node,
      BackgroundJob.node,
      CrossSpawnSpawner.node,
    ]),
  ),
)

afterEach(async () => {
  await disposeAllInstances()
})

const S1 = SessionID.make("ses_local_alpha_aaaaaaaaaaaaaaaa")
const S2 = SessionID.make("ses_local_beta_bbbbbbbbbbbbbbbbb")
const S3 = SessionID.make("ses_local_gamma_cccccccccccccccccc")

describe("Messaging local-session-set", () => {
  it.instance("registerLocal + localSet: round-trips registered ids in insertion order", () =>
    Effect.gen(function* () {
      const m = yield* Messaging.Service

      yield* m.registerLocal(S1)
      yield* m.registerLocal(S2)

      const set = yield* m.localSet()
      expect(set).toContain(S1)
      expect(set).toContain(S2)
      expect(set).toHaveLength(2)
    }),
  )

  it.instance("isLocal: true for registered sessions, false for unknown sessions", () =>
    Effect.gen(function* () {
      const m = yield* Messaging.Service

      yield* m.registerLocal(S1)
      yield* m.registerLocal(S2)

      expect(yield* m.isLocal(S1)).toBe(true)
      expect(yield* m.isLocal(S2)).toBe(true)
      expect(yield* m.isLocal(S3)).toBe(false)
    }),
  )

})

