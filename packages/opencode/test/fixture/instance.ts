import { ConfigProvider, Layer, ManagedRuntime } from "effect"
import { InstanceContext } from "../../src/effect/instance-context"
import { Instance } from "../../src/project/instance"

/** ConfigProvider that enables the experimental file watcher. */
export const watcherConfigLayer = ConfigProvider.layer(
  ConfigProvider.fromUnknown({
    OPENCODE_EXPERIMENTAL_FILEWATCHER: "true",
    OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "false",
  }),
)

/**
 * Boot an Instance with the given service layers and run `body` with
 * the ManagedRuntime. Cleanup is automatic — the runtime is disposed
 * and Instance context is torn down when `body` completes.
 *
 * Layers may depend on InstanceContext (provided automatically).
 * Pass extra layers via `options.provide` (e.g. ConfigProvider.layer).
 */
export function withServices<S>(
  directory: string,
  layer: Layer.Layer<S, any, InstanceContext>,
  body: (rt: ManagedRuntime.ManagedRuntime<S, never>) => Promise<void>,
  options?: { provide?: Layer.Layer<never>[] },
) {
  return Instance.provide({
    directory,
    fn: async () => {
      const ctx = Layer.sync(InstanceContext, () =>
        InstanceContext.of({
          directory: Instance.directory,
          worktree: Instance.worktree,
          project: Instance.project,
        }),
      )
      let resolved: Layer.Layer<S> = Layer.fresh(layer).pipe(Layer.provide(ctx)) as any
      if (options?.provide) {
        for (const l of options.provide) {
          resolved = resolved.pipe(Layer.provide(l)) as any
        }
      }
      const rt = ManagedRuntime.make(resolved)
      try {
        await body(rt)
      } finally {
        await rt.dispose()
      }
    },
  })
}
