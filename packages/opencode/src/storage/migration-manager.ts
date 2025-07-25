import path from "path"
import fs from "fs/promises"
import { Log } from "../util/log"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"

export namespace MigrationManager {
  const log = Log.create({ service: "storage.migration" })

  export type Migration = {
    version: number
    name: string
    migrate: (storageDir: string) => Promise<void>
  }

  export class Manager {
    private migrations: Migration[] = []

    register(migration: Migration): void {
      this.migrations.push(migration)
      this.migrations.sort((a, b) => a.version - b.version)
    }

    async getCurrentVersion(storageDir: string): Promise<number> {
      try {
        const migrationFile = path.join(storageDir, "migration")
        const content = await Bun.file(migrationFile).text()
        return parseInt(content, 10)
      } catch {
        return 0
      }
    }

    async setVersion(storageDir: string, version: number): Promise<void> {
      const migrationFile = path.join(storageDir, "migration")
      await Bun.write(migrationFile, version.toString())
    }

    async runMigrations(storageDir: string): Promise<void> {
      const currentVersion = await this.getCurrentVersion(storageDir)
      
      for (const migration of this.migrations) {
        if (migration.version > currentVersion) {
          log.info("running migration", { 
            version: migration.version, 
            name: migration.name 
          })
          
          try {
            await migration.migrate(storageDir)
            await this.setVersion(storageDir, migration.version)
          } catch (error) {
            log.error("migration failed", { 
              version: migration.version, 
              name: migration.name,
              error 
            })
            throw error
          }
        }
      }
    }
  }

  // Default migrations
  export const defaultMigrations: Migration[] = [
    {
      version: 1,
      name: "migrate-v1-messages-to-v2",
      migrate: async (storageDir: string) => {
        try {
          const files = new Bun.Glob("session/message/*/*.json").scanSync({
            cwd: storageDir,
            absolute: true,
          })
          
          for (const file of files) {
            const content = await Bun.file(file).json()
            if (!content.metadata) continue
            
            log.info("migrating to v2 message", { file })
            
            try {
              const result = MessageV2.fromV1(content)
              await Bun.write(
                file,
                JSON.stringify(
                  {
                    ...result.info,
                    parts: result.parts,
                  },
                  null,
                  2,
                ),
              )
            } catch (e) {
              await fs.rename(file, file.replace("storage", "broken"))
            }
          }
        } catch {
          // Ignore errors if directory doesn't exist
        }
      }
    },
    {
      version: 2,
      name: "split-message-parts",
      migrate: async (storageDir: string) => {
        const files = new Bun.Glob("session/message/*/*.json").scanSync({
          cwd: storageDir,
          absolute: true,
        })
        
        for (const file of files) {
          try {
            const { parts, ...info } = await Bun.file(file).json()
            if (!parts) continue
            
            for (const part of parts) {
              const id = Identifier.ascending("part")
              const partPath = path.join(
                storageDir,
                "session",
                "part",
                info.sessionID,
                info.id,
                id + ".json"
              )
              
              await fs.mkdir(path.dirname(partPath), { recursive: true })
              await Bun.write(
                partPath,
                JSON.stringify({
                  ...part,
                  id,
                  sessionID: info.sessionID,
                  messageID: info.id,
                  ...(part.type === "tool" ? { callID: part.id } : {}),
                }),
              )
            }
            
            await Bun.write(file, JSON.stringify(info, null, 2))
          } catch (e) {
            log.error("failed to migrate message parts", { file, error: e })
          }
        }
      }
    }
  ]
}