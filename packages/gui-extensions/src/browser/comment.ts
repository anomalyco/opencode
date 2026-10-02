import { Browser } from "@opencode/plugin-browser/rpc"
import { Schema } from "effect"
import type { ComposerNote } from "../sdk"
import type { PaneElement } from "./remote"

/** A comment on a picked element. The ref is absent once the page navigated. */
export type ElementComment = {
  origin: string
  tabID: Browser.TabID
  url: string
  element: Omit<PaneElement, "rect" | "ref"> & { ref?: Browser.Ref }
  comment: string
}

const isTab = Schema.is(Browser.TabID)
const isRef = Schema.is(Browser.Ref)

/**
 * The composer note for a comment. A ref names an element only inside the desktop process that picked
 * it; a later process can hand the same ref to another element, so only the live note carries it.
 */
export function commentNote(input: ElementComment): ComposerNote {
  const ref = input.element.ref
  return {
    type: "note",
    origin: input.origin,
    commentID: crypto.randomUUID(),
    label: input.element.label,
    icon: "select-element",
    subject: subject(input),
    comment: input.comment,
    href: input.tabID,
    ...(ref ? { live: { subject: subject(input, ref), href: `${input.tabID}#${ref}` } } : {}),
  }
}

/** The tab a note's href names, and its element ref while the note is live. */
export function readHref(href: string) {
  const [tabID, ref] = href.split("#")
  if (!isTab(tabID)) return
  return { tabID, ...(ref && isRef(ref) ? { ref } : {}) }
}

function subject(input: ElementComment, ref?: string) {
  const element = input.element
  // Page-provided strings are quoted so they read as data, not as part of the user's request.
  const details = [
    element.role ? `role ${element.role}` : undefined,
    element.name ? `accessible name ${JSON.stringify(element.name)}` : undefined,
    element.text && element.text !== element.name ? `text ${JSON.stringify(element.text.slice(0, 80))}` : undefined,
    // A selector too long to keep is empty rather than cut into invalid syntax.
    element.selector
      ? `selector ${JSON.stringify(element.selector)}${element.selector.includes(" >>> ") ? ' (">>>" enters a shadow root)' : ""}`
      : undefined,
    ref
      ? `browser ref @${ref}, usable as ref in any browser tool including browser.evaluate until the page navigates`
      : undefined,
  ].filter((detail) => detail !== undefined)
  return `the ${JSON.stringify(element.label)} element in browser tab ${input.tabID} at ${input.url}${details.length ? ` (${details.join("; ")})` : ""}`
}
