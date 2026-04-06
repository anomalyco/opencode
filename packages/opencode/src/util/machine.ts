import { randomUUID } from "crypto"
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs"
import path from "path"
import { Global } from "@/global"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

let cache: string | undefined

function code(err: unknown) {
  if (typeof err !== "object" || err === null || !("code" in err)) return
  const value = err.code
  if (typeof value !== "string") return
  return value
}

function filepath() {
  return path.join(Global.Path.data, "machine-id")
}

function read() {
  try {
    const raw = readFileSync(filepath(), "utf8").trim()
    if (!uuid.test(raw)) return
    return raw
  } catch (err) {
    if (code(err) === "ENOENT") return
    throw err
  }
}

export function machineId() {
  if (cache) return cache

  const hit = read()
  if (hit) {
    cache = hit
    return hit
  }

  const next = randomUUID()
  const f = filepath()
  const tmp = f + "." + process.pid + ".tmp"

  mkdirSync(Global.Path.data, { recursive: true })
  writeFileSync(tmp, next + "\n", { mode: 0o600 })

  try {
    renameSync(tmp, f)
  } catch (err) {
    rmSync(tmp, { force: true })
    const value = read()
    if (value) {
      cache = value
      return value
    }
    throw err
  }

  cache = next
  return next
}
