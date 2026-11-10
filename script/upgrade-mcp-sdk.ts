#!/usr/bin/env bun

// Upgrades @modelcontextprotocol/{client,core,server} and rebuilds our @modelcontextprotocol/client patch.
//
//   bun run script/upgrade-mcp-sdk.ts <version>
//
// The SDK ships bundled chunks whose file names are content hashes, so the patch never applies to a new version
// as is. This script pins the new version in packages/core and packages/client, drops the old patch, reinstalls,
// then reapplies every edit below with `bun patch` and commits the new patch file. Each edit names the PR that
// introduced it and must match exactly once in the ESM build and once in the CommonJS build; when the SDK changes
// the code an edit targets, the script stops and names that edit. Then check whether upstream fixed it (drop the
// edit) or moved it (update `find`), and run the script again.
//
// Before reporting success it checks that the patch file and its patchedDependencies entry exist and that a fresh
// install carries every edit. Any failure restores the manifests, lockfile and old patch and reinstalls them.
//
// Afterwards run `bun typecheck` and the MCP tests in packages/core.

import { rm } from "node:fs/promises"
import path from "node:path"
import { $ } from "bun"

type Edit = {
  readonly name: string
  // Bundled chunk the code lives in: `public-<hash>` (client) or `src-<hash>` (bundled core schemas).
  readonly chunk: "public" | "src"
  readonly find: (format: Format) => string
  readonly replace: (format: Format) => string
}

type Format = {
  readonly extension: "mjs" | "cjs"
  // How the chunk refers to core helpers and zod in each build.
  readonly core: string
  readonly zod: string
}

const formats: ReadonlyArray<Format> = [
  { extension: "mjs", core: "", zod: "z" },
  { extension: "cjs", core: "require_src.", zod: "zod_v4" },
]

const edits: ReadonlyArray<Edit> = [
  {
    // #48937: keep the server URL's query off OAuth metadata discovery URLs.
    name: "metadata discovery query",
    chunk: "public",
    find: () => "\t\turl.search = issuer.search;\n",
    replace: () => "",
  },
  {
    // #50519: don't force a consent prompt on every login that asks for offline_access.
    name: "offline_access consent prompt",
    chunk: "public",
    find: () =>
      '\tif (scope?.split(" ").includes("offline_access")) authorizationUrl.searchParams.append("prompt", "consent");\n',
    replace: () => "",
  },
  {
    // #61185: hand an input-required request's options to the handler (`mcpReq.origin`), so an elicitation reaches
    // the caller that brought its own handler.
    name: "input-required origin",
    chunk: "public",
    find: () => "\t\t\tbuildContext: (baseCtx) => this.buildContext(baseCtx, void 0),\n",
    replace: () =>
      [
        "\t\t\tbuildContext: (baseCtx) => this.buildContext({",
        "\t\t\t\t...baseCtx,",
        "\t\t\t\tmcpReq: {",
        "\t\t\t\t\t...baseCtx.mcpReq,",
        "\t\t\t\t\torigin: {",
        "\t\t\t\t\t\trequest: flow.request,",
        "\t\t\t\t\t\toptions: flow.options",
        "\t\t\t\t\t}",
        "\t\t\t\t}",
        "\t\t\t}, void 0),",
        "",
      ].join("\n"),
  },
  {
    // #60733: listed tools are unchecked (see below), so tolerate entries that are not objects.
    name: "x-mcp-header scan of unchecked tools",
    chunk: "public",
    find: (format) =>
      `\t\tconst filtered = result.tools.filter((tool) => {\n\t\t\tconst scan = ${format.core}scanXMcpHeaderDeclarations(tool.inputSchema);`,
    replace: (format) =>
      `\t\tconst filtered = result.tools.filter((tool) => {\n\t\t\tconst scan = ${format.core}scanXMcpHeaderDeclarations(tool?.inputSchema);`,
  },
  {
    // #58224: accept output schemas whose root is not an object.
    name: "tool outputSchema",
    chunk: "src",
    find: ({ zod }) =>
      [
        `\t\toutputSchema: ${zod}.object({`,
        `\t\t\ttype: ${zod}.literal("object"),`,
        `\t\t\tproperties: ${zod}.record(${zod}.string(), JSONValueSchema$1).optional(),`,
        `\t\t\trequired: ${zod}.array(${zod}.string()).optional()`,
        `\t\t}).catchall(${zod}.unknown()).optional(),`,
        "",
      ].join("\n"),
    replace: ({ zod }) => `\t\toutputSchema: ${zod}.looseObject({ $schema: ${zod}.string().optional() }).optional(),\n`,
  },
  {
    // #60733: leave listed tools unchecked so one malformed tool doesn't fail the list; McpClient checks each one.
    name: "legacy tools/list result",
    chunk: "src",
    find: ({ zod }) =>
      `const ListToolsResultSchema$1 = PaginatedResultSchema$1.extend({ tools: ${zod}.array(ToolSchema$1) });`,
    replace: ({ zod }) =>
      `const ListToolsResultSchema$1 = PaginatedResultSchema$1.extend({ tools: ${zod}.array(${zod}.unknown()) });`,
  },
  {
    // #60733: the same for the 2026-07-28 wire result.
    name: "modern tools/list result",
    chunk: "src",
    find: ({ zod }) => `\t\ttools: ${zod}.array(ToolSchema$1),\n\t\tnextCursor`,
    replace: ({ zod }) => `\t\ttools: ${zod}.array(${zod}.unknown()),\n\t\tnextCursor`,
  },
  {
    // #60733: the same for the lifted 2026-07-28 result.
    name: "lifted tools/list result",
    chunk: "src",
    find: ({ zod }) => `\t\t\ttools: ${zod}.array(ToolSchema$1),\n\t\t\tnextCursor`,
    replace: ({ zod }) => `\t\t\ttools: ${zod}.array(${zod}.unknown()),\n\t\t\tnextCursor`,
  },
]

