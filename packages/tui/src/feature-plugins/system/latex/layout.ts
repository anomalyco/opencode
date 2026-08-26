import type { MathCell, MathLayout, MathNode, MathStyle, MathVariant, RenderLatexOptions, SymbolRole } from "./types"

interface Box {
  width: number
  height: number
  baseline: number
  cells: Array<Array<MathCell | undefined>>
}

interface LayoutContext {
  displayMode: boolean
  compactScripts: boolean
  style?: MathStyle
  variant?: MathVariant
}

const superscripts: Readonly<Record<string, string>> = {
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
}

const subscripts: Readonly<Record<string, string>> = {
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

export function layoutMath(node: MathNode, options: RenderLatexOptions = {}): MathLayout {
  const context: LayoutContext = {
    displayMode: options.displayMode ?? true,
    compactScripts: options.compactScripts ?? true,
    ...(options.color ? { style: { color: options.color } } : {}),
  }
  return asPublicLayout(layoutNode(node, context))
}

function layoutNode(node: MathNode, context: LayoutContext): Box {
  switch (node.type) {
    case "row":
      return layoutRow(node.body, context)
    case "symbol":
      return textBox(applyVariant(node.value, context.variant), context.style)
    case "text":
      return textBox(applyVariant(node.value, context.variant), context.style)
    case "space":
      return blank(node.width, 1, 0)
    case "fraction":
      return layoutFraction(node.numerator, node.denominator, node.bar, context)
    case "root":
      return layoutRoot(node.body, node.index, context)
    case "scripts":
      return layoutScripts(node, context)
    case "delimited":
      return layoutDelimited(node.left, node.body, node.right, context)
    case "matrix":
      return layoutMatrix(node.rows, node.environment, context)
    case "accent":
      return layoutAccent(node.accent, node.body, context)
    case "variant":
      return layoutNode(node.body, withVariant(context, node.variant))
    case "operator":
      return textBox(applyVariant(node.value, context.variant), context.style)
    case "overunder":
      return layoutOverUnder(node.base, node.over, node.under, context)
    case "color":
      return layoutNode(node.body, { ...context, style: mergeStyle(context.style, { color: node.color }) })
  }
  throw new Error("Unsupported math node")
}

function layoutRow(nodes: MathNode[], context: LayoutContext): Box {
  if (nodes.length === 0) return blank(0, 1, 0)

  const boxes: Box[] = []
  let previousRole: SymbolRole | undefined

  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]
    const rawRole = nodeRole(node)
    const role = normalizeBinaryRole(rawRole, previousRole, nextSignificantRole(nodes, index + 1))
    if (needsMathSpace(previousRole, role, boxes.length)) boxes.push(blank(1, 1, 0))
    boxes.push(layoutNode(node, context))
    if (node.type !== "space") previousRole = role ?? "ordinary"
  }

  return hpack(boxes)
}

function layoutFraction(numeratorNode: MathNode, denominatorNode: MathNode, bar: boolean, context: LayoutContext): Box {
  const numerator = layoutNode(numeratorNode, context)
  const denominator = layoutNode(denominatorNode, context)
  const width = Math.max(numerator.width, denominator.width) + 2
  // Barless fractions (binomials) still reserve an axis row so surrounding
  // atoms and their stretching parentheses align between the two entries.
  const gap = 1
  const height = numerator.height + denominator.height + gap
  // TeX places a fraction's math axis on its rule (or the equivalent empty
  // axis row for a binomial). Align neighbors there, not on the denominator.
  const baseline = numerator.height
  const result = blank(width, height, baseline)

  overlay(result, numerator, Math.floor((width - numerator.width) / 2), 0)
  if (bar) drawHorizontal(result, numerator.height, 0, width, "─", context.style)
  overlay(result, denominator, Math.floor((width - denominator.width) / 2), numerator.height + gap)
  return result
}

function layoutRoot(bodyNode: MathNode, indexNode: MathNode | undefined, context: LayoutContext): Box {
  const body = layoutNode(bodyNode, context)
  const index = indexNode ? layoutNode(indexNode, context) : undefined
  const indexWidth = index ? Math.max(0, index.width - 1) : 0
  const bodyX = indexWidth + 2
  const width = bodyX + body.width
  const height = body.height + 1
  const baseline = body.baseline + 1
  const result = blank(width, height, baseline)

  setCell(result, bodyX - 1, 0, "╭", context.style)
  drawHorizontal(result, 0, bodyX, body.width, "─", context.style)
  setCell(result, bodyX - 2, baseline, "√", context.style)
  overlay(result, body, bodyX, 1)
  if (index) overlay(result, index, 0, 0)
  return result
}

