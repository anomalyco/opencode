/**
 * Best-effort LaTeX → Unicode for the OpenCode TUI.
 *
 * Terminals cannot run KaTeX. This module rewrites common math delimiters into
 * readable Unicode so assistant replies stay legible without a full TeX engine.
 *
 * Scope (intentionally limited):
 *   - Delimiters: $$…$$, \[…\], \(…\), $…$ (when math-like), \begin{equation|align|…}
 *   - Commands: greek, relations, sum/prod/int, frac, sqrt, mathbb/mathrm/…
 *   - Scripts: unicode sub/superscripts where glyphs exist; otherwise ₍…₎ / ⁽…⁾
 *
 * Non-goals:
 *   - Pixel-perfect layout, stacked fractions, matrices, aligned columns
 *   - Web/desktop KaTeX (separate surface — see linked issues)
 *
 * Currency safety: bare $…$ only converts when the body looks like math
 * (contains \ or ^ or _), so "$0.02/GB" is left alone.
 */

// ---------------------------------------------------------------------------
// Symbol tables
// ---------------------------------------------------------------------------

const GREEK: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  vartheta: "ϑ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  varpi: "ϖ",
  rho: "ρ",
  varrho: "ϱ",
  sigma: "σ",
  varsigma: "ς",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  varphi: "ϕ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Upsilon: "Υ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
}

/** Commands that expand to a fixed string (empty = strip). */
const CMDS: Record<string, string> = {
  // operators
  cdot: "·",
  times: "×",
  div: "÷",
  pm: "±",
  mp: "∓",
  ast: "∗",
  star: "⋆",
  circ: "∘",
  bullet: "•",
  oplus: "⊕",
  otimes: "⊗",
  ominus: "⊖",
  oslash: "⊘",
  odot: "⊙",
  // infinity / calculus
  infty: "∞",
  partial: "∂",
  nabla: "∇",
  // logic / sets
  forall: "∀",
  exists: "∃",
  nexists: "∄",
  emptyset: "∅",
  varnothing: "∅",
  in: "∈",
  notin: "∉",
  ni: "∋",
  subset: "⊂",
  supset: "⊃",
  subseteq: "⊆",
  supseteq: "⊇",
  cup: "∪",
  cap: "∩",
  vee: "∨",
  wedge: "∧",
  neg: "¬",
  lnot: "¬",
  land: "∧",
  lor: "∨",
  // arrows
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  leftrightarrow: "↔",
  Rightarrow: "⇒",
  Leftarrow: "⇐",
  Leftrightarrow: "⇔",
  mapsto: "↦",
  implies: "⟹",
  iff: "⟺",
  // relations
  leq: "≤",
  le: "≤",
  geq: "≥",
  ge: "≥",
  neq: "≠",
  ne: "≠",
  approx: "≈",
  sim: "∼",
  simeq: "≃",
  cong: "≅",
  equiv: "≡",
  propto: "∝",
  ll: "≪",
  gg: "≫",
  prec: "≺",
  succ: "≻",
  preceq: "⪯",
  succeq: "⪰",
  models: "⊨",
  vdash: "⊢",
  dashv: "⊣",
  perp: "⊥",
  parallel: "∥",
  mid: "∣",
  nmid: "∤",
  // big ops
  sum: "∑",
  prod: "∏",
  int: "∫",
  oint: "∮",
  bigcup: "⋃",
  bigcap: "⋂",
  bigvee: "⋁",
  bigwedge: "⋀",
  bigoplus: "⨁",
  bigotimes: "⨂",
  // delimiters
  langle: "⟨",
  rangle: "⟩",
  lfloor: "⌊",
  rfloor: "⌋",
  lceil: "⌈",
  rceil: "⌉",
  vert: "|",
  Vert: "‖",
  lVert: "‖",
  rVert: "‖",
  // misc
  ell: "ℓ",
  hbar: "ℏ",
  Re: "ℜ",
  Im: "ℑ",
  aleph: "ℵ",
  wp: "℘",
  degree: "°",
  prime: "′",
  primes: "′",
  backslash: "\\",
  angle: "∠",
  triangle: "△",
  square: "□",
  diamond: "⋄",
  // spacing
  quad: "  ",
  qquad: "    ",
  comma: ",",
  colon: ":",
  // function names kept as text
  log: "log",
  ln: "ln",
  exp: "exp",
  sin: "sin",
  cos: "cos",
  tan: "tan",
  max: "max",
  min: "min",
  arg: "arg",
  det: "det",
  dim: "dim",
  ker: "ker",
  // sizing / style no-ops
  left: "",
  right: "",
  big: "",
  Big: "",
  bigg: "",
  Bigg: "",
  biggl: "",
  biggr: "",
  Biggl: "",
  Biggr: "",
  displaystyle: "",
  textstyle: "",
  scriptstyle: "",
  scriptscriptstyle: "",
  limits: "",
  nolimits: "",
  notag: "",
  nonumber: "",
}

