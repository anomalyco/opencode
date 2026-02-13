/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *
 *  Ported from VSCode's terminalLinkParsing.ts
 *  https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminalContrib/links/browser/terminalLinkParsing.ts
 *--------------------------------------------------------------------------------------------*/

/**
 * This module is responsible for parsing possible links out of lines with only access to the line
 * text and the target operating system, ie. it does not do any validation that paths actually
 * exist.
 */

export enum OperatingSystem {
	Windows = 1,
	Macintosh = 2,
	Linux = 3,
}

export interface IParsedLink {
	path: ILinkPartialRange;
	prefix?: ILinkPartialRange;
	suffix?: ILinkSuffix;
}

export interface ILinkSuffix {
	row: number | undefined;
	col: number | undefined;
	rowEnd: number | undefined;
	colEnd: number | undefined;
	suffix: ILinkPartialRange;
}

export interface ILinkPartialRange {
	index: number;
	text: string;
}

/**
 * A simple lazy value implementation.
 */
class Lazy<T> {
	private _value: T | undefined;
	private _isInitialized = false;

	constructor(private readonly _factory: () => T) {}

	get value(): T {
		if (!this._isInitialized) {
			this._value = this._factory();
			this._isInitialized = true;
		}
		// biome-ignore lint/style/noNonNullAssertion: value is guaranteed to be set after initialization
		return this._value!;
	}
}

/**
 * A regex that extracts the link suffix which contains line and column information. The link suffix
 * must terminate at the end of line.
 */
const linkSuffixRegexEol = new Lazy<RegExp>(() =>
	generateLinkSuffixRegex(true),
);
/**
 * A regex that extracts the link suffix which contains line and column information.
 */
const linkSuffixRegex = new Lazy<RegExp>(() => generateLinkSuffixRegex(false));

function generateLinkSuffixRegex(eolOnly: boolean) {
	let ri = 0;
	let ci = 0;
	let rei = 0;
	let cei = 0;
	function r(): string {
		return `(?<row${ri++}>\\d+)`;
	}
	function c(): string {
		return `(?<col${ci++}>\\d+)`;
	}
	function re(): string {
		return `(?<rowEnd${rei++}>\\d+)`;
	}
	function ce(): string {
		return `(?<colEnd${cei++}>\\d+)`;
	}

	const eolSuffix = eolOnly ? "$" : "";

	// The comments in the regex below use real strings/numbers for better readability, here's
	// the legend:
	// - Path    = foo
	// - Row     = 339
	// - Col     = 12
	// - RowEnd  = 341
	// - ColEnd  = 789
	//
	// These all support single quote ' in the place of " and [] in the place of ()
	//
	// See the tests for an exhaustive list of all supported formats
	const lineAndColumnRegexClauses = [
		// foo:339
		// foo:339:12
		// foo:339:12-789
		// foo:339:12-341.789
		// foo:339.12
		// foo 339
		// foo 339:12                              [#140780]
		// foo 339.12
		// foo#339
		// foo#339:12                              [#190288]
		// foo#339.12
		// foo, 339                                [#217927]
		// "foo",339
		// "foo",339:12
		// "foo",339.12
		// "foo",339.12-789
		// "foo",339.12-341.789
		`(?::|#| |['"],|, )${r()}([:.]${c()}(?:-(?:${re()}\\.)?${ce()})?)?${eolSuffix}`,
		// The quotes below are optional           [#171652]
		// "foo", line 339                         [#40468]
		// "foo", line 339, col 12
		// "foo", line 339, column 12
		// "foo":line 339
		// "foo":line 339, col 12
		// "foo":line 339, column 12
		// "foo": line 339
		// "foo": line 339, col 12
		// "foo": line 339, column 12
		// "foo" on line 339
		// "foo" on line 339, col 12
		// "foo" on line 339, column 12
		// "foo" line 339 column 12
		// "foo", line 339, character 12           [#171880]
		// "foo", line 339, characters 12-789      [#171880]
		// "foo", lines 339-341                    [#171880]
		// "foo", lines 339-341, characters 12-789 [#178287]
		`['"]?(?:,? |: ?| on )lines? ${r()}(?:-${re()})?(?:,? (?:col(?:umn)?|characters?) ${c()}(?:-${ce()})?)?${eolSuffix}`,
		// () and [] are interchangeable
		// foo(339)
		// foo(339,12)
		// foo(339, 12)
		// foo (339)
		// foo (339,12)
		// foo (339, 12)
		// foo: (339)
		// foo: (339,12)
		// foo: (339, 12)
		// foo(339:12)                             [#229842]
		// foo (339:12)                            [#229842]
		`:? ?[[(]${r()}(?:(?:, ?|:)${c()})?[\\])]${eolSuffix}`,
	];

	const suffixClause = lineAndColumnRegexClauses
		// Join all clauses together
		.join("|")
		// Convert spaces to allow the non-breaking space char (ascii 160)
		.replace(/ /g, `[\u00A0 ]`);

	return new RegExp(`(${suffixClause})`, eolOnly ? undefined : "g");
}

