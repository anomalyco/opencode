const SYMBOLS: Record<string, string> = {
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
  varphi: "φ",
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
  times: "×",
  cdot: "·",
  div: "÷",
  pm: "±",
  mp: "∓",
  ast: "∗",
  star: "⋆",
  circ: "∘",
  bullet: "•",
  approx: "≈",
  sim: "∼",
  simeq: "≃",
  cong: "≅",
  equiv: "≡",
  propto: "∝",
  neq: "≠",
  ne: "≠",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  ll: "≪",
  gg: "≫",
  lt: "<",
  gt: ">",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  gets: "←",
  leftrightarrow: "↔",
  Rightarrow: "⇒",
  Leftarrow: "⇐",
  Leftrightarrow: "⇔",
  implies: "⇒",
  iff: "⇔",
  mapsto: "↦",
  uparrow: "↑",
  downarrow: "↓",
  infty: "∞",
  partial: "∂",
  nabla: "∇",
  sum: "∑",
  prod: "∏",
  coprod: "∐",
  int: "∫",
  iint: "∬",
  oint: "∮",
  in: "∈",
  notin: "∉",
  ni: "∋",
  subset: "⊂",
  supset: "⊃",
  subseteq: "⊆",
  supseteq: "⊇",
  cup: "∪",
  cap: "∩",
  setminus: "∖",
  emptyset: "∅",
  varnothing: "∅",
  forall: "∀",
  exists: "∃",
  nexists: "∄",
  neg: "¬",
  lnot: "¬",
  land: "∧",
  wedge: "∧",
  lor: "∨",
  vee: "∨",
  oplus: "⊕",
  otimes: "⊗",
  perp: "⊥",
  parallel: "∥",
  mid: "∣",
  angle: "∠",
  degree: "°",
  prime: "′",
  ldots: "…",
  dots: "…",
  cdots: "⋯",
  vdots: "⋮",
  ddots: "⋱",
  therefore: "∴",
  because: "∵",
  langle: "⟨",
  rangle: "⟩",
  lfloor: "⌊",
  rfloor: "⌋",
  lceil: "⌈",
  rceil: "⌉",
  lvert: "|",
  rvert: "|",
  vert: "|",
  lVert: "‖",
  rVert: "‖",
  Vert: "‖",
  hbar: "ℏ",
  ell: "ℓ",
  Re: "ℜ",
  Im: "ℑ",
  aleph: "ℵ",
  quad: "  ",
  qquad: "    ",
  log: "log",
  ln: "ln",
  exp: "exp",
  sin: "sin",
  cos: "cos",
  tan: "tan",
  min: "min",
  max: "max",
  lim: "lim",
  sup: "sup",
  inf: "inf",
  arg: "arg",
  det: "det",
  gcd: "gcd",
  Pr: "Pr",
}

const ESCAPES: Record<string, string> = {
  ",": " ",
  ";": " ",
  ":": " ",
  " ": " ",
  "!": "",
  "\\": "\n",
  "{": "{",
  "}": "}",
  "%": "%",
  $: "$",
  "&": "&",
  "#": "#",
  _: "_",
  "|": "‖",
}

const TEXT = new Set(["text", "textrm", "textit", "textbf", "textsf", "texttt", "textnormal", "mbox", "emph"])

const STYLE = new Set([
  "mathrm",
  "mathit",
  "mathbf",
  "mathsf",
  "mathtt",
  "mathcal",
  "mathfrak",
  "mathscr",
  "operatorname",
  "boldsymbol",
  "bm",
  "boxed",
  "displaystyle",
  "textstyle",
])

const SIZING = new Set([
  "left",
  "right",
  "middle",
  "big",
  "Big",
  "bigg",
  "Bigg",
  "bigl",
  "bigr",
  "Bigl",
  "Bigr",
  "biggl",
  "biggr",
  "Biggl",
  "Biggr",
])

const ACCENTS: Record<string, string> = {
  bar: "\u0304",
  overline: "\u0305",
  hat: "\u0302",
  widehat: "\u0302",
  tilde: "\u0303",
  widetilde: "\u0303",
  vec: "\u20D7",
  dot: "\u0307",
  ddot: "\u0308",
}

const DOUBLE_STRUCK: Record<string, string> = {
  R: "ℝ",
  N: "ℕ",
  Z: "ℤ",
  Q: "ℚ",
  C: "ℂ",
  P: "ℙ",
  E: "𝔼",
}

const SUPERSCRIPT: Record<string, string> = {
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
  "−": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
  a: "ᵃ",
  b: "ᵇ",
  c: "ᶜ",
  d: "ᵈ",
  e: "ᵉ",
  f: "ᶠ",
  g: "ᵍ",
  h: "ʰ",
  i: "ⁱ",
  j: "ʲ",
  k: "ᵏ",
  l: "ˡ",
  m: "ᵐ",
  n: "ⁿ",
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
  "′": "′",
  "∗": "∗",
}