function layoutScripts(node: Extract<MathNode, { type: "scripts" }>, context: LayoutContext): Box {
  const simpleBase = layoutNode(node.base, context)
  const superscriptText = node.superscript ? simpleNodeText(node.superscript) : undefined
  const subscriptText = node.subscript ? simpleNodeText(node.subscript) : undefined
  const canCompactBase = !(node.base.type === "operator" && node.base.limits && context.displayMode)

  if (context.compactScripts && canCompactBase && superscriptText !== undefined && subscriptText !== undefined) {
    const compactSuperscript = mapScript(superscriptText, superscripts)
    const compactSubscript = mapScript(subscriptText, subscripts)
    if (compactSuperscript !== undefined && compactSubscript !== undefined) {
      return hpack([simpleBase, textBox(compactSuperscript, context.style), textBox(compactSubscript, context.style)])
    }
  }

  if (
    context.compactScripts &&
    canCompactBase &&
    !(node.superscript && node.subscript) &&
    superscriptText !== undefined
  ) {
    const compact = mapScript(superscriptText, superscripts)
    if (compact !== undefined) return hpack([simpleBase, textBox(compact, context.style)])
  }
  if (
    context.compactScripts &&
    canCompactBase &&
    !(node.superscript && node.subscript) &&
    subscriptText !== undefined
  ) {
    const compact = mapScript(subscriptText, subscripts)
    if (compact !== undefined) return hpack([simpleBase, textBox(compact, context.style)])
  }

  if (node.base.type === "operator" && node.base.limits && context.displayMode) {
    return layoutOverUnder(node.base, node.superscript, node.subscript, context)
  }

  const superscript = node.superscript ? layoutNode(node.superscript, context) : undefined
  const subscript = node.subscript ? layoutNode(node.subscript, context) : undefined
  const scriptWidth = Math.max(superscript?.width ?? 0, subscript?.width ?? 0)
  const topHeight = superscript?.height ?? 0
  const bottomHeight = subscript?.height ?? 0
  const width = simpleBase.width + scriptWidth
  const height = topHeight + simpleBase.height + bottomHeight
  const baseline = topHeight + simpleBase.baseline
  const result = blank(width, height, baseline)

  overlay(result, simpleBase, 0, topHeight)
  if (superscript) overlay(result, superscript, simpleBase.width, 0)
  if (subscript) overlay(result, subscript, simpleBase.width, topHeight + simpleBase.height)
  return result
}

function layoutOverUnder(
  baseNode: MathNode,
  overNode: MathNode | undefined,
  underNode: MathNode | undefined,
  context: LayoutContext,
): Box {
  const base = layoutNode(baseNode, context)
  const over = overNode ? layoutNode(overNode, context) : undefined
  const under = underNode ? layoutNode(underNode, context) : undefined
  const width = Math.max(base.width, over?.width ?? 0, under?.width ?? 0)
  const overHeight = over?.height ?? 0
  const height = overHeight + base.height + (under?.height ?? 0)
  const baseline = overHeight + base.baseline
  const result = blank(width, height, baseline)

  if (over) overlay(result, over, Math.floor((width - over.width) / 2), 0)
  overlay(result, base, Math.floor((width - base.width) / 2), overHeight)
  if (under) overlay(result, under, Math.floor((width - under.width) / 2), overHeight + base.height)
  return result
}

function layoutDelimited(left: string, bodyNode: MathNode, right: string, context: LayoutContext): Box {
  const body = layoutNode(bodyNode, context)
  const leftBox = delimiterBox(left, body.height, body.baseline, true, context.style)
  const rightBox = delimiterBox(right, body.height, body.baseline, false, context.style)
  return hpack([leftBox, body, rightBox])
}

