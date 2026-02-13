/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *
 *  Ported from VSCode's terminalLinkParsing.test.ts
 *  https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminalContrib/links/test/browser/terminalLinkParsing.test.ts
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from "bun:test";
import {
	detectLinkSuffixes,
	detectLinks,
	getLinkSuffix,
	type ILinkSuffix,
	type IParsedLink,
	OperatingSystem,
	removeLinkQueryString,
	removeLinkSuffix,
} from "./index";

interface ITestLink {
	link: string;
	prefix: string | undefined;
	suffix: string | undefined;
	hasRow: boolean;
	hasCol: boolean;
	hasRowEnd?: boolean;
	hasColEnd?: boolean;
}

const operatingSystems: ReadonlyArray<OperatingSystem> = [
	OperatingSystem.Linux,
	OperatingSystem.Macintosh,
	OperatingSystem.Windows,
];
const osTestPath: Record<OperatingSystem, string> = {
	[OperatingSystem.Linux]: "/test/path/linux",
	[OperatingSystem.Macintosh]: "/test/path/macintosh",
	[OperatingSystem.Windows]: "C:\\test\\path\\windows",
};
const osLabel: Record<OperatingSystem, string> = {
	[OperatingSystem.Linux]: "[Linux]",
	[OperatingSystem.Macintosh]: "[macOS]",
	[OperatingSystem.Windows]: "[Windows]",
};

