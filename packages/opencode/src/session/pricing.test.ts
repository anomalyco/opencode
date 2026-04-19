import { describe, expect, it } from "bun:test";
import {
    computeUsageCost,
    getModelPricing,
    normalizeModelKey,
} from "./pricing";

describe("getModelPricing", () => {
    it("returns Opus rates for opus-4 family", () => {
        const pricing = getModelPricing("claude-opus-4-7");
        expect(pricing.inputPerMTok).toBe(15);
        expect(pricing.outputPerMTok).toBe(75);
        expect(pricing.cacheReadPerMTok).toBe(1.5);
        expect(pricing.cacheWritePerMTok).toBe(18.75);
    });

    it("returns Opus rates for dated Opus releases", () => {
        const pricing = getModelPricing("claude-opus-4-5-20251101");
        expect(pricing.inputPerMTok).toBe(15);
    });

    it("returns Sonnet rates for sonnet-4 family", () => {
        const pricing = getModelPricing("claude-sonnet-4-6");
        expect(pricing.inputPerMTok).toBe(3);
        expect(pricing.outputPerMTok).toBe(15);
    });

    it("returns Haiku 4 rates for haiku-4 family", () => {
        const pricing = getModelPricing("claude-haiku-4-5");
        expect(pricing.inputPerMTok).toBe(1);
        expect(pricing.outputPerMTok).toBe(5);
    });

    it("returns Haiku 3.5 rates for legacy haiku", () => {
        const pricing = getModelPricing("claude-3-5-haiku-20241022");
        expect(pricing.inputPerMTok).toBe(0.8);
        expect(pricing.outputPerMTok).toBe(4);
    });

    it("returns Sonnet 3.7 rates for sonnet-3-7", () => {
        const pricing = getModelPricing("claude-3-7-sonnet-20250219");
        expect(pricing.inputPerMTok).toBe(3);
    });

    it("is case-insensitive", () => {
        expect(getModelPricing("CLAUDE-OPUS-4-7").inputPerMTok).toBe(15);
    });

    it("falls back to Sonnet rates for unknown models", () => {
        const pricing = getModelPricing("future-model-xyz");
        expect(pricing.inputPerMTok).toBe(3);
    });

    it("falls back to Sonnet rates for undefined", () => {
        const pricing = getModelPricing(undefined);
        expect(pricing.inputPerMTok).toBe(3);
    });

    it("does not match sonnet-4 when pattern is sonnet-3-7", () => {
        expect(getModelPricing("claude-3-7-sonnet").inputPerMTok).toBe(3);
    });
});

describe("computeUsageCost", () => {
    it("computes Opus cost for 1M input / 1M output", () => {
        const pricing = getModelPricing("claude-opus-4-7");
        const cost = computeUsageCost(
            {
                input: 1_000_000,
                output: 1_000_000,
                cacheRead: 0,
                cacheWrite: 0,
            },
            pricing,
        );
        expect(cost).toBe(90);
    });

    it("computes Sonnet cost for 1M input / 1M output", () => {
        const pricing = getModelPricing("claude-sonnet-4-6");
        const cost = computeUsageCost(
            {
                input: 1_000_000,
                output: 1_000_000,
                cacheRead: 0,
                cacheWrite: 0,
            },
            pricing,
        );
        expect(cost).toBe(18);
    });

    it("includes cache read/write costs", () => {
        const pricing = getModelPricing("claude-sonnet-4-6");
        const cost = computeUsageCost(
            {
                input: 0,
                output: 0,
                cacheRead: 1_000_000,
                cacheWrite: 1_000_000,
            },
            pricing,
        );
        expect(cost).toBeCloseTo(0.3 + 3.75, 5);
    });

    it("returns 0 for zero usage", () => {
        const pricing = getModelPricing("claude-sonnet-4-6");
        expect(
            computeUsageCost(
                { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                pricing,
            ),
        ).toBe(0);
    });

    it("Opus costs are 5x Sonnet input + 5x Sonnet output (the bug we fixed)", () => {
        const sonnet = computeUsageCost(
            {
                input: 1_000_000,
                output: 1_000_000,
                cacheRead: 0,
                cacheWrite: 0,
            },
            getModelPricing("claude-sonnet-4-6"),
        );
        const opus = computeUsageCost(
            {
                input: 1_000_000,
                output: 1_000_000,
                cacheRead: 0,
                cacheWrite: 0,
            },
            getModelPricing("claude-opus-4-7"),
        );
        expect(opus).toBe(sonnet * 5);
    });

    it("rounds to 6 decimal places", () => {
        const pricing = getModelPricing("claude-sonnet-4-6");
        const cost = computeUsageCost(
            { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
            pricing,
        );
        expect(cost.toString().split(".")[1]?.length ?? 0).toBeLessThanOrEqual(
            6,
        );
    });
});

describe("normalizeModelKey", () => {
    it("strips date suffix from dated releases", () => {
        expect(normalizeModelKey("claude-opus-4-5-20251101")).toBe(
            "claude-opus-4-5",
        );
    });

    it("leaves aliases untouched", () => {
        expect(normalizeModelKey("claude-opus-4-7")).toBe("claude-opus-4-7");
    });

    it("lowercases", () => {
        expect(normalizeModelKey("CLAUDE-OPUS-4-7")).toBe("claude-opus-4-7");
    });

    it("returns 'unknown' for undefined", () => {
        expect(normalizeModelKey(undefined)).toBe("unknown");
    });

    it("preserves vendor prefixes", () => {
        expect(
            normalizeModelKey("anthropic.claude-opus-4-1-20250805-v1:0"),
        ).toBe("anthropic.claude-opus-4-1-20250805-v1:0");
    });
});
