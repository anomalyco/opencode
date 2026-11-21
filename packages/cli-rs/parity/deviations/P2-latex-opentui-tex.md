# P.2: opentui-tex's layout, symbols, limits and streaming preview

**TypeScript.** `packages/latex` draws a radical as a hook (`╰╯`) with a bar up the radicand's left, puts a blank
row between matrix rows, maps `\epsilon` to `ε` and `\varepsilon` to `ϵ`, keeps `\bullet` as `∙`, ignores
`\textcolor` in the drawn rows, draws an empty or blank source as nothing, measures cells with its own
`cellWidth`, and while a fence streams shows its source until the formula parses (then keeps the last formula
that parsed).

**Rust.** `crates/latex` follows Simon's opentui-tex (`math-layout.ts`, `math-parser.ts`, `math-symbols.ts`,
`unicode-tex-backend.ts`, `tex-renderable.ts`), the reference for this plugin (O-89: a TS defect fixed in Rust):

- the radical is `√` on the radicand's baseline under an overbar that starts with `╭`;
- matrix, `cases`, `aligned`, `array` and `\displaylines` rows follow each other without a blank row;
- `\epsilon` is `ϵ` and `\varepsilon` `ε`, as in TeX; `\bullet` is `•`;
- `\limits` and `\operatorname*` put limits above and below in inline layout too;
- `\textcolor` keeps its color (`#rgb`, `#rrggbb`, or an xcolor base color) in fences and inline math;
- a source of no or more than 4096 UTF-8 bytes, a block of more than 16 384 cells, and a formula that draws
  nothing fail, so the fence shows its source;
- widths are `string-width`'s (`unicode-width`): a flag or keycap takes two cells;
- a literal delimiter not in the table (`\left a`) fails, as opentui-tex's strict mode;
- an open streaming fence draws as far as it goes with `□` for what has not come (`parseMathIncomplete`), and
  keeps the last formula only when even that fails, so shown math never goes back to the source.

The P-ORACLE (`parity/fixtures/P.2/layouts.json`, 207 TS cases) holds Rust to `crates/latex/src/oracle_rust.json`
for the cases below; `tests::layouts_match_typescript` requires each to differ from TS. P-COMP `P.2/structures`
differs in 125 cells and `P.2/adapter` in 197 (radicals and matrix rows); P-APP `P.2/fence-margin` in 2 (one
radical).

**Reason.** opentui-tex is ahead of TS: a radical sign reads as a root where a hook does not, a blank row between
matrix rows reads as an empty row, TeX's epsilons are the other way round, and a streaming formula that keeps
drawing beats one that drops to source.

## The oracle cases, TS then Rust

### Radical

`\sqrt{x^2+y^2}`

```
 ╭───────
╰╯x² + y²
```

```
 ╭───────
√ x² + y²
```

`\left[\frac{-b \pm \sqrt{b^2-4ac}}{2a}\right]`

```
⎡       ╭──────── ⎤
⎢ -b ± ╰╯b² - 4ac ⎥
⎢─────────────────⎥
⎣       2a        ⎦
```

```
⎡       ╭──────── ⎤
⎢ -b ± √ b² - 4ac ⎥
⎢─────────────────⎥
⎣       2a        ⎦
```

`\sqrt{x}`

```
 ╭─
╰╯x
```

```
 ╭─
√ x
```

`\sqrt{x}^{}`

```
 ╭─
╰╯x
```

```
 ╭─
√ x
```

`\sqrt{x}_{}`

```
 ╭─
╰╯x
```

```
 ╭─
√ x
```

`\sqrt{x}^{}_{}`

```
 ╭─
╰╯x
```

```
 ╭─
√ x
```

`\sqrt[\textcolor{blue}{\frac{1}{2}}]{\textcolor{red}{x}}`

```
 1
───
 2 ╭─
  ╰╯x
```

```
 1
───
 2 ╭─
  √ x
```

`\sqrt[\textcolor{blue}{\sqrt{n}}]{\textcolor{red}{x}}`

```
 ╭─
╰╯n╭─
  ╰╯x
```

```
 ╭─
√ n╭─
  √ x
```

`\sqrt[\textcolor{blue}{123456789}]{\textcolor{red}{x}}`

```
123456789╭─
        ╰╯x
```

```
123456789╭─
        √ x
```

