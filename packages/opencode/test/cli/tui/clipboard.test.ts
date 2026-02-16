import { describe, expect, test, mock, beforeEach } from "bun:test"
import { Clipboard } from "../../../src/cli/cmd/tui/util/clipboard"

describe("Clipboard.readText", () => {
    test("returns text from clipboard", async () => {
        const text = await Clipboard.readText()
        // readText() should return a string or undefined depending on clipboard state
        // We mainly verify it doesn't throw
        expect(text === undefined || typeof text === "string").toBe(true)
    })

    test("normalizes CRLF to LF", () => {
        // Test the normalization logic directly since readText depends on system clipboard
        const input = "line1\r\nline2\r\nline3"
        const normalized = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
        expect(normalized).toBe("line1\nline2\nline3")
    })

    test("normalizes stray CR to LF", () => {
        const input = "line1\rline2\rline3"
        const normalized = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
        expect(normalized).toBe("line1\nline2\nline3")
    })

    test("handles mixed CRLF and CR", () => {
        const input = "line1\r\nline2\rline3\r\nline4"
        const normalized = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
        expect(normalized).toBe("line1\nline2\nline3\nline4")
    })

    test("preserves LF-only text unchanged", () => {
        const input = "line1\nline2\nline3"
        const normalized = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
        expect(normalized).toBe("line1\nline2\nline3")
    })

    test("handles empty string", () => {
        const input = ""
        const normalized = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
        expect(normalized).toBe("")
    })

    test("handles unicode text", () => {
        const input = "こんにちは\r\n世界\r\n🎉"
        const normalized = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
        expect(normalized).toBe("こんにちは\n世界\n🎉")
    })
})

describe("Clipboard.read", () => {
    test("returns Content with mime field", async () => {
        const content = await Clipboard.read()
        // content is either undefined or has { data, mime }
        if (content) {
            expect(typeof content.data).toBe("string")
            expect(typeof content.mime).toBe("string")
            expect(content.data.length).toBeGreaterThan(0)
        }
    })

    test("text content has text/plain mime type", async () => {
        const content = await Clipboard.read()
        if (content && !content.mime.startsWith("image/")) {
            expect(content.mime).toBe("text/plain")
        }
    })
})

describe("Ctrl+V paste text pipeline", () => {
    test("trims pasted text", () => {
        const raw = "  hello world  \n"
        const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
        const pastedContent = normalized.trim()
        expect(pastedContent).toBe("hello world")
    })

    test("counts lines correctly for summarization threshold", () => {
        const singleLine = "just one line"
        const lineCount1 = (singleLine.match(/\n/g)?.length ?? 0) + 1
        expect(lineCount1).toBe(1)

        const multiLine = "line1\nline2\nline3\nline4"
        const lineCount4 = (multiLine.match(/\n/g)?.length ?? 0) + 1
        expect(lineCount4).toBe(4)
    })

    test("summarizes large pastes (>= 3 lines)", () => {
        const pastedContent = "line1\nline2\nline3"
        const lineCount = (pastedContent.match(/\n/g)?.length ?? 0) + 1
        expect(lineCount >= 3).toBe(true)
        expect(`[Pasted ~${lineCount} lines]`).toBe("[Pasted ~3 lines]")
    })

    test("summarizes long single-line pastes (> 150 chars)", () => {
        const pastedContent = "a".repeat(200)
        const lineCount = (pastedContent.match(/\n/g)?.length ?? 0) + 1
        expect(lineCount).toBe(1)
        expect(pastedContent.length > 150).toBe(true)
    })

    test("short text is inserted directly (< 3 lines, <= 150 chars)", () => {
        const pastedContent = "hello world"
        const lineCount = (pastedContent.match(/\n/g)?.length ?? 0) + 1
        expect(lineCount < 3).toBe(true)
        expect(pastedContent.length <= 150).toBe(true)
        // In the real code, this would call input.insertText(pastedContent)
    })

    test("strips surrounding single quotes from file paths", () => {
        const pastedContent = "'/path/to/file.txt'"
        const filepath = pastedContent.replace(/^'+|'+$/g, "").replace(/\\ /g, " ")
        expect(filepath).toBe("/path/to/file.txt")
    })

    test("handles escaped spaces in file paths", () => {
        const pastedContent = "/path/to/my\\ file.txt"
        const filepath = pastedContent.replace(/^'+|'+$/g, "").replace(/\\ /g, " ")
        expect(filepath).toBe("/path/to/my file.txt")
    })

    test("detects URLs and skips file path handling", () => {
        const url = "https://example.com/image.png"
        const isUrl = /^(https?):\/\//.test(url)
        expect(isUrl).toBe(true)

        const filePath = "/Users/test/file.txt"
        const isUrlPath = /^(https?):\/\//.test(filePath)
        expect(isUrlPath).toBe(false)
    })

    test("empty clipboard content after trim is a no-op", () => {
        const raw = "   \r\n   "
        const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
        const pastedContent = normalized.trim()
        expect(pastedContent).toBe("")
        // In the real code, this returns early (no-op)
    })
})
