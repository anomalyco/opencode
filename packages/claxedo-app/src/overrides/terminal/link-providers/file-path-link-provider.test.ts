import { describe, expect, it, mock } from "bun:test";
import type { IBufferLine, ILink, Terminal } from "@xterm/xterm";
import { FilePathLinkProvider } from "./file-path-link-provider";

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
	provider: FilePathLinkProvider,
	lineNumber: number,
): Promise<ILink[]> {
	return new Promise((resolve) => {
		provider.provideLinks(lineNumber, (links) => {
			resolve(links ?? []);
		});
	});
}

describe("FilePathLinkProvider", () => {
	describe("basic file path detection", () => {
		it("should detect absolute paths", async () => {
			const terminal = createMockTerminal([
				{ text: "Error in /path/to/file.ts:10:5" },
			]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("/path/to/file.ts:10:5");
		});

		it("should detect relative paths starting with ./", async () => {
			const terminal = createMockTerminal([{ text: "See ./src/utils.ts" }]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("./src/utils.ts");
		});

		it("should detect relative paths starting with ../", async () => {
			const terminal = createMockTerminal([
				{ text: "Import from ../lib/helper.ts" },
			]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("../lib/helper.ts");
		});

		it("should detect home directory paths", async () => {
			const terminal = createMockTerminal([
				{ text: "Config at ~/config/settings.json" },
			]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("~/config/settings.json");
		});

		it("should detect paths with line and column numbers", async () => {
			const terminal = createMockTerminal([{ text: "/path/file.ts:42:10" }]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("/path/file.ts:42:10");
		});

		it("should detect multiple paths on one line", async () => {
			const terminal = createMockTerminal([
				{ text: "Import ./src/a.ts and ./src/b.ts" },
			]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(2);
			expect(links[0].text).toBe("./src/a.ts");
			expect(links[1].text).toBe("./src/b.ts");
		});
	});

	describe("filtering false positives", () => {
		it("should skip CLI flags that look like paths via suffix parsing", async () => {
			const terminal = createMockTerminal([
				{
					text: '"" /Users/yashvardhansingh/test/opencode/packages --include="*.test.ts" 2>/dev/null"',
				},
			]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			// Only the real directory should be linkified.
			expect(links.length).toBe(1);
			expect(links[0].text).toBe("/Users/yashvardhansingh/test/opencode/packages");
		});

		it("should skip numeric ratio patterns like 1/2", async () => {
			const terminal = createMockTerminal([{ text: "progress 1/2 complete" }]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(0);
		});

		it("should skip generic word/word fragments without a file-like basename", async () => {
			const terminal = createMockTerminal([
				{ text: "this should not linkify foo/bar in text" },
			]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(0);
		});

		it("should skip URLs with http://", async () => {
			const terminal = createMockTerminal([
				{ text: "Visit http://example.com/path" },
			]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(0);
		});

		it("should skip URLs with https://", async () => {
			const terminal = createMockTerminal([
				{ text: "Visit https://example.com/path" },
			]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(0);
		});

		it("should skip version strings", async () => {
			const terminal = createMockTerminal([{ text: "Package v1.2.3" }]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(0);
		});

		it("should skip npm package references", async () => {
			const terminal = createMockTerminal([
				{ text: "lodash@4.17.21/index.js" },
			]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(0);
		});

		it("should skip pure numbers like 123:456", async () => {
			// VSCode-style suffix parsing can match "word 123:456" as a link with row/col.
			// This provider now requires a real-looking path to avoid linkifying numbers.
			const terminal = createMockTerminal([
				{ text: "at position 123:456:789" },
			]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(0);
		});
	});

	describe("wrapped lines - forward looking (next line)", () => {
		it("should detect path that spans current line and wrapped next line", async () => {
			const terminal = createMockTerminal([
				{ text: "/path/to/very/long/fi" },
				{ text: "le/name.ts", isWrapped: true },
			]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("/path/to/very/long/file/name.ts");
			expect(links[0].range.start.y).toBe(1);
			expect(links[0].range.end.y).toBe(2);
		});

		it("should calculate correct range for multi-line path starting on current line", async () => {
			const terminal = createMockTerminal([
				{ text: "/path/to/very/long/fi" },
				{ text: "le/name.ts", isWrapped: true },
			]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links[0].range.start.x).toBe(1);
			expect(links[0].range.start.y).toBe(1);
			expect(links[0].range.end.x).toBe(11);
			expect(links[0].range.end.y).toBe(2);
		});
	});

	describe("wrapped lines - backward looking (previous line)", () => {
		it("should detect path from previous line when current line is wrapped", async () => {
			const terminal = createMockTerminal([
				{ text: "/path/to/very/long/fi" },
				{ text: "le/name.ts", isWrapped: true },
			]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 2);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("/path/to/very/long/file/name.ts");
			expect(links[0].range.start.y).toBe(1);
			expect(links[0].range.end.y).toBe(2);
		});

		it("should handle clicking on wrapped portion of path", async () => {
			const terminal = createMockTerminal([
				{ text: "Error: /usr/local/lib/nod" },
				{ text: "e_modules/pkg/index.js:10", isWrapped: true },
			]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 2);

			// node_modules paths are intentionally ignored to reduce noise
			expect(links.length).toBe(0);
		});
	});

	describe("three-line wrapping", () => {
		it("should handle path spanning three lines when scanned from middle", async () => {
			const terminal = createMockTerminal([
				{ text: "/path/to/ve" },
				{ text: "ry/long/dir", isWrapped: true },
				{ text: "/file.ts", isWrapped: true },
			]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 2);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("/path/to/very/long/dir/file.ts");
		});
	});

	describe("non-wrapped lines", () => {
		it("should not combine lines that are not wrapped", async () => {
			const terminal = createMockTerminal([
				{ text: "/path/one.ts" },
				{ text: "/path/two.ts", isWrapped: false },
			]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("/path/one.ts");
		});

		it("should handle paths on separate lines independently", async () => {
			const terminal = createMockTerminal([
				{ text: "/path/one.ts" },
				{ text: "/path/two.ts", isWrapped: false },
			]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links1 = await getLinks(provider, 1);
			const links2 = await getLinks(provider, 2);

			expect(links1.length).toBe(1);
			expect(links1[0].text).toBe("/path/one.ts");
			expect(links2.length).toBe(1);
			expect(links2[0].text).toBe("/path/two.ts");
		});
	});

	describe("handleActivation", () => {
		it("should require metaKey (Cmd) for activation", async () => {
			const terminal = createMockTerminal([{ text: "/path/file.ts" }]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);
			const mockEvent = {
				metaKey: false,
				ctrlKey: false,
				preventDefault: mock(),
			} as unknown as MouseEvent;

			links[0].activate(mockEvent, "/path/file.ts");

			expect(onOpen).not.toHaveBeenCalled();
		});

		it("should activate with metaKey (Cmd)", async () => {
			const terminal = createMockTerminal([{ text: "/path/file.ts" }]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);
			const mockEvent = {
				metaKey: true,
				ctrlKey: false,
				preventDefault: mock(),
			} as unknown as MouseEvent;

			links[0].activate(mockEvent, "/path/file.ts");

			expect(onOpen).toHaveBeenCalled();
			expect(onOpen.mock.calls[0][1]).toBe("/path/file.ts");
		});

		it("should activate with ctrlKey", async () => {
			const terminal = createMockTerminal([{ text: "/path/file.ts" }]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);
			const mockEvent = {
				metaKey: false,
				ctrlKey: true,
				preventDefault: mock(),
			} as unknown as MouseEvent;

			links[0].activate(mockEvent, "/path/file.ts");

			expect(onOpen).toHaveBeenCalled();
		});

		it("should parse line and column from path", async () => {
			const terminal = createMockTerminal([{ text: "/path/file.ts:42:10" }]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);
			const mockEvent = {
				metaKey: true,
				ctrlKey: false,
				preventDefault: mock(),
			} as unknown as MouseEvent;

			links[0].activate(mockEvent, "/path/file.ts:42:10");

			expect(onOpen).toHaveBeenCalled();
			expect(onOpen.mock.calls[0][1]).toBe("/path/file.ts");
			expect(onOpen.mock.calls[0][2]).toBe(42);
			expect(onOpen.mock.calls[0][3]).toBe(10);
		});
	});

	describe("VSCode-style link formats", () => {
		it("should detect parenthesis format: file.ts(42)", async () => {
			const terminal = createMockTerminal([
				{ text: "Error in /path/file.ts(42)" },
			]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("/path/file.ts(42)");

			const mockEvent = {
				metaKey: true,
				ctrlKey: false,
				preventDefault: mock(),
			} as unknown as MouseEvent;
			links[0].activate(mockEvent, links[0].text);

			expect(onOpen.mock.calls[0][1]).toBe("/path/file.ts");
			expect(onOpen.mock.calls[0][2]).toBe(42);
		});

		it("should detect parenthesis format with column: file.ts(42, 10)", async () => {
			const terminal = createMockTerminal([
				{ text: "Error in /path/file.ts(42, 10)" },
			]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("/path/file.ts(42, 10)");

			const mockEvent = {
				metaKey: true,
				ctrlKey: false,
				preventDefault: mock(),
			} as unknown as MouseEvent;
			links[0].activate(mockEvent, links[0].text);

			expect(onOpen.mock.calls[0][1]).toBe("/path/file.ts");
			expect(onOpen.mock.calls[0][2]).toBe(42);
			expect(onOpen.mock.calls[0][3]).toBe(10);
		});

		it("should detect square bracket format: file.ts[42]", async () => {
			const terminal = createMockTerminal([
				{ text: "Error in /path/file.ts[42]" },
			]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("/path/file.ts[42]");

			const mockEvent = {
				metaKey: true,
				ctrlKey: false,
				preventDefault: mock(),
			} as unknown as MouseEvent;
			links[0].activate(mockEvent, links[0].text);

			expect(onOpen.mock.calls[0][1]).toBe("/path/file.ts");
			expect(onOpen.mock.calls[0][2]).toBe(42);
		});

		it('should detect verbose format: "file.ts", line 42', async () => {
			const terminal = createMockTerminal([
				{ text: 'Error in "/path/file.ts", line 42' },
			]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe('"/path/file.ts", line 42');

			const mockEvent = {
				metaKey: true,
				ctrlKey: false,
				preventDefault: mock(),
			} as unknown as MouseEvent;
			links[0].activate(mockEvent, links[0].text);

			expect(onOpen.mock.calls[0][1]).toBe("/path/file.ts");
			expect(onOpen.mock.calls[0][2]).toBe(42);
		});

		it('should detect verbose format with column: "file.ts", line 42, col 10', async () => {
			const terminal = createMockTerminal([
				{ text: 'Error in "/path/file.ts", line 42, col 10' },
			]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe('"/path/file.ts", line 42, col 10');

			const mockEvent = {
				metaKey: true,
				ctrlKey: false,
				preventDefault: mock(),
			} as unknown as MouseEvent;
			links[0].activate(mockEvent, links[0].text);

			expect(onOpen.mock.calls[0][1]).toBe("/path/file.ts");
			expect(onOpen.mock.calls[0][2]).toBe(42);
			expect(onOpen.mock.calls[0][3]).toBe(10);
		});

		it("should detect line ranges: file.ts:42-50", async () => {
			const terminal = createMockTerminal([
				{ text: "See /path/file.ts:42:10-50" },
			]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("/path/file.ts:42:10-50");

			const mockEvent = {
				metaKey: true,
				ctrlKey: false,
				preventDefault: mock(),
			} as unknown as MouseEvent;
			links[0].activate(mockEvent, links[0].text);

			expect(onOpen.mock.calls[0][1]).toBe("/path/file.ts");
			expect(onOpen.mock.calls[0][2]).toBe(42);
			expect(onOpen.mock.calls[0][3]).toBe(10);
			expect(onOpen.mock.calls[0][5]).toBe(50); // columnEnd
		});

		it("should detect hash format: file.ts#42", async () => {
			const terminal = createMockTerminal([{ text: "See /path/file.ts#42" }]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("/path/file.ts#42");

			const mockEvent = {
				metaKey: true,
				ctrlKey: false,
				preventDefault: mock(),
			} as unknown as MouseEvent;
			links[0].activate(mockEvent, links[0].text);

			expect(onOpen.mock.calls[0][1]).toBe("/path/file.ts");
			expect(onOpen.mock.calls[0][2]).toBe(42);
		});

		it("should detect git diff paths: --- a/path/file.ts", async () => {
			const terminal = createMockTerminal([{ text: "--- a/path/to/file.ts" }]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("path/to/file.ts");
		});

		it("should detect git diff paths: +++ b/path/file.ts", async () => {
			const terminal = createMockTerminal([{ text: "+++ b/path/to/file.ts" }]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("path/to/file.ts");
		});
	});

	describe("URL-encoded paths", () => {
		it("should decode URL-encoded path with line number on activation", async () => {
			const terminal = createMockTerminal([
				{ text: "apps/desktop/src/main/lib/workspace-manager.ts%3A50" },
			]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);

			const mockEvent = {
				metaKey: true,
				ctrlKey: false,
				preventDefault: mock(),
			} as unknown as MouseEvent;
			links[0].activate(mockEvent, links[0].text);

			expect(onOpen).toHaveBeenCalled();
			expect(onOpen.mock.calls[0][1]).toBe(
				"apps/desktop/src/main/lib/workspace-manager.ts",
			);
			expect(onOpen.mock.calls[0][2]).toBe(50);
		});

		it("should decode URL-encoded path with line and column on activation", async () => {
			const terminal = createMockTerminal([{ text: "src/file.ts%3A42%3A10" }]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);

			const mockEvent = {
				metaKey: true,
				ctrlKey: false,
				preventDefault: mock(),
			} as unknown as MouseEvent;
			links[0].activate(mockEvent, links[0].text);

			expect(onOpen).toHaveBeenCalled();
			expect(onOpen.mock.calls[0][1]).toBe("src/file.ts");
			expect(onOpen.mock.calls[0][2]).toBe(42);
			expect(onOpen.mock.calls[0][3]).toBe(10);
		});

		it("should decode URL-encoded spaces in path", async () => {
			const terminal = createMockTerminal([
				{ text: "./path/to%20file/name.ts" },
			]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);

			const mockEvent = {
				metaKey: true,
				ctrlKey: false,
				preventDefault: mock(),
			} as unknown as MouseEvent;
			links[0].activate(mockEvent, links[0].text);

			expect(onOpen).toHaveBeenCalled();
			expect(onOpen.mock.calls[0][1]).toBe("./path/to file/name.ts");
		});
	});

	describe("punctuation handling", () => {
		it("should handle path followed by period at end of sentence", async () => {
			const terminal = createMockTerminal([
				{ text: "See the file at ./path/something." },
			]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			// The path should be detected without the trailing period
			expect(links.length).toBe(1);
			expect(links[0].text).toBe("./path/something");
		});

		it("should handle path in quotes", async () => {
			const terminal = createMockTerminal([
				{ text: 'Error in "./path/file.ts"' },
			]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("./path/file.ts");
		});
	});

	describe("edge cases", () => {
		it("should handle empty lines", async () => {
			const terminal = createMockTerminal([{ text: "" }]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(0);
		});

		it("should handle line that doesn't exist", async () => {
			const terminal = createMockTerminal([{ text: "Hello" }]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 999);

			expect(links.length).toBe(0);
		});

		it("should handle paths without directories (just relative path)", async () => {
			const terminal = createMockTerminal([
				{ text: "src/components/Button.tsx" },
			]);
			const onOpen = mock();
			const provider = new FilePathLinkProvider(terminal, onOpen);

			const links = await getLinks(provider, 1);

			expect(links.length).toBe(1);
			expect(links[0].text).toBe("src/components/Button.tsx");
		});
	});
});
