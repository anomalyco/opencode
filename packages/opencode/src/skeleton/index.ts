import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer } from "effect"
import path from "path"
import type { SkeletonResult, Strategy } from "./strategy"
import { typeScriptStrategy } from "./strategies/typescript"

export type { SkeletonResult, Strategy } from "./strategy"

export interface Interface {
  readonly supports: (filepath: string) => boolean
  readonly prune: (filepath: string, content: string) => Effect.Effect<SkeletonResult>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Skeleton") {}

const strategies: readonly Strategy[] = [typeScriptStrategy]

const findStrategy = (filepath: string): Strategy | undefined => {
  const ext = path.extname(filepath).toLowerCase()
  return strategies.find((s) => s.extensions.includes(ext))
}

export const layer = Layer.effect(
  Service,
  Effect.sync(() =>
    Service.of({
      supports: (filepath: string) => findStrategy(filepath) !== undefined,
      prune: (filepath: string, content: string) => {
        const strategy = findStrategy(filepath)
        if (!strategy) {
          const lines = content.split("\n").length
          return Effect.succeed({
            content,
            pruned: false,
            originalLines: lines,
            skeletonLines: lines,
          })
        }
        return strategy.prune(filepath, content)
      },
    }),
  ),
)

export const node = LayerNode.make({ service: Service, layer, deps: [] })
export * as Skeleton from "./index"
