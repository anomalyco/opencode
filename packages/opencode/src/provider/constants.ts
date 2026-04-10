/**
 * Default limits used when a model has no explicit limit configuration
 * and no data is available from the models.dev database.
 */

/** When limit.context is not configured and no models.dev data exists, use this default context window size */
export const DEFAULT_CONTEXT_LIMIT = 128_000

/** When limit.output is not configured and no models.dev data exists, use this default output token limit */
export const DEFAULT_OUTPUT_LIMIT = 8192
