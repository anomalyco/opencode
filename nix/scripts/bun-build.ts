import solidPlugin from "./packages/opencode/node_modules/@opentui/solid/scripts/solid-plugin"
import path from "path"
import fs from "fs"

const version = "@VERSION@"
const pkg = path.join(process.cwd(), "packages/opencode")
const parser = fs.realpathSync(path.join(pkg, "./node_modules/@opentui/core/parser.worker.js"))
const worker = "./src/cli/cmd/tui/worker.ts"
const target = process.env["BUN_COMPILE_TARGET"]

if (!target) {
  throw new Error("BUN_COMPILE_TARGET not set")
}

process.chdir(pkg)

const manifestName = "opencode-assets.manifest"
const manifestPath = path.join(pkg, manifestName)

const readTrackedAssets = () => {
  if (!fs.existsSync(manifestPath)) return []
  return fs
    .readFileSync(manifestPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

const removeTrackedAssets = () => {
  for (const file of readTrackedAssets()) {
    const filePath = path.join(pkg, file)
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true })
    }
  }
}

const assets = new Set<string>()

const addAsset = async (p: string) => {
  const file = path.basename(p)
  const dest = path.join(pkg, file)
  await Bun.write(dest, Bun.file(p))
  assets.add(file)
}

removeTrackedAssets()

const result = await Bun.build({
  conditions: ["browser"],
  tsconfig: "./tsconfig.json",
  plugins: [solidPlugin],
  sourcemap: "external",
  entrypoints: ["./src/index.ts", parser, worker],
  define: {
    OPENCODE_VERSION: `'@VERSION@'`,
    OTUI_TREE_SITTER_WORKER_PATH: "/$bunfs/root/" + path.relative(pkg, parser).replace(/\\/g, "/"),
    OPENCODE_CHANNEL: "'latest'",
  },
  compile: {
    target,
    outfile: "opencode",
    autoloadBunfig: false,
    autoloadDotenv: false,
    //@ts-ignore (bun types aren't up to date)
    autoloadTsconfig: true,
    autoloadPackageJson: true,
    execArgv: ["--user-agent=opencode/" + version, "--use-system-ca", "--"],
    windows: {},
  },
})

if (!result.success) {
  console.error("Build failed!")
  for (const log of result.logs) {
    console.error(log)
  }
  throw new Error("Compilation failed")
}

const assetOutputs = result.outputs?.filter((x) => x.kind === "asset") ?? []
for (const x of assetOutputs) {
  await addAsset(x.path)
}

const bundle = await Bun.build({
  entrypoints: [worker],
  tsconfig: "./tsconfig.json",
  plugins: [solidPlugin],
  target: "bun",
  outdir: "./.opencode-worker",
  sourcemap: "none",
})

if (!bundle.success) {
  console.error("Worker build failed!")
  for (const log of bundle.logs) {
    console.error(log)
  }
  throw new Error("Worker compilation failed")
}

const workerAssets = bundle.outputs?.filter((x) => x.kind === "asset") ?? []
for (const x of workerAssets) {
  await addAsset(x.path)
}

const output = bundle.outputs.find((x) => x.kind === "entry-point")
if (!output) {
  throw new Error("Worker build produced no entry-point output")
}

const dest = path.join(pkg, "opencode-worker.js")
await Bun.write(dest, Bun.file(output.path))
fs.rmSync(path.dirname(output.path), { recursive: true, force: true })

const list = Array.from(assets)
await Bun.write(manifestPath, list.length > 0 ? list.join("\n") + "\n" : "")

console.log("Build successful!")
