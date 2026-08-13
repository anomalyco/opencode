import { mkdir, rm, symlink } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const requireFromDrive = createRequire(join(packageRoot, "package.json"))
const effectRoot = dirname(requireFromDrive.resolve("effect/package.json"))
const compilerRoot = dirname(requireFromDrive.resolve("@typescript/native-preview/package.json"))
const bunTypesRoot = dirname(requireFromDrive.resolve("@types/bun/package.json"))
const requireFromBunTypes = createRequire(join(bunTypesRoot, "package.json"))
const bunRuntimeTypesRoot = dirname(requireFromBunTypes.resolve("bun-types/package.json"))

type Contract = "program" | "script"

export async function prepareScriptModule(artifacts: string, script: string) {
  const source = await resolveSource(script, "script")
  const root = await prepareRuntimeRoot(artifacts)
  return compileScript(root, source)
}

export async function prepareProgram(artifacts: string, script: string) {
  const source = await resolveSource(script, "program")
  const root = await prepareRuntimeRoot(artifacts)
  await typecheck(root, source, "program")
  const program = await compileScript(root, source)
  const runner = join(root, "program-runner.ts")
  await Bun.write(
    runner,
    [
      'import * as Effect from "effect/Effect"',
      `import program from ${JSON.stringify(program)}`,
      'if (!Effect.isEffect(program)) throw new Error("program must default-export a fully provided Effect")',
      "await Effect.runPromise(program)",
      "",
    ].join("\n"),
  )
  return runner
}

export async function checkScript(artifacts: string, script: string) {
  const source = await resolveSource(script, "script")
  const root = await prepareRuntimeRoot(artifacts)
  await typecheck(root, source, "script")
}

async function resolveSource(script: string, contract: Contract) {
  const source = resolve(script)
  if (!(await Bun.file(source).exists())) throw new Error(`${contract} not found: ${source}`)
  return source
}

async function compileScript(root: string, source: string) {
  const entry = join(root, "script-entry.ts")
  const output = join(root, "compiled")
  await Bun.write(entry, `export { default } from ${JSON.stringify(source)}\n`)
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: output,
    target: "bun",
    packages: "bundle",
    external: ["opencode-drive", "opencode-drive/*", "effect", "effect/*"],
    sourcemap: "inline",
  })
  if (!result.success) {
    const diagnostics = result.logs.map((log) => log.message).join("\n")
    throw new Error(diagnostics || `failed to compile script: ${source}`)
  }
  const file = result.outputs.find((item) => item.kind === "entry-point")?.path
  if (!file) throw new Error(`script compilation produced no entry point: ${source}`)
  return file
}

async function typecheck(root: string, source: string, contract: Contract) {
  const contractFile = join(root, `${contract}-contract.ts`)
  const tsconfig = join(root, `${contract}-tsconfig.json`)
  await Bun.write(
    contractFile,
    contract === "program"
      ? [
          'import type * as Effect from "effect/Effect"',
          `import program from ${JSON.stringify(source)}`,
          "const checked: Effect.Effect<unknown, unknown, never> = program",
          "void checked",
          "",
        ].join("\n")
      : [
          'import type { ScriptDefinition } from "opencode-drive/script"',
          `import script from ${JSON.stringify(source)}`,
          "const checked: ScriptDefinition = script",
          "void checked",
          "",
        ].join("\n"),
  )
  await Bun.write(
    tsconfig,
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          noEmit: true,
          allowJs: true,
          checkJs: true,
          lib: ["ESNext"],
          target: "ESNext",
          module: "Preserve",
          moduleResolution: "Bundler",
          allowImportingTsExtensions: true,
          skipLibCheck: true,
          types: ["bun"],
          paths: {
            "opencode-drive": [join(packageRoot, "src", "index.ts")],
            "opencode-drive/*": [join(packageRoot, "src", "*")],
            effect: [join(effectRoot, "dist", "index.d.ts")],
            "effect/*": [join(effectRoot, "dist", "*.d.ts")],
          },
        },
        files: [contractFile],
      },
      undefined,
      2,
    )}\n`,
  )
  const capture = contract === "script"
  const child = Bun.spawn([process.execPath, join(compilerRoot, "bin", "tsgo.js"), "-p", tsconfig], {
    cwd: root,
    stdin: "ignore",
    stdout: capture ? "pipe" : "inherit",
    stderr: capture ? "pipe" : "inherit",
  })
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    capture ? new Response(child.stdout).text() : "",
    capture ? new Response(child.stderr).text() : "",
  ])
  if (status === 0) return
  const diagnostics = [stdout, stderr]
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n")
  throw new Error(diagnostics || `${contract} type check failed with status ${status}`)
}

async function prepareRuntimeRoot(artifacts: string) {
  const root = join(resolve(artifacts), "script-runtime")
  const modules = join(root, "node_modules")
  await rm(root, { recursive: true, force: true })
  await mkdir(join(modules, "@types"), { recursive: true })
  await Promise.all([
    symlink(packageRoot, join(modules, "opencode-drive"), linkType),
    symlink(effectRoot, join(modules, "effect"), linkType),
    symlink(bunTypesRoot, join(modules, "@types", "bun"), linkType),
    symlink(bunRuntimeTypesRoot, join(modules, "bun-types"), linkType),
  ])
  return root
}

const linkType = process.platform === "win32" ? "junction" : "dir"
