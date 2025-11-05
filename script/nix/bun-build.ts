import solidPlugin from "./packages/opencode/node_modules/@opentui/solid/scripts/solid-plugin"
import path from "path"
import fs from "fs"

const version = "@VERSION@"
const repo = process.cwd()
const pkg = path.join(repo, "packages/opencode")
const parser = fs.realpathSync(
  path.join(pkg, "./node_modules/@opentui/core/parser.worker.js"),
)
const dir = pkg
const worker = "./src/cli/cmd/tui/worker.ts"
const target = process.env["BUN_COMPILE_TARGET"]

if (!target) {
  throw new Error("BUN_COMPILE_TARGET not set")
}

process.chdir(pkg)

const result = await Bun.build({
  conditions: ["browser"],
  tsconfig: "./tsconfig.json",
  plugins: [solidPlugin],
  sourcemap: "external",
  entrypoints: ["./src/index.ts", parser, worker],
  define: {
    OPENCODE_VERSION: `'@VERSION@'`,
    OTUI_TREE_SITTER_WORKER_PATH: "/$bunfs/root/" + path.relative(dir, parser).replace(/\\/g, "/"),
    OPENCODE_CHANNEL: "'latest'",
  },
  compile: {
    target,
    outfile: "opencode",
    execArgv: ["--user-agent=opencode/" + version, "--env-file=\"\"", "--"],
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

const output = bundle.outputs.find((item) => item.kind === "entry-point")
if (!output) {
  throw new Error("Worker build produced no entry-point output")
}

const dest = path.join(pkg, "opencode-worker.js")
const src = output.path
await Bun.write(dest, Bun.file(src))
fs.rmSync(path.dirname(src), { recursive: true, force: true })

console.log("Build successful!")