const SUP: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
  n: "ⁿ",
  i: "ⁱ",
  a: "ᵃ",
  b: "ᵇ",
  c: "ᶜ",
  d: "ᵈ",
  e: "ᵉ",
  f: "ᶠ",
  g: "ᵍ",
  h: "ʰ",
  j: "ʲ",
  k: "ᵏ",
  l: "ˡ",
  m: "ᵐ",
  o: "ᵒ",
  p: "ᵖ",
  r: "ʳ",
  s: "ˢ",
  t: "ᵗ",
  u: "ᵘ",
  v: "ᵛ",
  w: "ʷ",
  x: "ˣ",
  y: "ʸ",
  z: "ᶻ",
  T: "ᵀ",
}

const SUB: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
  "+": "₊",
  "-": "₋",
  "=": "₌",
  "(": "₍",
  ")": "₎",
  a: "ₐ",
  e: "ₑ",
  h: "ₕ",
  i: "ᵢ",
  j: "ⱼ",
  k: "ₖ",
  l: "ₗ",
  m: "ₘ",
  n: "ₙ",
  o: "ₒ",
  p: "ₚ",
  r: "ᵣ",
  s: "ₛ",
  t: "ₜ",
  u: "ᵤ",
  v: "ᵥ",
  x: "ₓ",
}

const MATHBB: Record<string, string> = {
  R: "ℝ",
  N: "ℕ",
  Z: "ℤ",
  Q: "ℚ",
  C: "ℂ",
  P: "ℙ",
  E: "𝔼",
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapAll(s: string, table: Record<string, string>): string | null {
  let out = ""
  for (const ch of s) {
    if (ch === " " || ch === ",") {
      out += ch
      continue
    }
    const m = table[ch]
    if (!m) return null
    out += m
  }
  return out
}

function takeBrace(src: string, start: number): { body: string; end: number } | null {
  if (src[start] !== "{") return null
  let depth = 0
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++
    else if (src[i] === "}") {
      depth--
      if (depth === 0) return { body: src.slice(start + 1, i), end: i + 1 }
    }
  }
  return null
}

const SUB_RUN = /^[₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ]+$/
const SUP_RUN = /^[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱᵃᵇᶜᵈᵉᶠᵍʰʲᵏˡᵐᵒᵖʳˢᵗᵘᵛʷˣʸᶻᵀ]+$/

/** Map to unicode scripts; multi-char without full coverage uses ₍…₎ / ⁽…⁾ (never bare _). */
function toScript(inner: string, table: Record<string, string>, kind: "sup" | "sub"): string {
  const full = mapAll(inner, table)
  if (full !== null) return full

  // e^{z_i} body becomes "zᵢ" after inner conversion — prefer ᶻᵢ over ⁽zᵢ⁾
  if (kind === "sup" && inner.length >= 2) {
    const base = inner[0]
    const rest = inner.slice(1)
    if (SUP[base] && SUB_RUN.test(rest)) return SUP[base] + rest
  }
  if (kind === "sub" && inner.length >= 2) {
    const base = inner[0]
    const rest = inner.slice(1)
    if (SUB[base] && SUP_RUN.test(rest)) return SUB[base] + rest
  }

  let out = ""
  let complete = true
  for (const ch of inner) {
    if (table[ch]) out += table[ch]
    else if (" ,:<>".includes(ch)) out += ch
    else {
      out += ch
      complete = false
    }
  }
  if (complete) return out
  return kind === "sub" ? `₍${inner}₎` : `⁽${inner}⁾`
}

/** Heuristic: bare $…$ is math only if it contains TeX structure. */
function looksLikeMath(body: string): boolean {
  if (/\\[a-zA-Z]/.test(body)) return true
  if (/[_^]/.test(body)) return true
  if (/\{|\}/.test(body)) return true
  // single greek-ish letter sequences are not enough; require operator-ish content
  if (/[=<>≤≥≠≈∈∑∏∫]/.test(body) && /[A-Za-z]/.test(body)) return true
  return false
}

// ---------------------------------------------------------------------------
// Core conversion of a math body (no outer delimiters)
// ---------------------------------------------------------------------------