const usage = "Usage: bun run script/upgrade-mcp-sdk.ts <version>"
const version = process.argv[2]?.replace(/^v/, "")
if (!version || process.argv.length > 3) {
  console.error(usage)
  process.exit(1)
}

const root = path.resolve(import.meta.dir, "..")
const pkg = "@modelcontextprotocol/client"
const patchFile = `patches/${pkg.replace("/", "%2F")}@${version}.patch`
const manifests = ["package.json", "packages/core/package.json", "packages/client/package.json", "bun.lock"]

// Every file this script changes, restored if any step fails so the SDK is never left unpatched.
const backup = new Map<string, string | undefined>()
for (const file of manifests) backup.set(file, await Bun.file(path.join(root, file)).text())
const previous = (backup.get("package.json") ?? "").match(
  /"@modelcontextprotocol\/client@[^"]+": "(patches\/[^"]+)"/,
)?.[1]
if (previous) backup.set(previous, await Bun.file(path.join(root, previous)).text())
if (patchFile !== previous) backup.set(patchFile, undefined)

const failure = await upgrade().then(
  () => undefined,
  (error: unknown) => error,
)
if (failure !== undefined) {
  console.error(failure instanceof Error ? failure.message : failure)
  for (const [file, text] of backup) {
    if (text === undefined)
      await Bun.file(path.join(root, file))
        .delete()
        .catch(() => {})
    else await Bun.write(path.join(root, file), text)
  }
  console.error(`Restored ${Array.from(backup.keys()).join(", ")}. Reinstalling the previous version.`)
  await $`bun install`.cwd(root).nothrow()
  process.exit(1)
}
console.log(`Patched ${pkg}@${version}. Run bun typecheck and the MCP tests in packages/core.`)

async function upgrade() {
  await pin(path.join(root, "packages/core/package.json"))
  await pin(path.join(root, "packages/client/package.json"))
  await dropPatch()
  await $`bun install`.cwd(root)

  // Edit the copy `bun patch` prepares; where it puts it depends on the Bun version and the install layout.
  const prepared = await $`bun patch ${pkg}@${version}`.cwd(root).quiet()
  const output = prepared.stdout.toString() + prepared.stderr.toString()
  const dir = output.match(/bun patch --commit '([^']+)'/)?.[1]
  if (!dir) throw new Error(`could not find the prepared directory in the bun patch output:\n${output}`)
  for (const [file, text] of await apply(path.resolve(root, dir))) await Bun.write(file, text)
  await $`bun patch --commit ${dir}`.cwd(root)
  await verify()
}

