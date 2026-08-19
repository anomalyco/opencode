import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import path from "path"
import { Glob } from "bun"

// Confirms opencode's model management does not depend on the Skein supervisor
// (fleet-model-gallery task 3.4: "Confirm opencode web and TUI model management
// works while Skein is stopped").
//
// The epic's premise is that Skein must not be a required proxy for ordinary
// model management. A one-off manual check with Skein's process killed would
// only prove "nothing called Skein on that path, that time" — it would pass
// just as happily the day after someone adds a Skein import, as long as the
// exercised branch happened to miss it. So the confirmation here is structural
// and repo-wide: there is no code in this package that can contact a Skein
// supervisor at all, therefore no model-management path can depend on one.
//
// Independently corroborated at the time of writing: Skein exposes no HTTP API
// (its own inventory for this change records "No HTTP API surface" — CLI and
// MCP only), so there is no Skein endpoint for opencode to call even in
// principle. Skein and opencode-skein share only on-disk conventions
// (`openspec/changes/*/.skein/`), which are files, not a running service.
//
// NOTE ON NAMES: "llama-skein" is a different program — the local model host
// that owns model files, inventory, and fit. Depending on it is the intended
// architecture, not a violation. Only the Skein *supervisor* is forbidden here.

const SRC = path.join(import.meta.dir, "../../src")

function sourceFiles(): string[] {
  const glob = new Glob("**/*.{ts,tsx}")
  return [...glob.scanSync({ cwd: SRC })].filter((f) => !f.endsWith(".d.ts")).sort()
}

/**
 * Import specifiers that contain "skein" but are not the Skein supervisor.
 * Anything matching these is architecture we want; anything else containing
 * "skein" is a new dependency this test exists to catch.
 */
function isAllowedSkeinImport(specifier: string): boolean {
  // The generated llama-skein client — the model host, which model management
  // is supposed to talk to directly.
  if (/(^|\/)llama-skein\//.test(specifier)) return true
  // llama-skein streams a themed "loading" flavor over SSE while a model warms
  // up; this module decodes that marker. Named for the marker field
  // (`skein_loading`) that llama-skein puts on the wire, not for the supervisor.
  if (/(^|\/)skein-loading$/.test(specifier)) return true
  return false
}

describe("model management is independent of the Skein supervisor", () => {
  const files = sourceFiles()

  test("the source tree is actually being scanned", () => {
    // Guards against a glob/path mistake silently making every check below
    // vacuous. This suite's whole value is in finding nothing, so "found
    // nothing" has to be distinguishable from "looked nowhere".
    expect(files.length).toBeGreaterThan(300)
    expect(files).toContain("local/mdns.ts")
    expect(files).toContain("server/routes/instance/httpapi/handlers/local.ts")
  })

  test("no module imports a Skein supervisor client", () => {
    const offenders: string[] = []
    for (const file of files) {
      const text = readFileSync(path.join(SRC, file), "utf8")
      for (const match of text.matchAll(/\bfrom\s*"([^"]+)"|\bimport\s*\(\s*"([^"]+)"\s*\)/g)) {
        const specifier = match[1] ?? match[2]
        if (!specifier || !/skein/i.test(specifier)) continue
        if (isAllowedSkeinImport(specifier)) continue
        offenders.push(`${file}: ${specifier}`)
      }
    }
    expect(offenders).toEqual([])
  })

  test("no module spawns a skein executable", () => {
    // A supervisor dependency does not have to arrive as an import — shelling
    // out to the `skein` CLI would be exactly the proxy this epic removes.
    const offenders: string[] = []
    for (const file of files) {
      const text = readFileSync(path.join(SRC, file), "utf8")
      if (!/skein/i.test(text)) continue
      for (const line of text.split("\n")) {
        const isSpawn = /\b(Bun\.spawn\w*|spawnSync|spawn|execFile\w*|execSync|exec)\s*\(/.test(line)
        if (!isSpawn) continue
        // "llama-skein"/"opencode-skein" as a spawned binary is not the
        // supervisor; a bare "skein" command is.
        if (/["'`\s/](skein)\b/.test(line.replace(/(llama|opencode)-skein/g, "«host»"))) {
          offenders.push(`${file}: ${line.trim()}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  test("model management reaches llama-skein directly", () => {
    // The positive half: absence of Skein would also be satisfied by model
    // management not working at all. These are the real entry points behind
    // the web (packages/app dialog-local-discovery) and TUI
    // (packages/tui dialog-provider) model surfaces, and each must reach the
    // model host on its own.
    const entryPoints = [
      "local/mdns.ts",
      "local/capacity.ts",
      "local/placement.ts",
      "server/routes/instance/httpapi/handlers/local.ts",
    ]
    const missing = entryPoints.filter(
      (entry) => !/llama-skein\/gen/.test(readFileSync(path.join(SRC, entry), "utf8")),
    )
    expect(missing).toEqual([])
  })
})

describe("the web and TUI model-management surfaces do not bypass the server", () => {
  // Both UIs drive model management through the opencode server's `local` HTTP
  // API group (asserted Skein-free above) via the generated SDK. This checks
  // they do not reach around it to a supervisor of their own.
  const surfaces = [
    "../../../app/src/components/dialog-local-discovery.tsx",
    "../../../tui/src/component/dialog-provider.tsx",
  ]

  test.each(surfaces)("%s contacts no Skein supervisor", (relative) => {
    const file = path.join(import.meta.dir, relative)
    const text = readFileSync(file, "utf8")
    const hits = [...text.matchAll(/.*skein.*/gi)]
      .map((m) => m[0].trim())
      .filter((line) => !/(llama|opencode)-skein/.test(line))
    expect(hits).toEqual([])
  })

  test("both surfaces call the server's local model-management API", () => {
    // The call is often split across lines by the formatter
    // (`sdk.client.local\n  .scan({...})`), so tolerate whitespace.
    const callsLocalApi = /\.local\s*\.\s*(scan|connect)\s*\(/
    const missing = surfaces.filter(
      (relative) => !callsLocalApi.test(readFileSync(path.join(import.meta.dir, relative), "utf8")),
    )
    expect(missing).toEqual([])
  })
})
