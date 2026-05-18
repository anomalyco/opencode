import { Context, Effect, Layer, Scope, Semaphore } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import type { ProviderID } from "./schema"

const log = Log.create({ service: "provider.concurrency" })

export interface AcquireOptions {
  readonly providerID: ProviderID
  readonly modelID: string
  readonly providerMaxConcurrency: number | undefined
  readonly modelMaxConcurrency: number | undefined
  readonly concurrencyCost: number | undefined
}

export interface Interface {
  readonly acquire: (options: AcquireOptions) => Effect.Effect<void, never, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ProviderConcurrency") {}

export const defaultLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const semaphores = new Map<string, Semaphore.Semaphore>()
    const warnedOverBudget = new Set<string>()

    const get = (key: string, capacity: number) => {
      const existing = semaphores.get(key)
      if (existing) return existing
      const next = Semaphore.makeUnsafe(capacity)
      semaphores.set(key, next)
      return next
    }

    const acquire: Interface["acquire"] = ({
      providerID,
      modelID,
      providerMaxConcurrency,
      modelMaxConcurrency,
      concurrencyCost,
    }) => {
      const steps: Effect.Effect<void, never, Scope.Scope>[] = []
      // Model permit first: it's cheap (always 1) and held against a smaller queue,
      // so we don't hog provider permits while waiting on a per-model cap.
      if (modelMaxConcurrency !== undefined) {
        const sem = get(`${providerID}:${modelID}`, modelMaxConcurrency)
        steps.push(Effect.asVoid(Effect.acquireRelease(sem.take(1), () => sem.release(1))))
      }
      if (providerMaxConcurrency !== undefined) {
        const requestedCost = concurrencyCost ?? 1
        const cost = Math.min(requestedCost, providerMaxConcurrency)
        // Clamp rather than block forever; warn once so the misconfig is visible.
        if (requestedCost > providerMaxConcurrency) {
          const key = `${providerID}:${modelID}`
          if (!warnedOverBudget.has(key)) {
            warnedOverBudget.add(key)
            log.warn("model concurrencyCost exceeds provider maxConcurrency; clamping to budget", {
              providerID,
              modelID,
              concurrencyCost: requestedCost,
              providerMaxConcurrency,
            })
          }
        }
        const sem = get(providerID, providerMaxConcurrency)
        steps.push(Effect.asVoid(Effect.acquireRelease(sem.take(cost), () => sem.release(cost))))
      }
      if (steps.length === 0) return Effect.void
      return Effect.all(steps, { discard: true })
    }

    return Service.of({ acquire })
  }),
)

export * as ProviderConcurrency from "./concurrency"