const testRow = 339;
const testCol = 12;
const testRowEnd = 341;
const testColEnd = 789;
const testLinks: ITestLink[] = [
	// Simple
	{
		link: "foo",
		prefix: undefined,
		suffix: undefined,
		hasRow: false,
		hasCol: false,
	},
	{
		link: "foo:339",
		prefix: undefined,
		suffix: ":339",
		hasRow: true,
		hasCol: false,
	},
	{
		link: "foo:339:12",
		prefix: undefined,
		suffix: ":339:12",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo:339:12-789",
		prefix: undefined,
		suffix: ":339:12-789",
		hasRow: true,
		hasCol: true,
		hasRowEnd: false,
		hasColEnd: true,
	},
	{
		link: "foo:339.12",
		prefix: undefined,
		suffix: ":339.12",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo:339.12-789",
		prefix: undefined,
		suffix: ":339.12-789",
		hasRow: true,
		hasCol: true,
		hasRowEnd: false,
		hasColEnd: true,
	},
	{
		link: "foo:339.12-341.789",
		prefix: undefined,
		suffix: ":339.12-341.789",
		hasRow: true,
		hasCol: true,
		hasRowEnd: true,
		hasColEnd: true,
	},
	{
		link: "foo#339",
		prefix: undefined,
		suffix: "#339",
		hasRow: true,
		hasCol: false,
	},
	{
		link: "foo#339:12",
		prefix: undefined,
		suffix: "#339:12",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo#339:12-789",
		prefix: undefined,
		suffix: "#339:12-789",
		hasRow: true,
		hasCol: true,
		hasRowEnd: false,
		hasColEnd: true,
	},
	{
		link: "foo#339.12",
		prefix: undefined,
		suffix: "#339.12",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo#339.12-789",
		prefix: undefined,
		suffix: "#339.12-789",
		hasRow: true,
		hasCol: true,
		hasRowEnd: false,
		hasColEnd: true,
	},
	{
		link: "foo#339.12-341.789",
		prefix: undefined,
		suffix: "#339.12-341.789",
		hasRow: true,
		hasCol: true,
		hasRowEnd: true,
		hasColEnd: true,
	},
	{
		link: "foo 339",
		prefix: undefined,
		suffix: " 339",
		hasRow: true,
		hasCol: false,
	},
	{
		link: "foo 339:12",
		prefix: undefined,
		suffix: " 339:12",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo 339:12-789",
		prefix: undefined,
		suffix: " 339:12-789",
		hasRow: true,
		hasCol: true,
		hasRowEnd: false,
		hasColEnd: true,
	},
	{
		link: "foo 339.12",
		prefix: undefined,
		suffix: " 339.12",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo 339.12-789",
		prefix: undefined,
		suffix: " 339.12-789",
		hasRow: true,
		hasCol: true,
		hasRowEnd: false,
		hasColEnd: true,
	},
	{
		link: "foo 339.12-341.789",
		prefix: undefined,
		suffix: " 339.12-341.789",
		hasRow: true,
		hasCol: true,
		hasRowEnd: true,
		hasColEnd: true,
	},
	{
		link: "foo, 339",
		prefix: undefined,
		suffix: ", 339",
		hasRow: true,
		hasCol: false,
	},

	// Double quotes
	{
		link: '"foo",339',
		prefix: '"',
		suffix: '",339',
		hasRow: true,
		hasCol: false,
	},
	{
		link: '"foo",339:12',
		prefix: '"',
		suffix: '",339:12',
		hasRow: true,
		hasCol: true,
	},
	{
		link: '"foo",339.12',
		prefix: '"',
		suffix: '",339.12',
		hasRow: true,
		hasCol: true,
	},
	{
		link: '"foo", line 339',
		prefix: '"',
		suffix: '", line 339',
		hasRow: true,
		hasCol: false,
	},
	{
		link: '"foo", line 339, col 12',
		prefix: '"',
		suffix: '", line 339, col 12',
		hasRow: true,
		hasCol: true,
	},
	{
		link: '"foo", line 339, column 12',
		prefix: '"',
		suffix: '", line 339, column 12',
		hasRow: true,
		hasCol: true,
	},
	{
		link: '"foo":line 339',
		prefix: '"',
		suffix: '":line 339',
		hasRow: true,
		hasCol: false,
	},
	{
		link: '"foo":line 339, col 12',
		prefix: '"',
		suffix: '":line 339, col 12',
		hasRow: true,
		hasCol: true,
	},
	{
		link: '"foo":line 339, column 12',
		prefix: '"',
		suffix: '":line 339, column 12',
		hasRow: true,
		hasCol: true,
	},
	{
		link: '"foo": line 339',
		prefix: '"',
		suffix: '": line 339',
		hasRow: true,
		hasCol: false,
	},
	{
		link: '"foo": line 339, col 12',
		prefix: '"',
		suffix: '": line 339, col 12',
		hasRow: true,
		hasCol: true,
	},
	{
		link: '"foo": line 339, column 12',
		prefix: '"',
		suffix: '": line 339, column 12',
		hasRow: true,
		hasCol: true,
	},
	{
		link: '"foo" on line 339',
		prefix: '"',
		suffix: '" on line 339',
		hasRow: true,
		hasCol: false,
	},
	{
		link: '"foo" on line 339, col 12',
		prefix: '"',
		suffix: '" on line 339, col 12',
		hasRow: true,
		hasCol: true,
	},
	{
		link: '"foo" on line 339, column 12',
		prefix: '"',
		suffix: '" on line 339, column 12',
		hasRow: true,
		hasCol: true,
	},
	{
		link: '"foo" line 339',
		prefix: '"',
		suffix: '" line 339',
		hasRow: true,
		hasCol: false,
	},
	{
		link: '"foo" line 339 column 12',
		prefix: '"',
		suffix: '" line 339 column 12',
		hasRow: true,
		hasCol: true,
	},

	// Single quotes
	{
		link: "'foo',339",
		prefix: "'",
		suffix: "',339",
		hasRow: true,
		hasCol: false,
	},
	{
		link: "'foo',339:12",
		prefix: "'",
		suffix: "',339:12",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "'foo',339.12",
		prefix: "'",
		suffix: "',339.12",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "'foo', line 339",
		prefix: "'",
		suffix: "', line 339",
		hasRow: true,
		hasCol: false,
	},
	{
		link: "'foo', line 339, col 12",
		prefix: "'",
		suffix: "', line 339, col 12",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "'foo', line 339, column 12",
		prefix: "'",
		suffix: "', line 339, column 12",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "'foo':line 339",
		prefix: "'",
		suffix: "':line 339",
		hasRow: true,
		hasCol: false,
	},
	{
		link: "'foo':line 339, col 12",
		prefix: "'",
		suffix: "':line 339, col 12",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "'foo':line 339, column 12",
		prefix: "'",
		suffix: "':line 339, column 12",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "'foo': line 339",
		prefix: "'",
		suffix: "': line 339",
		hasRow: true,
		hasCol: false,
	},
	{
		link: "'foo': line 339, col 12",
		prefix: "'",
		suffix: "': line 339, col 12",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "'foo': line 339, column 12",
		prefix: "'",
		suffix: "': line 339, column 12",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "'foo' on line 339",
		prefix: "'",
		suffix: "' on line 339",
		hasRow: true,
		hasCol: false,
	},
	{
		link: "'foo' on line 339, col 12",
		prefix: "'",
		suffix: "' on line 339, col 12",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "'foo' on line 339, column 12",
		prefix: "'",
		suffix: "' on line 339, column 12",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "'foo' line 339",
		prefix: "'",
		suffix: "' line 339",
		hasRow: true,
		hasCol: false,
	},
	{
		link: "'foo' line 339 column 12",
		prefix: "'",
		suffix: "' line 339 column 12",
		hasRow: true,
		hasCol: true,
	},

	// No quotes
	{
		link: "foo, line 339",
		prefix: undefined,
		suffix: ", line 339",
		hasRow: true,
		hasCol: false,
	},
	{
		link: "foo, line 339, col 12",
		prefix: undefined,
		suffix: ", line 339, col 12",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo, line 339, column 12",
		prefix: undefined,
		suffix: ", line 339, column 12",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo:line 339",
		prefix: undefined,
		suffix: ":line 339",
		hasRow: true,
		hasCol: false,
	},
	{
		link: "foo:line 339, col 12",
		prefix: undefined,
		suffix: ":line 339, col 12",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo:line 339, column 12",
		prefix: undefined,
		suffix: ":line 339, column 12",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo: line 339",
		prefix: undefined,
		suffix: ": line 339",
		hasRow: true,
		hasCol: false,
	},
	{
		link: "foo: line 339, col 12",
		prefix: undefined,
		suffix: ": line 339, col 12",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo: line 339, column 12",
		prefix: undefined,
		suffix: ": line 339, column 12",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo on line 339",
		prefix: undefined,
		suffix: " on line 339",
		hasRow: true,
		hasCol: false,
	},
	{
		link: "foo on line 339, col 12",
		prefix: undefined,
		suffix: " on line 339, col 12",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo on line 339, column 12",
		prefix: undefined,
		suffix: " on line 339, column 12",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo line 339",
		prefix: undefined,
		suffix: " line 339",
		hasRow: true,
		hasCol: false,
	},
	{
		link: "foo line 339 column 12",
		prefix: undefined,
		suffix: " line 339 column 12",
		hasRow: true,
		hasCol: true,
	},

	// Parentheses
	{
		link: "foo(339)",
		prefix: undefined,
		suffix: "(339)",
		hasRow: true,
		hasCol: false,
	},
	{
		link: "foo(339,12)",
		prefix: undefined,
		suffix: "(339,12)",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo(339, 12)",
		prefix: undefined,
		suffix: "(339, 12)",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo (339)",
		prefix: undefined,
		suffix: " (339)",
		hasRow: true,
		hasCol: false,
	},
	{
		link: "foo (339,12)",
		prefix: undefined,
		suffix: " (339,12)",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo (339, 12)",
		prefix: undefined,
		suffix: " (339, 12)",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo: (339)",
		prefix: undefined,
		suffix: ": (339)",
		hasRow: true,
		hasCol: false,
	},
	{
		link: "foo: (339,12)",
		prefix: undefined,
		suffix: ": (339,12)",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo: (339, 12)",
		prefix: undefined,
		suffix: ": (339, 12)",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo(339:12)",
		prefix: undefined,
		suffix: "(339:12)",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo (339:12)",
		prefix: undefined,
		suffix: " (339:12)",
		hasRow: true,
		hasCol: true,
	},

	// Square brackets
	{
		link: "foo[339]",
		prefix: undefined,
		suffix: "[339]",
		hasRow: true,
		hasCol: false,
	},
	{
		link: "foo[339,12]",
		prefix: undefined,
		suffix: "[339,12]",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo[339, 12]",
		prefix: undefined,
		suffix: "[339, 12]",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo [339]",
		prefix: undefined,
		suffix: " [339]",
		hasRow: true,
		hasCol: false,
	},
	{
		link: "foo [339,12]",
		prefix: undefined,
		suffix: " [339,12]",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo [339, 12]",
		prefix: undefined,
		suffix: " [339, 12]",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo: [339]",
		prefix: undefined,
		suffix: ": [339]",
		hasRow: true,
		hasCol: false,
	},
	{
		link: "foo: [339,12]",
		prefix: undefined,
		suffix: ": [339,12]",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo: [339, 12]",
		prefix: undefined,
		suffix: ": [339, 12]",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo[339:12]",
		prefix: undefined,
		suffix: "[339:12]",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo [339:12]",
		prefix: undefined,
		suffix: " [339:12]",
		hasRow: true,
		hasCol: true,
	},

	// OCaml-style
	{
		link: '"foo", line 339, character 12',
		prefix: '"',
		suffix: '", line 339, character 12',
		hasRow: true,
		hasCol: true,
	},
	{
		link: '"foo", line 339, characters 12-789',
		prefix: '"',
		suffix: '", line 339, characters 12-789',
		hasRow: true,
		hasCol: true,
		hasColEnd: true,
	},
	{
		link: '"foo", lines 339-341',
		prefix: '"',
		suffix: '", lines 339-341',
		hasRow: true,
		hasCol: false,
		hasRowEnd: true,
	},
	{
		link: '"foo", lines 339-341, characters 12-789',
		prefix: '"',
		suffix: '", lines 339-341, characters 12-789',
		hasRow: true,
		hasCol: true,
		hasRowEnd: true,
		hasColEnd: true,
	},

	// Non-breaking space
	{
		link: "foo\u00A0339:12",
		prefix: undefined,
		suffix: "\u00A0339:12",
		hasRow: true,
		hasCol: true,
	},
	{
		link: '"foo" on line 339,\u00A0column 12',
		prefix: '"',
		suffix: '" on line 339,\u00A0column 12',
		hasRow: true,
		hasCol: true,
	},
	{
		link: "'foo' on line\u00A0339, column 12",
		prefix: "'",
		suffix: "' on line\u00A0339, column 12",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo (339,\u00A012)",
		prefix: undefined,
		suffix: " (339,\u00A012)",
		hasRow: true,
		hasCol: true,
	},
	{
		link: "foo\u00A0[339, 12]",
		prefix: undefined,
		suffix: "\u00A0[339, 12]",
		hasRow: true,
		hasCol: true,
	},
];
const testLinksWithSuffix = testLinks.filter((e) => !!e.suffix);

