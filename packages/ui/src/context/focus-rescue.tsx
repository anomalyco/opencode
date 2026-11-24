// Chromium leaves focus on <body> when the focused element is removed, disabled or stops being editable, and fires no
// event. Inside a focus scope ([data-focus-scope]: a list, a tab strip, a chip row), move it to the next item, or to the
// previous one when the last item went, and widen to the enclosing scope when the inner one has nothing left.

const FOCUSABLE = [
  'a[href]:not([tabindex="-1"])',
  'button:not(:disabled):not([tabindex="-1"])',
  'input:not(:disabled):not([type="hidden"]):not([tabindex="-1"])',
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[contenteditable=""]',
  '[tabindex]:not([tabindex="-1"])',
  // Roving focus: only one item is a Tab stop, but focus may land on any of them.
  '[role="treeitem"]',
  "[data-roving]",
].join(",")

const SCOPE = "[data-focus-scope]"

// Where the element was: the gap its removal left, or the element itself when it stayed in place.
type Spot =
  | { type: "removed"; parent: Node; next: Node | null; previous: Node | null; added: Node[] }
  | { type: "stayed"; element: HTMLElement }

type Entry = { element: HTMLElement; observer: MutationObserver; spot?: Spot }

// The last few focused elements, newest last. An overlay's items go with it; what had focus before it stays here.
const history: Entry[] = []

let installs = 0

let keyboard = false

let pending: ReturnType<typeof setTimeout> | undefined

export function installFocusRescue() {
  installs += 1

  if (installs === 1) {
    document.addEventListener("focusin", track, true)
    document.addEventListener("keydown", useKeyboard, true)
    document.addEventListener("pointerdown", usePointer, true)
  }

  return () => {
    installs -= 1

    if (installs > 0) return
    document.removeEventListener("focusin", track, true)
    document.removeEventListener("keydown", useKeyboard, true)
    document.removeEventListener("pointerdown", usePointer, true)
    history.splice(0).forEach((entry) => entry.observer.disconnect())
    clearTimeout(pending)
    pending = undefined
  }
}

// A rescued control shows its ring only while the keyboard is moving focus. Typing, shortcuts and a key pressed on a
// control the pointer focused are not that.
const NAVIGATION = new Set(["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"])

const useKeyboard = (event: KeyboardEvent) => {
  if (event.ctrlKey || event.altKey || event.metaKey || !NAVIGATION.has(event.key)) return
  keyboard = true
}

const usePointer = () => {
  keyboard = false
}

function track(event: FocusEvent) {
  if (!(event.target instanceof HTMLElement)) return
  const element = event.target

  if (history.at(-1)?.element === element) return

  const entry: Entry = { element, observer: new MutationObserver((records) => lose(entry, records)) }

  // Each ancestor reports changes to its own children, so whichever one drops the element reports it.
  for (let node = element.parentNode; node; node = node.parentNode) entry.observer.observe(node, { childList: true })
  entry.observer.observe(element, {
    attributes: true,
    attributeFilter: ["disabled", "contenteditable", "tabindex", "hidden", "inert"],
  })

  history.filter((item) => item.element === element).forEach(forget)

  // Moving within one list or menu replaces its entry, so arrowing through a long menu keeps the control that opened it.
  const last = history.at(-1)

  if (last && !last.spot && group(last.element) === group(element)) forget(last)
  history.push(entry)

  if (history.length > 6) forget(history[0])
}

function group(element: HTMLElement) {
  return element.closest(`${SCOPE}, [role="menu"], [role="listbox"], [role="dialog"]`)
}

function forget(entry: Entry) {
  entry.observer.disconnect()
  history.splice(history.indexOf(entry), 1)
}

