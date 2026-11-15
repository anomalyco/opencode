import type { PluginErrorCode, PluginFailure } from "../../shared/ipc-rpc/plugins"

/** A failure the renderer maps to its own copy by `code`. */
export class PluginError extends Error {
  constructor(
    readonly code: PluginErrorCode,
    options?: ErrorOptions & { readonly message?: string },
  ) {
    super(options?.message ?? code, options)
  }
}

// SAFETY: a rejection's reason is unknown by contract; this is the boundary that maps it, by `instanceof` only.
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- see SAFETY above
export function pluginFailure(error: unknown): PluginFailure {
  if (error instanceof PluginError) return { code: error.code, message: error.message }

  return { code: "failed", message: error instanceof Error ? error.message : String(error) }
}
