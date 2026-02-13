import { describe, expect, it, mock } from "bun:test";
import type { IBufferLine, ILink, Terminal } from "@xterm/xterm";
import { UrlLinkProvider } from "./url-link-provider";

function createMockLine(text: string, isWrapped = false): IBufferLine {
	return {
		translateToString: () => text,
		isWrapped,
		length: text.length,
		getCell: mock(() => null),
		getCells: mock(() => []),
	} as unknown as IBufferLine;
}

function createMockTerminal(
	lines: Array<{ text: string; isWrapped?: boolean }>,
): Terminal {
	const mockLines = lines.map((l) =>
		createMockLine(l.text, l.isWrapped ?? false),
	);

	return {
		buffer: {
			active: {
				getLine: (index: number) => mockLines[index] ?? null,
			},
		},
		element: {
			style: { cursor: "" },
		},
	} as unknown as Terminal;
}

function getLinks(
	provider: UrlLinkProvider,
	lineNumber: number,
): Promise<ILink[]> {
	return new Promise((resolve) => {
		provider.provideLinks(lineNumber, (links) => {
			resolve(links ?? []);
		});
	});
}

describe("UrlLinkProvider", () => {
	describe("basic URL detection", () => {
		it("should detect https URLs", async () => {
			const terminal = createMockTerminal([
				{ text: "Visit https://example.com/path" },
			]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("https://example.com/path");
		});

		it("should detect http URLs", async () => {
			const terminal = createMockTerminal([
				{ text: "Visit http://example.com/path" },
			]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("http://example.com/path");
		});

		it("should detect URLs with query parameters", async () => {
			const terminal = createMockTerminal([
				{ text: "https://example.com/path?foo=bar&baz=qux" },
			]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("https://example.com/path?foo=bar&baz=qux");
		});

		it("should detect URLs with fragments", async () => {
			const terminal = createMockTerminal([
				{ text: "https://example.com/path#section" },
			]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("https://example.com/path#section");
		});

		it("should detect multiple URLs on one line", async () => {
			const terminal = createMockTerminal([
				{ text: "https://a.com and https://b.com" },
			]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(2);
			expect(links[0].text).toBe("https://a.com");
			expect(links[1].text).toBe("https://b.com");
		});

		it("should detect URLs with port numbers", async () => {
			const terminal = createMockTerminal([
				{ text: "Server at http://localhost:3000/api" },
			]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("http://localhost:3000/api");
		});

		it("should handle URLs with parentheses (like Wikipedia)", async () => {
			const terminal = createMockTerminal([
				{ text: "https://en.wikipedia.org/wiki/URL_(disambiguation)" },
			]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe(
				"https://en.wikipedia.org/wiki/URL_(disambiguation)",
			);
		});

		it("should strip trailing period from URL", async () => {
			const terminal = createMockTerminal([
				{ text: "See https://example.com." },
			]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("https://example.com");
		});

		it("should strip trailing comma from URL", async () => {
			const terminal = createMockTerminal([
				{ text: "Visit https://example.com, then continue." },
			]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("https://example.com");
		});

		it("should strip multiple trailing punctuation", async () => {
			const terminal = createMockTerminal([
				{ text: "Check https://example.com..." },
			]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("https://example.com");
		});

		it("should strip trailing exclamation and question marks", async () => {
			const terminal = createMockTerminal([
				{ text: "Is it https://example.com?" },
			]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("https://example.com");
		});

		it("should trim unbalanced trailing parenthesis", async () => {
			const terminal = createMockTerminal([
				{ text: "(see https://example.com)" },
			]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("https://example.com");
		});

		it("should keep balanced parentheses in URL", async () => {
			const terminal = createMockTerminal([
				{ text: "https://example.com/path(foo)" },
			]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("https://example.com/path(foo)");
		});

		it("should handle URL in parentheses with balanced parens inside", async () => {
			const terminal = createMockTerminal([
				{ text: "(see https://en.wikipedia.org/wiki/URL_(disambiguation))" },
			]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe(
				"https://en.wikipedia.org/wiki/URL_(disambiguation)",
			);
		});
	});

	describe("wrapped lines - forward looking (next line)", () => {
		it("should detect URL that spans current line and wrapped next line", async () => {
			const terminal = createMockTerminal([
				{ text: "https://example.com/ver" },
				{ text: "y/long/path/here", isWrapped: true },
			]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("https://example.com/very/long/path/here");
			expect(links[0].range.start.y).toBe(1);
			expect(links[0].range.end.y).toBe(2);
		});

		it("should calculate correct range for multi-line URL starting on current line", async () => {
			const terminal = createMockTerminal([
				{ text: "https://example.com/ver" },
				{ text: "y/long/path/here", isWrapped: true },
			]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links[0].range.start.x).toBe(1);
			expect(links[0].range.start.y).toBe(1);
			expect(links[0].range.end.x).toBe(17);
			expect(links[0].range.end.y).toBe(2);
		});
	});

	describe("wrapped lines - backward looking (previous line)", () => {
		it("should detect URL from previous line when current line is wrapped", async () => {
			const terminal = createMockTerminal([
				{ text: "https://example.com/ver" },
				{ text: "y/long/path/here", isWrapped: true },
			]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 2);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("https://example.com/very/long/path/here");
			expect(links[0].range.start.y).toBe(1);
			expect(links[0].range.end.y).toBe(2);
		});

		it("should handle clicking on wrapped portion of URL", async () => {
			const terminal = createMockTerminal([
				{ text: "Visit https://github.com/" },
				{ text: "anthropics/claude-code/issues", isWrapped: true },
			]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 2);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe(
				"https://github.com/anthropics/claude-code/issues",
			);
		});
	});

	describe("three-line wrapping", () => {
		it("should handle URL spanning three lines when scanned from middle", async () => {
			const terminal = createMockTerminal([
				{ text: "https://exa" },
				{ text: "mple.com/ve", isWrapped: true },
				{ text: "ry/long/url", isWrapped: true },
			]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 2);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("https://example.com/very/long/url");
		});
	});

	describe("non-wrapped lines", () => {
		it("should not combine lines that are not wrapped", async () => {
			const terminal = createMockTerminal([
				{ text: "https://a.com" },
				{ text: "https://b.com", isWrapped: false },
			]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("https://a.com");
		});

		it("should handle URLs on separate lines independently", async () => {
			const terminal = createMockTerminal([
				{ text: "https://a.com" },
				{ text: "https://b.com", isWrapped: false },
			]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const links1 = await getLinks(provider, 1);
			const links2 = await getLinks(provider, 2);

			expect(links1.length).toBe(1);
			expect(links1[0].text).toBe("https://a.com");
			expect(links2.length).toBe(1);
			expect(links2[0].text).toBe("https://b.com");
		});
	});

	describe("handleActivation", () => {
		it("should require metaKey (Cmd) or ctrlKey for activation", async () => {
			const terminal = createMockTerminal([{ text: "https://example.com" }]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);
			const mockEvent = {
				metaKey: false,
				ctrlKey: false,
				preventDefault: mock(),
			} as unknown as MouseEvent;

			links[0].activate(mockEvent, "https://example.com");

			expect(onOpen).not.toHaveBeenCalled();
		});

		it("should activate with metaKey (Cmd)", async () => {
			const terminal = createMockTerminal([{ text: "https://example.com" }]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);
			const mockEvent = {
				metaKey: true,
				ctrlKey: false,
				preventDefault: mock(),
			} as unknown as MouseEvent;

			links[0].activate(mockEvent, "https://example.com");

			expect(onOpen).toHaveBeenCalled();
			expect(onOpen.mock.calls[0][1]).toBe("https://example.com");
		});

		it("should activate with ctrlKey", async () => {
			const terminal = createMockTerminal([{ text: "https://example.com" }]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);
			const mockEvent = {
				metaKey: false,
				ctrlKey: true,
				preventDefault: mock(),
			} as unknown as MouseEvent;

			links[0].activate(mockEvent, "https://example.com");

			expect(onOpen).toHaveBeenCalled();
		});
	});

	describe("ReDoS prevention", () => {
		it("should handle pathological input without hanging", async () => {
			// This input would cause catastrophic backtracking with nested quantifiers
			// Old pattern: (?:[^\s<>[\]()'"]+|\([^\s<>[\]()'"]*\))+
			const maliciousInput = `https://${"a".repeat(100)}(`;
			const terminal = createMockTerminal([{ text: maliciousInput }]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const start = performance.now();
			const links = await getLinks(provider, 1);
			const elapsed = performance.now() - start;

			// Should complete in under 100ms (old pattern would take seconds/minutes)
			expect(elapsed).toBeLessThan(100);
			expect(links.length).toBe(1);
			// Unbalanced paren is trimmed
			expect(links[0].text).toBe(`https://${"a".repeat(100)}`);
		});

		it("should handle repeated parentheses pattern efficiently", async () => {
			// Another ReDoS pattern: alternating parens
			const input = `https://example.com/${"()".repeat(50)}`;
			const terminal = createMockTerminal([{ text: input }]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const start = performance.now();
			const links = await getLinks(provider, 1);
			const elapsed = performance.now() - start;

			expect(elapsed).toBeLessThan(100);
			expect(links.length).toBe(1);
		});

		it("should handle long URL with unmatched open paren", async () => {
			const input = `https://example.com/${"x".repeat(50)}(${"y".repeat(50)}`;
			const terminal = createMockTerminal([{ text: input }]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const start = performance.now();
			const links = await getLinks(provider, 1);
			const elapsed = performance.now() - start;

			expect(elapsed).toBeLessThan(100);
			expect(links.length).toBe(1);
		});
	});

	describe("edge cases", () => {
		it("should handle empty lines", async () => {
			const terminal = createMockTerminal([{ text: "" }]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(0);
		});

		it("should handle line that doesn't exist", async () => {
			const terminal = createMockTerminal([{ text: "Hello" }]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 999);

			expect(links.length).toBe(0);
		});

		it("should handle lines without URLs", async () => {
			const terminal = createMockTerminal([
				{ text: "This is just some text without links" },
			]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(0);
		});

		it("should not match file paths as URLs", async () => {
			const terminal = createMockTerminal([{ text: "/path/to/file.ts" }]);
			const onOpen = mock();
			const provider = new UrlLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(0);
		});
	});
});
