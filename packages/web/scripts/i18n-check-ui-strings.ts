import path from "node:path"
import { uiBlockedPhraseAllowlist, uiLiteralAllowlist } from "./i18n-check-allowlist"

const root = path.resolve(import.meta.dir, "../src")
const docsShellFiles = [
  "components/Header.astro",
  "components/Head.astro",
  "components/Lander.astro",
  "components/Share.tsx",
  "pages/s/[id].astro",
  "pages/[...slug].md.ts",
]
const shareFiles = await Array.fromAsync(new Bun.Glob("components/share/**/*.tsx").scan({ cwd: root }))
const files = [...new Set([...docsShellFiles, ...shareFiles])].sort()

const banned = [
  "The AI coding agent built for the terminal.",
  "The AI coding agent built for the terminal",
  "Get Started",
  "Link to this message",
  "Waiting for messages...",
  "Connected, waiting for messages...",
  "Connecting...",
  "Disconnected",
  "Reconnecting...",
  "Show more",
  "Show less",
  "Show results",
  "Hide results",
  "Show details",
  "Hide details",
  "Show preview",
  "Hide preview",
  "Show contents",
  "Hide contents",
  "Show output",
  "Hide output",
  "Scroll to bottom",
  "Not found",
]

const errors: string[] = []
for (const file of files) {
  const full = path.join(root, file)
  if (!(await Bun.file(full).exists())) {
    errors.push(`missing file in UI string check set: src/${file}`)
    continue
  }

  const text = await Bun.file(full).text()
  const allow = new Set([...(uiBlockedPhraseAllowlist[path.join("src", file)] ?? []), ...uiLiteralAllowlist])
  for (const phrase of banned) {
    if (allow.has(phrase)) {
      continue
    }
    if (!text.includes(phrase)) {
      continue
    }
    errors.push(`${path.join("src", file)} contains "${phrase}"`)
  }
}

if (errors.length === 0) {
  console.log(`No blocked hardcoded UI strings found in ${files.length} docs shell/share files.`)
  process.exit(0)
}

console.error("Blocked hardcoded UI strings found:")
for (const error of errors) {
  console.error(`- ${error}`)
}
console.error(
  "Action: move UI copy to i18n dictionaries, or add a sanctioned exception in scripts/i18n-check-allowlist.ts.",
)
process.exit(1)