/**
 * Removes the optional link suffix which contains line and column information.
 * @param link The link to use.
 */
export function removeLinkSuffix(link: string): string {
	const suffix = getLinkSuffix(link)?.suffix;
	if (!suffix) {
		return link;
	}
	return link.substring(0, suffix.index);
}

/**
 * Removes any query string from the link.
 * @param link The link to use.
 */
export function removeLinkQueryString(link: string): string {
	// Skip ? in UNC paths
	const start = link.startsWith("\\\\?\\") ? 4 : 0;
	const index = link.indexOf("?", start);
	if (index === -1) {
		return link;
	}
	return link.substring(0, index);
}

export function detectLinkSuffixes(line: string): ILinkSuffix[] {
	// Find all suffixes on the line. Since the regex global flag is used, lastIndex will be updated
	// in place such that there are no overlapping matches.
	const results: ILinkSuffix[] = [];
	linkSuffixRegex.value.lastIndex = 0;
	let match: RegExpExecArray | null = linkSuffixRegex.value.exec(line);
	while (match !== null) {
		const suffix = toLinkSuffix(match);
		if (suffix === null) {
			break;
		}
		results.push(suffix);
		match = linkSuffixRegex.value.exec(line);
	}
	return results;
}

/**
 * Returns the optional link suffix which contains line and column information.
 * @param link The link to parse.
 */
export function getLinkSuffix(link: string): ILinkSuffix | null {
	return toLinkSuffix(linkSuffixRegexEol.value.exec(link));
}

/**
 * Decode URL-encoded characters in a path.
 * Common encodings: %3A -> :, %20 -> space, %2F -> /
 */
export function decodeUrlEncodedPath(path: string): string {
	try {
		if (path.includes("%")) {
			return decodeURIComponent(path);
		}
		return path;
	} catch {
		// If decoding fails (malformed %), return original path
		return path;
	}
}

/**
 * Get the current operating system.
 * Works in browser environments (uses navigator.platform) or defaults to Linux.
 * For Node.js environments, you should pass the OS directly to detectLinks.
 */
export function getCurrentOS(): OperatingSystem {
	if (typeof navigator !== "undefined" && navigator.platform) {
		const platform = navigator.platform.toLowerCase();
		if (platform.includes("win")) {
			return OperatingSystem.Windows;
		}
		if (platform.includes("mac")) {
			return OperatingSystem.Macintosh;
		}
	}
	// Default to Linux for server environments
	return OperatingSystem.Linux;
}

export function toLinkSuffix(
	match: RegExpExecArray | null,
): ILinkSuffix | null {
	const groups = match?.groups;
	if (!groups || match.length < 1) {
		return null;
	}
	return {
		row: parseIntOptional(groups.row0 || groups.row1 || groups.row2),
		col: parseIntOptional(groups.col0 || groups.col1 || groups.col2),
		rowEnd: parseIntOptional(
			groups.rowEnd0 || groups.rowEnd1 || groups.rowEnd2,
		),
		colEnd: parseIntOptional(
			groups.colEnd0 || groups.colEnd1 || groups.colEnd2,
		),
		suffix: { index: match.index, text: match[0] },
	};
}

function parseIntOptional(value: string | undefined): number | undefined {
	if (value === undefined) {
		return value;
	}
	return Number.parseInt(value, 10);
}

