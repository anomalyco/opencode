import { describe, expect } from "bun:test"
import fs from "node:fs"
import { tmpdir as osTmpdir } from "node:os"
import path from "path"
import { afterAll } from "bun:test"
import { Duration, Effect, Exit, Fiber, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionExecutionLocal } from "@opencode-ai/core/session/execution/local"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { InteractiveProcess } from "@opencode-ai/core/tool/interactive/runtime"
import { InteractiveJobs } from "@opencode-ai/core/tool/interactive/store"
import { fakeProcess } from "./fixture/interactive-process"
import { testEffect } from "./lib/effect"

// One shared data directory for the whole file: the Location graph (with the
// interactive job stack) boots against it, and the ledger writes stay isolated
// from the developer machine.
const dataDir = fs.realpathSync(fs.mkdtempSync(path.join(osTmpdir(), "opencode-core-test-exec-")))
afterAll(async () => {
  await fs.promises.rm(dataDir, { recursive: true, force: true })
})

const runtime = fakeProcess()

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionStore.node,
      SessionV2.node,
      LocationServiceMap.node,
      SessionExecutionLocal.node,
    ]),
    [
      // SessionV2 depends on the unbound SessionExecution node; resolve it to
      // the real local implementation (same node also appears in the group)
      [SessionExecution.node, SessionExecutionLocal.node],
      [Global.node, Global.layerWith({ data: dataDir })],
      [InteractiveProcess.node, runtime.layer],
    ],
  ),
)

describe("SessionExecutionLocal interactive interrupt (spec R32/I10)", () => {
  it.live("interrupt kills the session's jobs with calls in flight and marks them cancelled", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const execution = yield* SessionExecution.Service
      const locations = yield* LocationServiceMap.Service
      // the projected Session location carries an explicit `workspaceID` key;
      // the LayerMap keys Locations structurally, so the test ref must match
      // that shape to resolve the SAME Location graph
      const ref = Location.Ref.make({ directory: AbsolutePath.make(dataDir), workspaceID: undefined })
      const session = yield* sessions.create({ location: ref })

      const jobs = yield* InteractiveJobs.Service.use((service) => Effect.succeed(service)).pipe(
        Effect.provide(locations.get(ref)),
      )
      const started = yield* jobs.start({ sessionID: session.id, command: "gdb ./a.out" })
      expect(started.status).toBe("waiting")

      // a wait parks on its deadline — it cannot settle early through the
      // quiescence path — so the interrupt lands deterministically mid-settle
      const inFlight = yield* Effect.forkChild(
        jobs.wait({ sessionID: session.id, jobID: started.jobID, timeout: 5000 }),
      )
      yield* Effect.sleep(Duration.millis(100))
      yield* execution.interrupt(session.id)

      const interruptedExit = yield* Fiber.await(inFlight)
      if (!Exit.isSuccess(interruptedExit)) return yield* Effect.die("expected the in-flight write to settle")
      expect(interruptedExit.value.status).toBe("cancelled")
      expect(interruptedExit.value.reason).toBe("interrupt")

      const replay = yield* jobs.wait({ sessionID: session.id, jobID: started.jobID, timeout: 1000 })
      expect(replay.status).toBe("cancelled")
      expect(replay.reason).toBe("interrupt")
    }))
})
