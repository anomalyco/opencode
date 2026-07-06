import path from "node:path"

export function v2ServerCommand() {
  const compiled = path.basename(process.execPath).replace(/\.exe$/, "") !== "bun"
  const entrypoint = compiled ? [] : process.argv[1] ? [process.argv[1]] : []
  if (!compiled && entrypoint.length === 0) throw new Error("Failed to resolve CLI entrypoint")
  return [process.execPath, ...entrypoint, "__v2-serve"]
}
