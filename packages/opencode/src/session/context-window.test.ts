import { describe, expect, it } from "bun:test";
import {
    CONTEXT_UTILIZATION_WARN_THRESHOLD,
    computeCacheHitRate,
    computeContextUtilization,
    getContextLimit,
    isContextWarn,
} from "./context-window";

describe("getContextLimit", () => {
    it("returns 200K by default for non-opus/sonnet models", () => {
        expect(getContextLimit("claude-haiku-4-5", false)).toBe(200_000);
    });

    it("returns 1M for sonnet-4 with context-1m beta", () => {
        expect(getContextLimit("claude-sonnet-4-6", true)).toBe(1_000_000);
    });

    it("returns 1M for Opus regardless of beta", () => {
        expect(getContextLimit("claude-opus-4-7", false)).toBe(1_000_000);
        expect(getContextLimit("claude-opus-4-7", true)).toBe(1_000_000);
    });

    it("returns 1M for claude-opus-4-7", () => {
        expect(getContextLimit("claude-opus-4-7", false)).toBe(1_000_000);
    });

    it("returns 1M for claude-opus-4-6", () => {
        expect(getContextLimit("claude-opus-4-6", false)).toBe(1_000_000);
    });

    it("keeps Haiku at 200K even with context-1m beta", () => {
        expect(getContextLimit("claude-haiku-4-5", true)).toBe(200_000);
    });

    it("returns 200K for undefined model", () => {
        expect(getContextLimit(undefined, false)).toBe(200_000);
        expect(getContextLimit(undefined, true)).toBe(200_000);
    });
});

describe("computeContextUtilization", () => {
    it("computes percentage used from input + cache_read + cache_write", () => {
        const util = computeContextUtilization(
            { input: 50_000, cacheRead: 30_000, cacheWrite: 20_000 },
            200_000,
        );
        expect(util.tokensUsed).toBe(100_000);
        expect(util.used).toBe(50);
        expect(util.remaining).toBe(50);
        expect(util.contextLimit).toBe(200_000);
    });

    it("does NOT include output tokens (matches v114 NV$)", () => {
        const util = computeContextUtilization(
            { input: 100_000, cacheRead: 0, cacheWrite: 0 },
            200_000,
        );
        expect(util.tokensUsed).toBe(100_000);
    });

    it("clamps to 100%", () => {
        const util = computeContextUtilization(
            { input: 300_000, cacheRead: 0, cacheWrite: 0 },
            200_000,
        );
        expect(util.used).toBe(100);
        expect(util.remaining).toBe(0);
    });

    it("clamps to 0% on negative inputs", () => {
        const util = computeContextUtilization(
            { input: -1, cacheRead: 0, cacheWrite: 0 },
            200_000,
        );
        expect(util.used).toBe(0);
    });

    it("handles zero/negative context limit safely", () => {
        const util = computeContextUtilization(
            { input: 100, cacheRead: 0, cacheWrite: 0 },
            0,
        );
        expect(util.used).toBe(0);
        expect(util.remaining).toBe(100);
        expect(util.tokensUsed).toBe(100);
    });

    it("handles 1M context", () => {
        const util = computeContextUtilization(
            { input: 500_000, cacheRead: 0, cacheWrite: 0 },
            1_000_000,
        );
        expect(util.used).toBe(50);
    });
});

describe("computeCacheHitRate", () => {
    it("returns cache_read / (input + cache_read + cache_write) * 100", () => {
        const rate = computeCacheHitRate({
            input: 10_000,
            cacheRead: 80_000,
            cacheWrite: 10_000,
        });
        expect(rate).toBe(80);
    });

    it("returns null when no cache traffic at all", () => {
        expect(
            computeCacheHitRate({ input: 0, cacheRead: 0, cacheWrite: 0 }),
        ).toBeNull();
    });

    it("returns 0 when input-only (real 0% hit, not null)", () => {
        expect(
            computeCacheHitRate({
                input: 10_000,
                cacheRead: 0,
                cacheWrite: 0,
            }),
        ).toBe(0);
    });

    it("returns 100 when all traffic is cache reads", () => {
        expect(
            computeCacheHitRate({
                input: 0,
                cacheRead: 10_000,
                cacheWrite: 0,
            }),
        ).toBe(100);
    });
});

describe("isContextWarn", () => {
    it("fires at 80% (the warn threshold)", () => {
        const util = {
            used: 80,
            remaining: 20,
            tokensUsed: 160_000,
            contextLimit: 200_000,
        };
        expect(isContextWarn(util)).toBe(true);
    });

    it("does not fire at 79%", () => {
        const util = {
            used: 79,
            remaining: 21,
            tokensUsed: 158_000,
            contextLimit: 200_000,
        };
        expect(isContextWarn(util)).toBe(false);
    });

    it("warn threshold is 0.8", () => {
        expect(CONTEXT_UTILIZATION_WARN_THRESHOLD).toBe(0.8);
    });
});
