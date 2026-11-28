/**
 * A page's heading structure, for translations: the depths of its headings in source order. A
 * translated page reuses the English ids by position (rehype-headings.ts), so a translation whose
 * headings were added, removed or reordered would put anchors on the wrong sections. The build and
 * check-translations.ts compare this sequence and treat such a translation as stale: the page falls
 * back to English until it is brought back in line.
 */
export function headingDepths(source: string) {
  const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
  const depths: number[] = []
  let fenced = false
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const heading = /^(#{1,6})\s+\S/.exec(line)
    if (heading) depths.push(heading[1].length)
  }
  return depths
}

/** True when a translation has the English page's headings, in the same order and at the same depths. */
export function sameHeadingStructure(english: readonly number[], translated: readonly number[]) {
  return english.length === translated.length && english.every((depth, index) => depth === translated[index])
}

/** A loaded translation, or undefined when it is stale: its page then shows the English fallback. */
export function currentTranslation<T extends { stale?: boolean }>(module: T | undefined) {
  return module?.stale ? undefined : module
}
