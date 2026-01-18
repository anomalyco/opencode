import { Database } from "bun:sqlite"
import { Global } from "../global"
import { Storage } from "../storage/storage"
import path from "path"
import { Log } from "./log"
import {
  SqliteConfigSchema,
  type SqliteConfig,
  type TableConfig,
  type EntityType,
  ENTITY_TYPES,
} from "../storage/sqlite-provider"

const log = Log.create({ service: "sqlite-storage" })

const DEFAULT_CONFIG: SqliteConfig = {
  database: "~/.local/share/opencode/storage.db",
  tables: {
    message: {
      columns: {
        id: "TEXT PRIMARY KEY",
        sessionID: "TEXT",
        role: "TEXT",
        "time.created": "INTEGER",
        data: "TEXT",
      },
      extract: ["sessionID", "role", "time.created"],
      indices: ["sessionID", "time.created"],
    },
    part: {
      columns: {
        id: "TEXT PRIMARY KEY",
        messageID: "TEXT",
        type: "TEXT",
        data: "TEXT",
      },
      extract: ["messageID", "type"],
      indices: ["messageID"],
    },
    session: {
      columns: {
        id: "TEXT PRIMARY KEY",
        projectID: "TEXT",
        title: "TEXT",
        "time.created": "INTEGER",
        "time.updated": "INTEGER",
        data: "TEXT",
      },
      extract: ["projectID", "title", "time.updated"],
      indices: ["projectID", "time.updated"],
    },
    project: {
      columns: {
        id: "TEXT PRIMARY KEY",
        worktree: "TEXT",
        vcs: "TEXT",
        "time.created": "INTEGER",
        "time.updated": "INTEGER",
        data: "TEXT",
      },
      extract: ["worktree", "vcs", "time.created", "time.updated"],
      indices: ["worktree", "time.created", "time.updated"],
    },
    todo: {
      columns: {
        id: "TEXT PRIMARY KEY",
        sessionID: "TEXT",
        data: "TEXT",
      },
      extract: ["sessionID"],
      indices: ["sessionID"],
    },
    session_diff: {
      columns: { id: "TEXT PRIMARY KEY", data: "TEXT" },
      extract: [],
      indices: [],
    },
    session_share: {
      columns: { id: "TEXT PRIMARY KEY", secret: "TEXT", url: "TEXT", data: "TEXT" },
      extract: ["secret", "url"],
      indices: [],
    },
  },
}

export namespace SqliteStorage {
  export async function create(configPath?: string) {
    const result = await loadConfig(configPath)
    return new StorageImpl(result.config, result.configPath)
  }

  async function loadConfig(configPath?: string): Promise<{ config: SqliteConfig; configPath: string }> {
    const defaultPath = path.join(Global.Path.config, "sqlite-storage.json")
    const target = configPath ? path.resolve(configPath) : defaultPath

    if (await Bun.file(target).exists()) {
      const json = await Bun.file(target).json()
      return {
        config: SqliteConfigSchema.parse(json),
        configPath: target,
      }
    }

    // Write default config if it doesn't exist
    if (!configPath) {
      await Bun.write(target, JSON.stringify(DEFAULT_CONFIG, null, 2))
      log.info("Created default sqlite-storage.json", { path: target })
    }

    return {
      config: DEFAULT_CONFIG,
      configPath: target,
    }
  }

  class StorageImpl {
    private db: Database | null = null
    private config: SqliteConfig
    private configPathUsed: string

    constructor(config: SqliteConfig, configPath: string) {
      this.config = config
      this.configPathUsed = configPath
    }

    dbPath(): string {
      const dbPath = this.config.database.replace(/^~/, Global.Path.home)
      return path.resolve(dbPath)
    }

    configPath(): string {
      return this.configPathUsed
    }

    private getDB(): Database {
      if (!this.db) {
        this.db = new Database(this.dbPath())
      }
      return this.db
    }

    async init() {
      const db = this.getDB()

      // Create tables based on config
      for (const [tableName, tableConfig] of Object.entries(this.config.tables ?? {})) {
        if (!tableConfig) continue

        const columns = Object.entries(tableConfig.columns)
          .map(([name, type]) => `\`${name}\` ${type}`)
          .join(", ")

        db.run(`DROP TABLE IF EXISTS ${tableName}`)
        db.run(`CREATE TABLE ${tableName} (${columns})`)

        // Create indices
        if (tableConfig.indices) {
          for (const column of tableConfig.indices) {
            db.run(`CREATE INDEX idx_${tableName}_${column.replace(/\./g, "_")} ON ${tableName}(\`${column}\`)`)
          }
        }

        log.info(`Created table ${tableName}`, {
          columns: Object.keys(tableConfig.columns),
          indices: tableConfig.indices,
        })
      }
    }

    async importFromJSON(options: {
      entity?: EntityType
      verbose?: boolean
      onProgress?: (entity: EntityType, count: number) => void
    }) {
      const entities: EntityType[] = options.entity ? [options.entity] : [...ENTITY_TYPES]

      const result = {
        message: 0,
        part: 0,
        session: 0,
        project: 0,
        todo: 0,
        session_diff: 0,
        session_share: 0,
      }

      for (const entity of entities) {
        const count = await this.importEntity(entity, options.onProgress)
        result[entity] = count
      }

      return result
    }

