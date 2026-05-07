/**
 * bun:sqlite 类型声明
 */
declare module "bun:sqlite" {
  export class Database {
    constructor(filename: string, options?: { create?: boolean; readwrite?: boolean; readonly?: boolean })
    exec(sql: string): void
    query<T = any>(sql: string): { all(...params: any[]): T[]; get(...params: any[]): T | null; run(...params: any[]): { changes: number; lastInsertRowid: number } }
    prepare<T = any>(sql: string): { run(...params: any[]): { changes: number; lastInsertRowid: number }; all(...params: any[]): T[]; get(...params: any[]): T | null }
    close(): void
    readonly inTransaction: boolean
  }
}