// This defines valid path characters for a link with a suffix, the first `[]` of the regex includes
// characters the path is not allowed to _start_ with, the second `[]` includes characters not
// allowed at all in the path. If the characters show up in both regexes the link will stop at that
// character, otherwise it will stop at a space character.
const linkWithSuffixPathCharacters =
	/(?<path>(?:file:\/\/\/)?[^\s|<>[({][^\s|<>]*)$/;

export function detectLinks(line: string, os: OperatingSystem): IParsedLink[] {
	// 1: Detect all links on line via suffixes first
	const results = detectLinksViaSuffix(line);

	// 2: Detect all links without suffixes and merge non-conflicting ranges into the results
	const noSuffixPaths = detectPathsNoSuffix(line, os);
	binaryInsertList(results, noSuffixPaths);

	return results;
}

function binaryInsertList(list: IParsedLink[], newItems: IParsedLink[]) {
	if (list.length === 0) {
		list.push(...newItems);
		return;
	}
	for (const item of newItems) {
		binaryInsert(list, item, 0, list.length);
	}
}

function binaryInsert(
	list: IParsedLink[],
	newItem: IParsedLink,
	low: number,
	high: number,
): void {
	if (list.length === 0) {
		list.push(newItem);
		return;
	}
	if (low > high) {
		return;
	}
	// Find the index where the newItem would be inserted
	const mid = Math.floor((low + high) / 2);
	const midItem = list[mid];
	const prevItem = mid > 0 ? list[mid - 1] : undefined;

	if (
		mid >= list.length ||
		(midItem &&
			newItem.path.index < midItem.path.index &&
			(mid === 0 || (prevItem && newItem.path.index > prevItem.path.index)))
	) {
		// Check if it conflicts with an existing link before adding
		if (
			mid >= list.length ||
			(midItem &&
				newItem.path.index + newItem.path.text.length < midItem.path.index &&
				(mid === 0 ||
					(prevItem &&
						newItem.path.index >
							prevItem.path.index + prevItem.path.text.length)))
		) {
			list.splice(mid, 0, newItem);
		}
		return;
	}
	if (midItem && newItem.path.index > midItem.path.index) {
		binaryInsert(list, newItem, mid + 1, high);
	} else {
		binaryInsert(list, newItem, low, mid - 1);
	}
}

function detectLinksViaSuffix(line: string): IParsedLink[] {
	const results: IParsedLink[] = [];

	// 1: Detect link suffixes on the line
	const suffixes = detectLinkSuffixes(line);
	for (const suffix of suffixes) {
		const beforeSuffix = line.substring(0, suffix.suffix.index);
		const possiblePathMatch = beforeSuffix.match(linkWithSuffixPathCharacters);
		if (
			possiblePathMatch &&
			possiblePathMatch.index !== undefined &&
			possiblePathMatch.groups?.path
		) {
			let linkStartIndex = possiblePathMatch.index;
			let path = possiblePathMatch.groups.path;
			// Extract a path prefix if it exists (not part of the path, but part of the underlined
			// section)
			let prefix: ILinkPartialRange | undefined;
			const prefixMatch = path.match(/^(?<prefix>['"]+)/);
			if (prefixMatch?.groups?.prefix) {
				prefix = {
					index: linkStartIndex,
					text: prefixMatch.groups.prefix,
				};
				path = path.substring(prefix.text.length);

				// Don't allow suffix links to be returned when the link itself is the empty string
				if (path.trim().length === 0) {
					continue;
				}

				// If there are multiple characters in the prefix, trim the prefix if the _first_
				// suffix character is the same as the last prefix character. For example, for the
				// text `echo "'foo' on line 1"`:
				//
				// - Prefix='
				// - Path=foo
				// - Suffix=' on line 1
				//
				// If this fails on a multi-character prefix, just keep the original.
				if (prefixMatch.groups.prefix.length > 1) {
					const suffixFirstChar = suffix.suffix.text[0];
					const prefixLastChar =
						prefixMatch.groups.prefix[prefixMatch.groups.prefix.length - 1];
					if (
						suffixFirstChar &&
						prefixLastChar &&
						suffixFirstChar.match(/['"]/) &&
						prefixLastChar === suffixFirstChar
					) {
						const trimPrefixAmount = prefixMatch.groups.prefix.length - 1;
						prefix.index += trimPrefixAmount;
						prefix.text = prefixLastChar;
						linkStartIndex += trimPrefixAmount;
					}
				}
			}
			results.push({
				path: {
					index: linkStartIndex + (prefix?.text.length || 0),
					text: path,
				},
				prefix,
				suffix,
			});

			// If the path contains an opening bracket, provide the path starting immediately after
			// the opening bracket as an additional result
			const openingBracketMatch = path.matchAll(/(?<bracket>[[({])(?![\])])/g);
			for (const match of openingBracketMatch) {
				const bracket = match.groups?.bracket;
				if (bracket) {
					results.push({
						path: {
							index:
								linkStartIndex + (prefix?.text.length || 0) + match.index + 1,
							text: path.substring(match.index + bracket.length),
						},
						prefix,
						suffix,
					});
				}
			}
		}
	}

	return results;
}

enum RegexPathConstants {
	PathPrefix = "(?:\\.\\.?|\\~|file:\\/\\/)",
	PathSeparatorClause = "\\/",
	// '":; are allowed in paths but they are often separators so ignore them
	// Also disallow \\ to prevent a catastropic backtracking case #24795
	ExcludedPathCharactersClause = "[^\\0<>\\?\\s!`&*()'\";:\\\\]",
	ExcludedStartPathCharactersClause = "[^\\0<>\\?\\s!`&*()\\[\\]'\";:\\\\]",

	WinOtherPathPrefix = "\\.\\.?|\\~",
	WinPathSeparatorClause = "(?:\\\\|\\/)",
	WinExcludedPathCharactersClause = "[^\\0<>\\?\\|\\/\\s!`&*()'\";:]",
	WinExcludedStartPathCharactersClause = "[^\\0<>\\?\\|\\/\\s!`&*()\\[\\]'\";:]",
}

/**
 * A regex that matches non-Windows paths, such as `/foo`, `~/foo`, `./foo`, `../foo` and
 * `foo/bar`.
 */
const unixLocalLinkClause = `(?:(?:${RegexPathConstants.PathPrefix}|(?:${RegexPathConstants.ExcludedStartPathCharactersClause}${RegexPathConstants.ExcludedPathCharactersClause}*))?(?:${RegexPathConstants.PathSeparatorClause}(?:${RegexPathConstants.ExcludedPathCharactersClause})+)+)`;

/**
 * A regex clause that matches the start of an absolute path on Windows, such as: `C:`, `c:`,
 * `file:///c:` (uri) and `\\?\C:` (UNC path).
 */
export const winDrivePrefix = "(?:\\\\\\\\\\?\\\\|file:\\/\\/\\/)?[a-zA-Z]:";

/**
 * A regex that matches Windows paths, such as `\\?\c:\foo`, `c:\foo`, `~\foo`, `.\foo`, `..\foo`
 * and `foo\bar`.
 */
const winLocalLinkClause = `(?:(?:(?:${winDrivePrefix}|${RegexPathConstants.WinOtherPathPrefix})|(?:${RegexPathConstants.WinExcludedStartPathCharactersClause}${RegexPathConstants.WinExcludedPathCharactersClause}*))?(?:${RegexPathConstants.WinPathSeparatorClause}(?:${RegexPathConstants.WinExcludedPathCharactersClause})+)+)`;

function detectPathsNoSuffix(line: string, os: OperatingSystem): IParsedLink[] {
	const results: IParsedLink[] = [];

	const regex = new RegExp(
		os === OperatingSystem.Windows ? winLocalLinkClause : unixLocalLinkClause,
		"g",
	);
	let match: RegExpExecArray | null = regex.exec(line);
	while (match !== null) {
		let text = match[0];
		let index = match.index;
		if (!text) {
			// Something matched but does not comply with the given match index, since this would
			// most likely a bug the regex itself we simply do nothing here
			break;
		}

		// Adjust the link range to exclude a/ and b/ if it looks like a git diff
		if (
			// --- a/foo/bar
			// +++ b/foo/bar
			((line.startsWith("--- a/") || line.startsWith("+++ b/")) &&
				index === 4) ||
			// diff --git a/foo/bar b/foo/bar
			(line.startsWith("diff --git") &&
				(text.startsWith("a/") || text.startsWith("b/")))
		) {
			text = text.substring(2);
			index += 2;
		}

		results.push({
			path: {
				index,
				text,
			},
			prefix: undefined,
			suffix: undefined,
		});

		match = regex.exec(line);
	}

	return results;
}
