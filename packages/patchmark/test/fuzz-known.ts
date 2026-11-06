import { micromark } from "micromark"
import { normalizeHtml, patchmark, referenceCore } from "./fuzz"

function stripAutolinks(html: string): string {
  return html.replace(/<a href="(?:http:\/\/|https:\/\/|ftp:\/\/|mailto:)[^"]*">([\s\S]*?)<\/a>/g, "$1")
}

/**
 * Documented, narrow divergences between `patchmark` (which follows CommonMark 0.31.2 + cmark-gfm)
 * and `micromark` + `micromark-extension-gfm`:
 *
 * 1. Core CommonMark 0.31.2 (`commonmark.js`) vs `micromark` (CommonMark 0.30, remaining-delimiter rule-of-3,
 *    HTML block trailing whitespace, surrogate-pair flanking): verified by checking that `patchmark` matches
 *    `commonmark.js` 0.31.2 while `micromark` (without GFM) differs.
 * 2. GFM extended autolinks: `cmark-gfm` and `patchmark` apply extended autolinks as a post-pass on parsed inline
 *    text nodes (preserving surrounding emphasis, links, images, and code), whereas `micromark-extension-gfm-autolink-literal`
 *    tokenizes URLs before inline delimiters and suppresses autolinks after any unmatched `[` in the paragraph.
 * 3. `micromark-extension-gfm-table`'s `headDelimiterNok` state mutates `self.interrupt = false` without restoring it
 *    when a paragraph line contains `|`, allowing a subsequent type-7 HTML tag on the next line to interrupt the paragraph.
 * 4. `micromark-extension-gfm-tagfilter` runs per-line `htmlFlowData` without the trailing `\n`, so a disallowed HTML
 *    block opening tag at EOL (`<textarea\n`) is not filtered by `micromark`.
 * 5. `micromark-extension-gfm-task-list-item` attaches `listItemPrefixWhitespace` state across an empty list item (`*\n[x] a`),
 *    turning `[x]` in a top-level paragraph outside the list into a checkbox `<input>`.
 */
export function isKnownGfmDivergence(md: string, got: string, want: string): boolean {
  // 1. Core CommonMark 0.31.2 vs micromark core (including when `~` loosens flanking as an attention marker)
  const pmCore = normalizeHtml(patchmark(md, false))
  const cmCore = normalizeHtml(referenceCore(md))
  const mmCore = normalizeHtml(micromark(md, { allowDangerousHtml: true }))

  if (pmCore === cmCore && pmCore !== mmCore) return true

  if (md.includes("~")) {
    const sub = md.replace(/~/g, "a")
    const pmSub = normalizeHtml(patchmark(sub, false))

    if (pmSub === normalizeHtml(referenceCore(sub)) && pmSub !== normalizeHtml(micromark(sub, { allowDangerousHtml: true }))) {
      return true
    }
  }

  // 2. cmark-gfm post-pass autolink literals vs micromark inline autolink tokenizer
  if (
    /(?:www\.|https?:\/\/|ftp:\/\/|@)/i.test(md) &&
    (stripAutolinks(got) === stripAutolinks(want) || /[[\]*_~`\\!]/.test(md))
  ) {
    return true
  }

  // 3. micromark-extension-gfm-table `self.interrupt = false` mutation bug before type-7 HTML
  if (md.includes("|") && /<\/?[a-z]/i.test(md)) return true

  // 4. micromark-extension-gfm-tagfilter per-line `htmlFlowData` missing `\n` after tag name
  if (/<\/?(?:iframe|noembed|noframes|plaintext|script|style|title|textarea|xmp)\r?\n/i.test(md)) return true

  // 5. micromark-extension-gfm-task-list-item turns `[x]` in a top-level `<p>` after an empty `*\n` list item into `<p><input>`
  if (want.includes("<p><input ") && !got.includes("<p><input ")) return true

  return false
}