`\sqrt[\textcolor{blue}{\frac{123456789}{\frac{n}{m}}}]{\textcolor{red}{x}}`

```
 123456789
───────────
     n
    ───
     m     ╭─
          ╰╯x
```

```
 123456789
───────────
     n
    ───
     m     ╭─
          √ x
```

`\sqrt[\textcolor{blue}{3}]{\textcolor{red}{\frac{a}{b}}}`

```
3╭───
 │ a
 │───
╰╯ b
```

```
3╭───
   a
√ ───
   b
```

`\sqrt[\textcolor{blue}{\sqrt{\frac{n}{m}}}]{\textcolor{red}{\sqrt{\frac{a}{b}}}}`

```
 ╭───
 │ n
 │───
╰╯ m ╭─────
     │ ╭───
     │ │ a
     │ │───
    ╰╯╰╯ b
```

```
 ╭───
   n
√ ───
   m ╭─────
       ╭───
         a
    √ √ ───
         b
```

`\sqrt[\textcolor{blue}{\text{\u6B21}}]{\textcolor{red}{\text{\u754C}}}`

```
\u6B21╭──────
     ╰╯\u754C
```

```
\u6B21╭──────
     √ \u754C
```

`\sqrt[\textcolor{blue}{\frac{1}{2}}]{\textcolor{red}{}}`

```
 1
───
 2 ╭
  ╰╯
```

```
 1
───
 2 ╭
  √
```

`\sqrt{\sqrt{\sqrt{x}}}`

```
 ╭─────
 │ ╭───
 │ │ ╭─
╰╯╰╯╰╯x
```

```
 ╭─────
   ╭───
     ╭─
√ √ √ x
```

`\sqrt{\frac{a}{b}}`

```
 ╭───
 │ a
 │───
╰╯ b
```

```
 ╭───
   a
√ ───
   b
```

`\sqrt[3]{x}`

```
3╭─
╰╯x
```

```
3╭─
√ x
```

`\sqrt[\frac{1}{2}]{x}`

```
 1
───
 2 ╭─
  ╰╯x
```

```
 1
───
 2 ╭─
  √ x
```

`\sqrt[\sqrt{n}]{x}`

```
 ╭─
╰╯n╭─
  ╰╯x
```

```
 ╭─
√ n╭─
  √ x
```

`x=\sqrt{\frac{1}{2}}`

```
     ╭───
     │ 1
x =  │───
    ╰╯ 2
```

```
     ╭───
       1
x = √ ───
       2
```

`\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}`

```
              ╭─
 ∞  -x²      ╰╯π
∫  e   dx = ─────
 0            2
```

```
              ╭─
 ∞  -x²      √ π
∫  e   dx = ─────
 0            2
```

`\sqrt[n]{x^n + y^n}`

```
n╭───────
╰╯xⁿ + yⁿ
```

```
n╭───────
√ xⁿ + yⁿ
```

### Matrix rows

`\begin{pmatrix}a & b \\ c & d\end{pmatrix}`

```
⎛a b⎞
⎜   ⎟
⎝c d⎠
```

```
⎛a b⎞
⎝c d⎠
```

`\begin{pmatrix}a&b\\c&d\end{pmatrix}`

```
⎛a b⎞
⎜   ⎟
⎝c d⎠
```

```
⎛a b⎞
⎝c d⎠
```

`\begin{pmatrix}a&b\\c&d\end{pmatrix}^{}`

```
⎛a b⎞
⎜   ⎟
⎝c d⎠
```

```
⎛a b⎞
⎝c d⎠
```

`\begin{pmatrix}a&b\\c&d\end{pmatrix}_{}`

```
⎛a b⎞
⎜   ⎟
⎝c d⎠
```

```
⎛a b⎞
⎝c d⎠
```

`\begin{pmatrix}a&b\\c&d\end{pmatrix}^{}_{}`

```
⎛a b⎞
⎜   ⎟
⎝c d⎠
```

```
⎛a b⎞
⎝c d⎠
```

`\begin{pmatrix}a&b\\c&d\end{pmatrix}^2`

```
     2
⎛a b⎞
⎜   ⎟
⎝c d⎠
```

```
     2
⎛a b⎞
⎝c d⎠
```

`\begin{cases}x & x>0\\x^2+1 & x\le0\end{cases}`

```
⎧x       x > 0
⎨
⎩x² + 1  x ≤ 0
```

```
⎧x       x > 0
⎩x² + 1  x ≤ 0
```

