export * as DesktopPaths from "./paths"

import { Effect, Path } from "effect"

export interface Resolved {
  readonly developmentResourcesRoot: string
  readonly preloadPath: string
  readonly rendererRoot: string
}

export const resolve = Effect.gen(function* () {
  const path = yield* Path.Path
  const root = path.dirname(yield* path.fromFileUrl(new URL(import.meta.url)))
  return {
    developmentResourcesRoot: path.join(root, "../../resources"),
    preloadPath: path.join(root, "../preload/index.js"),
    rendererRoot: path.join(root, "../renderer"),
  } satisfies Resolved
}).pipe(Effect.orDie)