const SUBSCRIPT: Record<string, string> = {
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
  "−": "₋",
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

function script(value: string, map: Record<string, string>, marker: string) {
  const chars = Array.from(value)
  if (chars.length > 0 && chars.every((char) => map[char])) return chars.map((char) => map[char]).join("")
  return chars.length === 1 ? marker + value : `${marker}(${value})`
}

function atomic(value: string) {
  return /^[\p{L}\p{N}.,′]+$/u.test(value) || Array.from(value).length === 1
}

function wrap(value: string) {
  return atomic(value) ? value : `(${value})`
}

class Parser {
  private index = 0
  private text = false

  constructor(private readonly src: string) {}

  parse(until?: string): string {
    let out = ""
    while (this.index < this.src.length) {
      const char = this.src[this.index]
      if (until && char === until) {
        this.index++
        return out
      }
      out += this.next()
    }
    return out
  }

  private next(): string {
    const char = this.src[this.index++]
    if (char === "{") return this.parse("}")
    if (char === "}") return ""
    if (char === "\\") return this.command()
    if (char === "*") return "∗"
    if (char === "~") return " "
    if (this.text) return char
    if (char === "^") return script(this.argument(), SUPERSCRIPT, "^")
    if (char === "_") return script(this.argument(), SUBSCRIPT, "_")
    if (char === "&") return " "
    if (char === "'") return "′"
    return char
  }

  private textArgument(): string {
    const previous = this.text
    this.text = true
    const value = this.argument()
    this.text = previous
    return value
  }

  private argument(): string {
    while (this.src[this.index] === " ") this.index++
    if (this.index >= this.src.length) return ""
    return this.next()
  }

  private optional(): string | undefined {
    if (this.src[this.index] !== "[") return
    const end = this.src.indexOf("]", this.index)
    if (end === -1) return
    const value = new Parser(this.src.slice(this.index + 1, end)).parse()
    this.index = end + 1
    return value
  }

  private command(): string {
    const name = /^[a-zA-Z]+/.exec(this.src.slice(this.index))?.[0]
    if (!name) {
      const char = this.src[this.index++] ?? ""
      return ESCAPES[char] ?? char
    }
    this.index += name.length

    if (TEXT.has(name)) return this.textArgument()
    if (STYLE.has(name)) return this.argument()
    if (name === "mathbb") {
      const value = this.argument()
      return DOUBLE_STRUCK[value] ?? value
    }
    if (SIZING.has(name)) {
      while (this.src[this.index] === " ") this.index++
      if (this.src[this.index] === ".") {
        this.index++
        return ""
      }
      return this.argument()
    }
    if (name === "frac" || name === "dfrac" || name === "tfrac" || name === "cfrac") {
      const numerator = this.argument()
      const denominator = this.argument()
      return `${wrap(numerator)}/${wrap(denominator)}`
    }
    if (name === "sqrt") {
      const index = this.optional()
      const value = wrap(this.argument())
      if (index === "3") return "∛" + value
      if (index === "4") return "∜" + value
      return (index ? script(index, SUPERSCRIPT, "^") : "") + "√" + value
    }
    if (name === "binom") {
      const n = this.argument()
      const k = this.argument()
      return `C(${n}, ${k})`
    }
    if (name === "begin" || name === "end") {
      this.argument()
      return ""
    }
    const accent = ACCENTS[name]
    if (accent) {
      const value = this.argument()
      return Array.from(value).length === 1 ? value + accent : value
    }
    const symbol = SYMBOLS[name]
    if (symbol !== undefined) return symbol
    return "\\" + name
  }
}

export function latexToUnicode(src: string, display = false) {
  const lines = new Parser(src.trim())
    .parse()
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
  return lines.join(display ? "\n" : "; ")
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const MATH =
  /(`+)[^`][\s\S]*?\1(?!`)|\\\[([\s\S]+?)\\\]|(^|\n)([ \t]*)\$\$([\s\S]+?)\$\$|\\\(([^\n]+?)\\\)/g

function replaceMath(text: string) {
  return text.replace(
    MATH,
    (match, code?: string, bracket?: string, start?: string, indent?: string, dollars?: string, inline?: string) => {
      if (code) return match
      if (bracket !== undefined) return latexToUnicode(bracket, true)
      if (dollars !== undefined) return (start ?? "") + (indent ?? "") + latexToUnicode(dollars, true)
      if (inline !== undefined) return latexToUnicode(inline)
      return match
    },
  )
}

/** Converts LaTeX math in assistant markdown to plain Unicode for terminal display, leaving code untouched. */
export function renderMath(markdown: string) {
  if (!markdown.includes("\\(") && !markdown.includes("\\[") && !markdown.includes("$$")) return markdown
  const out: string[] = []
  let prose: string[] = []
  let fence: string | undefined
  const flush = () => {
    if (prose.length) out.push(replaceMath(prose.join("\n")))
    prose = []
  }
  for (const line of markdown.split("\n")) {
    const marker = FENCE.exec(line)?.[1]
    if (fence) {
      out.push(line)
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && !line.trim().slice(marker.length))
        fence = undefined
      continue
    }
    if (marker) {
      flush()
      fence = marker
      out.push(line)
      continue
    }
    prose.push(line)
  }
  flush()
  return out.join("\n")
}
