const [command = "list", id] = process.argv.slice(2)
const base = (process.env.FRYN_BACKEND_URL || "http://127.0.0.1:8787").replace(/\/$/, "")
const token = process.env.FRYN_ADMIN_TOKEN
if (!token) {
  console.error("Defina FRYN_ADMIN_TOKEN antes de usar o admin CLI.")
  process.exit(1)
}
const headers = { "X-Admin-Token": token }
const path = command === "list" ? "/admin/api/licenses" : `/admin/api/licenses/${encodeURIComponent(id || "")}/${command}`
const response = await fetch(base + path, { method: command === "list" ? "GET" : "POST", headers })
const body = await response.json().catch(() => ({}))
if (!response.ok) {
  console.error(body)
  process.exit(1)
}
console.log(JSON.stringify(body, null, 2))
