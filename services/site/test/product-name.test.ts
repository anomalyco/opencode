import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Glob } from "bun"
import ts from "typescript"

/*
 * The pay-as-you-go models product is "OpenCode Models". Its old name, "Zen" or "OpenCode Zen", must
 * not come back into the site's copy. This reads the text a reader can see (string literals, template
 * text and JSX text in src, the site's JSON data and the public text files) and fails on the old name.
 * Code identifiers (ZenData, zenApiKey), i18n keys ("zen.faq.q1"), the /zen redirect and the
 * zen/v1 API paths are lowercase or part of a longer word, so they don't match.
 */
const root = path.join(import.meta.dir, "..")
// "Zen" as a word with a capital, or "OpenCode Zen" in any case. Lowercase "zen" alone is an identifier or a path.
const matches = (text: string) =>
  /(?<![A-Za-z\u00C0-\u024F])Zen(?![A-Za-z\u00C0-\u024F])/u.test(text) || /opencode[\s-]+zen/i.test(text)

// Each entry is a file, and the text in it that may keep the old name, with the reason.
const allowed: { file: string; text?: string; reason: string }[] = [
  { file: "src/lib/github-snapshot.json", reason: "release notes from GitHub, which are history" },
  {
    file: "src/routes/zen/index.tsx",
    reason: "the old /zen page, which redirects to /console/models (src/middleware.ts); its testimonials are quotes",
  },
  {
    file: "src/lib/voice-answers.ts",
    text: "opencode zen",
    reason: "a question the voice assistant matches, so people who ask for the old name get the answer",
  },
]

const isAllowed = (file: string, text: string) =>
  allowed.some((entry) => entry.file === file && (entry.text === undefined || text.includes(entry.text)))

function visibleText(file: string, source: string) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const texts: string[] = []
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    )
      texts.push(node.text)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return texts
}

async function scan(pattern: string, read: (file: string, source: string) => string[]) {
  // Glob returns backslash paths on Windows; the allowlist uses forward slashes.
  const files = (await Array.fromAsync(new Glob(pattern).scan({ cwd: root }))).map((file) => file.replaceAll("\\", "/"))
  const found = await Promise.all(
    files.map(async (file) => {
      const source = await Bun.file(path.join(root, file)).text()
      return read(file, source)
        .filter((text) => matches(text) && !isAllowed(file, text))
        .map((text) => `${file}: ${text.slice(0, 160)}`)
    }),
  )
  return found.flat()
}

describe("product name", () => {
  test("the matcher finds the old name and skips identifiers", () => {
    expect(
      ["Zen", "OpenCode Zen", "opencode zen", "Use Zen with", "Zenを使用", "Zen'i", "将 Zen 与"].every(matches),
    ).toBe(true)
    expect(
      ["zen.faq.q1", "/zen", "/zen/v1/chat/completions", "ZenData", "zenApiKey", "Zenburn", "citizen", "frozen"].some(
        matches,
      ),
    ).toBe(false)
  })

  test("site copy in src doesn't use the old name", async () => {
    expect(await scan("src/**/*.{ts,tsx}", visibleText)).toEqual([])
  })

  test("the site's JSON data doesn't use the old name", async () => {
    expect(await scan("src/**/*.json", (_, source) => [source])).toEqual([])
  })

  test("public text files don't use the old name", async () => {
    expect(await scan("public/**/*.{txt,md,json,webmanifest,xml}", (_, source) => [source])).toEqual([])
  })
})
