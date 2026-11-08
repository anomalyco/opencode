// Builds the StatsOg Worker (src/og/worker.ts) into .og-worker: the bundle, the Wasm engines, and the site's OpenTUI
// Mono fonts as TrueType (Satori can't read WOFF2). infra/stats.ts runs this and uploads every file there. It is
// outside .output because the site's own build replaces that directory. test/og.test.ts builds it too, so PR CI
// catches a broken build before the deploy does.
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { decompress } from "wawoff2"

const root = path.join(import.meta.dir, "..")

if (import.meta.main) await buildOgWorker(path.join(root, ".og-worker"))

export async function buildOgWorker(out: string) {
  await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })
  const result = await Bun.build({
    entrypoints: [path.join(root, "src/og/worker.ts")],
    outdir: out,
    naming: "index.mjs",
    target: "browser",
    format: "esm",
    minify: true,
    external: ["*.wasm", "*.bin"],
    loader: { ".svg": "text" },
  })
  if (!result.success) throw new AggregateError(result.logs, "The OG Worker failed to build")

  // The HarfBuzz Wasm satori inlines as base64 (see src/og/worker.ts).
  const satoriBundle = await Bun.file(Bun.resolveSync("satori/standalone", root)).text()
  const harfbuzz = satoriBundle.match(/="([A-Za-z0-9+/]{100000,}={0,2})",\w+=typeof Buffer=="function"/)?.[1]
  if (!harfbuzz)
    throw new Error("satori's inlined HarfBuzz Wasm wasn't found; check src/og/worker.ts against this satori version")

  await Promise.all([
    Bun.write(path.join(out, "harfbuzz.wasm"), Buffer.from(harfbuzz, "base64")),
    Bun.write(path.join(out, "satori-layout.wasm"), Bun.file(Bun.resolveSync("satori/layout.wasm", root))),
    Bun.write(path.join(out, "resvg.wasm"), Bun.file(Bun.resolveSync("@resvg/resvg-wasm/index_bg.wasm", root))),
    ...["regular", "bold"].flatMap((weight) =>
      ["latin", "rest"].map(async (group) =>
        Bun.write(
          path.join(out, `opentui-mono-${weight}-${group}.bin`),
          await decompress(
            await Bun.file(path.join(root, `src/asset/fonts/opentui-mono-${weight}-${group}.woff2`)).bytes(),
          ),
        ),
      ),
    ),
  ])
}
