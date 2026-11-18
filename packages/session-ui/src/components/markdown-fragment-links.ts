/** A heading's anchor as GitHub writes it: lowercased, punctuation dropped, spaces as hyphens. */
export function headingSlug(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
    .replaceAll(" ", "-")
}

/**
 * The element a `#fragment` link names in this document: a heading by its slug, where repeated headings take `-1`,
 * `-2` and so on, or an element whose raw HTML `id` or `name` it is.
 */
export function fragmentTarget(root: HTMLElement, fragment: string) {
  const slug = fragment.toLowerCase()
  const seen = new Map<string, number>()

  const heading = Array.from(root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")).find((heading) => {
    const base = headingSlug(heading.textContent ?? "")
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)

    return (count === 0 ? base : `${base}-${count}`) === slug
  })

  if (heading) return heading
  // Sanitizing prefixes raw HTML `id` and `name` so they cannot clobber the app's own globals.
  const named = CSS.escape(`user-content-${fragment}`)

  return root.querySelector<HTMLElement>(`[id="${named}"], [name="${named}"]`) ?? undefined
}

/** Fragment links scroll to their target in this document instead of navigating the app. */
export function setupFragmentLinks(root: HTMLElement) {
  const click = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || !(event.target instanceof Element)) return
    const link = event.target.closest('a[href^="#"]')

    if (!(link instanceof HTMLAnchorElement) || !root.contains(link)) return
    event.preventDefault()
    const fragment = decodeFragment(link.getAttribute("href")!.slice(1))
    const target = fragment ? fragmentTarget(root, fragment) : undefined

    if (!target) return
    const scroller = scrollParent(root)

    // `scrollIntoView` would also scroll clipped ancestors and shift the surrounding layout.
    if (!scroller) return target.scrollIntoView({ block: "start" })
    scroller.scrollTo({
      top: scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
    })
  }

  root.addEventListener("click", click)

  return () => root.removeEventListener("click", click)
}

function scrollParent(element: HTMLElement) {
  let parent = element.parentElement

  while (parent) {
    if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent
    parent = parent.parentElement
  }
}

function decodeFragment(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
