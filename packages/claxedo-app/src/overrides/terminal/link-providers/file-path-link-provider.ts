import {
	decodeUrlEncodedPath,
	detectFallbackLinks,
	detectLinks,
	getCurrentOS,
	type IFallbackLink,
	type IParsedLink,
	removeLinkSuffix,
} from "../link-parsing";
import type { ILink, ILinkProvider, Terminal } from "@xterm/xterm";

/**
 * A link provider that detects file paths in terminal output using VSCode's
 * terminal link parsing logic. Supports a wide variety of path formats including:
 *
 * - Basic paths: /path/to/file.ts, ./src/file.ts, ~/config.json
 * - With line numbers: file.ts:42, file.ts:42:10
 * - With line ranges: file.ts:42-50, file.ts:42:10-50
 * - Parenthesis format: file.ts(42), file.ts(42, 10)
 * - Square bracket format: file.ts[42], file.ts[42, 10]
 * - Verbose formats: "file.ts", line 42, col 10
 * - Git diff paths: --- a/path/file.ts, +++ b/path/file.ts
 *
 * Also handles multi-line wrapped paths spanning up to 3 terminal lines.
 */
export class FilePathLinkProvider implements ILinkProvider {
	constructor(
		private readonly terminal: Terminal,
		private readonly onOpen: (
			event: MouseEvent,
			path: string,
			line?: number,
			column?: number,
			lineEnd?: number,
			columnEnd?: number,
		) => void,
	) {}

	private readonly ignored =
		/(^|[\\/])(?:node_modules|\.git|\.next|dist|build|coverage|out|vendor|target|__pycache__|\.turbo|\.cache|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.venv)([\\/]|$)/;

	provideLinks(
		bufferLineNumber: number,
		callback: (links: ILink[] | undefined) => void,
	): void {
		const lineIndex = bufferLineNumber - 1;
		const line = this.terminal.buffer.active.getLine(lineIndex);
		if (!line) {
			callback(undefined);
			return;
		}

		const lineText = line.translateToString(true);
		const lineLength = lineText.length;
		const isCurrentLineWrapped = line.isWrapped;

		// Get previous line if current is wrapped (for handling wrapped paths)
		const prevLine = isCurrentLineWrapped
			? this.terminal.buffer.active.getLine(lineIndex - 1)
			: null;
		const prevLineText = prevLine ? prevLine.translateToString(true) : "";
		const prevLineLength = prevLineText.length;

		// Get next line if it's wrapped (for handling wrapped paths)
		const nextLine = this.terminal.buffer.active.getLine(lineIndex + 1);
		const nextLineIsWrapped = nextLine?.isWrapped ?? false;
		const nextLineText =
			nextLineIsWrapped && nextLine ? nextLine.translateToString(true) : "";

		// Combine lines for multi-line path detection
		const combinedText = prevLineText + lineText + nextLineText;
		const currentLineOffset = prevLineLength;

		// Use VSCode's link detection
		const os = getCurrentOS();
		const detectedLinks = detectLinks(combinedText, os);

		const links: ILink[] = [];

		for (let parsedLink of detectedLinks) {
			// Strip trailing punctuation from paths without suffixes
			// (paths with suffixes like :42 already have proper boundaries)
			if (!parsedLink.suffix) {
				parsedLink = this.stripTrailingPunctuation(parsedLink, combinedText);
			}

			// Calculate the full link range including prefix and suffix
			const linkStart = parsedLink.prefix?.index ?? parsedLink.path.index;
			const linkEnd = parsedLink.suffix
				? parsedLink.suffix.suffix.index + parsedLink.suffix.suffix.text.length
				: parsedLink.path.index + parsedLink.path.text.length;

			// Check if this link overlaps with the current line
			const currentLineStart = currentLineOffset;
			const currentLineEnd = currentLineOffset + lineLength;

			if (linkEnd <= currentLineStart || linkStart >= currentLineEnd) {
				continue;
			}

			// Get the path text (without suffix for opening)
			const pathText = parsedLink.path.text;

			// Skip URLs
			if (this.isUrl(pathText, linkStart, combinedText)) {
				continue;
			}

			// Skip noisy/ignored paths (common build artifacts, deps, etc.)
			if (this.shouldSkipPath(pathText)) {
				continue;
			}

			// Skip version strings like v1.2.3
			if (this.isVersionString(pathText)) {
				continue;
			}

			// Skip npm package references like @scope/package@1.2.3
			if (this.isNpmPackageReference(pathText, linkStart, combinedText)) {
				continue;
			}

			// Skip pure numeric patterns
			if (/^\d+(:\d+)*$/.test(pathText)) {
				continue;
			}

			// Skip numeric ratio-ish patterns like 1/2, 10/20/30
			if (/^\d+(?:\/\d+)+$/.test(pathText)) {
				continue;
			}

			// Require an explicit path prefix (./, ../, ~/, /, drive, UNC, file://) OR a filename
			// that looks like a real file (basename contains a dot). This prevents linkifying
			// generic "word/word" fragments and random "foo 123:456" suffix matches.
			if (!this.isExplicitPath(pathText) && !this.hasDotBasename(pathText)) {
				continue;
			}

			// Calculate the range for highlighting
			const range = this.calculateLinkRange(
				linkStart,
				linkEnd,
				prevLineLength,
				lineLength,
				bufferLineNumber,
				isCurrentLineWrapped,
				nextLineIsWrapped,
			);

			// Build the full link text for display
			const fullLinkText = combinedText.substring(linkStart, linkEnd);

			links.push({
				range,
				text: fullLinkText,
				activate: (event: MouseEvent) => {
					this.handleActivation(event, parsedLink);
				},
			});
		}

		// If no links found via primary detection, try fallback matchers
		// These catch special formats like Python errors, Rust errors, etc.
		if (links.length === 0) {
			const fallbackLinks = detectFallbackLinks(combinedText);
			for (const fallback of fallbackLinks) {
				if (this.shouldSkipPath(fallback.path)) {
					continue;
				}
				if (!this.isExplicitPath(fallback.path) && !this.hasDotBasename(fallback.path)) {
					continue;
				}

				const linkStart = fallback.index;
				const linkEnd = fallback.index + fallback.link.length;

				// Check if this link overlaps with the current line
				const fbCurrentLineStart = currentLineOffset;
				const fbCurrentLineEnd = currentLineOffset + lineLength;
				if (linkEnd <= fbCurrentLineStart || linkStart >= fbCurrentLineEnd) {
					continue;
				}

				// Calculate the range for highlighting
				const range = this.calculateLinkRange(
					linkStart,
					linkEnd,
					prevLineLength,
					lineLength,
					bufferLineNumber,
					isCurrentLineWrapped,
					nextLineIsWrapped,
				);

				links.push({
					range,
					text: fallback.link,
					activate: (event: MouseEvent) => {
						this.handleFallbackActivation(event, fallback);
					},
				});
			}
		}

		callback(links.length > 0 ? links : undefined);
	}

