import { and, eq, sql } from "drizzle-orm"
import { Schema } from "effect"
import type { Database } from "../storage/database"
import { extensions, extensionFiles } from "../storage/schema"
import { ExtensionManager } from "@opencode/plugin/desktop/manager"
import { readArchive, archiveLimit } from "./archive"

const decodeManifest = Schema.decodeUnknownSync(Schema.fromJsonString(ExtensionManager.Manifest))

/** Archive bytes and enable state are committed together in Desktop's SQLite store. */
export function createExtensionManager(input: {
  db: Database
  fetch: (url: string) => Promise<Response>
  changed(id: string, entries: readonly ExtensionManager.Installed[]): void
  reserved?: readonly string[]
}) {
  const list = (): ExtensionManager.Installed[] =>
    input.db
      .select()
      .from(extensions)
      .all()
      .map((row) => {
        const manifest = decodeManifest(row.manifest)
        return {
          id: row.id,
          name: manifest.name,
          version: manifest.version,
          revision: row.revision,
          generation: row.generation,
          enabled: row.enabled,
          hasMain: !!manifest.main,
        }
      })
  const get = (id: string, revision?: string) => {
    const row = input.db.select().from(extensions).where(eq(extensions.id, id)).get()
    if (!row || (revision && row.revision !== revision)) throw new ExtensionManager.ManagerError("notFound")
    if (!row.enabled) throw new ExtensionManager.ManagerError("disabled")
    return { ...row, manifest: decodeManifest(row.manifest) }
  }
  const source = (id: string, revision?: string, main = false): ExtensionManager.Source => {
    const row = get(id, revision)
    const entry = main ? row.manifest.main : row.manifest.entry
    const file =
      entry &&
      input.db
        .select()
        .from(extensionFiles)
        .where(and(eq(extensionFiles.extension_id, id), eq(extensionFiles.path, entry)))
        .get()
    if (!file) throw new ExtensionManager.ManagerError("notFound")
    return { manifest: row.manifest, revision: row.revision, source: file.data.toString("utf8") }
  }
  const install = async (bytes: Uint8Array) => {
    const archive = await readArchive(bytes)
    if (archive.manifest.id.startsWith("opencode.") || input.reserved?.includes(archive.manifest.id))
      throw new ExtensionManager.ManagerError("reserved")
    input.db.transaction((db) => {
      db.delete(extensionFiles).where(eq(extensionFiles.extension_id, archive.manifest.id)).run()
      db.insert(extensions)
        .values({
          id: archive.manifest.id,
          manifest: JSON.stringify(archive.manifest),
          revision: archive.revision,
          generation: 1,
          enabled: true,
        })
        .onConflictDoUpdate({
          target: extensions.id,
          set: {
            manifest: JSON.stringify(archive.manifest),
            revision: archive.revision,
            generation: sql`${extensions.generation} + 1`,
            enabled: true,
          },
        })
        .run()
      archive.files.forEach((file) =>
        db.insert(extensionFiles).values({ extension_id: archive.manifest.id, path: file.path, data: file.data }).run(),
      )
    })
    const entries = list()
    input.changed(archive.manifest.id, entries)
    return entries
  }
  return {
    list,
    source,
    install,
    enable(id: string, enabled: boolean) {
      const row = input.db.select().from(extensions).where(eq(extensions.id, id)).get()
      if (!row) throw new ExtensionManager.ManagerError("notFound")
      input.db
        .update(extensions)
        .set({ enabled, generation: row.generation + 1 })
        .where(eq(extensions.id, id))
        .run()
      const entries = list()
      input.changed(id, entries)
      return entries
    },
    reload(id: string) {
      const row = get(id)
      input.db
        .update(extensions)
        .set({ generation: row.generation + 1 })
        .where(eq(extensions.id, id))
        .run()
      const entries = list()
      input.changed(id, entries)
      return entries
    },
    async installURL(value: string) {
      if (!URL.canParse(value) || !["http:", "https:"].includes(new URL(value).protocol))
        throw new ExtensionManager.ManagerError("url")
      const response = await input.fetch(value).catch(() => {
        throw new ExtensionManager.ManagerError("download")
      })
      if (!response.ok || !response.body) throw new ExtensionManager.ManagerError("download")
      if (Number(response.headers.get("content-length")) > archiveLimit) {
        await response.body.cancel()
        throw new ExtensionManager.ManagerError("tooLarge")
      }
      const chunks: Uint8Array[] = []
      let size = 0
      for await (const chunk of response.body) {
        size += chunk.byteLength
        if (size > archiveLimit) throw new ExtensionManager.ManagerError("tooLarge")
        chunks.push(chunk)
      }
      return install(Buffer.concat(chunks))
    },
  }
}

export function readExtensionAsset(db: Database, id: string, revision: string, path: string) {
  const row = db
    .select()
    .from(extensions)
    .where(and(eq(extensions.id, id), eq(extensions.revision, revision), eq(extensions.enabled, true)))
    .get()
  if (!row) return
  return db
    .select({ data: extensionFiles.data })
    .from(extensionFiles)
    .where(and(eq(extensionFiles.extension_id, id), eq(extensionFiles.path, path)))
    .get()?.data
}
