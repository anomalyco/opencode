export * as ArtifactConformance from "./artifact-conformance"

import { expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Exit } from "effect"
import { Artifact } from "@opencode/core/artifact"
import { ArtifactTable } from "@opencode/core/artifact/sql"
import { Database } from "@opencode/core/database/database"

const encoder = new TextEncoder()
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
const server = "export default { fetch: (request) => Response.json({ url: request.url }) }"
const app = (manifest: object, files: Record<string, string>) => ({
  files: { "artifact.json": JSON.stringify(manifest), ...files },
})

/** What every artifact provider is run against. Each provider's answer to each is pinned in `expected`. */
export const fixtures = {
  "markdown-doc": { files: { "index.md": "# Report\n\nAll good." } },
  "static-binary": { files: { "index.html": "<img src='./logo.png'>", "logo.png": png } },
  "nested-entry": { files: { "docs/guide.html": "<h1>Guide</h1>" }, entry: "docs/guide.html" },
  "spa-index": app({ assets: "dist", spa: true }, { "dist/index.html": "<div id='app'></div>", "src/main.ts": "" }),
  "fetch-echo": app({ server: "server.js" }, { "server.js": server }),
  sqlite: app(
    { server: "server.js", bindings: [{ name: "DB", kind: "sqlite", migrations: ["migrations"] }] },
    { "server.js": server, "migrations/0001_init.sql": "CREATE TABLE note (id integer PRIMARY KEY);" },
  ),
  blob: app({ server: "server.js", bindings: [{ name: "FILES", kind: "blob" }] }, { "server.js": server }),
  cron: app(
    { server: "server.js", crons: [{ schedule: "0 * * * *", path: "/tasks/hourly" }] },
    { "server.js": server },
  ),
} satisfies Record<string, { readonly files: Artifact.Files; readonly entry?: string }>

export type Fixture = keyof typeof fixtures
type Matrix = Record<Fixture, "accept" | "refuse">

/** Pinned here rather than read from each provider's capabilities, so a provider that over-promises fails. */
export const expected = {
  local: {
    "markdown-doc": "accept",
    "static-binary": "accept",
    "nested-entry": "accept",
    "spa-index": "refuse",
    "fetch-echo": "refuse",
    sqlite: "refuse",
    blob: "refuse",
    cron: "refuse",
  },
  console: {
    "markdown-doc": "accept",
    "static-binary": "accept",
    "nested-entry": "refuse",
    "spa-index": "refuse",
    "fetch-echo": "refuse",
    sqlite: "refuse",
    blob: "refuse",
    cron: "refuse",
  },
} satisfies Record<string, Matrix>

export interface Subject {
  readonly provider: Artifact.ProviderID
  /** A published file as a reader of the artifact gets it, or undefined when the host serves none. */
  readonly fetch: (info: Artifact.Info, path: string) => Effect.Effect<Uint8Array | undefined, unknown>
  /** How many requests the host has had, so a refusal can show it had none. */
  readonly calls: () => number
}

/** Runs every fixture through create, fetch, update and delete, then checks a moved destination refuses changes. */
export const run = Effect.fnUntraced(function* (subject: Subject, matrix: Matrix) {
  const artifacts = yield* Artifact.Service
  const database = yield* Database.Service
  for (const [name, fixture] of Object.entries(fixtures) as [Fixture, (typeof fixtures)[Fixture]][]) {
    const calls = subject.calls()
    const exit = yield* artifacts.create({ title: name, provider: subject.provider, ...fixture }).pipe(Effect.exit)
    if (matrix[name] === "refuse") {
      expect(Exit.isFailure(exit), `${subject.provider} refuses ${name}`).toBe(true)
      expect(subject.calls(), `${subject.provider} sends nothing for ${name}`).toBe(calls)
      expect((yield* artifacts.list()).map((item) => item.title)).not.toContain(name)
      continue
    }
    if (Exit.isFailure(exit)) throw new Error(`${subject.provider} should accept ${name}: ${exit.cause}`)
    const info = exit.value
    const entry = Object.entries(fixture.files).find(
      ([filePath]) => filePath === ("entry" in fixture ? fixture.entry : info.entry),
    )
    expect(yield* subject.fetch(info, info.entry)).toEqual(bytes(entry?.[1] ?? ""))
    if (name === "static-binary") {
      expect(yield* subject.fetch(info, "logo.png")).toEqual(png)
      expect((yield* artifacts.get(info.id)).omitted).toEqual({ "logo.png": png.length })
    }
    const updated = yield* artifacts.update(info.id, {
      files: { ...fixture.files, [entry?.[0] ?? info.entry]: "<p>v2</p>" },
    })
    expect(updated.url).toBe(info.url)
    expect(yield* subject.fetch(updated, updated.entry)).toEqual(bytes("<p>v2</p>"))
    yield* artifacts.remove(info.id)
    expect(yield* subject.fetch(info, info.entry)).toBeUndefined()
  }

  const pinned = yield* artifacts.create({
    title: "Pinned",
    provider: subject.provider,
    files: fixtures["markdown-doc"].files,
  })
  yield* database.db
    .update(ArtifactTable)
    .set({ destination: "elsewhere" })
    .where(eq(ArtifactTable.id, pinned.id))
    .run()
  const calls = subject.calls()
  expect(yield* artifacts.update(pinned.id, { files: { "index.md": "# Moved" } }).pipe(Effect.flip)).toBeInstanceOf(
    Artifact.InvalidError,
  )
  expect(yield* artifacts.remove(pinned.id).pipe(Effect.flip)).toBeInstanceOf(Artifact.InvalidError)
  expect(subject.calls()).toBe(calls)
  expect((yield* artifacts.info(pinned.id)).id).toBe(pinned.id)
})

const bytes = (value: string | Uint8Array) => (typeof value === "string" ? encoder.encode(value) : value)
