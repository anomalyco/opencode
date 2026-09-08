#!/usr/bin/env bun
import path from "node:path"
import { parseArgs } from "node:util"
import { isBuiltin } from "node:module"
import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } from "@zip.js/zip.js"
import { build } from "vite"
import solid from "vite-plugin-solid"
import { Schema } from "effect"
import { ExtensionManager } from "../src/desktop/manager"

const args = parseArgs({
  options: {
    manifest: { type: "string" },
    renderer: { type: "string" },
    main: { type: "string" },
    assets: { type: "string" },
    out: { type: "string" },
  },
}).values
if (!args.manifest || !args.renderer || !args.out)
  throw new Error(
    "Usage: desktop-pack --manifest manifest.json --renderer index.tsx [--main main.ts] [--assets assets] --out extension.ocdx",
  )
const metadata = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ id: Schema.String, name: Schema.String, version: Schema.String })),
)(await Bun.file(args.manifest).text())

async function bundle(entry: string, renderer: boolean) {
  const result = await build({
    configFile: false,
    plugins: renderer ? [solid()] : [],
    ssr: { noExternal: true },
    build: {
      target: renderer ? "esnext" : "node22",
      ssr: !renderer,
      write: false,
      cssCodeSplit: false,
      assetsInlineLimit: Number.MAX_SAFE_INTEGER,
      lib: { entry: path.resolve(entry), formats: ["cjs"], fileName: () => (renderer ? "renderer.cjs" : "main.cjs") },
      rollupOptions: {
        external: (id) =>
          isBuiltin(id) || /^(solid-js(?:\/|$)|effect(?:\/|$)|@tanstack\/solid-query$|@opencode\/|electron$)/.test(id),
        output: { inlineDynamicImports: true, dynamicImportInCjs: false, exports: "named" },
      },
    },
  })
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((result) =>
    "output" in result ? result.output : [],
  )
  const code = outputs.find((output) => output.type === "chunk")
  if (!code || code.type !== "chunk") throw new Error(`No bundle was produced for ${entry}`)
  return { code, assets: outputs.filter((output) => output.type === "asset") }
}

const renderer = await bundle(args.renderer, true)
const main = args.main ? await bundle(args.main, false) : undefined
const style = renderer.assets.find((asset) => asset.fileName.endsWith(".css"))
const manifest = Schema.decodeUnknownSync(ExtensionManager.Manifest)({
  ...metadata,
  schema: "opencode.desktop/1",
  entry: "renderer.cjs",
  imports: renderer.code.imports,
  ...(main ? { main: "main.cjs", mainImports: main.code.imports } : {}),
  ...(style ? { style: style.fileName } : {}),
})
const archive = new ZipWriter(new BlobWriter("application/vnd.ocdx"))
await archive.add("manifest.json", new TextReader(JSON.stringify(manifest)))
await archive.add("renderer.cjs", new TextReader(renderer.code.code))
if (main) await archive.add("main.cjs", new TextReader(main.code.code))
for (const asset of renderer.assets)
  await archive.add(
    asset.fileName,
    typeof asset.source === "string" ? new TextReader(asset.source) : new Uint8ArrayReader(asset.source),
  )
if (args.assets) {
  for await (const file of new Bun.Glob("**/*").scan({ cwd: args.assets, onlyFiles: true })) {
    await archive.add(
      `assets/${file.replaceAll("\\", "/")}`,
      new Uint8ArrayReader(await Bun.file(path.join(args.assets, file)).bytes()),
    )
  }
}
await Bun.write(args.out, await archive.close())
console.log(args.out)
