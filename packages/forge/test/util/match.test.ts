import { describe, expect, test } from "bun:test";
import { fuzzyMatch } from "../../src/util/match.js";

describe("fuzzyMatch", () => {
	interface TestItem {
		name: string;
		id: number;
	}

	const items: TestItem[] = [
		{ name: "Claude Code", id: 1 },
		{ name: "Gemini CLI", id: 2 },
		{ name: "Codex CLI", id: 3 },
		{ name: "Kimi CLI", id: 4 },
		{ name: "Goose", id: 5 },
	];

	test("exact match (case-insensitive)", () => {
		const result = fuzzyMatch("Claude Code", items, (item) => item.name);
		expect(result).toEqual({ success: true, match: items[0] });
	});

	test("exact match with different case", () => {
		const result = fuzzyMatch("claude code", items, (item) => item.name);
		expect(result).toEqual({ success: true, match: items[0] });
	});

	test("exact match with UPPERCASE", () => {
		const result = fuzzyMatch("GEMINI CLI", items, (item) => item.name);
		expect(result).toEqual({ success: true, match: items[1] });
	});

	test("single fuzzy match", () => {
		const result = fuzzyMatch("claude", items, (item) => item.name);
		expect(result).toEqual({ success: true, match: items[0] });
	});

	test("single fuzzy match case-insensitive", () => {
		const result = fuzzyMatch("GOOSE", items, (item) => item.name);
		expect(result).toEqual({ success: true, match: items[4] });
	});

	test("single fuzzy match with partial string", () => {
		const result = fuzzyMatch("gemini", items, (item) => item.name);
		expect(result).toEqual({ success: true, match: items[1] });
	});

	test("multiple fuzzy matches returns error", () => {
		const result = fuzzyMatch("cli", items, (item) => item.name);
		expect(result).toEqual({
			success: false,
			error: "ambiguous",
			matches: [items[1], items[2], items[3]],
		});
	});

	test("no match returns error with all items", () => {
		const result = fuzzyMatch("invalid", items, (item) => item.name);
		expect(result).toEqual({
			success: false,
			error: "not-found",
			available: items,
		});
	});

	test("exact match takes priority over fuzzy match", () => {
		const itemsWithOverlap: TestItem[] = [
			{ name: "cli", id: 1 },
			{ name: "Gemini CLI", id: 2 },
			{ name: "Codex CLI", id: 3 },
		];
		const result = fuzzyMatch("cli", itemsWithOverlap, (item) => item.name);
		expect(result).toEqual({ success: true, match: itemsWithOverlap[0] });
	});

	test("empty query returns not-found", () => {
		const result = fuzzyMatch("", items, (item) => item.name);
		expect(result).toEqual({
			success: false,
			error: "not-found",
			available: items,
		});
	});

	test("whitespace-only query returns not-found", () => {
		const result = fuzzyMatch("   ", items, (item) => item.name);
		expect(result).toEqual({
			success: false,
			error: "not-found",
			available: items,
		});
	});
});
