import { parsePathLineSuffix } from "@opencode/util/path"

// Common files with no extension. Anything else needs a `.` or `/` to look like a file.
const fileNames = new Set([
  "CHANGELOG",
  "CODEOWNERS",
  "Containerfile",
  "Dockerfile",
  "Gemfile",
  "Justfile",
  "LICENSE",
  "Makefile",
  "Procfile",
  "README",
  "Rakefile",
  "Vagrantfile",
])

/**
 * `url` for an http(s) URL, `path` for anything that could name a file. A `path` only becomes a link once the host
 * confirms the file exists, so this stays a cheap syntax check.
 */
export function inlineCodeKind(text: string): "path" | "url" | undefined {
  if (/^https?:\/\//i.test(text)) return "url"

  if (!text || /\s/.test(text) || /^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return

  // Code, globs and markup, not paths.
  if (/[{}<>"'`;=|&*,]/.test(text)) return

  // A network share (`\\host\share`) would make the server connect to the host just to check it.
  if (/^[\\/]{2}/.test(text)) return

  const path = parsePathLineSuffix(text).path

  if (fileNames.has(path)) return "path"

  if (/[./\\]/.test(path) && /[a-z]/i.test(path)) return "path"
}
