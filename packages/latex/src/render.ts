import { layoutMath } from "./layout"
import { parseLatex } from "./parser"
import type { MathLayout, RenderLatexOptions } from "./types"

export function renderLatex(source: string, options: RenderLatexOptions = {}): MathLayout {
  return layoutMath(parseLatex(source, options), options)
}

export function renderLatexToString(source: string, options: RenderLatexOptions = {}): string {
  return renderLatex(source, options).toString()
}
