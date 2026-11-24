import { expect, test } from "bun:test"
import { createMarkdownParser } from "@opencode/ui/context/marked-parser"
import { markdownText } from "./markdown-text"

// The parser that renders a reply. Find reads the text a reply shows from its tokens.
const parser = createMarkdownParser()

// Find counted hits in the Markdown source: 8 for `**` in a reply that shows no asterisk, and 2 for a URL that shows
// once, the second being the destination behind a link's label.
test.each([
  {
    name: "emphasis markers",
    source: "A **bold** and _slanted_ and ~~struck~~ word",
    text: "A bold and slanted and struck word",
  },
  {
    name: "a phrase across bold",
    source: "Paragraph with **bold text** inside",
    text: "Paragraph with bold text inside",
  },
  { name: "the backticks of inline code", source: "Run `bun test` now", text: "Run bun test now" },
  { name: "a heading's marker", source: "## Step 3: wire it", text: "Step 3: wire it" },
  {
    name: "a link's destination",
    source: "See [the docs](https://github.com/x/y) on github.com",
    text: "See the docs on github.com",
  },
  { name: "a link's definition", source: "See [the docs][d].\n\n[d]: https://example.com/docs", text: "See the docs." },
  {
    name: "the brackets of an autolink, whose address is its label",
    source: "Visit <https://example.com/a> or https://bare.example/b",
    text: "Visit https://example.com/a or https://bare.example/b",
  },
  { name: "an image", source: "Before ![a chart](chart.png) after", text: "Before  after" },
  {
    name: "the names of entities, but not in code",
    source: "Tom &amp; Jerry, 5 &lt; 6, `&amp;` in code",
    text: "Tom & Jerry, 5 < 6, &amp; in code",
  },
  { name: "the backslash of an escaped marker", source: "Escaped \\*stars\\* stay", text: "Escaped *stars* stay" },
  { name: "a formula", source: "Area $x^2$ and price $5", text: "Area  and price $5" },
  { name: "the spaces of a hard break", source: "first  \nsecond", text: "first\nsecond" },
  { name: "raw tags in a line", source: "Press <kbd>Ctrl</kbd> now<br>then", text: "Press Ctrl now\nthen" },
  {
    name: "list markers, one line an item",
    source: "- one\n- **two**\n  - nested\n\n1. first",
    text: "one\ntwo\nnested\nfirst",
  },
  { name: "the boxes of a task list", source: "- [x] done\n- [ ] open", text: "done\nopen" },
  { name: "a quote's marker", source: "> quoted **words**", text: "quoted words" },
  {
    name: "a table's rules, one line a cell",
    source: "| Col A | Col B |\n| --- | :-: |\n| cell a | `b` |",
    text: "Col A\nCol B\ncell a\nb",
  },
  {
    name: "a code block's fence",
    source: "```ts\nconst answer = compute(41) + 1\n```",
    text: "const answer = compute(41) + 1",
  },
  {
    name: "a rule and a diagram",
    source: "above\n\n---\n\n```mermaid\ngraph TD; A-->B\n```\n\nbelow",
    text: "above\nbelow",
  },
  { name: "display math in a fence", source: "```latex\nx^2\n```\n\nafter", text: "after" },
  {
    name: "the tags of a disclosure",
    source: "<details><summary>More</summary>\n\nHidden **part**\n\n</details>",
    text: "\n\nMore\n\nHidden part\n\n",
  },
  { name: "the space between blocks, one line each", source: "one\n\ntwo", text: "one\ntwo" },
])("the text a reply shows leaves out $name", ({ source, text }) => {
  expect(markdownText(parser.lexer(source))).toBe(text)
})

// A reply quoted a harness tag after a list. The renderer takes the tag's line and what follows, up to the next blank
// line, for raw HTML: its asterisks and backticks stay on screen. A parser that follows CommonMark to the letter
// reads the same lines as a paragraph with bold text, and Find did not count 282 asterisk pairs a session showed.
test("the text after a raw tag line keeps the markers the reply shows", () => {
  const source = '- item **one**\n<background-result kind="x">\nFreed **65.5 GB** of `caches`\n\nafter **it**'

  expect(markdownText(parser.lexer(source))).toBe("item one\n\n\nFreed **65.5 GB** of `caches`\nafter it")
})
