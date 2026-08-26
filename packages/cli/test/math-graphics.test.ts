import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { mathGraphicsPlugin } from "../script/math-graphics"

test("compiled math graphics loads TeX components, SVG fonts, and the native rasterizer", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-math-graphics-"))
  await using _cleanup = { [Symbol.asyncDispose]: () => rm(directory, { recursive: true, force: true }) }
  const entry = path.join(directory, "entry.ts")
  const executable = path.join(directory, process.platform === "win32" ? "math.exe" : "math")
  const cwd = path.join(directory, "clean")
  await mkdir(cwd)
  await Bun.write(
    entry,
    `const { renderLatexToPng } = await import(${JSON.stringify(Bun.resolveSync("opentui-math/graphics", path.resolve(import.meta.dirname, "../../tui")))})
const results = [];
for (const source of [String.raw\`\\frac{1}{2} + \\sqrt{x}\`, String.raw\`\\cancel{x} + \\mathscr{A}\`]) {
  const image = await renderLatexToPng(source);
  if (image.svg.includes('data-mml-node="merror"')) throw new Error("MathJax rendered an error");
  results.push({ bytes: image.png.length, signature: image.png.subarray(0, 8).toString("hex"), width: image.width, height: image.height });
}
console.log(JSON.stringify(results));`,
  )
  const result = await Bun.build({
    entrypoints: [entry],
    plugins: [mathGraphicsPlugin({ os: process.platform, arch: process.arch })],
    minify: true,
    format: "esm",
    splitting: true,
    compile: { outfile: executable, autoloadBunfig: false, autoloadDotenv: false },
  })
  expect(result.logs).toEqual([])
  expect(result.success).toBe(true)
  const child = Bun.spawn([executable], { cwd, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect(stderr).toBe("")
  expect(exitCode).toBe(0)
  const images = JSON.parse(stdout)
  expect(images).toHaveLength(2)
  for (const image of images) {
    expect(image.signature).toBe("89504e470d0a1a0a")
    expect(image.bytes).toBeGreaterThan(8)
    expect(image.width).toBeGreaterThan(0)
    expect(image.height).toBeGreaterThan(0)
  }
}, 30_000)