// Checks the patch file and its entry, then reinstalls the package from scratch and checks every edit landed in
// the copy the workspace resolves.
async function verify() {
  const patch = Bun.file(path.join(root, patchFile))
  if (!(await patch.exists()) || patch.size === 0) throw new Error(`bun patch --commit did not write ${patchFile}`)
  const manifest = await Bun.file(path.join(root, "package.json")).json()
  if (manifest.patchedDependencies?.[`${pkg}@${version}`] !== patchFile)
    throw new Error(`package.json has no patchedDependencies entry for ${pkg}@${version}`)

  const store = path.join(root, "node_modules/.bun")
  for (const entry of await Array.fromAsync(
    new Bun.Glob(`${pkg.replace("/", "+")}@${version}*`).scan({ cwd: store, onlyFiles: false }),
  ))
    await rm(path.join(store, entry), { recursive: true, force: true })
  await $`bun install`.cwd(root)
  const installed = path.dirname(Bun.resolveSync(`${pkg}/package.json`, path.join(root, "packages/core")))
  const missing: string[] = []
  for (const [format, files] of await chunks(installed))
    for (const edit of edits) {
      const text = await Bun.file(files[edit.chunk]).text()
      const replacement = edit.replace(format)
      if (text.includes(edit.find(format)) || (replacement !== "" && !text.includes(replacement)))
        missing.push(`${edit.name} (${format.extension})`)
    }
  if (missing.length > 0) throw new Error(`the installed ${pkg} at ${installed} is missing: ${missing.join(", ")}`)
}

// Applies every edit to the chunks under `dir` and returns the edited files. Throws naming the first edit whose
// code is not found exactly once.
async function apply(dir: string) {
  const edited = new Map<string, string>()
  for (const [format, files] of await chunks(dir)) {
    for (const file of Object.values(files)) edited.set(file, await Bun.file(file).text())
    for (const edit of edits) {
      const text = edited.get(files[edit.chunk])!
      const find = edit.find(format)
      const count = text.split(find).length - 1
      if (count !== 1) throw new Error(`edit "${edit.name}" matched ${count} times in ${files[edit.chunk]}, expected 1`)
      edited.set(
        files[edit.chunk],
        text.replace(find, () => edit.replace(format)),
      )
    }
  }
  return edited
}

// The one `public-*` and `src-*` chunk per build under `dir`.
async function chunks(dir: string) {
  return Promise.all(
    formats.map(async (format) => {
      const find = async (chunk: Edit["chunk"]) => {
        const matches = await Array.fromAsync(new Bun.Glob(`dist/${chunk}-*.${format.extension}`).scan({ cwd: dir }))
        const [match] = matches
        if (match === undefined || matches.length !== 1)
          throw new Error(`expected one dist/${chunk}-*.${format.extension} in ${dir}, found ${matches.length}`)
        return path.join(dir, match)
      }
      return [format, { public: await find("public"), src: await find("src") }] as const
    }),
  )
}

async function pin(file: string) {
  const text = await Bun.file(file).text()
  await Bun.write(file, text.replace(/("@modelcontextprotocol\/(?:client|core|server)": )"[^"]+"/g, `$1"${version}"`))
}

// `bun patch` needs the unpatched package installed, so remove the old entry and file first.
async function dropPatch() {
  const file = path.join(root, "package.json")
  const text = await Bun.file(file).text()
  const entry = text.match(/\n\s*"@modelcontextprotocol\/client@[^"]+": "(patches\/[^"]+)",?/)
  if (!entry?.[1]) return
  await Bun.file(path.join(root, entry[1])).delete()
  // Removing the last entry leaves a trailing comma behind; valid JSON has none anywhere else.
  await Bun.write(file, text.replace(entry[0], "").replace(/,(\s*\})/g, "$1"))
}
