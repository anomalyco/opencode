import { Effect, Layer } from "effect"
import { Automation } from "../../src/automation/automation"

export const noopAutomationLayer = Layer.succeed(
  Automation.Service,
  Automation.Service.of({
    init: () => Effect.void,
    list: () => Effect.succeed([]),
    get: () => Effect.die("unused automation test service"),
    create: () => Effect.die("unused automation test service"),
    update: () => Effect.die("unused automation test service"),
    remove: () => Effect.die("unused automation test service"),
    duplicate: () => Effect.die("unused automation test service"),
    runNow: () => Effect.die("unused automation test service"),
    listRuns: () => Effect.succeed([]),
    getRun: () => Effect.die("unused automation test service"),
    listFindings: () => Effect.succeed([]),
    diff: () => Effect.succeed([]),
    markRunRead: () => Effect.die("unused automation test service"),
    archiveRun: () => Effect.die("unused automation test service"),
    cancelRun: () => Effect.die("unused automation test service"),
  }),
)
