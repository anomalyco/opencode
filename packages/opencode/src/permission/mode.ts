import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Session } from "@/session"
import { SessionID } from "@/session/schema"
import { Log } from "@/util/log"
import { Effect, Layer, ServiceMap } from "effect"
import z from "zod"
import { getNextPermissionMode, PermissionMode } from "./schema"

export { PermissionMode, getNextPermissionMode, DEFAULT_PERMISSION_MODE } from "./schema"

/**
 * Permission mode evaluation result
 */
export type ModeEvaluationResult = {
  action: "allow" | "deny" | "ask"
  reason?: string
}

/**
 * Check if a permission should be auto-approved based on mode.
 * - bypassPermissions: All permissions are auto-approved
 * - plan: Write/bash operations are blocked (treated as deny)
 * - acceptEdits: Edit operations are auto-approved, others ask
 * - default: Ask for all
 */
export function evaluatePermissionForMode(permission: string, mode: PermissionMode): ModeEvaluationResult {
  if (mode === "bypassPermissions") {
    return { action: "allow", reason: "bypassPermissions mode" }
  }

  if (mode === "plan") {
    // In plan mode, block write operations and bash
    const blockedPermissions = ["edit", "write", "bash", "apply_patch", "multiedit"]
    if (blockedPermissions.includes(permission)) {
      return { action: "deny", reason: "plan mode blocks write operations" }
    }
    return { action: "ask" }
  }

  if (mode === "acceptEdits") {
    // Auto-approve edit operations
    const editPermissions = ["edit", "write", "apply_patch", "multiedit"]
    if (editPermissions.includes(permission)) {
      return { action: "allow", reason: "acceptEdits mode auto-approves edits" }
    }
    // Ask for bash and other operations
    return { action: "ask" }
  }

  // Default mode: ask for everything
  return { action: "ask" }
}

export namespace PermissionModeService {
  const log = Log.create({ service: "permission-mode" })

  export const Event = {
    Changed: BusEvent.define(
      "permission-mode.changed",
      z.object({
        sessionID: SessionID.zod,
        previousMode: PermissionMode,
        newMode: PermissionMode,
      }),
    ),
  }

  export interface Interface {
    readonly get: (sessionID: SessionID) => Effect.Effect<PermissionMode>
    readonly set: (input: { sessionID: SessionID; mode: PermissionMode }) => Effect.Effect<void>
    readonly cycle: (sessionID: SessionID) => Effect.Effect<PermissionMode>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/PermissionMode") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const get = Effect.fn("PermissionMode.get")(function* (sessionID: SessionID) {
        const session = yield* Effect.tryPromise(() => Session.get(sessionID)).pipe(
          Effect.catch(() => Effect.succeed({ permissionMode: "default" as PermissionMode })),
        )
        return session.permissionMode ?? ("default" as PermissionMode)
      })

      const set = Effect.fn("PermissionMode.set")(function* (input: { sessionID: SessionID; mode: PermissionMode }) {
        const previousMode = yield* get(input.sessionID)
        if (previousMode === input.mode) return

        log.info("mode changed", {
          sessionID: input.sessionID,
          previousMode,
          newMode: input.mode,
        })

        yield* Effect.tryPromise(() =>
          Session.setPermissionMode({
            sessionID: input.sessionID,
            permissionMode: input.mode,
          }),
        ).pipe(Effect.orDie)

        void Bus.publish(Event.Changed, {
          sessionID: input.sessionID,
          previousMode,
          newMode: input.mode,
        })
      })

      const cycle = Effect.fn("PermissionMode.cycle")(function* (sessionID: SessionID) {
        const currentMode = yield* get(sessionID)
        const nextMode = getNextPermissionMode(currentMode)
        yield* set({ sessionID, mode: nextMode })
        return nextMode
      })

      return Service.of({ get, set, cycle })
    }),
  )
}
