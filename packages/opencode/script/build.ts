#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import type { BunPlugin } from "bun"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const generated = await import("./generate.ts")

import { Script } from "@opencode-ai/script"
import pkg from "../package.json"

const singleFlag = process.argv.includes("--single")
const baselineFlag = process.argv.includes("--baseline")
const skipInstall = process.argv.includes("--skip-install")
const sourcemapsFlag = process.argv.includes("--sourcemaps")
const plugin = createSolidTransformPlugin()
const skipEmbedWebUi = process.argv.includes("--skip-embed-web-ui")

const createEmbeddedWebUIBundle = async () => {
  console.log(`Building Web UI to embed in the binary`)
  const appDir = path.join(import.meta.dirname, "../../app")
  const dist = path.join(appDir, "dist")
  await $`OPENCODE_CHANNEL=${Script.channel} bun run --cwd ${appDir} build`
  const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dist })))
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => !file.endsWith(".map"))
    .sort()
  const imports = files.map((file, i) => {
    const spec = path.relative(dir, path.join(dist, file)).replaceAll("\\", "/")
    return `import file_${i} from ${JSON.stringify(spec.startsWith(".") ? spec : `./${spec}`)} with { type: "file" };`
  })
  const entries = files.map((file, i) => `  ${JSON.stringify(file)}: file_${i},`)
  return [
    `// Import all files as file_$i with type: "file"`,
    ...imports,
    `// Export with original mappings`,
    `export default {`,
    ...entries,
    `}`,
  ].join("\n")
}

const embeddedFileMap = skipEmbedWebUi ? null : await createEmbeddedWebUIBundle()
const treeSitterWorker = await Bun.file(fileURLToPath(import.meta.resolve("@opentui/core/parser.worker"))).text()

// Resolve grammar assets from Nix or network fetch
import { bundledGrammars } from "./bundled-grammars"
import { existsSync } from "node:fs"