    private async importEntity(entity: EntityType, onProgress?: (entity: EntityType, count: number) => void) {
      const tableConfig = this.config.tables?.[entity]
      if (!tableConfig) {
        log.warn(`No table config for ${entity}, skipping`)
        return 0
      }

      const db = this.getDB()
      let count = 0

      // Get storage paths based on entity type
      log.info(`Getting storage paths for ${entity}`)
      const paths = await this.getStoragePaths(entity)
      log.info(`Found ${paths.length} ${entity} records to import`)

      for (const storagePath of paths) {
        try {
          const data = await Storage.read<any>(storagePath)
          const row = this.mapToRow(data, tableConfig, storagePath)

          const columns = Object.keys(row)
            .map((col) => `\`${col}\``)
            .join(", ")
          const placeholders = Object.keys(row)
            .map(() => "?")
            .join(", ")

          const stmt = db.prepare(`INSERT OR REPLACE INTO ${entity} (${columns}) VALUES (${placeholders})`)
          stmt.run(...Object.values(row))

          count++
          if (onProgress && count % 100 === 0) {
            onProgress(entity, count)
          }
        } catch (error) {
          log.error(`Failed to import ${entity}`, { path: storagePath, error })
        }
      }

      return count
    }

    async exportToJSON(options: {
      entity?: EntityType
      verbose?: boolean
      force?: boolean
      onProgress?: (entity: EntityType, count: number) => void
    }) {
      const entities: EntityType[] = options.entity ? [options.entity] : [...ENTITY_TYPES]

      const result = {
        message: 0,
        part: 0,
        session: 0,
        project: 0,
        todo: 0,
        session_diff: 0,
        session_share: 0,
      }

      for (const entity of entities) {
        const count = await this.exportEntity(entity, options.force ?? false, options.onProgress)
        result[entity] = count
      }

      return result
    }

    private async exportEntity(
      entity: EntityType,
      force: boolean,
      onProgress?: (entity: EntityType, count: number) => void,
    ) {
      const tableConfig = this.config.tables?.[entity]
      if (!tableConfig) {
        log.warn(`No table config for ${entity}, skipping`)
        return 0
      }

      const db = this.getDB()
      const rows = db.prepare(`SELECT * FROM ${entity}`).all() as any[]

      // Get JSON storage directory
      const jsonStorageDir = path.join(Global.Path.data, "storage")

      let count = 0
      for (const row of rows) {
        try {
          const data = this.mapFromRow(row, tableConfig)
          const storagePath = this.getStoragePathFromRow(entity, row)

          // Construct file path for JSON storage
          const filePath = path.join(jsonStorageDir, ...storagePath) + ".json"
          const fileDir = path.dirname(filePath)

          // Create directory if it doesn't exist
          await Bun.$`mkdir -p ${fileDir}`.quiet()

          // Check if file exists and force flag
          if (!force && (await Bun.file(filePath).exists())) {
            log.warn(`File already exists, skipping (use --force to overwrite)`, { path: filePath })
            continue
          }

          // Write directly to JSON file
          await Bun.file(filePath).write(JSON.stringify(data, null, 2))

          count++
          if (onProgress && count % 100 === 0) {
            onProgress(entity, count)
          }
        } catch (error) {
          log.error(`Failed to export ${entity}`, { row, error })
        }
      }

      return count
    }

    private mapToRow(data: any, config: TableConfig, storagePath: string[]): Record<string, any> {
      const row: Record<string, any> = {}

      // Extract ID from storage path
      row.id = storagePath[storagePath.length - 1]

      // Extract specified fields to columns
      if (config.extract) {
        for (const field of config.extract) {
          const value = this.getNestedValue(data, field)
          if (value !== undefined) {
            row[field] = this.serializeValue(value)
          }
        }
      }

      // Store COMPLETE object in data blob (no deletion for simplicity)
      row.data = JSON.stringify(data)

      return row
    }

    private mapFromRow(row: any, config: TableConfig): any {
      // Parse complete object from JSON blob
      return row.data ? JSON.parse(row.data) : {}
    }

    private async getStoragePaths(entity: EntityType): Promise<string[][]> {
      switch (entity) {
        case "message":
          return await Storage.list(["message"])
        case "part":
          return await Storage.list(["part"])
        case "session":
          return await Storage.list(["session"])
        case "project":
          return await Storage.list(["project"])
        case "todo":
          return await Storage.list(["todo"])
        case "session_diff":
          return await Storage.list(["session_diff"])
        case "session_share":
          return await Storage.list(["session_share"])
        default:
          return []
      }
    }

    private getStoragePathFromRow(entity: EntityType, row: any): string[] {
      switch (entity) {
        case "message":
          return ["message", row.sessionID, row.id]
        case "part":
          return ["part", row.messageID, row.id]
        case "session":
          return ["session", row.projectID, row.id]
        case "project":
          return ["project", row.id]
        case "todo":
          return ["todo", row.sessionID, row.id]
        case "session_diff":
          return ["session_diff", row.id]
        case "session_share":
          return ["session_share", row.id]
        default:
          return []
      }
    }

    private getNestedValue(obj: any, path: string): any {
      const parts = path.split(".")
      let current = obj

      for (const part of parts) {
        if (current === undefined || current === null) return undefined
        current = current[part]
      }

      return current
    }

    private serializeValue(value: any): any {
      if (typeof value === "object" && value !== null) {
        return JSON.stringify(value)
      }
      return value
    }

    close() {
      if (this.db) {
        this.db.close()
        this.db = null
      }
    }
  }
}
