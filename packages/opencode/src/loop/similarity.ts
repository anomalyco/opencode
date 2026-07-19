// Sørensen–Dice coefficient over character bigrams: cheap, dependency-free,
// and forgiving of small formatting drift between otherwise-repeated
// iteration output. 1 = identical, 0 = nothing in common.
//
// Lives in its own module with ZERO imports on purpose: it is shared by
// loop/loop.ts and session/prompt.ts, and loop.ts imports SessionPrompt.
// When prompt.ts imported similarity from loop.ts directly, that made
// prompt.ts <-> loop.ts circular, and loop.ts's module-scope
// `LayerNode.make(layer, [SessionPrompt.node, ...])` then evaluated while
// prompt.ts was mid-initialization — SessionPrompt.node was undefined, the
// app graph contained an undefined node, and every boot died with
// "undefined is not an object (evaluating 'e.dependencies')" (TUI: silent
// black screen). Keep this module import-free.
function normalize(text: string) {
  return text.trim().toLowerCase().replace(/\s+/g, " ")
}
function bigrams(text: string) {
  const grams = new Set<string>()
  for (let i = 0; i < text.length - 1; i++) grams.add(text.slice(i, i + 2))
  return grams
}
export function similarity(a: string, b: string): number {
  const na = normalize(a)
  const nb = normalize(b)
  if (na === nb) return 1
  if (!na || !nb) return 0
  const ga = bigrams(na)
  const gb = bigrams(nb)
  if (ga.size === 0 || gb.size === 0) return 0
  let intersection = 0
  for (const gram of ga) if (gb.has(gram)) intersection++
  return (2 * intersection) / (ga.size + gb.size)
}
