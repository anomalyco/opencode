import { readFile } from "node:fs/promises"

export async function running(pid: number) {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  if (process.platform !== "linux") return true

  const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => undefined)
  if (stat === undefined) return true
  const state = stat.slice(stat.lastIndexOf(")") + 1).trimStart()[0]
  // A zombie has exited but remains visible to kill(pid, 0) until its parent reaps it.
  return state !== "Z" && state !== "X" && state !== "x"
}
