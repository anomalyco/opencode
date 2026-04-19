import { describe, expect, it } from "bun:test";
import {
    formatCost,
    formatModelLine,
    formatTokenNumber,
} from "./live-token-math";

describe("formatTokenNumber", () => {
    it("formats zero", () => {
        expect(formatTokenNumber(0)).toBe("0");
    });

    it("formats small numbers without separators", () => {
        expect(formatTokenNumber(123)).toBe("123");
    });

    it("formats thousands with comma separator", () => {
        expect(formatTokenNumber(1234)).toBe("1,234");
    });

    it("formats large numbers with multiple separators", () => {
        expect(formatTokenNumber(208258)).toBe("208,258");
    });

    it("formats millions", () => {
        expect(formatTokenNumber(1_000_000)).toBe("1,000,000");
    });
});

describe("formatCost", () => {
    it("formats zero cost", () => {
        expect(formatCost(0)).toBe("$0.00");
    });

    it("formats small cost with rounding", () => {
        expect(formatCost(0.1234567)).toBe("$0.12");
    });

    it("formats cost with exactly 2 decimals", () => {
        expect(formatCost(0.05)).toBe("$0.05");
    });

    it("formats cost with trailing zero", () => {
        expect(formatCost(0.1)).toBe("$0.10");
    });

    it("formats large cost", () => {
        expect(formatCost(123.456)).toBe("$123.46");
    });

    it("rounds down correctly", () => {
        expect(formatCost(0.124)).toBe("$0.12");
    });

    it("rounds up correctly", () => {
        expect(formatCost(0.126)).toBe("$0.13");
    });
});

describe("formatModelLine", () => {
    it("formats model line with all zeros", () => {
        const line = formatModelLine("claude-opus-4-7", 0, 0, 0, 0, 0);
        expect(line).toBe(
            "  claude-opus-4-7: 0 input, 0 output, 0 cache read, 0 cache write ($0.00)",
        );
    });

    it("formats model line with typical usage", () => {
        const line = formatModelLine(
            "claude-opus-4-7",
            1234,
            567,
            89,
            12,
            0.05,
        );
        expect(line).toBe(
            "  claude-opus-4-7: 1,234 input, 567 output, 89 cache read, 12 cache write ($0.05)",
        );
    });

    it("formats model line with large numbers", () => {
        const line = formatModelLine(
            "claude-sonnet-4-6",
            208258,
            45123,
            12000,
            3000,
            1.23,
        );
        expect(line).toBe(
            "  claude-sonnet-4-6: 208,258 input, 45,123 output, 12,000 cache read, 3,000 cache write ($1.23)",
        );
    });

    it("formats model line with millions", () => {
        const line = formatModelLine(
            "claude-haiku-4-5",
            1_000_000,
            500_000,
            100_000,
            50_000,
            12.34,
        );
        expect(line).toBe(
            "  claude-haiku-4-5: 1,000,000 input, 500,000 output, 100,000 cache read, 50,000 cache write ($12.34)",
        );
    });

    it("formats model line with high precision cost", () => {
        const line = formatModelLine(
            "claude-opus-4-7",
            1000,
            1000,
            1000,
            1000,
            0.123456789,
        );
        expect(line).toBe(
            "  claude-opus-4-7: 1,000 input, 1,000 output, 1,000 cache read, 1,000 cache write ($0.12)",
        );
    });
});
