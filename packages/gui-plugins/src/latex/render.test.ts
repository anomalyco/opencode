import { expect, test } from "bun:test"
import { renderLatex } from "./render"

test("renders a fenced formula as display math", () => {
  const html = renderLatex(
    "S_{\\text{adj}} = \\min\\!\\left(10,\\; \\max\\!\\left(1,\\; S \\cdot \\left(\\frac{T_0}{T}\\right)^{\\alpha}\\right)\\right)",
  )

  expect(html).toContain('<span class="katex-display">')
})

test("renders a multi-line environment", () => {
  expect(renderLatex("\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}")).toContain('<span class="katex-display">')
})

test.each(["", "  \n", "\\frac{1}{", "\\notacommand{x}"])("keeps the code for source KaTeX cannot parse: %p", (source) => {
  expect(renderLatex(source)).toBeUndefined()
})
