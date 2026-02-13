import { describe, expect, it } from "bun:test";
import {
	detectFallbackLinks,
	generateTrimmedCandidates,
} from "./fallback-matchers";

describe("detectFallbackLinks", () => {
	describe("Python style errors", () => {
		it('detects File "/path/to/file.py", line 42', () => {
			const result = detectFallbackLinks('  File "/path/to/file.py", line 42');
			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({
				link: '"/path/to/file.py", line 42',
				path: "/path/to/file.py",
				line: 42,
				col: undefined,
				index: 7,
			});
		});

		it('detects File "/path/to/file.py" without line', () => {
			const result = detectFallbackLinks('  File "/path/to/file.py"');
			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({
				link: '"/path/to/file.py"',
				path: "/path/to/file.py",
				line: undefined,
				col: undefined,
				index: 7,
			});
		});
	});

	describe("Rust/Cargo error format", () => {
		it("detects --> src/main.rs:10:5", () => {
			const result = detectFallbackLinks("   --> src/main.rs:10:5");
			expect(result).toHaveLength(1);
			expect(result[0]?.path).toContain("src/main.rs");
			expect(result[0]?.line).toBeDefined();
		});
	});

	describe("C++ compile error formats", () => {
		it("detects /path/to/file.cpp(339): error", () => {
			const result = detectFallbackLinks("/path/to/file.cpp(339): error C2065");
			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({
				link: "/path/to/file.cpp(339)",
				path: "/path/to/file.cpp",
				line: 339,
				col: undefined,
				index: 0,
			});
		});

		it("detects /path/to/file.cpp(339,12): error", () => {
			const result = detectFallbackLinks(
				"/path/to/file.cpp(339,12): error C2065",
			);
			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({
				link: "/path/to/file.cpp(339,12)",
				path: "/path/to/file.cpp",
				line: 339,
				col: 12,
				index: 0,
			});
		});
	});

	it("returns empty array for non-matching lines", () => {
		expect(detectFallbackLinks("just some regular text")).toEqual([]);
		expect(detectFallbackLinks("")).toEqual([]);
	});
});

describe("generateTrimmedCandidates", () => {
	it("generates candidates by trimming trailing punctuation", () => {
		const result = generateTrimmedCandidates("/path/to/file.ts.");
		expect(result).toEqual([{ path: "/path/to/file.ts", trimAmount: 1 }]);
	});

	it("handles paths ending with multiple special chars", () => {
		const result = generateTrimmedCandidates("/path/to/file.ts...");
		// The regex matches multiple chars at once, so we get one candidate
		expect(result.length).toBeGreaterThanOrEqual(1);
		// The final trimmed path should be without the trailing dots
		const lastCandidate = result[result.length - 1];
		expect(lastCandidate?.path).toBe("/path/to/file.ts");
	});

	it("handles paths ending with brackets", () => {
		const result = generateTrimmedCandidates("/path/to/file]");
		expect(result).toEqual([{ path: "/path/to/file", trimAmount: 1 }]);
	});

	it("returns empty array for paths without trailing punctuation", () => {
		expect(generateTrimmedCandidates("/path/to/file.ts")).toEqual([]);
		expect(generateTrimmedCandidates("")).toEqual([]);
	});
});
