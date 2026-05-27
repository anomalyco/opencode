/**
 * Node/Electron 下替代 bun:sqlite，供 build-node 打包进 desktop sidecar。
 */
import { DatabaseSync, type SQLInputParams } from "node:sqlite"

type QueryParams = SQLInputParams

export class Database {
  #db: DatabaseSync

  constructor(filename: string, options?: { readonly?: boolean; create?: boolean }) {
    this.#db = new DatabaseSync(filename, options?.readonly ? { readOnly: true } : undefined)
  }

  query(sql: string) {
    const stmt = this.#db.prepare(sql)
    return {
      all: (...params: QueryParams) => stmt.all(...params),
      get: (...params: QueryParams) => stmt.get(...params),
      run: (...params: QueryParams) => stmt.run(...params),
    }
  }

  prepare(sql: string) {
    return this.#db.prepare(sql)
  }

  run(sql: string, ...params: QueryParams) {
    return this.#db.prepare(sql).run(...params)
  }

  close() {
    this.#db.close()
  }
}

export default Database
