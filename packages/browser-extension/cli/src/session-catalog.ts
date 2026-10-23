import { dataRoot } from "./paths.ts"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"
import { Schema } from "effect"
import { isNodeError, isUnsupportedDirectorySyncError } from "./fs-durability.ts"
import { isValidSessionId } from "./relay-helpers.ts"

export const PersistedSession = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  readOnly: Schema.Boolean,
  target: Schema.optionalKey(Schema.Struct({
    id: Schema.String,
    owner: Schema.Literals(["relay", "user"]),
  })),
})

export type PersistedSession = Schema.Schema.Type<typeof PersistedSession>

const Catalog = Schema.Struct({
  version: Schema.Literal(1),
  sessions: Schema.Array(PersistedSession),
})

export function defaultSessionCatalogPath(port: number, home = os.homedir()): string {
  return path.join(dataRoot(home), "relays", String(port), "sessions.json")
}

export class SessionCatalog {
  constructor(readonly filePath: string) {}

  async load(): Promise<readonly PersistedSession[]> {
    let text: string
    try {
      text = await fs.readFile(this.filePath, "utf8")
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return []
      throw new Error(`Could not read OpenCode Browser session catalog at ${this.filePath}`, { cause: error })
    }
    try {
      const sessions = Schema.decodeUnknownSync(Catalog)(JSON.parse(text)).sessions
      const invalid = sessions.find((session) => !isValidSessionId(session.id))
      if (invalid) throw new Error(`Invalid persisted session id: ${invalid.id}`)
      return sessions
    } catch (error) {
      const detail = error instanceof Error && error.message ? `: ${error.message}` : ""
      throw new Error(`Could not decode OpenCode Browser session catalog at ${this.filePath}${detail}`, { cause: error })
    }
  }

  async save(sessions: readonly PersistedSession[]): Promise<void> {
    const directory = path.dirname(this.filePath)
    const temporaryPath = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`
    const contents = `${JSON.stringify({ version: 1, sessions }, null, 2)}\n`
    let temporaryFile: fs.FileHandle | undefined
    try {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 })
      await fs.chmod(directory, 0o700)
      temporaryFile = await fs.open(temporaryPath, "wx", 0o600)
      await temporaryFile.writeFile(contents, "utf8")
      await temporaryFile.sync()
      await temporaryFile.close()
      temporaryFile = undefined
      await fs.rename(temporaryPath, this.filePath)
      const directoryHandle = await fs.open(directory, "r")
      try {
        try {
          await directoryHandle.sync()
        } catch (error) {
          if (!isUnsupportedDirectorySyncError(error)) throw error
        }
      } finally {
        await directoryHandle.close()
      }
    } catch (error) {
      try {
        await temporaryFile?.close()
      } catch {}
      try {
        await fs.rm(temporaryPath, { force: true })
      } catch {}
      throw new Error(`Could not write OpenCode Browser session catalog at ${this.filePath}`, { cause: error })
    }
  }
}