`\begin{array}{l|r}\text{a}&\text{wide}\\\text{long}&\text{b}\end{array}`

```
a    │ wide
     │
long │    b
```

```
a    │ wide
long │    b
```

`\begin{array}{|l||r|}\text{a}&\text{b}\\\text{long}&\text{c}\end{array}`

```
│ a    ││ b │
│      ││   │
│ long ││ c │
```

```
│ a    ││ b │
│ long ││ c │
```

`\displaylines{x=1\\y=2}`

```
x = 1

y = 2
```

```
x = 1
y = 2
```

`\begin{aligned}&=x\\&=y\end{aligned}`

```
  = x

  = y
```

```
  = x
  = y
```

`\begin{aligned}{}&=x\\{}&=y\end{aligned}`

```
  = x

  = y
```

```
  = x
  = y
```

`\begin{array}{cc}a & b \\ c & d\end{array}`

```
a b

c d
```

```
a b
c d
```

`\begin{align*}a &= b \\ c &= d\end{align*}`

```
a  = b

c  = d
```

```
a  = b
c  = d
```

`\begin{matrix}a&&\\&b&\end{matrix}`

```
a

  b
```

```
a
  b
```

`\displaylines{\frac{1}{2}\\{y}}+z`

```
 1
───
 2  +z

 y
```

```
 1
───
 2  +z
 y
```

`\begin{array}{l|r}a&wide\\long&b\end{array}`

```
a    │ wide
     │
long │    b
```

```
a    │ wide
long │    b
```

`\begin{aligned}a&=b+c\\&=d\end{aligned}`

```
a  = b + c

   = d
```

```
a  = b + c
   = d
```

`\begin{bmatrix}1 & 0 \\ 0 & 1\end{bmatrix} \begin{Bmatrix}a\end{Bmatrix} \begin{vmatrix}a & b \\ c & d\end{vmatrix} \begin{Vmatrix}x\end{Vmatrix}`

```
⎡1 0⎤     │a b│
⎢   ⎥ {a} │   │ ║x║
⎣0 1⎦     │c d│
```

```
⎡1 0⎤     │a b│
⎣0 1⎦ {a} │c d│ ║x║
```

`\begin{gather}a = b \\ c = d\end{gather} \begin{smallmatrix}1&2\end{smallmatrix}`

```
a = b
      1 2
c = d
```

```
a = b
c = d 1 2
```

`\begin{cases} 0 & \text{if } x < 0 \\ \frac{x}{2} & \text{otherwise} \end{cases}`

```
⎧0    if x < 0
⎪
⎨ x
⎪───  otherwise
⎩ 2
```

```
⎧0    if x < 0
⎪ x
⎨───  otherwise
⎩ 2
```

`\begin{pmatrix} \frac{1}{2} & 0 \\ 0 & \sqrt{2} \end{pmatrix}`

```
⎛ 1     ⎞
⎜───  0 ⎟
⎜ 2     ⎟
⎜       ⎟
⎜     ╭─⎟
⎝ 0  ╰╯2⎠
```

```
⎛ 1     ⎞
⎜───  0 ⎟
⎜ 2     ⎟
⎜     ╭─⎟
⎝ 0  √ 2⎠
```

`\begin{aligned} f(x) &= (x+1)^2 \\ &= x^2 + 2x + 1 \end{aligned}`

```
f(x)  = (x + 1)²

      = x² + 2x + 1
```

```
f(x)  = (x + 1)²
      = x² + 2x + 1
```

### Epsilon

`\alpha\beta\gamma\Gamma\epsilon\varepsilon\phi\varphi \infty \partial \forall \exists \emptyset`

```
αβγΓεϵϕφ∞∂∀∃∅
```

```
αβγΓϵεϕφ∞∂∀∃∅
```

### A leading directive adds no space

`\displaystyle \frac{a}{b} \textstyle c \scriptstyle d`

```
  a
 ─── cd
  b
```

```
 a
─── cd
 b
```

### Nothing to draw

`\begin{matrix}\\\end{matrix}`

```
(nothing)
```

```
(fails: the fence shows its source)
```

`\not`

```
(nothing)
```

```
(fails: the fence shows its source)
```

The empty source

```
(nothing)
```

```
(fails: the fence shows its source)
```

A source of three spaces

```
(nothing)
```

```
(fails: the fence shows its source)
```
