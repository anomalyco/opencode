import katex from "katex"

/** The fence languages drawn as display math, the same ones the TUI's latex plugin draws. */
export const latexLanguages = ["latex", "math"] as const

/** Renders a fenced block's source as display math, or `undefined` when KaTeX cannot parse it so the block keeps its code. */
export function renderLatex(source: string) {
  if (!source.trim()) return

  try {
    return katex.renderToString(source, { displayMode: true, throwOnError: true })
  } catch {
    return
  }
}