function layoutMatrix(
  rows: MathNode[][],
  environment: Extract<MathNode, { type: "matrix" }>["environment"],
  context: LayoutContext,
): Box {
  const cellRows = rows.map((row) => row.map((cell) => layoutNode(cell, context)))
  const columnCount = Math.max(0, ...cellRows.map((row) => row.length))
  const columnWidths = Array.from({ length: columnCount }, (_, column) =>
    Math.max(0, ...cellRows.map((row) => row[column]?.width ?? 0)),
  )
  const rowAscents = cellRows.map((row) => Math.max(0, ...row.map((cell) => cell.baseline)))
  const rowDescents = cellRows.map((row) => Math.max(0, ...row.map((cell) => cell.height - cell.baseline - 1)))
  const rowHeights = rowAscents.map((ascent, index) => ascent + 1 + rowDescents[index])
  const columnGap = environment === "cases" ? 2 : environment === "aligned" || environment === "align" ? 2 : 1
  const width = columnWidths.reduce((sum, value) => sum + value, 0) + Math.max(0, columnCount - 1) * columnGap
  const height = Math.max(1, rowHeights.reduce((sum, value) => sum + value, 0) + Math.max(0, rows.length - 1))
  const result = blank(width, height, Math.floor(height / 2))
  let y = 0

  for (let rowIndex = 0; rowIndex < cellRows.length; rowIndex++) {
    let x = 0
    const cells = cellRows[rowIndex]
    for (let column = 0; column < columnCount; column++) {
      const cell = cells[column]
      const columnWidth = columnWidths[column]
      if (cell) {
        const centered = environment !== "aligned" && environment !== "align" && environment !== "cases"
        const cellX =
          x + (centered ? Math.floor((columnWidth - cell.width) / 2) : column % 2 === 0 ? columnWidth - cell.width : 0)
        const cellY = y + rowAscents[rowIndex] - cell.baseline
        overlay(result, cell, cellX, cellY)
      }
      x += columnWidth + columnGap
    }
    y += rowHeights[rowIndex] + 1
  }

  const delimiters = matrixDelimiters(environment)
  return delimiters
    ? hpack([
        delimiterBox(delimiters[0], height, result.baseline, true, context.style),
        result,
        delimiterBox(delimiters[1], height, result.baseline, false, context.style),
      ])
    : result
}

function layoutAccent(
  accent: Extract<MathNode, { type: "accent" }>["accent"],
  bodyNode: MathNode,
  context: LayoutContext,
): Box {
  const body = layoutNode(bodyNode, context)
  if (accent === "underline") {
    const result = blank(body.width, body.height + 1, body.baseline)
    overlay(result, body, 0, 0)
    drawHorizontal(result, body.height, 0, body.width, "─", context.style)
    return result
  }

  const result = blank(body.width, body.height + 1, body.baseline + 1)
  overlay(result, body, 0, 1)
  const mark =
    accent === "hat" || accent === "widehat"
      ? body.width === 1
        ? "^"
        : "⌢"
      : accent === "bar" || accent === "overline"
        ? "─"
        : accent === "vec"
          ? "→"
          : accent === "tilde"
            ? "~"
            : accent === "dot"
              ? "·"
              : "¨"

  if (accent === "bar" || accent === "overline") drawHorizontal(result, 0, 0, body.width, mark, context.style)
  else setCell(result, Math.max(0, Math.floor((body.width - cellWidth(mark)) / 2)), 0, mark, context.style)
  return result
}

function delimiterBox(
  delimiter: string,
  height: number,
  baseline: number,
  left: boolean,
  style: MathStyle | undefined,
): Box {
  if (!delimiter) return blank(0, height, baseline)
  if (height <= 1) return textBox(delimiter, style)
  const glyphs = delimiterGlyphs(delimiter)
  const width = Math.max(...glyphs.map(cellWidth))
  const result = blank(width, height, baseline)
  for (let y = 0; y < height; y++) {
    const glyph = y === 0 ? glyphs[0] : y === height - 1 ? glyphs[2] : glyphs[1]
    setCell(result, 0, y, glyph, style)
  }
  if ((delimiter === "{" || delimiter === "}") && height >= 3) {
    setCell(result, 0, Math.floor(height / 2), left ? "⎨" : "⎬", style)
  }
  return result
}

function delimiterGlyphs(delimiter: string): [string, string, string] {
  switch (delimiter) {
    case "(":
      return ["⎛", "⎜", "⎝"]
    case ")":
      return ["⎞", "⎟", "⎠"]
    case "[":
      return ["⎡", "⎢", "⎣"]
    case "]":
      return ["⎤", "⎥", "⎦"]
    case "{":
      return ["⎧", "⎪", "⎩"]
    case "}":
      return ["⎫", "⎪", "⎭"]
    case "⌊":
      return ["│", "│", "⌊"]
    case "⌋":
      return ["│", "│", "⌋"]
    case "⌈":
      return ["⌈", "│", "│"]
    case "⌉":
      return ["⌉", "│", "│"]
    case "⟨":
      return ["/", "│", "\\"]
    case "⟩":
      return ["\\", "│", "/"]
    default:
      return [delimiter, delimiter, delimiter]
  }
}

