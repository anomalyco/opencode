/** Pages the history keeps, and the most one import brings: the most used and most recent. */
export const MAX_PAGES = 50_000

/** A longer address is not one a person returns to by typing; other browsers keep ones of many thousands. */
export const MAX_URL_LENGTH = 2_048

/** What a title is cut to; the drop-down shows far less. */
export const MAX_TITLE_LENGTH = 200

/** A page of the history: one row per page, however often and by which of its addresses it was visited. */
export type PageVisit = {
  readonly url: string
  readonly title: string
  /** Visits in all; at least one. */
  readonly visits: number
  /** How many of them began in an address bar. */
  readonly typed: number
  /** The last visit, in Unix milliseconds. */
  readonly visited: number
}

/**
 * The page an address names and its host. The key is the host without `www.`, the path without a trailing slash, the
 * query and the fragment, so `http`, `https`, `www.` and a trailing slash all name one page. Undefined for an
 * address the history never keeps: one that is not `http(s)`, that carries a user name or a password, or that is
 * longer than `MAX_URL_LENGTH`.
 */
export function webPage(url: string) {
  if (url.length > MAX_URL_LENGTH || !URL.canParse(url)) return undefined
  const parsed = new URL(url)

  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) return undefined

  return {
    key: `${parsed.host.replace(/^www\./, "")}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}${parsed.hash}`,
    host: parsed.hostname,
  }
}

/** The key of `webPage`; undefined for an address the history never keeps. */
export function pageKey(url: string) {
  return webPage(url)?.key
}

/** A title as the history keeps it: trimmed, and cut to `MAX_TITLE_LENGTH` without splitting a character. */
export function pageTitle(title: string) {
  const trimmed = title.trim()

  return trimmed.length > MAX_TITLE_LENGTH ? trimmed.slice(0, MAX_TITLE_LENGTH).replace(/[\uD800-\uDBFF]$/, "") : trimmed
}

/** The address without its web scheme or a leading `www.`, as people type it. */
export function bare(url: string) {
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "")
}

/**
 * The address a row of the address field's list puts in the field, as Chrome fills it: without `http://` and without
 * the slash that ends a bare host. `https://` stays.
 */
export function filled(url: string) {
  return hostOnly(url).replace(/^http:\/\//i, "")
}

/**
 * The rest of a page's address after `text`, when the address begins with it: `ub.com` for `gith` and
 * `https://github.com/`. Empty when the text is the whole address; undefined when the address does not begin with
 * it, or the text holds a space. The text may leave out the scheme and a leading `www.`, as people type an address,
 * and its case does not count.
 */
export function completion(text: string, url: string) {
  if (!text || /\s/.test(text)) return undefined
  const typed = text.toLowerCase()

  // The slash that ends a bare host is not completed, yet a text that types it is still the whole address.
  const shown = [hostOnly(url), url]
    .flatMap((whole) => [bare(whole), whole.replace(/^https?:\/\//i, ""), whole])
    .find((form) => form.toLowerCase().startsWith(typed))

  return shown?.slice(text.length)
}

/** The address without the slash that ends a bare host, which nobody types. */
function hostOnly(url: string) {
  return url.replace(/^([a-z][a-z\d+.-]*:\/\/[^/?#]+)\/$/i, "$1")
}
