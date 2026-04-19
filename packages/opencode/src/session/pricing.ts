/**
 * Per-model pricing + cost computation.
 *
 * Rates are Anthropic list pricing (USD per 1M tokens) for standard context
 * windows (≤200K). The 1M-context beta doubles input/cache rates server-side
 * (2x) — we do not multiply here because the plugin tracks list-price
 * approximations, not the canonical billing ledger. If you need exact costs,
 * use Anthropic's billing dashboard.
 *
 * Sources:
 * - https://www.anthropic.com/pricing
 * - Claude Code v2.1.114 internal model tables
 */

export interface ModelPricing {
    inputPerMTok: number;
    outputPerMTok: number;
    cacheReadPerMTok: number;
    cacheWritePerMTok: number;
}

const OPUS_4X: ModelPricing = {
    inputPerMTok: 15,
    outputPerMTok: 75,
    cacheReadPerMTok: 1.5,
    cacheWritePerMTok: 18.75,
};

const SONNET_4X: ModelPricing = {
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheReadPerMTok: 0.3,
    cacheWritePerMTok: 3.75,
};

const HAIKU_4X: ModelPricing = {
    inputPerMTok: 1,
    outputPerMTok: 5,
    cacheReadPerMTok: 0.1,
    cacheWritePerMTok: 1.25,
};

const SONNET_3_7: ModelPricing = {
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheReadPerMTok: 0.3,
    cacheWritePerMTok: 3.75,
};

const HAIKU_3_5: ModelPricing = {
    inputPerMTok: 0.8,
    outputPerMTok: 4,
    cacheReadPerMTok: 0.08,
    cacheWritePerMTok: 1,
};

// Conservative default: unknown models get Sonnet-tier rates so we neither
// under- nor wildly over-bill (Opus is 5× Sonnet, Haiku is ~1/3 Sonnet).
const UNKNOWN_DEFAULT: ModelPricing = SONNET_4X;

/**
 * Resolves pricing for a given Anthropic model id.
 *
 * Family detection is substring-based and case-insensitive so aliases
 * (`claude-opus-4-5`) and dated releases (`claude-opus-4-5-20251101`) share
 * rates. Unknown models fall back to Sonnet-tier pricing.
 */
export function getModelPricing(modelId: string | undefined): ModelPricing {
    if (!modelId) return UNKNOWN_DEFAULT;
    const m = modelId.toLowerCase();

    // Order matters: check more specific patterns (3-7-sonnet, 3-5-haiku)
    // BEFORE the generic family matchers to avoid "sonnet-4" matching first.
    if (m.includes("3-7-sonnet") || m.includes("sonnet-3-7")) return SONNET_3_7;
    if (m.includes("3-5-haiku") || m.includes("haiku-3-5")) return HAIKU_3_5;

    if (m.includes("opus-4") || m.includes("opus_4")) return OPUS_4X;
    if (m.includes("haiku-4") || m.includes("haiku_4")) return HAIKU_4X;
    if (m.includes("sonnet-4") || m.includes("sonnet_4")) return SONNET_4X;

    return UNKNOWN_DEFAULT;
}

/**
 * Computes list-price cost for a single request's token usage.
 * Rounds to 6 decimal places to bound floating-point drift across
 * millions of accumulations (worst case ~1e-9 error per op).
 */
export function computeUsageCost(
    usage: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
    },
    pricing: ModelPricing,
): number {
    const raw =
        (usage.input / 1e6) * pricing.inputPerMTok +
        (usage.output / 1e6) * pricing.outputPerMTok +
        (usage.cacheRead / 1e6) * pricing.cacheReadPerMTok +
        (usage.cacheWrite / 1e6) * pricing.cacheWritePerMTok;
    return Math.round(raw * 1e6) / 1e6;
}

/**
 * Normalizes a model id into a stable aggregation key.
 *
 * Dated releases collapse to their alias (e.g. `claude-opus-4-5-20251101` →
 * `claude-opus-4-5`) so per-model ledgers don't fragment across every date
 * suffix Anthropic ships. Vendor prefixes (`anthropic.`, `vertex/`) are
 * preserved to distinguish routing paths.
 */
export function normalizeModelKey(modelId: string | undefined): string {
    if (!modelId) return "unknown";
    return modelId.toLowerCase().replace(/-\d{8}$/, "");
}
