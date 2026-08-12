#!/usr/bin/env bun
/**
 * Regenerates the llama-skein TypeScript client from that repo's OpenAPI
 * contract, which is the source of truth for the wire format.
 *
 * package.json has referenced this script since the client was first
 * committed, but the file was never added — so `bun run build:llama-skein-client`,
 * the command both repos' CLAUDE.md documents as the way to regenerate, has
 * always failed. The client was produced by a one-off invocation instead.
 *
 * The spec lives in the sibling llama-skein checkout. Override with
 * LLAMA_SKEIN_SPEC when it is somewhere else.
 */
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

const DEFAULT_SPEC = join(homedir(), "dev", "llama-skein", "contracts", "llama-skein.openapi.json")
const spec = resolve(process.env["LLAMA_SKEIN_SPEC"] ?? DEFAULT_SPEC)
const output = join(import.meta.dir, "..", "src", "local", "llama-skein", "gen")

if (!existsSync(spec)) {
  console.error(`llama-skein spec not found: ${spec}`)
  console.error("Set LLAMA_SKEIN_SPEC to the contract path, or clone llama-skein next to opencode.")
  process.exit(1)
}

console.log(`generating llama-skein client\n  spec:   ${spec}\n  output: ${output}`)

// @hey-api/openapi-ts is a devDependency of packages/sdk/js, not of this
// package. Reuse that pinned copy rather than adding a second declaration:
// this fork rebases on upstream, and every extra dependency line is conflict
// surface for a generator that runs by hand a few times a release.
async function loadGenerator(): Promise<any> {
  // Indirected through a variable: the package is not resolvable from this
  // package's node_modules, so a literal specifier would be a type error even
  // though the fallback below finds it at runtime.
  const specifier = "@hey-api/openapi-ts"
  try {
    return await import(specifier)
  } catch {
    const workspaceCopy = join(import.meta.dir, "..", "..", "sdk", "js", "node_modules", "@hey-api", "openapi-ts")
    if (!existsSync(workspaceCopy)) {
      console.error("@hey-api/openapi-ts not found in this package or in packages/sdk/js.")
      console.error("Run `bun install` at the repo root, then retry.")
      process.exit(1)
    }
    return await import(workspaceCopy)
  }
}

const { createClient } = await loadGenerator()

await createClient({
  input: spec,
  // Formatted with the repo's prettier so generated code reads like the rest
  // of the codebase. This reformats the bundled client/ and core/ files too —
  // a one-time ~1500-line diff that then stays stable, so land it separately
  // from any contract change or it buries the real diff.
  output: { path: output, postProcess: ["prettier"] },
  plugins: [
    { name: "@hey-api/typescript" },
    // baseUrl is llama-skein's default listen address; callers that talk to a
    // remote provider pass their own via createClient/createConfig.
    { name: "@hey-api/client-fetch", baseUrl: "http://127.0.0.1:11435", bundle: true },
    // Consumers import the class (mdns.ts, httpapi/handlers/local.ts), so the
    // class name is part of this repo's API and must stay stable.
    { name: "@hey-api/sdk", operations: { strategy: "single", containerName: "LlamaSkeinClient" } },
  ],
})

console.log("done — review `git diff` before committing")
