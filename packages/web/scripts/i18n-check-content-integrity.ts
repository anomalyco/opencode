import path from "node:path"
import { docsResidualProseAllowlist } from "./i18n-check-allowlist"
import { docsDir, selected } from "./i18n-common"

const placeholder = /___[A-Z0-9_]+___/
const residual = [
  {
    id: "copilot-pro-plus",
    note: "known residual untranslated prose",
    pattern: /Some models might need a \[Pro\+/,
  },
  {
    id: "shared-with-your",
    note: "known residual untranslated prose",
    pattern: /shared with your/,
  },
  {
    id: "gitlab-plugin-paragraph",
    note: "known residual untranslated prose",
    pattern:
      /This plugin provides comprehensive GitLab repository management capabilities including MR reviews, issue tracking, pipeline monitoring, and more\./,
  },
] as const

const errors: string[] = []
for (const code of selected()) {
  const dir = path.join(docsDir, code)
  for await (const file of new Bun.Glob("**/*.mdx").scan({ cwd: dir })) {
    const full = path.join(dir, file)
    const doc = path.join("src/content/docs", code, file)
    const allow = new Set(docsResidualProseAllowlist[doc] ?? [])
    const lines = (await Bun.file(full).text()).split("\n")
    let fence = false
    for (const [row, line] of lines.entries()) {
      const trimmed = line.trimStart()
      if (trimmed.startsWith("```")) {
        fence = !fence
        continue
      }
      if (fence) {
        continue
      }
      if (line.includes("：：：")) {
        errors.push(`${doc}:${row + 1}: full-width admonition opener artifact: ${line.trim()}`)
      }
      if (placeholder.test(line)) {
        errors.push(`${doc}:${row + 1}: placeholder artifact ___TOKEN___ detected: ${line.trim()}`)
      }
      for (const item of residual) {
        if (!item.pattern.test(line)) {
          continue
        }
        if (allow.has(item.id)) {
          continue
        }
        errors.push(`${doc}:${row + 1}: ${item.note} (${item.id}): ${line.trim()}`)
      }
    }
  }
}

if (errors.length === 0) {
  console.log("No docs content integrity defects found in non-root locale pages.")
  process.exit(0)
}

console.error("Docs content integrity check failed:")
for (const error of errors) {
  console.error(`- ${error}`)
}
console.error(
  "Action: fix the localized prose artifact, or add a proven false-positive exception in scripts/i18n-check-allowlist.ts.",
)
process.exit(1)
