const owners = new WeakMap<Element, (write: () => void) => void>()

/**
 * Makes the scroll writes that other code sends through `holdScroll` the owner's own. The owner runs `write` where
 * it makes its own scroll writes, so that it can tell them from the reader's scroll. Returns the cleanup.
 */
export function ownScroll(scroller: Element, run: (write: () => void) => void) {
  owners.set(scroller, run)

  return () => {
    if (owners.get(scroller) === run) owners.delete(scroller)
  }
}

/**
 * Makes a scroll write to a scroll element that the caller does not own, to hold a control in place while the content
 * around it changes size. The session timeline takes every movement of its offset that it did not write for the
 * reader's scroll, and an upward one stops it from following its end. A write made here is the timeline's own.
 *
 * Not for a scroll that takes the reader somewhere, such as a link: that one is the reader's, and leaves the end.
 */
export function holdScroll(scroller: Element, write: () => void) {
  const run = owners.get(scroller)

  if (run) return run(write)
  write()
}
