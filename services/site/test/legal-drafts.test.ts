import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Glob } from "bun"

/*
 * The legal drafts pending review (where your code goes, subprocessors, the DPA, acceptable use,
 * cookies, security) live outside the repository until legal approves them. This fails if one comes
 * back: their routes, titles, or a fingerprint of a distinctive sentence from each, anywhere in the
 * app's files or its build output. The fingerprints are hashes, so the draft text is not in the
 * repository either. To bring a draft back, remove it from these lists.
 */

const app = path.join(import.meta.dir, "..")
const routes = ["cookies", "dpa", "subprocessors", "acceptable-use", "where-your-code-goes", "security"].map(
  (slug) => `/legal/${slug}`,
)
const titles = ["Where your code and prompts go", "Data Processing Addendum", "Acceptable Use Policy", "Cookie Policy"]
// Bun.hash of the first eight words of one sentence per draft, lower case, punctuation as spaces.
const fingerprints = new Set([
  "5055022175405847030",
  "16235648370261031223",
  "12693654933234181395",
  "17687433890787457279",
  "7925250811482029832",
  "17650710177392802355",
])
const binary = /\.(png|jpe?g|webp|avif|gif|ico|woff2?|otf|ttf|zip|pdf|mp3|mp4|webm|mov|glb|wasm)$/i

async function files() {
  const listed = Bun.spawnSync(["git", "ls-files", "--cached", "--others", "--exclude-standard"], { cwd: app })
  const tracked = listed.stdout.toString().split("\n").filter(Boolean)
  // The build output is ignored by git, so it is scanned on its own when a build exists.
  const output = await Array.fromAsync(new Glob(".output/**/*").scan({ cwd: app, dot: true })).catch(() => [])
  return [...tracked, ...output].filter((file) => !binary.test(file) && !file.endsWith("legal-drafts.test.ts"))
}

function words(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
}

describe("legal drafts", () => {
  test("no draft route, title or text is in the app or its build", async () => {
    const found = (
      await Promise.all(
        (await files()).map(async (file) => {
          const blob = Bun.file(path.join(app, file))
          if (!(await blob.exists()) || blob.size > 8 * 1024 * 1024) return []
          const text = await blob.text()
          const hits = [...routes, ...titles].filter((needle) =>
            needle.startsWith("/") ? new RegExp(`${needle}(?![\\w-]|\\.\\w)`).test(text) : text.includes(needle),
          )
          const list = words(text)
          const prints = list.some((_, index) =>
            fingerprints.has(String(Bun.hash(list.slice(index, index + 8).join(" ")))),
          )
          return [...hits, ...(prints ? ["a draft's text"] : [])].map((hit) => `${file}: ${hit}`)
        }),
      )
    ).flat()
    expect(found).toEqual([])
  }, 60_000)
})
