import { bundledLanguagesInfo } from "shiki"
import { getFilename } from "@opencode-ai/util/path"

// language metadata only; grammars stay behind shiki's lazy imports
const LANGUAGE_NAMES = new Map<string, string>(
  bundledLanguagesInfo.flatMap((info) =>
    [info.id, ...(info.aliases ?? [])].map((alias) => [alias, info.name] as [string, string]),
  ),
)

// attachments carry text/plain for all text files, so the label comes from the extension;
// filename may be an absolute path, so extract the basename before looking for one
export function typeLabel(filename: string, mime: string, fallback: string) {
  if (mime === "application/pdf") return "PDF"
  const base = getFilename(filename)
  // idx 0 is a dotfile like .gitignore, not an extension
  const idx = base.lastIndexOf(".")
  const suffix = idx <= 0 ? "" : base.slice(idx + 1).toLowerCase()
  if (!suffix) return fallback
  return LANGUAGE_NAMES.get(suffix) ?? suffix.toUpperCase()
}