// Verify known hashes for assets
async function assertSha256(bytes: Uint8Array<ArrayBuffer>, expected: string, url: string) {
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  const actual = Buffer.from(digest).toString("hex")
  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${url}: expected ${expected}, got ${actual}`)
  }
}

// Run async work over items with bounded concurrency.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let index = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const i = index++
        results[i] = await fn(items[i]!)
      }
    }),
  )
  return results
}

async function fetchGrammarAsset(spec: { url: string; sha256: string; file: string }) {
  const localDir = process.env.OPENTUI_BUNDLED_GRAMMARS_DIR
  if (localDir) {
    // The env var means a hermetic (Nix) build: a missing asset is fatal,
    // falling back to the network would fail confusingly inside the sandbox.
    const local = path.join(localDir, spec.file)
    if (!existsSync(local)) {
      throw new Error(`OPENTUI_BUNDLED_GRAMMARS_DIR is set to ${localDir} but ${spec.file} is missing`)
    }
    return new Uint8Array((await Bun.file(local).arrayBuffer()) as ArrayBuffer)
  }
  const res = await fetch(spec.url)
  if (!res.ok) throw new Error(`Failed to fetch bundled grammar asset ${spec.url}: ${res.status}`)
  const bytes = new Uint8Array((await res.arrayBuffer()) as ArrayBuffer)
  await assertSha256(bytes, spec.sha256, spec.url)
  return bytes
}

const grammarSpecs = [
  ...new Map(
    Object.values(bundledGrammars)
      .flatMap((grammar) => [grammar.wasm, ...Object.values(grammar.queries).flat()])
      .map((spec) => [spec.url, spec]),
  ).values(),
]
const grammarAssets = new Map(
  await mapLimit(grammarSpecs, 8, async (spec) => [spec.url, await fetchGrammarAsset(spec)] as const),
)

// Write grammar assets plus the generated TUI resolver to a gitignored dir.
const grammarDir = path.join(dir, "gen", "grammars")
fs.rmSync(grammarDir, { recursive: true, force: true })
fs.mkdirSync(grammarDir, { recursive: true })
for (const grammar of Object.values(bundledGrammars)) {
  await Bun.write(path.join(grammarDir, grammar.wasm.file), grammarAssets.get(grammar.wasm.url)!)
  for (const assets of Object.values(grammar.queries)) {
    for (const asset of assets) {
      await Bun.write(path.join(grammarDir, asset.file), grammarAssets.get(asset.url)!)
    }
  }
}

const resolverGenPath = path.join(grammarDir, "bundled-grammars.gen.ts")
const importLine = (binding: string, file: string) =>
  `import ${binding} from ${JSON.stringify(`./${file}`)} with { type: "file" };`
const resolverImports = Object.entries(bundledGrammars).flatMap(([name, grammar]) => [
  importLine(`wasm_${name}`, grammar.wasm.file),
  ...Object.entries(grammar.queries).flatMap(([qkey, assets]) =>
    assets.map((asset, i) => importLine(`${qkey}_${name}_${i}`, asset.file)),
  ),
])
const resolverEntries = Object.entries(bundledGrammars).map(
  ([name, grammar]) =>
    `  ${JSON.stringify(name)}: { wasm: wasm_${name}, queries: { ${Object.entries(grammar.queries)
      .map(([qkey, assets]) => `${qkey}: [${assets.map((_, i) => `${qkey}_${name}_${i}`).join(", ")}]`)
      .join(", ")} } },`,
)
const resolverContent = [
  "// Generated by packages/opencode/script/build.ts. Do not edit.",
  ...resolverImports,
  "",
  "export default {",
  ...resolverEntries,
  "}",
  "",
].join("\n")
await Bun.write(resolverGenPath, resolverContent)

// Redirect `parsers-config.ts`'s import of the committed stub to the generated
// resolver so compiling never mutates the working tree.
const grammarResolverPlugin: BunPlugin = {
  name: "opencode-grammar-resolver",
  setup(build) {
    build.onResolve({ filter: /bundled-grammars\.gen$/ }, () => ({ path: resolverGenPath }))
  },
}

const allTargets: {
  os: string
  arch: "arm64" | "x64"
  abi?: "musl"
  avx2?: false
}[] = [
  {
    os: "linux",
    arch: "arm64",
  },
  {
    os: "linux",
    arch: "x64",
  },
  {
    os: "linux",
    arch: "x64",
    avx2: false,
  },
  {
    os: "linux",
    arch: "arm64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
    avx2: false,
  },
  {
    os: "darwin",
    arch: "arm64",
  },
  {
    os: "darwin",
    arch: "x64",
  },
  {
    os: "darwin",
    arch: "x64",
    avx2: false,
  },
  {
    os: "win32",
    arch: "arm64",
  },
  {
    os: "win32",
    arch: "x64",
  },
  {
    os: "win32",
    arch: "x64",
    avx2: false,
  },
]

const targets = singleFlag
  ? allTargets.filter((item) => {
      if (item.os !== process.platform || item.arch !== process.arch) {
        return false
      }

      // When building for the current platform, prefer a single native binary by default.
      // Baseline binaries require additional Bun artifacts and can be flaky to download.
      if (item.avx2 === false) {
        return baselineFlag
      }

      // also skip abi-specific builds for the same reason
      if (item.abi !== undefined) {
        return false
      }

      return true
    })
  : allTargets

await $`rm -rf dist`

const binaries: Record<string, string> = {}
if (!skipInstall) {
  await $`bun install --os="*" --cpu="*" @opentui/core@${pkg.dependencies["@opentui/core"]}`
  await $`bun install --os="*" --cpu="*" @parcel/watcher@${pkg.dependencies["@parcel/watcher"]}`
  await $`bun install --os="*" --cpu="*" @ff-labs/fff-bun@${pkg.dependencies["@ff-labs/fff-bun"]}`
}
for (const item of targets) {
  const name = [
    pkg.name,
    // changing to win32 flags npm for some reason
    item.os === "win32" ? "windows" : item.os,
    item.arch,
    item.avx2 === false ? "baseline" : undefined,
    item.abi === undefined ? undefined : item.abi,
  ]
    .filter(Boolean)
    .join("-")
  console.log(`building ${name}`)
  await $`mkdir -p dist/${name}/bin`

  const workerPath = "./src/cli/tui/worker.ts"
  const treeSitterWorkerPath = "opentui-tree-sitter-worker.js"
  const bunfsRoot = item.os === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"

  await Bun.build({
    conditions: ["bun", "node"],
    tsconfig: "./tsconfig.json",
    plugins: [plugin, grammarResolverPlugin],
    external: ["node-gyp"],
    format: "esm",
    minify: true,
    sourcemap: sourcemapsFlag ? "linked" : "none",
    splitting: true,
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      target: name.replace(pkg.name, "bun") as any,
      outfile: `dist/${name}/bin/opencode`,
      execArgv: [`--user-agent=opencode/${Script.version}`, "--use-system-ca", "--"],
      windows: {},
    },
    files: {
      [treeSitterWorkerPath]: treeSitterWorker,
      ...(embeddedFileMap ? { "opencode-web-ui.gen.ts": embeddedFileMap } : {}),
    },
    entrypoints: [
      "./src/index.ts",
      workerPath,
      treeSitterWorkerPath,
      ...(embeddedFileMap ? ["opencode-web-ui.gen.ts"] : []),
    ],
    define: {
      FFF_LIBC: JSON.stringify(item.abi === "musl" ? "musl" : "gnu"),
      OPENCODE_VERSION: `'${Script.version}'`,
      OPENCODE_MODELS_DEV: generated.modelsData,
      OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + treeSitterWorkerPath,
      OPENCODE_WORKER_PATH: workerPath,
      OPENCODE_CHANNEL: `'${Script.channel}'`,
      OPENCODE_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "",
      ...(item.os === "linux" ? { "process.env.OPENTUI_LIBC": JSON.stringify(item.abi ?? "glibc") } : {}),
    },
  })

  // Smoke test: only run if binary is for current platform
  if (item.os === process.platform && item.arch === process.arch && !item.abi) {
    const binaryPath = `dist/${name}/bin/opencode`
    console.log(`Running smoke test: ${binaryPath} --version`)
    try {
      const versionOutput = await $`${binaryPath} --version`.text()
      console.log(`Smoke test passed: ${versionOutput.trim()}`)
    } catch (e) {
      console.error(`Smoke test failed for ${name}:`, e)
      process.exit(1)
    }
  }

  await $`rm -rf ./dist/${name}/bin/tui`
  await Bun.file(`dist/${name}/package.json`).write(
    JSON.stringify(
      {
        name,
        version: Script.version,
        preferUnplugged: true,
        os: [item.os],
        cpu: [item.arch],
        ...(item.abi ? { libc: [item.abi] } : {}),
      },
      null,
      2,
    ),
  )
  binaries[name] = Script.version
}

if (Script.release) {
  for (const key of Object.keys(binaries)) {
    if (key.includes("linux")) {
      await $`tar -czf ../../${key}.tar.gz *`.cwd(`dist/${key}/bin`)
    } else {
      await $`zip -r ../../${key}.zip *`.cwd(`dist/${key}/bin`)
    }
  }
  await $`gh release upload v${Script.version} ./dist/*.zip ./dist/*.tar.gz --clobber --repo ${process.env.GH_REPO}`
}

export { binaries }