	private shouldSkipPath(pathText: string): boolean {
		// Common shell devices/redirections that are rarely useful to open.
		if (pathText === "/dev/null" || pathText.startsWith("/dev/fd/")) {
			return true;
		}

		// CLI flags/globs frequently get mis-detected via "suffix" parsing, eg:
		// --include="*.test.ts" 2>/dev/null
		if (/^--?[a-zA-Z0-9][a-zA-Z0-9_-]*(?:=|$)/.test(pathText)) {
			return true;
		}
		if (/[*?[\]]/.test(pathText)) {
			return true;
		}

		if (pathText.startsWith("node:")) {
			return true;
		}
		return this.ignored.test(pathText);
	}

	private isExplicitPath(pathText: string): boolean {
		// unix-ish + file:// + windows drive + UNC
		return /^(?:file:\/\/\/|~\/|\.{1,2}\/|\/|\\\\|[a-zA-Z]:[\\/])/.test(
			pathText,
		);
	}

	private hasDotBasename(pathText: string): boolean {
		const base = pathText.split(/[\\/]/).pop() ?? "";
		if (!base.includes(".")) {
			return false;
		}
		const i = base.lastIndexOf(".");
		if (i === -1 || i === base.length - 1) {
			return false;
		}
		// Avoid treating "foo." as a file; require at least one letter in the suffix.
		return /[a-zA-Z]/.test(base.slice(i + 1));
	}

	/**
	 * Strip trailing punctuation from a link that has no suffix.
	 * This handles cases like "See ./path/file." where the period is sentence punctuation,
	 * not part of the path.
	 */
	private stripTrailingPunctuation(
		parsedLink: IParsedLink,
		combinedText: string,
	): IParsedLink {
		const pathText = parsedLink.path.text;
		const linkEnd = parsedLink.path.index + pathText.length;

		// Check if the path ends with common sentence punctuation
		// Only strip if followed by whitespace or end of line (to avoid stripping valid extensions)
		const trailingPunctMatch = pathText.match(/([.,;:!?)]+)$/);
		if (trailingPunctMatch) {
			const punct = trailingPunctMatch[1];
			const afterPunct = combinedText[linkEnd];

			// Only strip if followed by whitespace, end of string, or another punctuation
			if (
				afterPunct === undefined ||
				/\s/.test(afterPunct) ||
				afterPunct === '"' ||
				afterPunct === "'"
			) {
				// Don't strip if it looks like a file extension (e.g., "file.ts")
				// A period followed by 1-4 alphanumeric characters at the end is likely an extension
				if (punct === "." && /\.[a-zA-Z0-9]{1,4}$/.test(pathText)) {
					return parsedLink;
				}

				return {
					...parsedLink,
					path: {
						index: parsedLink.path.index,
						text: pathText.slice(0, -punct.length),
					},
				};
			}
		}

