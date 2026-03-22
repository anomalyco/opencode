import { ConfigProvider, Effect, Layer, ManagedRuntime } from "effect"
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
 * when `body` completes.
 *
 * Pass extra layers via `options.provide` (e.g. ConfigProvider.layer).
 */
export function withServices<S>(
  directory: string,
  layer: Layer.Layer<S, any>,
  body: (rt: ManagedRuntime.ManagedRuntime<S, never>) => Promise<void>,
  options?: { provide?: Layer.Layer<never>[] },
) {
  return Instance.provide({
    directory,
    fn: async () => {
      let resolved: Layer.Layer<S> = layer as any
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

export const provideInstance =
  (directory: string) =>
  <A, E = never, R = never>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.services<A, E, R>((fiber) =>
      Effect.promise<A>(async () =>
        Instance.provide({
          directory,
          fn: () => Effect.runPromiseWith(fiber.services)(self),
        }),
      ),
    )