function matrixDelimiters(environment: string): [string, string] | undefined {
  switch (environment) {
    case "pmatrix":
      return ["(", ")"]
    case "bmatrix":
      return ["[", "]"]
    case "Bmatrix":
      return ["{", "}"]
    case "vmatrix":
      return ["│", "│"]
    case "Vmatrix":
      return ["║", "║"]
    case "cases":
      return ["{", ""]
    default:
      return undefined
  }
}

function hpack(boxes: Box[]): Box {
  if (boxes.length === 0) return blank(0, 1, 0)
  const ascent = Math.max(...boxes.map((box) => box.baseline))
  const descent = Math.max(...boxes.map((box) => box.height - box.baseline - 1))
  const width = boxes.reduce((sum, box) => sum + box.width, 0)
  const result = blank(width, ascent + descent + 1, ascent)
  let x = 0
  for (const box of boxes) {
    overlay(result, box, x, ascent - box.baseline)
    x += box.width
  }
  return result
}

function textBox(text: string, style?: MathStyle): Box {
  const graphemes = segment(text)
  const width = graphemes.reduce((sum, grapheme) => sum + cellWidth(grapheme), 0)
  const result = blank(width, 1, 0)
  let x = 0
  for (const grapheme of graphemes) {
    setCell(result, x, 0, grapheme, style)
    x += cellWidth(grapheme)
  }
  return result
}

function blank(width: number, height: number, baseline: number): Box {
  return {
    width: Math.max(0, width),
    height: Math.max(1, height),
    baseline: Math.max(0, baseline),
    cells: Array.from({ length: Math.max(1, height) }, () => Array<MathCell | undefined>(Math.max(0, width))),
  }
}

function overlay(target: Box, source: Box, x: number, y: number): void {
  for (let sourceY = 0; sourceY < source.height; sourceY++) {
    for (let sourceX = 0; sourceX < source.width; sourceX++) {
      const cell = source.cells[sourceY]?.[sourceX]
      if (cell) target.cells[y + sourceY][x + sourceX] = cell
    }
  }
}

function drawHorizontal(
  box: Box,
  y: number,
  x: number,
  width: number,
  char: string,
  style: MathStyle | undefined,
): void {
  for (let offset = 0; offset < width; offset++) setCell(box, x + offset, y, char, style)
}

function setCell(box: Box, x: number, y: number, char: string, style?: MathStyle): void {
  if (x < 0 || y < 0 || x >= box.width || y >= box.height) return
  box.cells[y][x] = style ? { char, style } : { char }
}

function nodeRole(node: MathNode): SymbolRole | undefined {
  if (node.type === "symbol") return node.role
  if (node.type === "operator") return "operator"
  // Tall constructs need a terminal-cell side bearing. Treating them like
  // operators gives their fraction bars/radical hooks breathing room without
  // adding padding inside the construct itself.
  if (node.type === "fraction" || node.type === "root" || node.type === "matrix") return "operator"
  if (node.type === "scripts") return nodeRole(node.base)
  return undefined
}

function needsMathSpace(previous: SymbolRole | undefined, current: SymbolRole | undefined, count: number): boolean {
  if (count === 0) return false
  if (previous === "punctuation" || previous === "opening" || current === "punctuation" || current === "closing") {
    return false
  }
  return (
    previous === "binary" ||
    previous === "relation" ||
    previous === "operator" ||
    current === "binary" ||
    current === "relation" ||
    current === "operator"
  )
}

function normalizeBinaryRole(
  role: SymbolRole | undefined,
  previous: SymbolRole | undefined,
  next: SymbolRole | undefined,
): SymbolRole | undefined {
  if (role !== "binary") return role
  if (
    previous === undefined ||
    previous === "binary" ||
    previous === "relation" ||
    previous === "operator" ||
    previous === "punctuation" ||
    previous === "opening" ||
    next === undefined ||
    next === "binary" ||
    next === "relation" ||
    next === "punctuation" ||
    next === "closing"
  ) {
    return "ordinary"
  }
  return role
}

