// P-ORACLE for crates/latex: the TypeScript renderLatex (packages/latex/src/render.ts) in strict mode, as the
// plugin calls it, over every source in packages/latex/src/*.test.ts plus common textbook formulas. Writes
// parity/fixtures/P.2/layouts.json; crates/latex/src/tests.rs expects the same text, geometry, cell styles, and
// parse failures.
import { renderLatex } from "../../../latex/src/render"
import { LatexParseError, type RenderLatexOptions } from "../../../latex/src/types"

const tests = [
  // render.test.ts
  String.raw`\frac{x+1}{y-1}`,
  String.raw`E = mc^2`,
  String.raw`a_n`,
  String.raw`x_i^2`,
  String.raw`x^{}`,
  String.raw`x_{}`,
  String.raw`x^{}_{}`,
  String.raw`x^m_1`,
  String.raw`x^2_q`,
  String.raw`x^{\frac{1}{2}}_1`,
  String.raw`\sum_1^n`,
  String.raw`P = \binom{n}{k}`,
  String.raw`\sqrt{x^2+y^2}`,
  String.raw`\begin{pmatrix}a & b \\ c & d\end{pmatrix}`,
  String.raw`\sum_{i=1}^{n} i^2`,
  String.raw`\frac{1}{2}`,
  String.raw`\mathbb{R} \to \mathcal{C} \times \mathfrak{g}`,
  String.raw`\mathbf{\mathsf{\textcolor{red}{\mathit{x}}}}`,
  String.raw`\frac{1}{1+\frac{1}{x}}`,
  String.raw`\left[\frac{-b \pm \sqrt{b^2-4ac}}{2a}\right]`,
  String.raw`\not\rightarrow`,
  String.raw`x\in[0,1]`,
  String.raw`[-1,1]`,
  // layout.test.ts
  ...[String.raw`\sqrt{x}`, String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`, String.raw`\underbrace{abcd}`, String.raw`\overbrace{abcd}`, String.raw`\sum`].flatMap(
    (source) => [source, ...["^{}", "_{}", "^{}_{}"].map((scripts) => source + scripts)],
  ),
  String.raw`\overbrace{abcd}^{n}`,
  String.raw`\underbrace{abcd}_{n}`,
  String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}^2`,
  String.raw`\begin{cases}x & x>0\\x^2+1 & x\le0\end{cases}`,
  String.raw`\begin{array}{l|r}\text{a}&\text{wide}\\\text{long}&\text{b}\end{array}`,
  String.raw`\begin{array}{|l||r|}\text{a}&\text{b}\\\text{long}&\text{c}\end{array}`,
  String.raw`\cfrac[l]{\text{1}}{\text{12345}}`,
  String.raw`\cfrac[r]{\text{1}}{\text{12345}}`,
  String.raw`\overbrace{a + b + c}^{n}`,
  String.raw`\underbrace{a + b + c}_{n}`,
  // root.test.ts
  ...[
    ["x", String.raw`\frac{1}{2}`],
    ["x", String.raw`\sqrt{n}`],
    ["x", "123456789"],
    ["x", String.raw`\frac{123456789}{\frac{n}{m}}`],
    [String.raw`\frac{a}{b}`, "3"],
    [String.raw`\sqrt{\frac{a}{b}}`, String.raw`\sqrt{\frac{n}{m}}`],
    [String.raw`\text{界}`, String.raw`\text{次}`],
    ["", String.raw`\frac{1}{2}`],
  ].map(([body, index]) => String.raw`\sqrt[\textcolor{blue}{${index}}]{\textcolor{red}{${body}}}`),
  String.raw`\sqrt{\sqrt{\sqrt{x}}}`,
  String.raw`\sqrt{\frac{a}{b}}`,
  String.raw`\sqrt[3]{x}`,
  String.raw`\sqrt[\frac{1}{2}]{x}`,
  String.raw`\sqrt[\sqrt{n}]{x}`,
  // parser-render.test.ts
  String.raw`\|v\|`,
  String.raw`\left\|v\right\|`,
  String.raw`\left|v\right|`,
  String.raw`\left(A\rightarrow B\right)`,
  String.raw`\left\lbrace x\right\rbrace`,
  String.raw`\operatorname{arg\,max} x`,
  String.raw`\textrm{if }x`,
  String.raw`\displaylines{x=1\\y=2}`,
  String.raw`\begin{aligned}&=x\\&=y\end{aligned}`,
  String.raw`\begin{aligned}{}&=x\\{}&=y\end{aligned}`,
  // parser.test.ts
  String.raw`\frac{x^2+1}{y_0}`,
  String.raw`\begin{array}{cc}a & b \\ c & d\end{array}`,
  String.raw`\begin{align*}a &= b \\ c &= d\end{align*}`,
  String.raw`\left(\left[A\right]\rightharpoonup B\right)`,
  String.raw`\left(A\rightarrow B`,
  String.raw`\left(A\rightward B\right)`,
  String.raw`\begin{matrix}a&&\\&b&\end{matrix}`,
  String.raw`\begin{matrix}a\\\end{matrix}`,
  String.raw`\begin{matrix}\\\end{matrix}`,
  String.raw`\displaylines{\frac{1}{2}\\{y}}+z`,
  String.raw`\displaylines[l]{x\\y}`,
  String.raw`\displaylines{x\\y`,
  ...["", "[]", "[l]", "[r]", "[c]", "[lr]", "[left]", "[l"].map((option) => String.raw`\cfrac${option}{1}{23}`),
  String.raw`\begin{array}{ | l || c r | }a&b&c\end{array}`,
  ...["", "||", "p{2cm}", "*{2}{c}", "c@{}c", "lXr"].map((columns) => String.raw`\begin{array}{${columns}}a\end{array}`),
  String.raw`\begin{array}a&b\end{array}`,
  String.raw`\overbrace{a+b}^{n}`,
  String.raw`\underbrace{x}_{k}`,
  String.raw`\lbrace x\rbrace`,
  String.raw`\left\unknown x\right)`,
  String.raw`\left(x\right\unknown`,
  String.raw`\big\unknown`,
  String.raw`\left(x\middle\unknown y\right)`,
  String.raw`\definitelyUnknown{x}`,
  String.raw`\text{left \{ only}`,
  String.raw`\text{right \} only}`,
  String.raw`\operatorname*{arg\,max}_{x}`,
  String.raw`\int\limits_0^1`,
  String.raw`\sum\nolimits_{i=1}`,
  String.raw`\operatorname{arg\,max}`,
  String.raw`\textrm{ if }`,
  String.raw`\begin{matrix}]`,
  String.raw`\begin{matrix}x}`,
  String.raw`\begin{matrix}&}`,
  "{".repeat(300) + "x" + "}".repeat(300),
  // markdown.test.ts
  String.raw`\frac{1}{`,
  String.raw`\unsupported{x}`,
  String.raw`\cfrac[x]{1}{2}`,
  String.raw`\begin{array}{p{2cm}}x\end{array}`,
  String.raw`\documentclass{article}
\begin{document}
Hello
\end{document}`,
  String.raw`\cfrac[l]{1}{12345}`,
  String.raw`\underbrace{a+b+c}_{n}`,
  String.raw`\begin{array}{l|r}a&wide\\long&b\end{array}`,
  String.raw`\begin{aligned}a&=b+c\\&=d\end{aligned}`,
  String.raw`\frac{a_1+b_1}{c_1+d_1}`,
  String.raw`\frac{a_1+b_1}{c_1+d_1}+\frac{a_`,
  String.raw`\frac{a_1+b_1}{c_1+d_1}+\frac{a_2+b_2}{c_2+d_2}`,
  String.raw`x^2 + \frac{1}{`,
  String.raw`x^2 + \unsupported{x}`,
  String.raw`\text{Start a very long formula with enough content to overflow Finish}`,
  String.raw`x=\sqrt{\frac{1}{2}}`,
  String.raw`\text{中文}=x`,
  String.raw`\frac{\text{中文}}{abcd}=x`,
]

const textbook = [
  String.raw`e^{i\pi} + 1 = 0`,
  String.raw`\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}`,
  String.raw`\lim_{x \to 0} \frac{\sin x}{x} = 1`,
  String.raw`f(x) = \sum_{n=0}^{\infty} \frac{f^{(n)}(a)}{n!}(x-a)^n`,
  String.raw`\nabla \times \vec{E} = -\frac{\partial \vec{B}}{\partial t}`,
  String.raw`\hat{x} + \bar{y} + \tilde{z} + \dot{a} + \ddot{b} + \widehat{abc} + \overline{xy} + \underline{uv}`,
  String.raw`\overset{\text{def}}{=} \underset{n}{\max} \stackrel{?}{=}`,
  String.raw`\begin{bmatrix}1 & 0 \\ 0 & 1\end{bmatrix} \begin{Bmatrix}a\end{Bmatrix} \begin{vmatrix}a & b \\ c & d\end{vmatrix} \begin{Vmatrix}x\end{Vmatrix}`,
  String.raw`\begin{gather}a = b \\ c = d\end{gather} \begin{smallmatrix}1&2\end{smallmatrix}`,
  String.raw`\left\langle u, v \right\rangle \left\lfloor x \right\rfloor \left\lceil y \right\rceil`,
  String.raw`\left( \frac{a}{b} \right) \left\{ \frac{a}{b} \right\} \left. \frac{a}{b} \right|`,
  String.raw`\alpha\beta\gamma\Gamma\epsilon\varepsilon\phi\varphi \infty \partial \forall \exists \emptyset`,
  String.raw`a \le b \ge c \ne d \approx e \equiv f \sim g \subset h \subseteq i \in j \notin k`,
  String.raw`\not= \not\in \not\equiv \not<`,
  String.raw`A \cup B \cap C \setminus D \oplus E \otimes F \cdot G \times H \div I \pm J \mp K`,
  String.raw`\Rightarrow \Leftarrow \Leftrightarrow \mapsto \to \gets \longrightarrow`,
  String.raw`\cdots \ldots \vdots \ddots , ; :`,
  String.raw`\sin x + \cos y + \tan z + \log w + \ln v + \exp u + \det A + \gcd(a,b)`,
  String.raw`\max_{x} f(x) \min_{y} g(y) \sup_n a_n \inf_n b_n \limsup_{n\to\infty} c_n`,
  String.raw`\prod_{i=1}^n x_i \coprod \iint \iiint \oint \bigcup_i A_i \bigcap_j B_j`,
  String.raw`\mathrm{d}x \mathbf{v} \mathit{w} \mathsf{S} \mathtt{code1} \mathbb{N}\mathbb{Z}\mathbb{Q}\mathbb{C} \mathcal{L} \mathfrak{H}`,
  String.raw`a\quad b\qquad c\,d\;e\:f\!g~h\enspace i`,
  String.raw`\text{if } x > 0 \text{ and } y \mbox{ or } z`,
  String.raw`\color{red} x + y`,
  String.raw`\textcolor{blue}{\frac{1}{2}}`,
  String.raw`\displaystyle \frac{a}{b} \textstyle c \scriptstyle d`,
  String.raw`\bigl( x \bigr) \Big[ y \Big] \bigg\{ z \bigg\} \Bigg| w \Bigg|`,
  String.raw`\pmod{7} a \bmod b a \mod c`,
  String.raw`\dfrac{1}{2} \tfrac{3}{4} \dbinom{n}{2} \tbinom{m}{3}`,
  String.raw`\# \$ \% \& \_ \{ \} \backslash`,
  String.raw`x^{2^{3}} x_{i_{j}} x^{-1} x^{n+1} x_{ij} x^{(n)}`,
  String.raw`f'(x) f''(x) x^\prime`,
  String.raw`% comment
x + y % trailing
= z`,
  String.raw`\begin{cases} 0 & \text{if } x < 0 \\ \frac{x}{2} & \text{otherwise} \end{cases}`,
  String.raw`\begin{pmatrix} \frac{1}{2} & 0 \\ 0 & \sqrt{2} \end{pmatrix}`,
  String.raw`\begin{aligned} f(x) &= (x+1)^2 \\ &= x^2 + 2x + 1 \end{aligned}`,
  String.raw`\begin{align} a &= b & c &= d \end{align}`,
  String.raw`\sqrt[n]{x^n + y^n}`,
  String.raw`\frac{\partial^2 u}{\partial t^2} = c^2 \nabla^2 u`,
  String.raw`\begin{unknownenv}x\end{unknownenv}`,
  String.raw`\begin{equation}x\end{equation}`,
  String.raw`x^`,
  String.raw`x_`,
  String.raw`\frac{1}`,
  String.raw`\sqrt[3`,
  String.raw`{x`,
  String.raw`x}`,
  String.raw`\right)`,
  String.raw`\text{unterminated`,
  String.raw`\not`,
  String.raw`\left`,
  String.raw`- a`,
  String.raw`a -`,
  String.raw`(-a) + [-b] - \{-c\}`,
  String.raw`a = -b`,
  String.raw`\vec{v} \cdot \vec{w}`,
  String.raw`\overbrace{x+y}^{\text{sum}} + \underbrace{a \cdot b}_{\text{product}}`,
  String.raw`\binom{n}{k} = \frac{n!}{k!(n-k)!}`,
  String.raw`\left( \sum_{k=1}^n a_k b_k \right)^2 \le \left( \sum_{k=1}^n a_k^2 \right) \left( \sum_{k=1}^n b_k^2 \right)`,
  "",
  "   ",
  "x\n\ny",
]

const cases: { source: string; options?: RenderLatexOptions }[] = [
  ...[...tests, ...textbook].map((source) => ({ source })),
  { source: String.raw`x_i^2`, options: { compactScripts: false } },
  { source: String.raw`\sum_1^n`, options: { displayMode: false } },
  { source: String.raw`\sum_1^n`, options: { compactScripts: false } },
  { source: String.raw`\lim_{x\to0} f`, options: { displayMode: false } },
]

const layouts = cases.map((item) => {
  const options = { ...item.options, strict: true, displayMode: item.options?.displayMode ?? true }
  try {
    const layout = renderLatex(item.source, options)
    const styled = layout.cells.flatMap((row, y) =>
      row.flatMap((cell, x) => {
        const style = cell?.style
        if (!style || !(style.bold || style.italic || style.dim || style.color)) return []
        const flags = `${style.bold ? "b" : ""}${style.italic ? "i" : ""}${style.dim ? "d" : ""}`
        return [`${x},${y} ${flags} ${style.color ?? ""}`.trimEnd()]
      }),
    )
    return {
      ...item,
      text: layout.toString(),
      width: layout.width,
      height: layout.height,
      baseline: layout.baseline,
      styled,
    }
  } catch (error) {
    if (!(error instanceof LatexParseError || error instanceof RangeError)) throw error
    return { ...item, error: true }
  }
})

const path = new URL("../fixtures/P.2/layouts.json", import.meta.url).pathname
await Bun.write(path, JSON.stringify(layouts, null, 1) + "\n")
console.log(`P.2: ${layouts.length} layouts`)
