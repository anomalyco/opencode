import { Database } from "bun:sqlite"
import { StorageProvider } from "./provider"
import { Log } from "../util/log"
import path from "path"
import z from "zod"

const log = Log.create({ service: "storage:sqlite" })

// Shared entity types
export const ENTITY_TYPES = ["message", "part", "session", "project", "todo", "session_diff", "session_share"] as const
export type EntityType = (typeof ENTITY_TYPES)[number]

// Config schema - shared with sqlite-storage.ts
const ColumnSchema = z.record(z.string(), z.string())

const TableConfigSchema = z.object({
  columns: ColumnSchema,
  extract: z.array(z.string()).optional(),
  indices: z.array(z.string()).optional(),
})

export const SqliteConfigSchema = z.object({
  database: z.string(),
  tables: z
    .object({
      message: TableConfigSchema.optional(),
      part: TableConfigSchema.optional(),
      session: TableConfigSchema.optional(),
      project: TableConfigSchema.optional(),
      todo: TableConfigSchema.optional(),
      session_diff: TableConfigSchema.optional(),
      session_share: TableConfigSchema.optional(),
    })
    .optional(),
})

export type SqliteConfig = z.infer<typeof SqliteConfigSchema>
export type TableConfig = z.infer<typeof TableConfigSchema>

export class SqliteStorageProvider implements StorageProvider.Interface {
  private db: Database
  private config: SqliteConfig

  constructor(dbPath: string, config: SqliteConfig) {
    this.db = new Database(dbPath)
    this.config = config
    log.info("Initialized SQLite storage", { dbPath })
  }

  async read<T>(key: string[]): Promise<T> {
    const [entity, ...rest] = key
    const id = rest[rest.length - 1]
    const entityType = entity as EntityType

    const tableConfig = this.config.tables?.[entityType]
    if (!tableConfig) {
      throw new StorageProvider.NotFoundError({ message: `No table config for ${entity}` })
    }

    const row = this.db.prepare(`SELECT * FROM ${entity} WHERE id = ?`).get(id) as any

    if (!row) {
      throw new StorageProvider.NotFoundError({ message: `Resource not found: ${key.join("/")}` })
    }

    return this.mapFromRow(row, tableConfig, entity) as T
  }

  async write<T>(key: string[], content: T): Promise<void> {
    const [entity, ...rest] = key
    const id = rest[rest.length - 1]
    const entityType = entity as EntityType

    const tableConfig = this.config.tables?.[entityType]
    if (!tableConfig) {
      log.warn(`No table config for ${entity}, skipping write`)
      return
    }

    const row = this.mapToRow(content, tableConfig, key)

    const columns = Object.keys(row)
      .map((col) => `\`${col}\``)
      .join(", ")
    const placeholders = Object.keys(row)
      .map(() => "?")
      .join(", ")

    this.db.prepare(`INSERT OR REPLACE INTO ${entity} (${columns}) VALUES (${placeholders})`).run(...Object.values(row))
  }

  async update<T>(key: string[], fn: (draft: T) => void): Promise<T> {
    // Read current value
    const current = await this.read<T>(key)

    // Mutate it
    fn(current)

    // Write it back
    await this.write(key, current)

    return current
  }

  async remove(key: string[]): Promise<void> {
    const [entity, ...rest] = key
    const id = rest[rest.length - 1]

    this.db.prepare(`DELETE FROM ${entity} WHERE id = ?`).run(id)
  }

  async list(prefix: string[], options?: StorageProvider.ListOptions): Promise<string[][]> {
    const [entity, ...rest] = prefix
    const entityType = entity as EntityType

    const tableConfig = this.config.tables?.[entityType]
    if (!tableConfig) {
      return []
    }

    // Build ORDER BY clause
    let orderByClause = ""
    if (options?.orderBy) {
      const { field, desc } = this.parseOrderBy(options.orderBy)
      // Check if field is extracted, otherwise order by id
      const isExtracted = tableConfig.extract?.includes(field)
      const orderField = isExtracted ? `\`${field}\`` : "id"
      orderByClause = ` ORDER BY ${orderField} ${desc ? "DESC" : "ASC"}`
    } else {
      // Default: order by id
      orderByClause = " ORDER BY id ASC"
    }

    // Build LIMIT clause
    const limitClause = options?.limit ? ` LIMIT ${options.limit}` : ""

    // Handle filtering based on prefix
    let rows: any[]

    if (rest.length === 0) {
      // No filter - get all entities
      rows = this.db.prepare(`SELECT * FROM ${entity}${orderByClause}${limitClause}`).all() as any[]
    } else {
      // Filter based on entity type and prefix
      switch (entityType) {
        case "message":
          // prefix: ["message", sessionID]
          if (rest[0]) {
            rows = this.db
              .prepare(`SELECT * FROM message WHERE sessionID = ?${orderByClause}${limitClause}`)
              .all(rest[0]) as any[]
          } else {
            rows = this.db.prepare(`SELECT * FROM message${orderByClause}${limitClause}`).all() as any[]
          }
          break
        case "part":
          // prefix: ["part", messageID]
          if (rest[0]) {
            rows = this.db
              .prepare(`SELECT * FROM part WHERE messageID = ?${orderByClause}${limitClause}`)
              .all(rest[0]) as any[]
          } else {
            rows = this.db.prepare(`SELECT * FROM part${orderByClause}${limitClause}`).all() as any[]
          }
          break
        case "session":
          // prefix: ["session", projectID]
          if (rest[0]) {
            rows = this.db
              .prepare(`SELECT * FROM session WHERE projectID = ?${orderByClause}${limitClause}`)
              .all(rest[0]) as any[]
          } else {
            rows = this.db.prepare(`SELECT * FROM session${orderByClause}${limitClause}`).all() as any[]
          }
          break
        case "todo":
          // prefix: ["todo", sessionID]
          if (rest[0]) {
            rows = this.db
              .prepare(`SELECT * FROM todo WHERE sessionID = ?${orderByClause}${limitClause}`)
              .all(rest[0]) as any[]
          } else {
            rows = this.db.prepare(`SELECT * FROM todo${orderByClause}${limitClause}`).all() as any[]
          }
          break
        case "session_diff":
          // session_diff has no parent filtering
          rows = this.db.prepare(`SELECT * FROM session_diff${orderByClause}${limitClause}`).all() as any[]
          break
        case "session_share":
          // session_share has no parent filtering
          rows = this.db.prepare(`SELECT * FROM session_share${orderByClause}${limitClause}`).all() as any[]
          break
        case "project":
          // Projects don't have parent filtering
          rows = this.db.prepare(`SELECT * FROM project${orderByClause}${limitClause}`).all() as any[]
          break
        default:
          rows = []
      }
    }

    return rows.map((row) => this.getStoragePathFromRow(entityType, row))
  }

  private parseOrderBy(orderBy: string): { field: string; desc: boolean } {
    const desc = orderBy.startsWith("-")
    const field = desc ? orderBy.slice(1) : orderBy
    return { field, desc }
  }

  close() {
    this.db.close()
  }

  // Mapping logic

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
    // This means extracted fields are stored twice (column + blob) but avoids reconstruction bugs
    row.data = JSON.stringify(data)

    return row
  }

  private mapFromRow(row: any, config: TableConfig, entity?: string): any {
    // Parse complete object from JSON blob
    // Since we store the complete object, no reconstruction needed
    return row.data ? JSON.parse(row.data) : {}
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
}
