const openers: Readonly<Record<string, string | undefined>> = { ")": "(", "]": "[" }

/** Drops punctuation trailing a URL, but keeps a closing bracket that pairs with one inside it (`…/Mercury_(planet)`). */
function trimTrailing(url: string) {
  let end = url.length

  while (end > 0) {
    const char = url[end - 1]!
    const opener = openers[char]

    if (opener) {
      const head = url.slice(0, end)
      if (count(head, opener) >= count(head, char)) break
    } else if (!",.;:!?".includes(char)) break

    end -= 1
  }

  return url.slice(0, end)
}

function count(text: string, char: string) {
  return text.split(char).length - 1
}

/** Splits plain text into runs, marking each http(s) URL with its link target. */
export function linkSegments(text: string) {
  const result: { text: string; href?: string }[] = []
  let last = 0

  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/g)) {
    const href = trimTrailing(match[0])

    if (!URL.canParse(href)) continue

    if (match.index > last) result.push({ text: text.slice(last, match.index) })
    result.push({ text: href, href })
    last = match.index + href.length
  }

  if (last < text.length) result.push({ text: text.slice(last) })

  return result
}
