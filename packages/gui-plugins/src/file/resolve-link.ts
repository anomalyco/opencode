import { parsePathLineSuffix } from "@opencode/util/path"
import type { Files, LineRange } from "@opencode/plugin/gui"

export type ParsedFileLink = {
  /** The normalized path: absolute, or relative with any leading `../` kept. */
  readonly path: string
  readonly selection?: LineRange
}

/** What a relative path names in the workspace: one file, or several to pick from. */
export type FileLinkTarget =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "picker"; readonly query: string }

/**
 * Extracts a normalized file path and optional 1-based line range from a markdown link or inline-code token.
 * Supports `:line`, `:line:col`, `:start-end`, `#Lstart`, and `#Lstart-Lend`.
 *
 * Inline code names a raw path, so its characters stay literal. A Markdown link is a URL: pass `link` to strip its
 * query and fragment (except a line range) and decode percent escapes. `file://` inputs always use URL semantics.
 */
export function parseFileLink(href: string, options?: { readonly link?: boolean }): ParsedFileLink {
  const raw = href.trim().replaceAll("\\", "/")
  const isFileUrl = /^file:\/\//i.test(raw)
  const isUrl = isFileUrl || !!options?.link

  const extracted = isFileUrl
    ? extractLineSelection(raw, true)
    : options?.link
      ? extractLinkSelection(raw)
      : extractLineSelection(raw, false)

  return { path: normalizeRelativeSegments(extracted.path, isUrl), selection: extracted.selection }
}

export function isAbsoluteLink(path: string) {
  return /^[a-z]:\//i.test(path) || path.startsWith("/")
}

/**
 * The workspace files a relative path names: the literal path when it exists, else every file whose path ends with
 * it. One file opens; several open the picker.
 */
export async function findFileLink(input: {
  readonly files: Pick<Files, "search">
  readonly path: string
  readonly signal: AbortSignal
}): Promise<FileLinkTarget | undefined> {
  const query = input.path.replace(/^(?:\.\.\/)+/, "")

  if (!query) return

  const results = await input.files.search(query, { limit: 200, signal: input.signal }).catch(() => [])
  const matches = [...new Set(results)].filter((file) => file === query || file.endsWith(`/${query}`))
  const literal = matches.find((file) => file === query)

  if (literal) return { kind: "file", path: literal }

  if (matches.length === 1 && matches[0]) return { kind: "file", path: matches[0] }

  if (matches.length > 1) return { kind: "picker", query }
}

/**
 * Whether a path named in a message is a file, without reading it: absolute paths by listing their directory,
 * workspace paths by the search index.
 */
export async function checkFileLinkExists(input: {
  readonly files: Pick<Files, "search" | "resolve" | "exists">
  readonly href: string
  readonly signal: AbortSignal
}): Promise<boolean> {
  // Markdown links reach this as a URL, inline code as a raw path. Try the literal path first so a name that really
  // contains `#`, `?` or `%` keeps working, then fall back to the URL form.
  const parsed = parseFileLink(input.href)
  const link = parseFileLink(input.href, { link: true })

  if (await exists(parsed)) return true

  return link.path !== parsed.path && (await exists(link))

  async function exists(target: ParsedFileLink) {
    // `~` is the server's home folder, which the app cannot expand. A network share (`//host/share`) would make the
    // server connect to the host just to answer.
    if (!target.path || target.path.startsWith("~") || target.path.startsWith("//")) return false

    if (isAbsoluteLink(target.path)) return input.files.exists(input.files.resolve(target.path))

    return !!(await findFileLink({ files: input.files, path: target.path, signal: input.signal }))
  }
}

/** A Markdown link's target: its query and fragment are URL syntax, but a line range stays a selection. */
function extractLinkSelection(input: string) {
  const parsed = parsePathLineSuffix(input)

  return { path: parsed.path.split(/[?#]/, 1)[0] ?? "", selection: parsed.selection }
}

function extractLineSelection(input: string, isFileUrl: boolean) {
  const parsed = parsePathLineSuffix(input)

  if (parsed.selection || parsed.path !== input) {
    const path = isFileUrl ? (parsed.path.split("?", 1)[0] ?? "") : parsed.path

    return { path, selection: parsed.selection }
  }

  if (!isFileUrl) return { path: input, selection: undefined }

  const withoutFragment = input.replace(/(\.[a-z0-9]+)#[^/.]*$/i, "$1")
  const withoutQuery = withoutFragment.split("?", 1)[0] ?? ""

  return parsePathLineSuffix(withoutQuery)
}

function normalizeRelativeSegments(input: string, decode: boolean): string {
  const fileHost = /^file:\/\/(?!(?:localhost)?\/)([^/]+\/.*)$/i.exec(input)

  const withoutProtocol = fileHost
    ? `//${fileHost[1]}`
    : input.replace(/^file:\/\/(?:localhost)?/i, "").replace(/^\/([a-z]:\/)/i, "$1")

  const decoded = decode ? decodePathSafely(withoutProtocol) : withoutProtocol
  const trimmed = decoded.replace(/^\.\//, "").replace(/\/+$/, "")

  if (!trimmed) return ""

  const unc = trimmed.startsWith("//")
  const driveMatch = trimmed.match(/^([a-z]:)\/(.*)$/i)
  const prefix = unc ? "//" : driveMatch ? `${driveMatch[1]}/` : trimmed.startsWith("/") ? "/" : ""
  const rest = unc ? trimmed.slice(2) : driveMatch ? (driveMatch[2] ?? "") : prefix ? trimmed.slice(1) : trimmed

  const out = rest.split("/").reduce<string[]>((acc, part) => {
    if (!part || part === ".") return acc

    if (part === "..") {
      if (acc.length > 0 && acc.at(-1) !== "..") {
        acc.pop()

        return acc
      }

      if (!prefix) acc.push("..")

      return acc
    }

    acc.push(part)

    return acc
  }, [])

  return `${prefix}${out.join("/")}`
}

function decodePathSafely(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
