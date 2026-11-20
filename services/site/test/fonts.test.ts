import { describe, expect, test } from "bun:test"
import path from "node:path"
import { interFaces } from "~/component/site/inter-fonts"
import { monoFontFaces } from "~/component/site/mono-fonts"

const root = path.resolve(import.meta.dir, "..")
// The licensed mono face the site used before OpenTUI Mono, and its foundry. Built from parts so
// this file doesn't match itself; the lookahead skips codes like "TX020" in vendored bundles.
const retired = new RegExp(["t", "x-?02(?!\\d)", "|", "be", "rkeley"].join(""), "i")

describe("fonts", () => {
  test("no file names or mentions the retired mono face", async () => {
    const files = (await Bun.$`git ls-files -co --exclude-standard`.cwd(root).text()).split("\n").filter(Boolean)
    const hits = (
      await Promise.all(
        files.map(async (file) => {
          if (retired.test(file)) return [file]
          const data = Bun.file(path.join(root, file))
          if (!(await data.exists())) return []
          const bytes = new Uint8Array(await data.arrayBuffer())
          // Text files only, as grep -I reads them.
          if (bytes.subarray(0, 8000).includes(0)) return []
          return new TextDecoder()
            .decode(bytes)
            .split("\n")
            .flatMap((line, index) => (retired.test(line) ? [`${file}:${index + 1}`] : []))
        }),
      )
    ).flat()
    expect(hits).toEqual([])
  })

  test("the mono stack starts with OpenTUI Mono, served from our own files", async () => {
    const css = await Bun.file(path.join(root, "src/component/site/site.css")).text()
    expect(css).toMatch(/--font-mono:\s*var\(--mono-choice,\) "OpenTUI Mono",/)
    const ranges = await Bun.file(path.join(root, "src/asset/fonts/opentui-mono.json")).json()
    expect(Object.keys(ranges)).toEqual(["latin", "rest"])
    expect(await Bun.file(path.join(root, "src/asset/fonts/OpenTUIMono-OFL.txt")).exists()).toBe(true)
  })

  test("the stylesheet's faces are the ones mono-fonts.ts and inter-fonts.ts describe", async () => {
    // Each face's declarations, with a font file named by its file name alone and numbers as numbers.
    const faces = (css: string) =>
      [...css.matchAll(/@font-face \{([^}]*)\}/g)].map((face) =>
        face[1]
          .replace(/url\("?[^)"]*[\\/]([\w-]+\.woff2)"?\)/g, "url($1)")
          .replace(/\d+\.\d+/g, (number) => String(Number(number)))
          .split(";")
          .map((declaration) => declaration.trim().replace(/\s+/g, " "))
          .filter(Boolean),
      )
    const css = await Bun.file(path.join(root, "src/style/fonts.css")).text()
    expect(faces(css)).toEqual(faces(`${monoFontFaces}\n${interFaces}`))
  })
})
