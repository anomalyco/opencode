// Stub for bun:sqlite - not used in browser, we use sql.js instead
export class Database {
  constructor(_path: string, _opts?: any) {
    throw new Error("bun:sqlite is not available in browser. Use sql.js instead.")
  }
}
export default { Database }