function convertMath(src: string): string {
  let s = src

  // 1. \frac{a}{b} (nested, iterative)
  for (let n = 0; n < 8; n++) {
    if (!s.includes("\\frac")) break
    let out = ""
    let i = 0
    while (i < s.length) {
      if (s.startsWith("\\frac", i)) {
        let j = i + 5
        while (s[j] === " ") j++
        const a = takeBrace(s, j)
        if (!a) {
          out += s[i++]
          continue
        }
        let k = a.end
        while (s[k] === " ") k++
        const b = takeBrace(s, k)
        if (!b) {
          out += s.slice(i, a.end)
          i = a.end
          continue
        }
        out += `(${convertMath(a.body).trim()})/(${convertMath(b.body).trim()})`
        i = b.end
        continue
      }
      out += s[i++]
    }
    s = out
  }

  // 2. roots
  s = s.replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^}]*)\}/g, (_, n, x) => `${n}√(${convertMath(x)})`)
  s = s.replace(/\\sqrt\s*\{([^}]*)\}/g, (_, x) => `√(${convertMath(x)})`)

  // 3. font wrappers / blackboard
  s = s.replace(/\\mathbb\s*\{([A-Za-z])\}/g, (_, ch) => MATHBB[ch] ?? ch)
  s = s.replace(/\\mathcal\s*\{([A-Za-z]+)\}/g, "$1")
  s = s.replace(
    /\\(?:text|textbf|textrm|textit|mathrm|mathbf|mathit|mathsf|mathtt|operatorname)\s*\{([^{}]*)\}/g,
    "$1",
  )

  // 4. named commands and greek (before scripts so \pi_\theta works)
  s = s.replace(/\\([a-zA-Z]+)/g, (_, name: string) => {
    if (GREEK[name]) return GREEK[name]
    if (name in CMDS) return CMDS[name]
    return name
  })

  // 5. braced then single-char scripts (repeat for nesting)
  for (let n = 0; n < 4; n++) {
    const before = s
    s = s.replace(/\^\{([^{}]*)\}/g, (_, body) => toScript(convertMath(body).trim(), SUP, "sup"))
    s = s.replace(/_\{([^{}]*)\}/g, (_, body) => toScript(convertMath(body).trim(), SUB, "sub"))
    if (s === before) break
  }
  // BMP letters/digits/greek already substituted
  s = s.replace(/_([\w\u0370-\u03FF+\-=])/gu, (_, ch) => SUB[ch] ?? `₍${ch}₎`)
  s = s.replace(/\^([\w\u0370-\u03FF+\-=])/gu, (_, ch) => SUP[ch] ?? `⁽${ch}⁾`)

  // 6. cleanup
  s = s.replace(/[{}]/g, "")
  s = s.replace(/\\[,;]/g, " ")
  s = s.replace(/\\!/g, "")
  s = s.replace(/~/g, " ")
  s = s.replace(/\\/g, "")

  // 7. spacing around relations; keep minus readable
  s = s.replace(/\s*([=≈≠≤≥×·])\s*/g, " $1 ")
  s = s.replace(/([^\s])-([^\s])/g, "$1 - $2")
  s = s.replace(/\s*,\s*/g, ", ")
  s = s.replace(/\s+/g, " ").trim()

  // collapse spaces inside pure subscript/superscript runs (∑ₜ ₌ ₁ → ∑ₜ₌₁)
  s = s.replace(/([∑∏∫])\s+([ₜᵢⱼₖₙₘₓ])/g, "$1$2")
  s = s.replace(/([₀-₉ₐ-ₓ₍₎₊₋₌])\s+([₀-₉ₐ-ₓ₍₎₊₋₌])/g, "$1$2")
  s = s.replace(/([⁰-⁹ⁿⁱᵃ-ᶻᵀ⁽⁾⁺⁻⁼])\s+([⁰-⁹ⁿⁱᵃ-ᶻᵀ⁽⁾⁺⁻⁼])/g, "$1$2")

  // conditioned-on bar
  s = s.replace(/\s+\|\s+/g, " ∣ ")
  s = s.replace(/\|/g, "∣")
  s = s.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")")

  // No raw _ / * left for the markdown layer to interpret as emphasis
  s = s.replace(/_/g, "")
  s = s.replace(/\*/g, "·")

  return s
}

// ---------------------------------------------------------------------------
// Delimiter rewrite
// ---------------------------------------------------------------------------

function displayBlock(body: string): string {
  return `\n\n    ${convertMath(body)}\n\n`
}

function replaceDelimiters(text: string): string {
  let s = text

  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, body) => displayBlock(body))
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_, body) => displayBlock(body))
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_, body) => convertMath(body))

  // bare $…$ — only when math-like (avoids $0.02/GB currency breakage)
  s = s.replace(/(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g, (full, body: string) => {
    if (!looksLikeMath(body)) return full
    return convertMath(body)
  })

  s = s.replace(
    /\\begin\{(?:equation|align|align\*|eqnarray|gather)\*?\}([\s\S]*?)\\end\{(?:equation|align|align\*|eqnarray|gather)\*?\}/g,
    (_, body: string) => {
      const lines = body
        .split("\\\\")
        .map((line) => convertMath(line.replace(/&/g, "  ")))
        .filter((line) => line.length > 0)
      return "\n\n" + lines.map((line) => `    ${line}`).join("\n") + "\n\n"
    },
  )

  return s
}

/**
 * Convert LaTeX math in markdown text to Unicode-friendly plain text for TUI display.
 * Safe to call on every assistant text/reasoning part; no-ops when no math markers present.
 */
export function latexToUnicode(text: string): string {
  if (!text) return text
  if (!/[\\$]/.test(text)) return text
  try {
    return replaceDelimiters(text)
  } catch {
    return text
  }
}
