import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { markdownClipboardHtml } from "./markdown-clipboard"

beforeAll(() => GlobalRegistrator.register())

afterAll(() => GlobalRegistrator.unregister())

function markdownRoot(html: string) {
  const root = document.createElement("div")
  root.setAttribute("data-component", "markdown")
  root.innerHTML = html
  document.body.replaceChildren(root)

  return root
}

function rangeOver(node: Node) {
  const range = document.createRange()
  range.selectNodeContents(node)

  return range
}

test("keeps semantic structure without colours, classes, or layout attributes", () => {
  const root = markdownRoot(
    [
      '<div data-markdown-block="" style="display: contents">',
      '<h2 class="heading" style="color: rgb(237, 237, 237)">Title</h2>',
      '<p style="color: white">Some <strong>bold</strong>, <em>italic</em> and <code data-inline-code-kind="path">src/app.ts</code>.</p>',
      '<ol start="3"><li>three</li><li>four</li></ol>',
      '<table><thead><tr><th style="text-align: left">A</th></tr></thead><tbody><tr><td colspan="2">1</td></tr></tbody></table>',
      "<blockquote><p>quoted</p></blockquote>",
      "</div>",
    ].join(""),
  )

  expect(markdownClipboardHtml(root, rangeOver(root))).toBe(
    [
      "<div>",
      "<h2>Title</h2>",
      "<p>Some <strong>bold</strong>, <em>italic</em> and <code>src/app.ts</code>.</p>",
      '<ol start="3"><li>three</li><li>four</li></ol>',
      '<table><thead><tr><th>A</th></tr></thead><tbody><tr><td colspan="2">1</td></tr></tbody></table>',
      "<blockquote><p>quoted</p></blockquote>",
      "</div>",
    ].join(""),
  )
})

test("strips syntax highlight colours and the copy button from code blocks", () => {
  const root = markdownRoot(
    [
      '<div data-component="markdown-code" data-language="ts">',
      '<pre class="highlights"><code class="language-ts">',
      '<span style="color: #c678dd">const</span><span style="color: #e5c07b"> a</span>',
      "</code></pre>",
      '<div data-slot="markdown-copy-button"><button aria-label="Copy"><svg></svg></button></div>',
      "</div>",
    ].join(""),
  )

  expect(markdownClipboardHtml(root, rangeOver(root))).toBe(
    "<div><pre><code><span>const</span><span> a</span></code></pre></div>",
  )
})

test("wraps a partial selection in its semantic ancestors", () => {
  const root = markdownRoot(
    '<ul><li>item <strong class="x">very bold</strong></li></ul><pre><code><span style="color: red">let x</span></code></pre>',
  )

  const bold = root.querySelector("strong")!.firstChild!
  const token = root.querySelector("pre span")!.firstChild!
  const boldRange = document.createRange()
  boldRange.setStart(bold, 5)
  boldRange.setEnd(bold, 9)
  const codeRange = document.createRange()
  codeRange.setStart(token, 0)
  codeRange.setEnd(token, 3)

  expect(markdownClipboardHtml(root, boldRange)).toBe("<ul><li><strong>bold</strong></li></ul>")
  expect(markdownClipboardHtml(root, codeRange)).toBe("<pre><code>let</code></pre>")
})

test("keeps web links and drops local paths, scripts, and decorative icons", () => {
  const root = markdownRoot(
    [
      '<p><a class="external-link" target="_blank" href="https://opencode.ai/docs">',
      '<span class="markdown-link-favicon" aria-hidden="true"><img src="https://example.com/icon.png"></span>docs</a> ',
      '<a href="javascript:alert(1)">bad</a> <a href="mailto:help@example.com">mail</a> ',
      '<a data-local-link="src/app.ts" href="src/app.ts">app</a> ',
      '<img src="https://example.com/chart.png" alt="chart" width="20"> <img src="blob:local" alt="local">',
      '<span class="sr-only">hidden</span></p>',
    ].join(""),
  )

  expect(markdownClipboardHtml(root, rangeOver(root))).toBe(
    [
      '<p><a href="https://opencode.ai/docs">docs</a> ',
      '<a>bad</a> <a href="mailto:help@example.com">mail</a> ',
      "<a>app</a> ",
      '<img src="https://example.com/chart.png" alt="chart"> <img alt="local">',
      "</p>",
    ].join(""),
  )
})