function lose(entry: Entry, records: MutationRecord[]) {
  if (entry.spot) return
  const element = entry.element

  // A panel or popover focused as a whole (tabindex -1) keeps focus when its page changes around it.
  if (usable(element) || holds(element)) return

  const record = records.find(
    (item) => item.type === "childList" && Array.from(item.removedNodes).some((node) => node.contains(element)),
  )

  if (!record && !element.isConnected) return
  entry.spot = record
    ? {
        type: "removed",
        parent: record.target,
        next: record.nextSibling,
        previous: record.previousSibling,
        added: Array.from(record.addedNodes),
      }
    : { type: "stayed", element }
  entry.observer.disconnect()

  if (pending !== undefined) return
  // After overlays and dialogs have returned focus themselves.
  pending = setTimeout(rescue)
}

function rescue() {
  pending = undefined
  const active = document.activeElement

  // A control that was just disabled can still be the active element until Chromium's next update.
  if (active instanceof HTMLElement && active !== document.body && (usable(active) || holds(active))) return

  const ring = keyboard
  const entries = history.toReversed()

  // The newest element that went. One outside any scope was in an overlay, so what had focus before it decides; when
  // that still stands, the overlay's own return had its chance, and the user's place is not ours to pick.
  for (const [index, entry] of entries.entries()) {
    if (!entry.spot) return
    const target = pick(entry.spot)

    if (target) return target.focus({ focusVisible: ring })

    if (target === undefined) continue

    // A scope left with nothing to focus, such as the last toast, hands focus back to what had it before.
    const previous = entries.slice(index + 1).find((item) => !item.spot && usable(item.element))

    if (previous) previous.element.focus({ focusVisible: ring })

    return
  }
}

// `undefined` outside any scope, `null` when nothing in the scope or around it can take focus.
function pick(spot: Spot) {
  const anchor = spot.type === "removed" ? spot.parent : spot.element
  const start = (anchor instanceof Element ? anchor : anchor.parentElement)?.closest<HTMLElement>(SCOPE)

  if (!start) return

  if (spot.type === "stayed") {
    const owner = spot.element.parentElement?.closest<HTMLElement>(FOCUSABLE)

    if (owner && start.contains(owner) && usable(owner)) return owner
  }

  // What took its place, such as the tab a finished rename puts back.
  const replacement =
    spot.type === "removed"
      ? spot.added.flatMap((node) => (node instanceof HTMLElement && node.isConnected ? within(node, true) : []))[0]
      : undefined

  if (replacement) return replacement

  for (let scope: HTMLElement | null = start; scope; scope = scope.parentElement?.closest<HTMLElement>(SCOPE) ?? null) {
    const items = within(scope, false)
    const target = items.find((item) => after(spot, item)) ?? items.findLast((item) => !after(spot, item))

    if (target) return target
  }

  return null
}

// Never into a Kobalte tab list: its tabs select themselves on focus, and with no tab left it never settles.
function within(root: HTMLElement, self: boolean) {
  return [...(self ? [root] : []), ...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => usable(element) && !element.closest('[role="tablist"]'),
  )
}

// Not aria-hidden: a closing modal menu or dialog still hides the rest of the page from assistive tech for a moment.
function usable(element: HTMLElement) {
  return element.matches(FOCUSABLE) && element.checkVisibility() && !element.closest("[inert]")
}

// Still the focused element and still able to keep focus, though not a Tab stop: lost focus would be on <body>.
function holds(element: HTMLElement) {
  return (
    element === document.activeElement &&
    element.matches('[tabindex]:not(:disabled)') &&
    element.checkVisibility() &&
    !element.closest("[inert]")
  )
}

function after(spot: Spot, element: HTMLElement) {
  if (spot.type === "stayed") return !spot.element.contains(element) && follows(spot.element, element)

  if (spot.next?.isConnected) return spot.next.contains(element) || follows(spot.next, element)

  if (spot.previous?.isConnected) return !spot.previous.contains(element) && follows(spot.previous, element)

  return follows(spot.parent, element)
}

function follows(node: Node, element: HTMLElement) {
  return !!(node.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
}
