// Browser database initialization using sql.js (WASM SQLite)
import type { Database as SqlJsDatabase } from "sql.js"
import sqlJsLoaderUrl from "sql.js/dist/sql-wasm.js?url"
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url"

let _db: SqlJsDatabase | null = null
let _SQL: any = null
let _loaderPromise: Promise<InitSqlJs> | null = null
let _dbPromise: Promise<SqlJsDatabase> | null = null

const IDB_KEY = "opencode-db-v2"
const IDB_STORE = "opencode"
const IDB_DB = "opencode-storage-v2"

type InitSqlJs = (config?: { locateFile?: (file: string) => string }) => Promise<any>

declare global {
  var initSqlJs: InitSqlJs | undefined
}

function getInitSqlJs(): InitSqlJs | undefined {
  const candidate = globalThis.initSqlJs
  return typeof candidate === "function" ? candidate : undefined
}

function loadSqlJs(): Promise<InitSqlJs> {
  const existing = getInitSqlJs()
  if (existing) {
    return Promise.resolve(existing)
  }

  if (_loaderPromise) {
    return _loaderPromise
  }

  _loaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = sqlJsLoaderUrl
    script.async = true
    script.dataset.sqlJsLoader = "true"
    script.onload = () => {
      const initSqlJs = getInitSqlJs()
      if (!initSqlJs) {
        reject(new Error("sql.js loader did not expose initSqlJs"))
        return
      }
      resolve(initSqlJs)
    }
    script.onerror = () => {
      reject(new Error(`Failed to load sql.js loader from ${sqlJsLoaderUrl}`))
    }
    document.head.append(script)
  })

  return _loaderPromise
}

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_DB, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(IDB_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function loadFromIDB(): Promise<Uint8Array | null> {
  const db = await openIDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly")
    const store = tx.objectStore(IDB_STORE)
    const request = store.get(IDB_KEY)
    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => reject(request.error)
    tx.oncomplete = () => db.close()
  })
}

async function saveToIDB(data: Uint8Array): Promise<void> {
  const db = await openIDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite")
    const store = tx.objectStore(IDB_STORE)
    store.put(data, IDB_KEY)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => reject(tx.error)
  })
}

export async function initBrowserDB(): Promise<SqlJsDatabase> {
  if (_db) return _db
  if (_dbPromise) return _dbPromise

  _dbPromise = (async () => {
    const originalProcess = globalThis.process
    const initSqlJs = await loadSqlJs()

    try {
      // sql.js detects Node by checking process.versions.node. Our browser shell
      // provides a process shim for OpenCode/OpenTUI, so temporarily hide it here.
      if (originalProcess) {
        ;(globalThis as { process?: typeof originalProcess }).process = undefined
      }

      _SQL = await initSqlJs({
        locateFile: () => sqlWasmUrl,
      })
    } finally {
      if (originalProcess) {
        globalThis.process = originalProcess
      }
    }

    const saved = await loadFromIDB()
    if (saved) {
      _db = new _SQL.Database(saved)
    } else {
      _db = new _SQL.Database()
    }

    return _db
  })()

  try {
    return await _dbPromise
  } catch (error) {
    _dbPromise = null
    throw error
  }
}

export function getBrowserDB(): SqlJsDatabase {
  if (!_db) throw new Error("Browser DB not initialized. Call initBrowserDB() first.")
  return _db
}

export async function persistDB(): Promise<void> {
  if (!_db) return
  const data = _db.export()
  await saveToIDB(data)
}

// Auto-persist every 5 seconds
let _persistInterval: ReturnType<typeof setInterval> | null = null
export function startAutoPersist(intervalMs = 5000) {
  if (_persistInterval) return
  _persistInterval = setInterval(() => persistDB(), intervalMs)
}

export function stopAutoPersist() {
  if (_persistInterval) {
    clearInterval(_persistInterval)
    _persistInterval = null
  }
}

// Drizzle-compatible init function (matches the #db interface)
import { drizzle } from "drizzle-orm/sql-js"

export function init(_path: string) {
  const db = getBrowserDB()
  return drizzle(db)
}
