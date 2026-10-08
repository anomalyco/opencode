import type { ExtensionErrorCode, ExtensionFailure } from "../../shared/ipc-rpc/extensions"

/** A failure the renderer maps to its own copy by `code`. */
export class ExtensionError extends Error {
  constructor(
    readonly code: ExtensionErrorCode,
    options?: ErrorOptions & { readonly message?: string },
  ) {
    super(options?.message ?? code, options)
  }
}

export function extensionFailure(error: unknown): ExtensionFailure {
  if (error instanceof ExtensionError) return { code: error.code, message: error.message }

  return { code: "failed", message: error instanceof Error ? error.message : String(error) }
}