		return parsedLink;
	}

	private isUrl(
		pathText: string,
		linkStart: number,
		combinedText: string,
	): boolean {
		if (
			pathText.startsWith("http://") ||
			pathText.startsWith("https://") ||
			pathText.startsWith("ftp://")
		) {
			return true;
		}

		// Check if this is part of a URL (e.g., the path portion after ://)
		// detectLinks() with Windows OS mode may only capture "/host/path" from "http://host/path"
		// because the Windows regex consumes the leading slashes differently. We look at the
		// context around linkStart to detect the "://" scheme separator.
		if (linkStart >= 1) {
			const contextStart = Math.max(0, linkStart - 10);
			const context = combinedText.substring(contextStart, linkStart + 1);
			if (/https?:\/\//.test(context) || /ftp:\/\//.test(context)) {
				return true;
			}
		}

		return false;
	}

	private isVersionString(pathText: string): boolean {
		// Match version strings like 1.2.3, v1.2.3, 1.2.3.4
		return /^v?\d+\.\d+(\.\d+)*$/.test(pathText);
	}

	private isNpmPackageReference(
		pathText: string,
		linkStart: number,
		combinedText: string,
	): boolean {
		// Check context for npm package patterns like @scope/package@1.2.3
		const contextStart = Math.max(0, linkStart - 30);
		const contextEnd = linkStart + pathText.length;
		const context = combinedText.substring(contextStart, contextEnd);
		return /@\d+\.\d+/.test(context);
	}

	private handleActivation(event: MouseEvent, parsedLink: IParsedLink): void {
		if (!event.metaKey && !event.ctrlKey) {
			return;
		}

		event.preventDefault();

		const pathText = parsedLink.path.text;

		// Clean up the path - remove any remaining suffix patterns that might have been
		// included (defensive, since detectLinks should handle this)
		let cleanPath = removeLinkSuffix(pathText);

		if (!cleanPath) {
			return;
		}

		// Decode URL-encoded characters (e.g., %3A -> :, %20 -> space)
		cleanPath = decodeUrlEncodedPath(cleanPath);

		// Extract line/column info from suffix, or try to parse from URL-encoded path
		let line = parsedLink.suffix?.row;
		let column = parsedLink.suffix?.col;
		const lineEnd = parsedLink.suffix?.rowEnd;
		const columnEnd = parsedLink.suffix?.colEnd;

		// If no suffix was detected, check if the decoded path contains line:col info
		if (line === undefined) {
			const lineColMatch = cleanPath.match(/:(\d+)(?::(\d+))?$/);
			if (lineColMatch) {
				cleanPath = cleanPath.replace(/:(\d+)(?::(\d+))?$/, "");
				line = Number.parseInt(lineColMatch[1], 10);
				if (lineColMatch[2]) {
					column = Number.parseInt(lineColMatch[2], 10);
				}
			}
		}

		this.onOpen(event, cleanPath, line, column, lineEnd, columnEnd);
	}

	private handleFallbackActivation(
		event: MouseEvent,
		fallback: IFallbackLink,
	): void {
		if (!event.metaKey && !event.ctrlKey) {
			return;
		}

		event.preventDefault();

		const cleanPath = decodeUrlEncodedPath(fallback.path);

		if (!cleanPath) {
			return;
		}

		this.onOpen(event, cleanPath, fallback.line, fallback.col);
	}

	private calculateLinkRange(
		matchIndex: number,
		matchEnd: number,
		prevLineLength: number,
		lineLength: number,
		bufferLineNumber: number,
		isCurrentLineWrapped: boolean,
		nextLineIsWrapped: boolean,
	): ILink["range"] {
		const currentLineStart = prevLineLength;
		const currentLineEnd = prevLineLength + lineLength;

		const startsInPrevLine =
			isCurrentLineWrapped && matchIndex < currentLineStart;
		const endsInNextLine = nextLineIsWrapped && matchEnd > currentLineEnd;

		let startY: number;
		let startX: number;
		let endY: number;
		let endX: number;

		if (startsInPrevLine) {
			startY = bufferLineNumber - 1;
			startX = matchIndex + 1;
		} else {
			startY = bufferLineNumber;
			startX = matchIndex - currentLineStart + 1;
		}

		if (endsInNextLine) {
			endY = bufferLineNumber + 1;
			endX = matchEnd - currentLineEnd + 1;
		} else if (matchEnd <= currentLineStart) {
			endY = bufferLineNumber - 1;
			endX = matchEnd + 1;
		} else {
			endY = bufferLineNumber;
			endX = matchEnd - currentLineStart + 1;
		}

		return {
			start: { x: startX, y: startY },
			end: { x: endX, y: endY },
		};
	}
}