describe("TerminalLinkParsing", () => {
	describe("removeLinkSuffix", () => {
		for (const testLink of testLinks) {
			it(`\`${testLink.link}\``, () => {
				expect(removeLinkSuffix(testLink.link)).toEqual(
					testLink.suffix === undefined
						? testLink.link
						: testLink.link.replace(testLink.suffix, ""),
				);
			});
		}
	});

	describe("getLinkSuffix", () => {
		for (const testLink of testLinks) {
			it(`\`${testLink.link}\``, () => {
				expect(getLinkSuffix(testLink.link)).toEqual(
					testLink.suffix === undefined
						? null
						: ({
								row: testLink.hasRow ? testRow : undefined,
								col: testLink.hasCol ? testCol : undefined,
								rowEnd: testLink.hasRowEnd ? testRowEnd : undefined,
								colEnd: testLink.hasColEnd ? testColEnd : undefined,
								suffix: {
									index: testLink.link.length - testLink.suffix.length,
									text: testLink.suffix,
								},
							} as ReturnType<typeof getLinkSuffix>),
				);
			});
		}
	});

	describe("detectLinkSuffixes", () => {
		for (const testLink of testLinks) {
			it(`\`${testLink.link}\``, () => {
				expect(detectLinkSuffixes(testLink.link)).toEqual(
					testLink.suffix === undefined
						? []
						: [
								{
									row: testLink.hasRow ? testRow : undefined,
									col: testLink.hasCol ? testCol : undefined,
									rowEnd: testLink.hasRowEnd ? testRowEnd : undefined,
									colEnd: testLink.hasColEnd ? testColEnd : undefined,
									suffix: {
										index: testLink.link.length - testLink.suffix.length,
										text: testLink.suffix,
									},
								} as ILinkSuffix,
							],
				);
			});
		}

		it("foo(1, 2) bar[3, 4] baz on line 5", () => {
			expect(detectLinkSuffixes("foo(1, 2) bar[3, 4] baz on line 5")).toEqual([
				{
					col: 2,
					row: 1,
					rowEnd: undefined,
					colEnd: undefined,
					suffix: {
						index: 3,
						text: "(1, 2)",
					},
				},
				{
					col: 4,
					row: 3,
					rowEnd: undefined,
					colEnd: undefined,
					suffix: {
						index: 13,
						text: "[3, 4]",
					},
				},
				{
					col: undefined,
					row: 5,
					rowEnd: undefined,
					colEnd: undefined,
					suffix: {
						index: 23,
						text: " on line 5",
					},
				},
			]);
		});
	});

	describe("removeLinkQueryString", () => {
		it("should remove any query string from the link", () => {
			expect(removeLinkQueryString("?a=b")).toBe("");
			expect(removeLinkQueryString("foo?a=b")).toBe("foo");
			expect(removeLinkQueryString("./foo?a=b")).toBe("./foo");
			expect(removeLinkQueryString("/foo/bar?a=b")).toBe("/foo/bar");
			expect(removeLinkQueryString("foo?a=b?")).toBe("foo");
			expect(removeLinkQueryString("foo?a=b&c=d")).toBe("foo");
		});
		it("should respect ? in UNC paths", () => {
			expect(removeLinkQueryString("\\\\?\\foo?a=b")).toBe("\\\\?\\foo");
		});
	});

	describe("detectLinks", () => {
		it('foo(1, 2) bar[3, 4] "baz" on line 5', () => {
			expect(
				detectLinks(
					'foo(1, 2) bar[3, 4] "baz" on line 5',
					OperatingSystem.Linux,
				),
			).toEqual([
				{
					path: {
						index: 0,
						text: "foo",
					},
					prefix: undefined,
					suffix: {
						col: 2,
						row: 1,
						rowEnd: undefined,
						colEnd: undefined,
						suffix: {
							index: 3,
							text: "(1, 2)",
						},
					},
				},
				{
					path: {
						index: 10,
						text: "bar",
					},
					prefix: undefined,
					suffix: {
						col: 4,
						row: 3,
						rowEnd: undefined,
						colEnd: undefined,
						suffix: {
							index: 13,
							text: "[3, 4]",
						},
					},
				},
				{
					path: {
						index: 21,
						text: "baz",
					},
					prefix: {
						index: 20,
						text: '"',
					},
					suffix: {
						col: undefined,
						row: 5,
						rowEnd: undefined,
						colEnd: undefined,
						suffix: {
							index: 24,
							text: '" on line 5',
						},
					},
				},
			] as IParsedLink[]);
		});

		it("should detect multiple links when opening brackets are in the text", () => {
			expect(detectLinks("notlink[foo:45]", OperatingSystem.Linux)).toEqual([
				{
					path: {
						index: 0,
						text: "notlink[foo",
					},
					prefix: undefined,
					suffix: {
						col: undefined,
						row: 45,
						rowEnd: undefined,
						colEnd: undefined,
						suffix: {
							index: 11,
							text: ":45",
						},
					},
				},
				{
					path: {
						index: 8,
						text: "foo",
					},
					prefix: undefined,
					suffix: {
						col: undefined,
						row: 45,
						rowEnd: undefined,
						colEnd: undefined,
						suffix: {
							index: 11,
							text: ":45",
						},
					},
				},
			] as IParsedLink[]);
		});

		it("should extract the link prefix", () => {
			expect(
				detectLinks('"foo", line 5, col 6', OperatingSystem.Linux),
			).toEqual([
				{
					path: {
						index: 1,
						text: "foo",
					},
					prefix: {
						index: 0,
						text: '"',
					},
					suffix: {
						row: 5,
						col: 6,
						rowEnd: undefined,
						colEnd: undefined,
						suffix: {
							index: 4,
							text: '", line 5, col 6',
						},
					},
				},
			] as IParsedLink[]);
		});

		it("should be smart about determining the link prefix when multiple prefix characters exist", () => {
			expect(
				detectLinks("echo '\"foo\", line 5, col 6'", OperatingSystem.Linux),
			).toEqual([
				{
					path: {
						index: 7,
						text: "foo",
					},
					prefix: {
						index: 6,
						text: '"',
					},
					suffix: {
						row: 5,
						col: 6,
						rowEnd: undefined,
						colEnd: undefined,
						suffix: {
							index: 10,
							text: '", line 5, col 6',
						},
					},
				},
			] as IParsedLink[]);
		});

		it("should detect both suffix and non-suffix links on a single line", () => {
			expect(
				detectLinks(
					"PS C:\\Github\\microsoft\\vscode> echo '\"foo\", line 5, col 6'",
					OperatingSystem.Windows,
				),
			).toEqual([
				{
					path: {
						index: 3,
						text: "C:\\Github\\microsoft\\vscode",
					},
					prefix: undefined,
					suffix: undefined,
				},
				{
					path: {
						index: 38,
						text: "foo",
					},
					prefix: {
						index: 37,
						text: '"',
					},
					suffix: {
						row: 5,
						col: 6,
						rowEnd: undefined,
						colEnd: undefined,
						suffix: {
							index: 41,
							text: '", line 5, col 6',
						},
					},
				},
			] as IParsedLink[]);
		});

		describe('"|"', () => {
			it("should exclude pipe characters from link paths", () => {
				expect(
					detectLinks(
						"|C:\\Github\\microsoft\\vscode|",
						OperatingSystem.Windows,
					),
				).toEqual([
					{
						path: {
							index: 1,
							text: "C:\\Github\\microsoft\\vscode",
						},
						prefix: undefined,
						suffix: undefined,
					},
				] as IParsedLink[]);
			});
			it("should exclude pipe characters from link paths with suffixes", () => {
				expect(
					detectLinks(
						"|C:\\Github\\microsoft\\vscode:400|",
						OperatingSystem.Windows,
					),
				).toEqual([
					{
						path: {
							index: 1,
							text: "C:\\Github\\microsoft\\vscode",
						},
						prefix: undefined,
						suffix: {
							col: undefined,
							row: 400,
							rowEnd: undefined,
							colEnd: undefined,
							suffix: {
								index: 27,
								text: ":400",
							},
						},
					},
				] as IParsedLink[]);
			});
		});

		describe('"<>"', () => {
			for (const os of operatingSystems) {
				it(`should exclude bracket characters from link paths ${osLabel[os]}`, () => {
					expect(detectLinks(`<${osTestPath[os]}<`, os)).toEqual([
						{
							path: {
								index: 1,
								text: osTestPath[os],
							},
							prefix: undefined,
							suffix: undefined,
						},
					] as IParsedLink[]);
					expect(detectLinks(`>${osTestPath[os]}>`, os)).toEqual([
						{
							path: {
								index: 1,
								text: osTestPath[os],
							},
							prefix: undefined,
							suffix: undefined,
						},
					] as IParsedLink[]);
				});
				it(`should exclude bracket characters from link paths with suffixes ${osLabel[os]}`, () => {
					expect(detectLinks(`<${osTestPath[os]}:400<`, os)).toEqual([
						{
							path: {
								index: 1,
								text: osTestPath[os],
							},
							prefix: undefined,
							suffix: {
								col: undefined,
								row: 400,
								rowEnd: undefined,
								colEnd: undefined,
								suffix: {
									index: 1 + osTestPath[os].length,
									text: ":400",
								},
							},
						},
					] as IParsedLink[]);
					expect(detectLinks(`>${osTestPath[os]}:400>`, os)).toEqual([
						{
							path: {
								index: 1,
								text: osTestPath[os],
							},
							prefix: undefined,
							suffix: {
								col: undefined,
								row: 400,
								rowEnd: undefined,
								colEnd: undefined,
								suffix: {
									index: 1 + osTestPath[os].length,
									text: ":400",
								},
							},
						},
					] as IParsedLink[]);
				});
			}
		});

		describe("query strings", () => {
			for (const os of operatingSystems) {
				it(`should exclude query strings from link paths ${osLabel[os]}`, () => {
					expect(detectLinks(`${osTestPath[os]}?a=b`, os)).toEqual([
						{
							path: {
								index: 0,
								text: osTestPath[os],
							},
							prefix: undefined,
							suffix: undefined,
						},
					] as IParsedLink[]);
					expect(detectLinks(`${osTestPath[os]}?a=b&c=d`, os)).toEqual([
						{
							path: {
								index: 0,
								text: osTestPath[os],
							},
							prefix: undefined,
							suffix: undefined,
						},
					] as IParsedLink[]);
				});
				it("should not detect links starting with ? within query strings that contain posix-style paths (#204195)", () => {
					// ? appended to the cwd will exist since it's just the cwd
					expect(
						detectLinks("http://foo.com/?bar=/a/b&baz=c", os).some((e) =>
							e.path.text.startsWith("?"),
						),
					).toBe(false);
				});
				it("should not detect links starting with ? within query strings that contain Windows-style paths (#204195)", () => {
					// ? appended to the cwd will exist since it's just the cwd
					expect(
						detectLinks("http://foo.com/?bar=a:\\b&baz=c", os).some((e) =>
							e.path.text.startsWith("?"),
						),
					).toBe(false);
				});
			}
		});

		describe("should detect file names in git diffs", () => {
			it("--- a/foo/bar", () => {
				expect(detectLinks("--- a/foo/bar", OperatingSystem.Linux)).toEqual([
					{
						path: {
							index: 6,
							text: "foo/bar",
						},
						prefix: undefined,
						suffix: undefined,
					},
				] as IParsedLink[]);
			});
			it("+++ b/foo/bar", () => {
				expect(detectLinks("+++ b/foo/bar", OperatingSystem.Linux)).toEqual([
					{
						path: {
							index: 6,
							text: "foo/bar",
						},
						prefix: undefined,
						suffix: undefined,
					},
				] as IParsedLink[]);
			});
			it("diff --git a/foo/bar b/foo/baz", () => {
				expect(
					detectLinks("diff --git a/foo/bar b/foo/baz", OperatingSystem.Linux),
				).toEqual([
					{
						path: {
							index: 13,
							text: "foo/bar",
						},
						prefix: undefined,
						suffix: undefined,
					},
					{
						path: {
							index: 23,
							text: "foo/baz",
						},
						prefix: undefined,
						suffix: undefined,
					},
				] as IParsedLink[]);
			});
		});

		describe("should detect 3 suffix links on a single line", () => {
			for (let i = 0; i < testLinksWithSuffix.length - 2; i++) {
				// biome-ignore lint/style/noNonNullAssertion: we know these indices are valid in the loop
				const link1 = testLinksWithSuffix[i]!;
				// biome-ignore lint/style/noNonNullAssertion: we know these indices are valid in the loop
				const link2 = testLinksWithSuffix[i + 1]!;
				// biome-ignore lint/style/noNonNullAssertion: we know these indices are valid in the loop
				const link3 = testLinksWithSuffix[i + 2]!;
				const line = ` ${link1.link} ${link2.link} ${link3.link} `;
				it(`\`${line.replaceAll("\u00A0", "<nbsp>")}\``, () => {
					expect(detectLinks(line, OperatingSystem.Linux).length).toBe(3);
					expect(link1.suffix).toBeTruthy();
					expect(link2.suffix).toBeTruthy();
					expect(link3.suffix).toBeTruthy();
					// biome-ignore lint/style/noNonNullAssertion: suffix is checked with toBeTruthy above
					const link1Suffix = link1.suffix!;
					// biome-ignore lint/style/noNonNullAssertion: suffix is checked with toBeTruthy above
					const link2Suffix = link2.suffix!;
					// biome-ignore lint/style/noNonNullAssertion: suffix is checked with toBeTruthy above
					const link3Suffix = link3.suffix!;
					const detectedLink1: IParsedLink = {
						prefix: link1.prefix
							? {
									index: 1,
									text: link1.prefix,
								}
							: undefined,
						path: {
							index: 1 + (link1.prefix?.length ?? 0),
							text: link1.link
								.replace(link1Suffix, "")
								.replace(link1.prefix || "", ""),
						},
						suffix: {
							row: link1.hasRow ? testRow : undefined,
							col: link1.hasCol ? testCol : undefined,
							rowEnd: link1.hasRowEnd ? testRowEnd : undefined,
							colEnd: link1.hasColEnd ? testColEnd : undefined,
							suffix: {
								index: 1 + (link1.link.length - link1Suffix.length),
								text: link1Suffix,
							},
						},
					};
					const detectedLink2: IParsedLink = {
						prefix: link2.prefix
							? {
									index:
										(detectedLink1.prefix?.index ?? detectedLink1.path.index) +
										link1.link.length +
										1,
									text: link2.prefix,
								}
							: undefined,
						path: {
							index:
								(detectedLink1.prefix?.index ?? detectedLink1.path.index) +
								link1.link.length +
								1 +
								(link2.prefix ?? "").length,
							text: link2.link
								.replace(link2Suffix, "")
								.replace(link2.prefix ?? "", ""),
						},
						suffix: {
							row: link2.hasRow ? testRow : undefined,
							col: link2.hasCol ? testCol : undefined,
							rowEnd: link2.hasRowEnd ? testRowEnd : undefined,
							colEnd: link2.hasColEnd ? testColEnd : undefined,
							suffix: {
								index:
									(detectedLink1.prefix?.index ?? detectedLink1.path.index) +
									link1.link.length +
									1 +
									(link2.link.length - link2Suffix.length),
								text: link2Suffix,
							},
						},
					};
					const detectedLink3: IParsedLink = {
						prefix: link3.prefix
							? {
									index:
										(detectedLink2.prefix?.index ?? detectedLink2.path.index) +
										link2.link.length +
										1,
									text: link3.prefix,
								}
							: undefined,
						path: {
							index:
								(detectedLink2.prefix?.index ?? detectedLink2.path.index) +
								link2.link.length +
								1 +
								(link3.prefix ?? "").length,
							text: link3.link
								.replace(link3Suffix, "")
								.replace(link3.prefix ?? "", ""),
						},
						suffix: {
							row: link3.hasRow ? testRow : undefined,
							col: link3.hasCol ? testCol : undefined,
							rowEnd: link3.hasRowEnd ? testRowEnd : undefined,
							colEnd: link3.hasColEnd ? testColEnd : undefined,
							suffix: {
								index:
									(detectedLink2.prefix?.index ?? detectedLink2.path.index) +
									link2.link.length +
									1 +
									(link3.link.length - link3Suffix.length),
								text: link3Suffix,
							},
						},
					};
					expect(detectLinks(line, OperatingSystem.Linux)).toEqual([
						detectedLink1,
						detectedLink2,
						detectedLink3,
					]);
				});
			}
		});

		describe("should ignore links with suffixes when the path itself is the empty string", () => {
			it('""",1', () => {
				expect(detectLinks('""",1', OperatingSystem.Linux)).toEqual(
					[] as IParsedLink[],
				);
			});
		});
	});
});
