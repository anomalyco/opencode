import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { AttachmentCoordinator } from "@/session/attachment/coordinator"
import { InstanceRef } from "@/effect/instance-ref"
import { SessionID } from "@/session/schema"
import type { TaskPromptOps } from "@/tool/task"
import { DIRECTORY_A, DIRECTORY_B, instance } from "../lib/attachment"

/**
 * CP-023 Gate 8, prerequisite C-5: the attachment registry is per-Instance, and there is exactly
 * ONE construction of it.
 *
 * WHAT THIS FILE IS FALSIFYING. Before C-5, `AttachmentCoordinator` was in no LayerNode group and in
 * no `deps`, so `SessionPrompt` resolved `Effect.serviceOption` to `None` and built a PRIVATE
 * coordinator inline. Because `LayerNode.compile` memoizes by node identity and this package's
 * layer graph is shared across Instances, that private object's maps were process-wide: every
 * Instance saw every other Instance's scopes and claims. §14.1 named the AppRuntime provision as the
 * cause, but that provision is inert on the prompt path — the served graph never reached it.
 *
 * Each test below states which half it proves, and every negative is paired with a positive control.
 * A cross-Instance isolation assertion is worthless alone: "B cannot see A's scope" is also true
 * when nothing was scoped at all, when `open` silently failed, or when the coordinator is inert. The
 * same-Instance positive is what makes the negative mean isolation rather than absence.
 */

const provideA = Effect.provideService(InstanceRef, instance(DIRECTORY_A))
const provideB = Effect.provideService(InstanceRef, instance(DIRECTORY_B))

describe("CP-023 C-5: per-Instance attachment registry", () => {
  test("one service object, two Instances: a scope is visible in its own Instance and absent from the other", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          /**
           * Built ONCE, with no ambient Instance. That is the production shape: a single service
           * object whose registry is selected by the ambient directory at CALL time. If the
           * registry were still allocated at construction, both directories below would reach it.
           */
          const coordinator = yield* AttachmentCoordinator.make
          const sessionID = SessionID.create()

          const opened = yield* coordinator.open(sessionID).pipe(provideA)

          // POSITIVE CONTROL. Without this, the negative below passes for a coordinator that never
          // registered anything, and the test would prove nothing about isolation.
          const sameInstance = yield* coordinator.locate(sessionID).pipe(provideA)
          expect(sameInstance).toBe(opened)

          // THE NEGATIVE. A different directory reaches a different registry entirely.
          const otherInstance = yield* coordinator.locate(sessionID).pipe(provideB)
          expect(otherInstance).toBeUndefined()

          yield* coordinator.open(sessionID).pipe(provideA, Effect.exit)
          yield* opened.close()
        }),
      ),
    )
  })

  test("claims partition by Instance while still linearizing within one Instance (R-38)", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const coordinator = yield* AttachmentCoordinator.make
          const sessionID = SessionID.create()

          const first = yield* coordinator.claim(sessionID).pipe(provideA)
          expect(first.owner).toBe(true)

          /**
           * THE PROPERTY R-38 RESTS ON. Within one Instance the second claimant is NOT the owner, so
           * CP-021's Task-local claim linearizes before either prompt reaches a CP-023 `start`. This
           * is the assertion that would break if the registry were rebuilt per call — every claimant
           * would be an owner and two Task prompts could both enter core.
           */
          const second = yield* coordinator.claim(sessionID).pipe(provideA)
          expect(second.owner).toBe(false)

          /**
           * AND THE PARTITION. A different Instance is a different claim space, which is what K46
           * requires and what makes cross-directory scope visibility unrepresentable rather than
           * merely unlikely. A SessionID belongs to one directory, so this never competes in
           * practice; it is asserted because the isolation must hold structurally.
           */
          const otherInstance = yield* coordinator.claim(sessionID).pipe(provideB)
          expect(otherInstance.owner).toBe(true)

          yield* coordinator.settleClaim(first, false).pipe(provideA)
          yield* coordinator.settleClaim(otherInstance, false).pipe(provideB)
        }),
      ),
    )
  })

  test("closing a scope clears it from its own Instance only", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const coordinator = yield* AttachmentCoordinator.make
          const sharedID = SessionID.create()

          const inA = yield* coordinator.open(sharedID).pipe(provideA)
          const inB = yield* coordinator.open(sharedID).pipe(provideB)

          // Positive control: both registries hold their own scope for the same SessionID.
          expect(yield* coordinator.locate(sharedID).pipe(provideA)).toBe(inA)
          expect(yield* coordinator.locate(sharedID).pipe(provideB)).toBe(inB)
          expect(inA).not.toBe(inB)

          yield* inA.close()

          // A's entry is gone; B's is untouched. `close` captures the registry `open` resolved, so
          // this holds even though `close` runs outside any ambient Instance here.
          expect(yield* coordinator.locate(sharedID).pipe(provideA)).toBeUndefined()
          expect(yield* coordinator.locate(sharedID).pipe(provideB)).toBe(inB)

          yield* inB.close()
        }),
      ),
    )
  })

  test("a missing coordinator is a COMPILE error, not a runtime fallback", () => {
    /**
     * THE UNREPRESENTABLE HALF, and the reason this is a type assertion rather than a behavioural
     * one. There is no runtime state in which `attachments` is absent, so there is nothing to
     * observe — which is exactly the property. Before C-5, `TaskPromptOps.attachments` was optional
     * and `task.ts` read `ops.attachments ?? fallbackAttachments`, so an omission produced a second
     * live registry instead of an error.
     *
     * If either declaration is relaxed, the `const` below stops compiling. A behavioural test could
     * only have detected the divergence after it happened.
     */
    type AttachmentsOptional = undefined extends TaskPromptOps["attachments"] ? true : false
    const attachmentsOptional: AttachmentsOptional = false
    type TaskCanMintFence = "captureFence" extends keyof AttachmentCoordinator.TaskInterface ? true : false
    type ScopeCanMintFence = "captureFence" extends keyof AttachmentCoordinator.Scope ? true : false
    const taskCanMintFence: TaskCanMintFence = false
    const scopeCanMintFence: ScopeCanMintFence = false

    type LocateIsEffect =
      ReturnType<AttachmentCoordinator.Interface["locate"]> extends Effect.Effect<
        AttachmentCoordinator.Scope | undefined
      >
        ? true
        : false
    const locateIsEffect: LocateIsEffect = true

    expect(attachmentsOptional).toBe(false)
    expect(locateIsEffect).toBe(true)
    expect([taskCanMintFence, scopeCanMintFence]).toEqual([false, false])
  })
})
