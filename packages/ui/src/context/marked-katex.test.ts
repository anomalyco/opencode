import { expect, test } from "bun:test"
import { Marked } from "marked"
import { markedKatex } from "./marked-katex"

// KaTeX output is verbose, so assert on whether it rendered rather than on the HTML.
const marked = new Marked(markedKatex)
const isMath = async (markdown: string) => (await marked.parse(markdown)).includes("katex")
const countMath = async (markdown: string, className = 'class="katex"') =>
  (await marked.parse(markdown)).split(className).length - 1

test("renders block math", async () => {
  for (const source of [
    "$$\nx^2\n$$",
    "$$x^2 = y$$",
    "$$x^2 +\ny^2 = z^2$$",
    "\\[x^2\\]",
    "\\[\nx^2\n\\]",
    "\\[ f(x) =\n\\int g \\]",
  ]) {
    expect(await isMath(source)).toBe(true)
  }
})

test("renders inline math", async () => {
  for (const source of [
    "$E = mc^2$ is famous.",
    "inline \\(a+b\\) works",
    "Here is \\[x=y\\] in a sentence.",
    "$\\$5 + x$ done",
  ]) {
    expect(await isMath(source)).toBe(true)
  }
})

test("closes inline math on punctuation, brackets and unicode", async () => {
  for (const source of ["see $x$).", "list: $x$; next", "ref [$x$] here", "value ($x$) here", "$x$’"]) {
    expect(await isMath(source)).toBe(true)
  }
})

// #34850 removed $...$ because prose was rendering as math. These pin that it stays gone.
test("leaves currency and regex literals alone", async () => {
  for (const source of [
    "price is $5 and $6 total.",
    "I spent $10 for lunch and $20 for dinner.",
    "Costs 5$ or 10$.",
    "Cost: 20$ (twenty), tip: 5$.",
    "Use /^foo$/ and /^bar$/ patterns.",
    "($10 and $20)",
    "It costs $$5 and later $$10.",
  ]) {
    expect(await isMath(source)).toBe(false)
  }
})

test("a rejected dollar does not hide later math", async () => {
  expect(await marked.parse("The cost is US$10, and the formula is $f(x) = x^2$.")).toContain("US$10")
  expect(await isMath("The cost is US$10, and the formula is $f(x) = x^2$.")).toBe(true)
  expect(await isMath("shell$var followed by $x$")).toBe(true)
})

test("does not bridge two expressions into one", async () => {
  // "$10, while $x$" must not match as a single formula spanning both dollars.
  expect(await marked.parse("It costs $10, while $x$ is unknown")).toContain("$10")
  expect(await isMath("It costs $10, while $x$ is unknown")).toBe(true)
  expect(await countMath("a $x$ and $y$ b")).toBe(2)
  expect(await countMath("Here is $$a$$ and $$b$$.", "katex-display")).toBe(2)
  expect(await countMath("$$a$$ and $$b$$", "katex-display")).toBe(2)
})

test("leaves math inside code spans alone", async () => {
  expect(await marked.parse("`$notmath$` code")).toContain("<code>$notmath$</code>")
})
