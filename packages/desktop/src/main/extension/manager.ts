import { randomUUID } from "node:crypto"
import { and, eq, isNotNull } from "drizzle-orm"
import { Option, Predicate } from "effect"
import type { Definition } from "@opencode/gui-extensions/sdk/main"
import { extensionEnabled } from "@opencode/gui-extensions/sdk/bridge"
import type { Database } from "../storage/database"
import { extension, extensionFile } from "../storage/schema"
import { ExtensionError } from "./error"
import { decodeManifest } from "./manifest"
import { readEnableState } from "./enable-state"

/**
 * Enable state and installed archives, committed together in the desktop database. Archive installs are groundwork for
 * `.ocdx` extensions: an installed archive runs its main entry only, the renderer loads built-ins until that format
 * ships renderer bundles, and packaged builds refuse the manager until installs have a trust model.
 */
export function createManager(db: Database, reserved: (id: string) => boolean, definitions: readonly Definition[]) {
  return {
    /** Every installed archive. A manifest that no longer decodes is reported, not dropped. */
    installed() {
      return db
        .select()
        .from(extension)
        .where(isNotNull(extension.manifest))
        .all()
        .map((item) => ({
          id: item.id,
          enabled: item.enabled,
          revision: item.revision ?? undefined,
          manifest: Option.getOrUndefined(decodeManifest(item.manifest)),
        }))
    },
    /** The current id wins, then declared legacy ids newest first; no setting means enabled. */
    enabled(id: string) {
      return extensionEnabled(
        definitions.find((definition) => definition.id === id) ?? { id },
        readEnableState(db.$client),
      )
    },
    setEnabled(id: string, enabled: boolean) {
      db.insert(extension).values({ id, enabled }).onConflictDoUpdate({ target: extension.id, set: { enabled } }).run()
    },
    /** A new revision tells renderers to reload the extension's code and assets. */
    bump(id: string) {
      db.update(extension).set({ revision: randomUUID() }).where(eq(extension.id, id)).run()
    },
    file(id: string, path: string) {
      return db
        .select({ data: extensionFile.data })
        .from(extensionFile)
        .where(and(eq(extensionFile.extension_id, id), eq(extensionFile.path, path)))
        .get()?.data
    },
    async install(source: Uint8Array | string) {
      const { readArchive } = await import("./archive")
      const archive = await readArchive(Predicate.isString(source) ? await download(source) : source)
      const id = archive.manifest.id

      if (reserved(id)) throw new ExtensionError("reserved")

      const values = { enabled: true, manifest: JSON.stringify(archive.manifest), revision: randomUUID() }
      db.transaction((tx) => {
        tx.delete(extensionFile).where(eq(extensionFile.extension_id, id)).run()
        tx.insert(extension)
          .values({ id, ...values })
          .onConflictDoUpdate({ target: extension.id, set: values })
          .run()
        archive.files.forEach((file) =>
          tx.insert(extensionFile).values({ extension_id: id, path: file.path, data: file.data }).run(),
        )
      })

      return archive.manifest
    },
    remove(id: string) {
      db.transaction((tx) => {
        tx.delete(extensionFile).where(eq(extensionFile.extension_id, id)).run()
        tx.delete(extension).where(eq(extension.id, id)).run()
      })
    },
  }
}

async function download(url: string) {
  const { archiveLimit } = await import("./archive")

  if (!URL.canParse(url) || !["http:", "https:"].includes(new URL(url).protocol)) throw new ExtensionError("url")

  const { net } = await import("electron")

  const response = await net.fetch(url).catch((error) => {
    throw new ExtensionError("download", { cause: error })
  })

  if (!response.ok || !response.body) throw new ExtensionError("download", { message: String(response.status) })

  if (Number(response.headers.get("content-length")) > archiveLimit) {
    await response.body.cancel()

    throw new ExtensionError("tooLarge")
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []

  const pump = async (size: number): Promise<number> => {
    const next = await reader.read()

    if (next.done) return size

    if (size + next.value.byteLength > archiveLimit) {
      await reader.cancel()

      throw new ExtensionError("tooLarge")
    }

    chunks.push(next.value)

    return pump(size + next.value.byteLength)
  }

  await pump(0)

  return Buffer.concat(chunks)
}
