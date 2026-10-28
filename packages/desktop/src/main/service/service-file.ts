import path from "node:path"

export function serviceFile(file: string, channel: string | undefined, override?: string) {
  const selected = override ?? (channel === "prod" ? "prod" : undefined)

  if (selected !== "local" && selected !== "prod") return file

  return path.join(path.dirname(file), `service-${selected}.json`)
}
