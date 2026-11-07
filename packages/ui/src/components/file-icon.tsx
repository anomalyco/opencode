import type { Accessor, Component, JSX, Setter } from "solid-js"
import { createEffect, createMemo, createSignal, createUniqueId, splitProps, Show, untrack } from "solid-js"
import {
  chooseFallbackIconName,
  FILE_ICON_LOAD_TIMEOUT_MS,
  FILE_ICON_REQUESTED,
  INITIAL_FILE_ICON_SYMBOL_STATE,
  READY_FILE_ICON_SYMBOL_STATE,
  selectFileIconSymbol,
  transitionFileIconSymbol,
  type FileIconSymbolEffect,
  type FileIconSymbolEvent,
  type FileIconSymbolState,
} from "./file-icon-machine"
import { chooseIconName } from "./file-icons/choose-icon-name"
import type { IconName } from "./file-icons/types"

export type FileIconProps = JSX.GSVGAttributes<SVGSVGElement> & {
  node: { path: string; type: "file" | "directory" }
  expanded?: boolean
  mono?: boolean
}

export const FileIcon: Component<FileIconProps> = (props) => {
  const [local, rest] = splitProps(props, ["node", "class", "classList", "expanded", "mono"])
  const name = createMemo(() => chooseIconName(local.node.path, local.node.type, local.expanded || false))
  const fallback = createMemo(() => chooseFallbackIconName(local.node.type, local.expanded || false))
  const shown = createMemo(() => selectFileIconSymbol(symbol(name()).state(), name(), fallback()))
  const id = `file-icon-mono-${createUniqueId()}`
  createEffect(() => {
    sprite()
    dispatchSymbol(name(), FILE_ICON_REQUESTED)
  })

  return (
    <svg
      data-component="file-icon"
      {...rest}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <Show when={local.mono} fallback={<use href={`#${symbolID(shown())}`} />}>
        <defs>
          <mask id={id} mask-type="alpha">
            <use href={`#${symbolID(shown())}`} />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="currentColor" mask={`url(#${id})`} />
      </Show>
    </svg>
  )
}

// Chromium parses an external `<use href="sprite.svg#id">` target as a whole isolated SVG document, so the full
// sprite cost several MB per copy. Each icon is instead a lazy chunk, copied once into a hidden in-document sprite.
const spriteID = "file-icon-sprite"

const symbolID = (name: string) => `file-icon-${name}`

const FALLBACK_ICONS = new Set<IconName>(["Document", "Folder", "FolderOpen"])

type SymbolEntry = {
  state: Accessor<FileIconSymbolState>
  setState: Setter<FileIconSymbolState>
  timer?: ReturnType<typeof setTimeout>
}

const symbols = new Map<IconName, SymbolEntry>()

let sources: Partial<Record<IconName, () => Promise<string>>> | undefined

function symbol(name: IconName) {
  const existing = symbols.get(name)

  if (existing) return existing

  const [state, setState] = createSignal(
    FALLBACK_ICONS.has(name) ? READY_FILE_ICON_SYMBOL_STATE : INITIAL_FILE_ICON_SYMBOL_STATE,
  )

  const entry: SymbolEntry = { state, setState }
  symbols.set(name, entry)

  return entry
}

function dispatchSymbol(name: IconName, event: FileIconSymbolEvent) {
  const entry = symbol(name)
  const prev = untrack(entry.state)
  const next = transitionFileIconSymbol(prev, event)

  if (next.state !== prev) entry.setState(next.state)
  // A `<use>` follows its target once the symbol appears, so mounted icons may switch before the insert.
  next.effects.forEach((effect) => runSymbolEffect(name, entry, effect))
}

function runSymbolEffect(name: IconName, entry: SymbolEntry, effect: FileIconSymbolEffect) {
  if (effect.type === "insert-symbol") return insertSymbol(name, effect.svg)

  if (effect.type === "cancel-timeout") return clearTimeout(entry.timer)

  // The fallbacks are bundled, so they never load lazily.
  sources ??= Object.fromEntries(
    Object.entries(
      import.meta.glob<string>(
        [
          "../assets/icons/file-types/*.svg",
          "!../assets/icons/file-types/document.svg",
          "!../assets/icons/file-types/folder.svg",
          "!../assets/icons/file-types/folder-open.svg",
        ],
        { query: "?raw", import: "default" },
      ),
    ).map(([path, load]) => [toIconName(path), load]),
  )
  const load = sources[name]

  if (!load) return dispatchSymbol(name, { type: "load.failed" })
  // A dynamic import has no timeout of its own and can stall on a slow or dropped connection.
  entry.timer = setTimeout(() => dispatchSymbol(name, { type: "load.timed-out" }), FILE_ICON_LOAD_TIMEOUT_MS)
  load().then(
    (svg) => dispatchSymbol(name, { type: "load.succeeded", svg }),
    () => dispatchSymbol(name, { type: "load.failed" }),
  )
}

// Mirrors the file name to icon name rule of the spritesheet generator that writes `file-icons/types.ts`.
function toIconName(path: string) {
  return path
    .slice(path.lastIndexOf("/") + 1, -".svg".length)
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("")
}

function insertSymbol(name: string, text: string) {
  const id = symbolID(name)

  // Icons share the document now, so scope their internal ids (gradients, clip paths) and drop their unstyled
  // classes, which app CSS such as Tailwind utilities would otherwise match.
  const scoped = text
    .replace(/\sclass="[^"]*"/g, "")
    .replace(/\sid="([^"]*)"/g, ` id="${id}-$1"`)
    .replace(/url\(#([^)]*)\)/g, `url(#${id}-$1)`)
    .replace(/href="#([^"]*)"/g, `href="#${id}-$1"`)

  const svg = new DOMParser().parseFromString(scoped, "image/svg+xml").documentElement
  const symbol = document.createElementNS("http://www.w3.org/2000/svg", "symbol")
  Array.from(svg.attributes)
    .filter((attr) => !attr.name.startsWith("xmlns") && !["version", "width", "height"].includes(attr.name))
    .forEach((attr) => symbol.setAttributeNS(attr.namespaceURI, attr.name, attr.value))
  symbol.id = id
  symbol.append(...Array.from(svg.childNodes, (node) => document.importNode(node, true)))
  // Hot reload keeps the DOM sprite, so replace a symbol an older module inserted.
  document.getElementById(id)?.remove()
  sprite().append(symbol)
}

function sprite() {
  const existing = document.getElementById(spriteID)

  if (existing) return existing
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.id = spriteID
  svg.setAttribute("aria-hidden", "true")
  svg.setAttribute("width", "0")
  svg.setAttribute("height", "0")
  svg.style.position = "absolute"
  svg.style.overflow = "hidden"
  document.body.insertBefore(svg, document.body.firstChild)
  // The fallbacks ship with the component, so an icon whose own symbol fails to load always has one to show.
  Object.entries(
    import.meta.glob<string>(
      [
        "../assets/icons/file-types/document.svg",
        "../assets/icons/file-types/folder.svg",
        "../assets/icons/file-types/folder-open.svg",
      ],
      { query: "?raw", import: "default", eager: true },
    ),
  ).forEach(([path, text]) => insertSymbol(toIconName(path), text))

  return svg
}
