import { observeReducedMotion, prefersReducedMotion } from "../motion/reduced"

/**
 * The name of artwork registered at runtime with `registerIcons`, `<owner>:<name>`, such as a plugin's `acme:logo`. No
 * catalog name holds a colon, so `Icon` tells the two apart by the name alone.
 */
export type RegisteredIconName = `${string}:${string}`

/** Registered artwork, parsed once: what its symbol frames, the root's other attributes, and the drawing. */
type Artwork = {
  readonly viewBox: string
  readonly attributes: readonly Attr[]
  readonly content: DocumentFragment
}

const namespace = "http://www.w3.org/2000/svg"

const spriteID = "opencode-v2-icon-registered"

// What the artwork's root says about its document or its frame, not about the drawing.
const structural = new Set(["xmlns", "width", "height", "viewBox", "id"])

/** Each name's artwork, how many icons draw each name now, the artwork each symbol holds, and each name's symbol id. */
const state = {
  artwork: new Map<string, Artwork>(),
  mounted: new Map<string, number>(),
  drawn: new Map<string, Artwork>(),
  symbols: new Map<string, string>(),
}

/**
 * Whether a name refers to registered artwork, not to the catalog.
 * @param name - A name supplied by a caller, including names unknown to this build.
 */
export function isRegisteredIconName(name: string): name is RegisteredIconName {
  return name.includes(":")
}

/**
 * Registers artwork by name, so `Icon` draws it wherever a name is used, in any part of the app. Each value is an SVG
 * document as text: its `viewBox` (else its `width` and `height`) frames it, its root's presentation attributes apply
 * to its content, and `currentColor` follows the text color where it is drawn. A name that is registered again draws
 * the newer artwork. The set registers whole: when one document throws, none is registered.
 * @param sources - Each SVG document, by its name, `<owner>:<name>`.
 * @returns Withdraws the artwork; icons that use a name draw nothing until it is registered again.
 * @throws When a source is not an SVG document, or frames no drawing.
 */
export function registerIcons(sources: Readonly<Record<RegisteredIconName, string>>) {
  const parsed = Object.entries(sources).map(([name, source]) => ({ name, artwork: parse(name, source) }))

  parsed.forEach((entry) => {
    state.artwork.set(entry.name, entry.artwork)
    draw(entry.name)
  })

  return () =>
    parsed.forEach((entry) => {
      if (state.artwork.get(entry.name) !== entry.artwork) return

      state.artwork.delete(entry.name)
      draw(entry.name)
    })
}

/**
 * Keeps a name's artwork in the document while an `Icon` draws it. Artwork nothing draws is not in the document, so
 * artwork that animates costs nothing while it is off screen. A place that renders again releases the name and takes
 * it again in the same task; the artwork, and an animation in it, stays in place through that.
 * @param name - The registered name the icon draws.
 * @returns Releases the name.
 */
export function mountRegisteredIcon(name: RegisteredIconName) {
  const count = state.mounted.get(name) ?? 0

  state.mounted.set(name, count + 1)

  if (count === 0) draw(name)

  return () => {
    const left = (state.mounted.get(name) ?? 1) - 1

    if (left > 0) return void state.mounted.set(name, left)

    state.mounted.delete(name)
    queueMicrotask(() => draw(name))
  }
}

/**
 * The id of the symbol that holds a name's artwork while it is mounted. A name may hold any character, so the id is a
 * counter, not the name.
 * @param name - A registered name.
 */
export function registeredIconSymbol(name: string) {
  const existing = state.symbols.get(name)

  if (existing) return existing

  const id = `${spriteID}-${state.symbols.size + 1}`

  state.symbols.set(name, id)

  return id
}

// Puts the name's symbol in the sprite while the name is both registered and drawn, and takes it out otherwise. A
// symbol that already holds the name's artwork stays as it is.
function draw(name: string) {
  const id = registeredIconSymbol(name)
  const artwork = state.mounted.has(name) ? state.artwork.get(name) : undefined
  const current = document.getElementById(id)

  if (!artwork) {
    state.drawn.delete(name)

    return void current?.remove()
  }

  if (current && state.drawn.get(name) === artwork) return

  state.drawn.set(name, artwork)

  const symbol = document.createElementNS(namespace, "symbol")

  symbol.id = id
  symbol.setAttribute("viewBox", artwork.viewBox)
  artwork.attributes.forEach((attribute) =>
    symbol.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value),
  )
  symbol.append(artwork.content.cloneNode(true))

  if (current) return void current.replaceWith(symbol)

  sprite().append(symbol)
}

function sprite() {
  const existing = document.getElementById(spriteID)

  if (existing) return existing

  const svg = document.createElementNS(namespace, "svg")

  svg.id = spriteID
  svg.setAttribute("aria-hidden", "true")
  svg.setAttribute("width", "0")
  svg.setAttribute("height", "0")
  svg.style.position = "absolute"
  svg.style.overflow = "hidden"
  document.body.insertBefore(svg, document.body.firstChild)

  // Artwork may animate with SVG animation elements, which run on the sprite's clock. Under reduced motion the clock
  // holds at its start, so every icon shows its first frame.
  const settle = () => {
    if (!prefersReducedMotion()) return svg.unpauseAnimations()

    svg.pauseAnimations()
    svg.setCurrentTime(0)
  }

  observeReducedMotion(settle)
  settle()

  return svg
}

function parse(name: string, source: string): Artwork {
  const root = new DOMParser().parseFromString(source, "image/svg+xml").documentElement

  if (root.localName !== "svg" || root.getElementsByTagName("parsererror").length > 0)
    throw new Error(`Icon "${name}" is not an SVG document`)

  const content = document.createDocumentFragment()

  content.append(...Array.from(root.childNodes, (node) => document.importNode(node, true)))

  return {
    viewBox: root.getAttribute("viewBox") ?? frame(name, root),
    attributes: Array.from(root.attributes).filter(
      (attribute) => !structural.has(attribute.name) && attribute.prefix !== "xmlns",
    ),
    content,
  }
}

// A document without a viewBox, such as some design tool exports, is framed by its size.
function frame(name: string, root: Element) {
  const width = Number.parseFloat(root.getAttribute("width") ?? "")
  const height = Number.parseFloat(root.getAttribute("height") ?? "")

  if (width > 0 && height > 0) return `0 0 ${width} ${height}`

  throw new Error(`Icon "${name}" needs a viewBox, or a width and a height`)
}
