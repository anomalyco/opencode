/**
 * Context-window utilization + cache-hit math.
 *
 * Mirrors Claude Code v2.1.114's `NV$()` function (line 112908): context
 * utilization is `(input + cache_creation + cache_read) / limit`, excluding
 * output_tokens because output is generated after the request's context
 * footprint is established.
 */

const DEFAULT_CONTEXT_LIMIT = 200_000;
const LONG_CONTEXT_LIMIT = 1_000_000;

/**
 * Fraction of the context window above which we emit a `[context-window]
 * WARN` log entry. 0.8 matches CC's internal soft-threshold — below this,
 * a request is unlikely to be truncated by subsequent cache/tool growth.
 */
export const CONTEXT_UTILIZATION_WARN_THRESHOLD = 0.8;

export interface ContextUtilization {
    /** Percentage 0–100 (clamped). */
    used: number;
    /** Percentage remaining (100 - used). */
    remaining: number;
    /** Raw token count used (input + cache_read + cache_creation). */
    tokensUsed: number;
    /** Context window ceiling used for the percentage. */
    contextLimit: number;
}

/**
 * Resolves the context window ceiling for a given model.
 *
 * The `context-1m-2025-08-07` beta only applies to Sonnet 4.x at time of
 * writing; Opus/Haiku remain at 200K even with the beta header set.
 */
export function getContextLimit(
    modelId: string | undefined,
    has1mContextBeta: boolean,
): number {
    if (!modelId) return DEFAULT_CONTEXT_LIMIT;
    if (has1mContextBeta && /sonnet-4/i.test(modelId))
        return LONG_CONTEXT_LIMIT;
    return DEFAULT_CONTEXT_LIMIT;
}

/**
 * Computes context utilization for a completed request's usage block.
 *
 * Matches v114 `NV$()` semantics: excludes `output_tokens` because output
 * doesn't count toward the prompt's context footprint. Caller provides
 * the context limit (via {@link getContextLimit}).
 */
export function computeContextUtilization(
    usage: { input: number; cacheRead: number; cacheWrite: number },
    contextLimit: number,
): ContextUtilization {
    const tokensUsed = usage.input + usage.cacheRead + usage.cacheWrite;
    if (contextLimit <= 0) {
        return { used: 0, remaining: 100, tokensUsed, contextLimit };
    }
    const raw = Math.round((tokensUsed / contextLimit) * 100);
    const used = Math.min(100, Math.max(0, raw));
    return { used, remaining: 100 - used, tokensUsed, contextLimit };
}

/**
 * Computes cache hit rate for a single request.
 *
 * Formula matches v114's `XZK()`: `cache_read / (input + cache_read +
 * cache_creation)`. Returns `null` when the denominator is 0 so callers can
 * distinguish "no cache traffic" from "0% hits".
 */
export function computeCacheHitRate(usage: {
    input: number;
    cacheRead: number;
    cacheWrite: number;
}): number | null {
    const denom = usage.input + usage.cacheRead + usage.cacheWrite;
    if (denom === 0) return null;
    return Math.round((usage.cacheRead / denom) * 100);
}

/**
 * True when the request exceeds the soft warning threshold.
 * Convenience wrapper so call sites don't re-derive the percent threshold.
 */
export function isContextWarn(util: ContextUtilization): boolean {
    return util.used >= Math.round(CONTEXT_UTILIZATION_WARN_THRESHOLD * 100);
}