function nextSignificantRole(nodes: MathNode[], start: number): SymbolRole | undefined {
  for (let index = start; index < nodes.length; index++) {
    const node = nodes[index]
    if (node.type === "space") continue
    return nodeRole(node) ?? "ordinary"
  }
  return undefined
}

function simpleNodeText(node: MathNode): string | undefined {
  if (node.type === "symbol" || node.type === "text" || node.type === "operator") return node.value
  if (node.type === "row") {
    const values = node.body.map(simpleNodeText)
    return values.every((value) => value !== undefined) ? values.join("") : undefined
  }
  return undefined
}

function mapScript(value: string, table: Readonly<Record<string, string>>): string | undefined {
  let result = ""
  for (const char of value) {
    const mapped = table[char]
    if (!mapped) return undefined
    result += mapped
  }
  return result
}

function withVariant(context: LayoutContext, variant: MathVariant): LayoutContext {
  const style =
    variant === "bold"
      ? { bold: true }
      : variant === "italic"
        ? { italic: true }
        : variant === "sans"
          ? {}
          : variant === "monospace"
            ? {}
            : {}
  return { ...context, variant, style: mergeStyle(context.style, style) }
}

function applyVariant(value: string, variant: MathVariant | undefined): string {
  if (!variant || variant === "normal" || variant === "bold" || variant === "italic") return value

  const exceptions: Partial<Record<MathVariant, Readonly<Record<string, string>>>> = {
    "double-struck": {
      C: "ℂ",
      H: "ℍ",
      N: "ℕ",
      P: "ℙ",
      Q: "ℚ",
      R: "ℝ",
      Z: "ℤ",
    },
    script: {
      B: "ℬ",
      E: "ℰ",
      F: "ℱ",
      H: "ℋ",
      I: "ℐ",
      L: "ℒ",
      M: "ℳ",
      R: "ℛ",
      e: "ℯ",
      g: "ℊ",
      o: "ℴ",
    },
    fraktur: {
      C: "ℭ",
      H: "ℌ",
      I: "ℑ",
      R: "ℜ",
      Z: "ℨ",
    },
  }

  const ranges: Partial<Record<MathVariant, readonly [number, number, number?]>> = {
    "double-struck": [0x1d538, 0x1d552, 0x1d7d8],
    script: [0x1d49c, 0x1d4b6],
    fraktur: [0x1d504, 0x1d51e],
    sans: [0x1d5a0, 0x1d5ba, 0x1d7e2],
    monospace: [0x1d670, 0x1d68a, 0x1d7f6],
  }
  const range = ranges[variant]
  if (!range) return value

  return Array.from(value)
    .map((char) => {
      const exception = exceptions[variant]?.[char]
      if (exception) return exception
      const code = char.codePointAt(0)!
      if (code >= 65 && code <= 90) return String.fromCodePoint(range[0] + code - 65)
      if (code >= 97 && code <= 122) return String.fromCodePoint(range[1] + code - 97)
      if (range[2] !== undefined && code >= 48 && code <= 57) return String.fromCodePoint(range[2] + code - 48)
      return char
    })
    .join("")
}

function mergeStyle(base: MathStyle | undefined, overlayStyle: MathStyle): MathStyle {
  return { ...base, ...overlayStyle }
}

function segment(value: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].map((item) => item.segment)
  }
  return Array.from(value)
}

function cellWidth(value: string): number {
  if (value.length === 0) return 0
  if (/^(?:[\u0000-\u001f\u007f-\u009f]|[\u0300-\u036f]|[\ufe00-\ufe0f])$/u.test(value)) return 0
  const code = value.codePointAt(0) ?? 0
  if (
    code >= 0x1100 &&
    (code <= 0x115f ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff))
  ) {
    return 2
  }
  return 1
}

function asPublicLayout(box: Box): MathLayout {
  return {
    width: box.width,
    height: box.height,
    baseline: box.baseline,
    cells: box.cells,
    toString() {
      return box.cells
        .map((row) => {
          let output = ""
          for (let x = 0; x < box.width; x++) {
            const cell = row[x]
            output += cell?.char ?? " "
            if (cell && cellWidth(cell.char) > 1) x += cellWidth(cell.char) - 1
          }
          return output.trimEnd()
        })
        .join("\n")
    },
  }
}
