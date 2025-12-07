import { describe, expect, test } from "bun:test";
import type { ModelInfo } from "@agentclientprotocol/sdk";
import { matchModel } from "../../../src/acp/util.js";

describe("matchModel", () => {
	const models: ModelInfo[] = [
		{
			modelId: "claude-sonnet-4.5-20250929",
			name: "Claude Sonnet 4.5",
			description: "Most intelligent model",
		},
		{
			modelId: "claude-haiku-4-20250514",
			name: "Claude Haiku 4",
			description: "Fast and efficient",
		},
		{
			modelId: "claude-opus-4-20250514",
			name: "Claude Opus 4",
			description: "Highly capable",
		},
	];

	test("exact modelId match", () => {
		const result = matchModel("claude-sonnet-4.5-20250929", models);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.match.modelId).toBe("claude-sonnet-4.5-20250929");
		}
	});

	test("exact modelId match (case-insensitive)", () => {
		const result = matchModel("CLAUDE-HAIKU-4-20250514", models);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.match.modelId).toBe("claude-haiku-4-20250514");
		}
	});

	test("fuzzy modelId match - 'haiku' matches haiku model", () => {
		const result = matchModel("haiku", models);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.match.modelId).toBe("claude-haiku-4-20250514");
		}
	});

	test("fuzzy modelId match - 'sonnet' matches sonnet model", () => {
		const result = matchModel("sonnet", models);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.match.modelId).toBe("claude-sonnet-4.5-20250929");
		}
	});

	test("fuzzy modelId match - 'opus' matches opus model", () => {
		const result = matchModel("opus", models);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.match.modelId).toBe("claude-opus-4-20250514");
		}
	});

	test("exact name match", () => {
		const result = matchModel("Claude Haiku 4", models);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.match.name).toBe("Claude Haiku 4");
		}
	});

	test("fuzzy name match", () => {
		const result = matchModel("sonnet 4.5", models);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.match.name).toBe("Claude Sonnet 4.5");
		}
	});

	test("ambiguous match - 'claude' matches multiple models", () => {
		const result = matchModel("claude", models);
		expect(result.success).toBe(false);
		if (!result.success && result.error === "ambiguous") {
			expect(result.matches.length).toBe(3);
		}
	});

	test("not found - 'gpt-4' doesn't match any model", () => {
		const result = matchModel("gpt-4", models);
		expect(result.success).toBe(false);
		if (!result.success && result.error === "not-found") {
			expect(result.available).toEqual(models);
		}
	});

	test("exact modelId match takes priority", () => {
		const modelsWithOverlap: ModelInfo[] = [
			{
				modelId: "haiku",
				name: "Special Haiku",
			},
			{
				modelId: "claude-haiku-4-20250514",
				name: "Claude Haiku 4",
			},
		];
		const result = matchModel("haiku", modelsWithOverlap);
		expect(result.success).toBe(true);
		// Should match the exact modelId "haiku" even though "claude-haiku-4" also contains "haiku"
		if (result.success) {
			expect(result.match.modelId).toBe("haiku");
		}
	});

	test("falls back to name match when modelId doesn't match", () => {
		const modelsWithDistinctNames: ModelInfo[] = [
			{
				modelId: "model-123",
				name: "Fast Model",
			},
			{
				modelId: "model-456",
				name: "Slow Model",
			},
		];
		const result = matchModel("fast", modelsWithDistinctNames);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.match.name).toBe("Fast Model");
		}
	});

	test("empty string returns not-found", () => {
		const result = matchModel("", models);
		expect(result.success).toBe(false);
		if (!result.success && result.error === "not-found") {
			expect(result.available).toEqual(models);
		}
	});
});
