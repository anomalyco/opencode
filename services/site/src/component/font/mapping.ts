import { createSignal } from "solid-js"
import { isLetter, letters, type Letter } from "~/lib/font-content"

// The map from every other character to one of the six letters. It lives only in memory, so each
// visit starts fresh, and the hero, the substitutions table and the font download all share it.
const mapping: Record<string, Letter> = Object.create(null)
const [version, setVersion] = createSignal(0)

/** Changes whenever the map is shuffled, for views that show it. */
export const mapVersion = version

function randomLetter() {
  const number = crypto.getRandomValues(new Uint32Array(1))[0]
  return letters[Math.floor((number / 4294967296) * letters.length)]
}

/** The letter a non-space character is drawn with. The six letters always keep their identity. */
export function mapCharacter(character: string) {
  const key = character.toLowerCase()
  if (isLetter(key)) return key
  mapping[key] ??= randomLetter()
  return mapping[key]
}

export function shuffleMapping() {
  for (const key of Object.keys(mapping)) delete mapping[key]
  setVersion((value) => value + 1)
}
