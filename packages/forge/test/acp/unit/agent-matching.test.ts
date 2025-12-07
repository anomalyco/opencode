import { describe, expect, test } from "bun:test";
import { matchAgent, ACP_AGENTS } from "../../../src/acp/agents.js";

describe("matchAgent", () => {
	test("exact match (case-insensitive)", () => {
		const result = matchAgent("Claude Code");
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.match.name).toBe("Claude Code");
		}
	});

	test("exact match with lowercase", () => {
		const result = matchAgent("claude code");
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.match.name).toBe("Claude Code");
		}
	});

	test("fuzzy match - 'claude' matches 'Claude Code'", () => {
		const result = matchAgent("claude");
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.match.name).toBe("Claude Code");
		}
	});

	test("fuzzy match - 'gemini' matches 'Gemini CLI'", () => {
		const result = matchAgent("gemini");
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.match.name).toBe("Gemini CLI");
		}
	});

	test("fuzzy match - 'goose' matches 'Goose'", () => {
		const result = matchAgent("goose");
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.match.name).toBe("Goose");
		}
	});

	test("ambiguous match - 'cli' matches multiple agents", () => {
		const result = matchAgent("cli");
		expect(result.success).toBe(false);
		if (!result.success && result.error === "ambiguous") {
			expect(result.matches.length).toBeGreaterThan(1);
			const matchNames = result.matches.map((a) => a.name);
			expect(matchNames).toContain("Gemini CLI");
			expect(matchNames).toContain("Codex CLI");
			expect(matchNames).toContain("Kimi CLI");
		}
	});

	test("not found - 'invalid' doesn't match any agent", () => {
		const result = matchAgent("invalid");
		expect(result.success).toBe(false);
		if (!result.success && result.error === "not-found") {
			expect(result.available).toEqual(ACP_AGENTS);
		}
	});

	test("empty string returns not-found", () => {
		const result = matchAgent("");
		expect(result.success).toBe(false);
		if (!result.success && result.error === "not-found") {
			expect(result.available).toEqual(ACP_AGENTS);
		}
	});
});
