import { describe, expect, test } from "bun:test"
import path from "node:path"

/**
 * The New timeline is an experiment beside the timeline users have today. These rules keep it from changing that
 * timeline: the old one never reaches into this folder, the experiment is read in a few known places only, and this
 * folder's styles cannot match the old timeline's markup.
 */

const packages = path.resolve(import.meta.dir, "../../..")

const folder = path.join(packages, "session-ui/src/timeline-next")

// The places that choose which timeline to show.
const switches = ["app/src/session/timeline/controller.tsx", "app/src/session/timeline/message-timeline.tsx"]

// The setting itself and where it is offered.
const setting = [
  ...switches,
  "app/src/settings/model.tsx",
  "app/src/settings/experimental/experimental.tsx",
  "app/src/settings/search-catalog.ts",
  "app/src/runtime/i18n/en.ts",
]

const root = '[data-timeline="next"]'

describe("New timeline boundary", () => {
  test("only the switches import the New timeline", async () => {
    const importers = (await sources()).filter(
      (file) => !inFolder(file.path) && /["'](@opencode\/session-ui\/|(\.\.\/)+)timeline-next\b/.test(file.text),
    )

    expect(importers.map((file) => file.name).filter((name) => !switches.includes(name))).toEqual([])
  })

  test("only the setting's own files and the switches read the experiment", async () => {
    const readers = (await sources()).filter((file) => !inFolder(file.path) && /\bnewTimeline\b/.test(file.text))

    expect(readers.map((file) => file.name).filter((name) => !setting.includes(name))).toEqual([])
  })

  test("every style in the folder is scoped to the New timeline", async () => {
    const files = await Array.fromAsync(new Bun.Glob("**/*.css").scan({ cwd: folder, absolute: true }))

    const unscoped = await Promise.all(
      files.map(async (file) =>
        topLevelSelectors(await Bun.file(file).text())
          .filter((selector) => !scoped(selector))
          .map((selector) => `${path.relative(folder, file)}: ${selector}`),
      ),
    )

    expect(unscoped.flat()).toEqual([])
  })
})

async function sources() {
  const globs = [
    "app/src/**/*.{ts,tsx}",
    "session-ui/src/**/*.{ts,tsx}",
    "ui/src/**/*.{ts,tsx}",
    "stories/src/**/*.{ts,tsx}",
  ]

  const paths = (
    await Promise.all(globs.map((glob) => Array.fromAsync(new Bun.Glob(glob).scan({ cwd: packages, absolute: true }))))
  ).flat()

  return Promise.all(
    // Named with forward slashes on every platform, as the lists above are.
    paths.map(async (file) => ({
      path: file,
      name: path.relative(packages, file).split(path.sep).join("/"),
      text: await Bun.file(file).text(),
    })),
  )
}

function inFolder(file: string) {
  return file.startsWith(folder + path.sep)
}

// At-rules name things globally, so they carry the folder's prefix; everything else hangs off the root.
function scoped(selector: string) {
  if (selector.startsWith("@keyframes ")) return selector.startsWith("@keyframes timeline-next-")

  if (selector.startsWith("@property ")) return selector.startsWith("@property --timeline-next-")

  return (
    selector === root ||
    selector.startsWith(`${root} `) ||
    selector.startsWith(`${root}[`) ||
    selector.startsWith(`${root}:`)
  )
}

// The selectors of each top-level rule, split at commas outside parentheses.
function topLevelSelectors(css: string) {
  const selectors: string[] = []
  let depth = 0
  let buffer = ""

  for (const char of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (char === "{" && depth === 0) selectors.push(...splitSelectors(buffer))

    if (char === "{" || char === "}" || (char === ";" && depth === 0)) buffer = ""
    else buffer += char

    if (char === "{") depth++

    if (char === "}") depth--
  }

  return selectors
}

function splitSelectors(text: string) {
  const parts = [""]
  let parens = 0

  for (const char of text) {
    if (char === "," && parens === 0) {
      parts.push("")
      continue
    }

    if (char === "(") parens++

    if (char === ")") parens--
    parts[parts.length - 1] += char
  }

  return parts.flatMap((part) => {
    const value = part.trim().replace(/\s+/g, " ")

    return value ? [value] : []
  })
}
