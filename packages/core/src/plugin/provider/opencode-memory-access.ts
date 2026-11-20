export * as OpencodeMemoryAccess from "./opencode-memory-access.js"

// Prefix-anchored key formats: rejected wherever they appear.
const FORMATS: ReadonlyArray<readonly [string, RegExp]> = [
  ["a GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,})/],
  ["a GitLab token", /\bglpat-[A-Za-z0-9_-]{20,}/],
  ["an AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["a Slack token", /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ["a Stripe key", /\b[rs]k_(?:live|test)_[0-9A-Za-z]{16,}/],
  ["an Anthropic key", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["an OpenAI key", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/],
  ["a Google API key", /\bAIza[0-9A-Za-z_-]{35}/],
  ["an npm token", /\bnpm_[A-Za-z0-9]{36}/],
  ["an OpenCode Console key", /\boc_sk_[A-Za-z0-9]{8,}_[A-Za-z0-9_-]{16,}/],
  ["a PyPI token", /\bpypi-[A-Za-z0-9_-]{50,}/],
  ["a Hugging Face token", /\bhf_[A-Za-z0-9]{30,}/],
  ["a SendGrid key", /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/],
  ["a private key", /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/],
]
// Credentials given as literal command arguments; the first group is the value, which may only be a reference.
const ARGUMENTS: ReadonlyArray<readonly [string, RegExp]> = [
  [
    "a password, secret or token assigned to a variable",
    /(?<![A-Za-z0-9_])(?:[A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|APIKEY)|MYSQL_PWD)=([^\s;&|]+)/g,
  ],
  ["a password after mysql -p", /\b(?:mysql|mysqldump|mariadb|mysqladmin)\b[^\n|;&]*?\s-p(?!\s)([^\s;&|]+)/g],
  ["a password after --password=", /\s--password=([^\s;&|]+)/g],
  ["a password after sshpass -p", /\bsshpass\s+-p\s*([^\s;&|]+)/g],
  ["a credential in an Authorization header", /\bAuthorization:\s*(?:Bearer|Basic|token)\s+([^\s"'`\\]+)/gi],
  ["a password in a URL", /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"`]+:([^\s/@'"`]+)@[^\s/'"`]/gi],
]
/** A variable reference or a placeholder, which stands for a credential without being one. */
const REFERENCE =
  /^(?:""|''|["'`]?(?:\$\{\{|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|\$\(|%[A-Za-z_][A-Za-z0-9_]*%|<[^<>]+>|\{\{[^}]+\}\}|\*{3,}|\.{3}|…|x{3,}|X{3,}))/

/** What in `text` may not reach the workspace's pool, by its kind and never its value, or undefined. */
export function secret(text: string): string | undefined {
  const format = FORMATS.find(([, pattern]) => pattern.test(text))
  if (format) return format[0]
  const argument = ARGUMENTS.find(([, pattern]) =>
    Array.from(text.matchAll(pattern), (match) => match[1] ?? "").some((value) => !REFERENCE.test(value)),
  )
  return argument?.[0]
}

/**
 * `text` with this machine's paths made shareable: inside the checkout, relative to its root; elsewhere under the home
 * directory, from `~/`, so no account name leaves the machine.
 */
export function localize(text: string, roots: { readonly checkout?: string; readonly home?: string }) {
  const replace = (from: string | undefined, to: string, input: string) =>
    from === undefined || from.length < 2
      ? input
      : input
          .replaceAll(`file://${from}/`, to)
          .replaceAll(`${from}/`, to)
          .replace(new RegExp(`${escape(from)}(?![\\w.-])`, "g"), to === "" ? "." : to.slice(0, -1))
  return replace(roots.home, "~/", replace(roots.checkout, "", text))
}

/**
 * A write's fields as they may leave the machine: every text localized, except `oldText`, which must match the stored
 * body as it is. Or the first field holding a secret, by name and kind, when nothing may be sent.
 */
export function share(
  fields: Record<string, unknown>,
  roots: { readonly checkout?: string; readonly home?: string },
):
  | { readonly fields: Record<string, unknown> }
  | { readonly field: string; readonly kind: string; readonly repair: string } {
  const found: Array<{ field: string; kind: string; repair: string }> = []
  const visit = (value: unknown, field: string): unknown => {
    if (typeof value === "string") {
      const kind = secret(value)
      if (kind !== undefined)
        found.push({
          field,
          kind,
          repair: "Replace it with a variable reference such as $TOKEN or a placeholder such as <password>",
        })
      const localized = localize(value, roots)
      // Hosts and addresses only the workspace's network reaches name nothing a reader can use, and say where it is.
      if (kind === undefined && INTERNAL.test(localized))
        found.push({
          field,
          kind: "an internal host name or address",
          repair: "Replace it with a descriptive placeholder such as <internal database host>",
        })
      // A scratch file exists only on this machine.
      if (kind === undefined && TEMP.test(localized))
        found.push({
          field,
          kind: "a scratch path (/tmp/…)",
          repair: "Leave it out, or say what the file holds instead: no other machine has this one's scratch files",
        })
      // What's left in a home directory after this machine's own paths were made relative is someone else's.
      if (kind === undefined && HOME.test(localized))
        found.push({
          field,
          kind: "a path in a home directory",
          repair: "Write it relative to the repository, or from ~/ for a path in the user's own home directory",
        })
      return localized
    }
    if (Array.isArray(value)) return value.map((item, index) => visit(item, `${field}[${index}]`))
    if (typeof value === "object" && value !== null)
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          key === "oldText" ? item : visit(item, field === "" ? key : `${field}.${key}`),
        ]),
      )
    return value
  }
  const shared = visit(fields, "")
  return found[0] ?? { fields: shared as Record<string, unknown> }
}

/** A private-network address (RFC 1918), or a host under a name only an internal network resolves. */
const INTERNAL =
  /(?<![\d.])(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}(?![\d.]*\d)|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:internal|corp|lan|intranet)\b/i

/** A path into this machine's scratch space, as Console's scan finds one. */
const TEMP = /(?:^|[\s"'`(=:[,])(?:(?:\/private)?\/tmp\/|\/var\/folders\/)/

/** A path into someone's home directory, as Console's scan finds one. */
const HOME =
  /(?:^|[\s"'`(=:[,])(?:\/home\/[^/\s"'`]+|\/Users\/[^/\s"'`]+|\/root(?=[/\s"'`]|$)|[A-Za-z]:\\Users\\[^\\\s"'`]+)/

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
