import { appendFileSync, existsSync, readFileSync } from "node:fs"

const file = process.argv[2]
if (!file) throw new Error("Expected spawn log path")

const starts = existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").length : 0
appendFileSync(file, `${process.pid}\n`)
// Optional mode arguments need a prefix because the command appends --stdio after them.
const timing = process.argv[4]?.startsWith("timing=") ? process.argv[4].slice(7) : undefined
if (process.argv[3] === "fail-first-replacement" && starts === 1) {
  if (timing) appendFileSync(timing, `${Date.now()}\n`)
  process.exit(1)
}
if (process.argv[3] === "ready-after-file" && starts === 1) {
  const file = process.argv[4]
  if (!file) throw new Error("Expected readiness marker path")
  while (!existsSync(file)) await Bun.sleep(10)
}
if (process.argv[3] !== "silent-once" || starts !== 1)
  console.log(
    JSON.stringify({ url: process.argv[3] === "server-url" ? process.argv[4] : `http://127.0.0.1:1/${process.pid}` }),
  )
if (process.argv[3] === "fail-first-replacement" && timing && starts === 2) appendFileSync(timing, `${Date.now()}\n`)
process.stdin.resume()
process.stdin.on("end", () => process.exit(0))
