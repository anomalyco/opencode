import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import type { Plugin } from "vite"

const id = "virtual:story-index"

/**
 * `virtual:story-index`: every story in `roots` by the id Storybook gave it (`<meta id or title>--<export>`), so the
 * component tests keep their ids. Each entry loads only its own file.
 */
export function storyIndex(roots: string[]): Plugin {
  return {
    name: "opencode:story-index",
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load(source) {
      if (source !== `\0${id}`) return

      const files = roots.flatMap((root) =>
        readdirSync(root, { recursive: true, encoding: "utf8" })
          .filter((file) => file.endsWith(".stories.tsx") && !file.includes("node_modules"))
          .map((file) => path.join(root, file).replaceAll("\\", "/")),
      )

      const entries = files.flatMap((file, index) => {
        // A Windows checkout may have CRLF line endings, which the meta block's closing `\n}\n` would miss.
        const source = readFileSync(file, "utf8").replaceAll("\r\n", "\n")
        const meta = source.slice(source.indexOf("export default {")).split(/\n}\n/)[0] ?? ""
        const kind = meta.match(/[{\s,]id:\s*"([^"]+)"/)?.[1] ?? meta.match(/[{\s,]title:\s*"([^"]+)"/)?.[1]

        if (!kind) return []

        return [...source.matchAll(/^export const (\w+)/gm)].map((match) => [
          `${sanitize(kind)}--${sanitize(startCase(match[1]!))}`,
          index,
          match[1],
        ])
      })

      return [
        `const paths = ${JSON.stringify(files)}`,
        `const files = [${files.map((file) => `() => import(${JSON.stringify(file)})`).join(",\n")}]`,
        `const stories = ${JSON.stringify(Object.fromEntries(entries.map(([story, file, name]) => [story, [file, name]])))}`,
        "export function findStory(id) {",
        "  const entry = stories[id]",
        "  return entry && { load: files[entry[0]], name: entry[1], file: paths[entry[0]] }",
        "}",
      ].join("\n")
    },
  }
}

// Storybook's story name for an export (`QuestionAndPermission` → "Question And Permission", `Queue1` → "Queue 1").
function startCase(key: string) {
  return key
    .replace(/[_\-.]/g, " ")
    .replace(/([^\n])([A-Z])([a-z])/g, "$1 $2$3")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-z])([0-9])/gi, "$1 $2")
    .replace(/([0-9])([a-z])/gi, "$1 $2")
    .replace(/ +/g, " ")
    .trim()
}

// Storybook's id segment: lower case, with every run of other characters as one dash.
function sanitize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}
