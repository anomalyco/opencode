import type { SessionMessageInfo } from "@opencode/client/promise"
import { Option, Schema } from "effect"
import { artifactAddress, artifactLink } from "./artifact-link"

type Assistant = Extract<SessionMessageInfo, { type: "assistant" }>

/**
 * A page the agent meant the person to see: a web page or an artifact by address, or an HTML or PDF file of the
 * workspace the agent showed in the browser, by its path. `key` tells repeats apart (see `linkKey`).
 */
export type SessionLink =
  | { readonly type: "page"; readonly key: string; readonly url: string }
  | { readonly type: "file"; readonly key: string; readonly path: string }

/** How many pages the side panel's New tab page lists from a session. */
export const SESSION_LINKS = 10

/** How many of a session's last replies are read for its pages: a fixed ceiling, however long the session. */
const REPLIES = 50

/**
 * Calls that put a page, by `url` or `path`, in front of the person in the browser: as tools, and as calls of a
 * code-mode program. Reading a page for the agent itself, as `webfetch` or `fetch` does, is not showing it.
 */
const SHOWING: readonly string[] = ["browser.tabs.open", "browser.navigate"]

/** Tools whose result names the page they published for the person: an artifact's link. */
const PUBLISHING: readonly string[] = ["artifact_create", "artifact_update"]

/** The input of a call that names a page. */
const PageInput = Schema.Struct({ url: Schema.optionalKey(Schema.String), path: Schema.optionalKey(Schema.String) })

/** What a code-mode program records of its calls; each call is read on its own, so one odd call loses only itself. */
const ProgramCalls = Schema.Struct({ toolCalls: Schema.Array(Schema.Unknown) })

/** One call a code-mode program made. */
const ProgramCall = Schema.Struct({ tool: Schema.String, input: Schema.optionalKey(PageInput) })

/**
 * An address in text: a web address, an artifact's, or the relative link of an artifact on the session's server. A
 * Markdown link's target is one too, without its parentheses.
 */
const TEXT_ADDRESS = /(?:https?:\/\/|artifact:\/\/|(?<![\w/])\/api\/experimental\/artifacts\/)[^\s<>()`"'[\]{}]+/g

/** Hosts kept for examples in writing (RFC 2606), which a reply names to explain, never as a page to open. */
const EXAMPLE_HOST = /(?:^|\.)example(?:\.(?:com|org|net))?$/i

/** Code in a reply: fenced blocks, then inline spans. An address there is a command, a setting or an example. */
const CODE = /```[\s\S]*?```|`[^`\n]*`/g

/** Files the browser shows: pages and PDFs. Others open in the file panel. */
const SHOWN_FILE = /\.(?:html?|pdf)$/i

/** Punctuation that ends the sentence or the emphasis around an address, not the address. */
const TRAILING = /[.,;:!?*_~]+$/

/**
 * The pages the agent's finished replies show the person in a session, newest first and without repeats: what it
 * opened in the browser, what it published, and what its text links to outside code. Reads replies from the newest and
 * stops at `limit` pages or after `REPLIES` replies, and reads each finished reply once for as long as the returned
 * function lives, so a long session costs no more than its last replies.
 */
export function createSessionLinks() {
  const read = new WeakMap<Assistant, readonly SessionLink[]>()

  /**
   * @param server - The session's server URL, which a relative artifact link belongs to.
   */
  return (messages: readonly SessionMessageInfo[], limit: number, server: string) => {
    const links: SessionLink[] = []
    let replies = 0

    // A loop that stops: the newest replies are enough, and older ones are never read.
    for (let index = messages.length - 1; index >= 0 && links.length < limit && replies < REPLIES; index--) {
      const message = messages[index]

      // A reply still streaming changes; it is read once it completes.
      if (message?.type !== "assistant" || message.time.completed === undefined) continue
      replies++
      const found = read.get(message) ?? remember(read, message, server)

      found.forEach((link) => {
        if (links.length < limit && !links.some((item) => item.key === link.key)) links.push(link)
      })
    }

    return links
  }
}

/** The pages one reply shows, newest first: its last part first, and the end of a text before its start. */
export function messageLinks(message: Assistant, server: string): readonly SessionLink[] {
  const found = message.content.flatMap((part): SessionLink[] => {
    if (part.type === "text") return addresses(part.text.replace(CODE, " "), server)

    if (part.type !== "tool" || part.state.status !== "completed") return []
    const state = part.state
    const own = SHOWING.includes(part.name) ? Option.toArray(Schema.decodeUnknownOption(PageInput)(state.input)) : []

    // A code-mode program records each call it made, with its input.
    const nested = Option.match(Schema.decodeUnknownOption(ProgramCalls)(state.metadata), {
      onNone: () => [],
      onSome: (program) =>
        program.toolCalls.flatMap((call) =>
          Option.toArray(Schema.decodeUnknownOption(ProgramCall)(call)).flatMap((decoded) =>
            SHOWING.includes(decoded.tool) && decoded.input ? [decoded.input] : [],
          ),
        ),
    })

    // A published artifact's link.
    const published = PUBLISHING.includes(part.name)
      ? state.content.flatMap((content) => (content.type === "text" ? addresses(content.text, server) : []))
      : []

    return [...[...own, ...nested].flatMap((input) => inputLinks(input, server)), ...published]
  })

  return found.toReversed()
}

/** The addresses in a text, in order. */
function addresses(text: string, server: string) {
  return [...text.matchAll(TEXT_ADDRESS)].flatMap((match) => page(match[0].replace(TRAILING, ""), server))
}

/** A call's page: its web address, else the workspace file it showed, when the browser shows that file. */
function inputLinks(input: typeof PageInput.Type, server: string): SessionLink[] {
  if (input.url !== undefined) return page(input.url, server)

  return input.path && SHOWN_FILE.test(input.path) ? [{ type: "file", key: `file:${input.path}`, path: input.path }] : []
}

/** An address the browser opens: an artifact on the session's server by its own address, or a web page. */
function page(value: string, server: string): SessionLink[] {
  if (value.startsWith("artifact://")) {
    const item = artifactAddress(value)

    return item ? [artifactPage(`artifact://${item.id}/${item.path}`)] : []
  }

  const artifact = artifactLink(value, server)

  if (artifact) return [artifactPage(artifact)]
  const url = URL.canParse(value) ? new URL(value) : undefined

  return url && (url.protocol === "https:" || url.protocol === "http:") && !EXAMPLE_HOST.test(url.hostname)
    ? [{ type: "page", key: linkKey(url.href), url: url.href }]
    : []
}

function artifactPage(url: string): SessionLink {
  return { type: "page", key: url, url }
}

/**
 * What tells one listed page from another: a web page's address without its scheme's `www.`, its trailing slash, its
 * query and its fragment, so the same page opened with other parameters, as a dev server's or a story's, lists once.
 * The pages the browser showed last compare by it too, so a page is never listed twice. Any other address is its own.
 */
export function linkKey(address: string) {
  const url = URL.canParse(address) ? new URL(address) : undefined

  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) return address

  return `${url.protocol}//${url.host.replace(/^www\./i, "")}${url.pathname.replace(/\/+$/, "")}`
}

/** A path from the filesystem's root, as the agent may pass to `browser.tabs.open({ path })`, rather than the workspace's. */
export function absolutePath(path: string) {
  return /^(?:\/|[a-zA-Z]:[\\/])/.test(path)
}

function remember(read: WeakMap<Assistant, readonly SessionLink[]>, message: Assistant, server: string) {
  const found = messageLinks(message, server)
  read.set(message, found)

  return found
}
