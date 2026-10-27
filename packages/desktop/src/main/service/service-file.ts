import path from "node:path"

export function serviceFile(file: string, channel: string | undefined) {
  if (channel !== "local" && channel !== "prod") return file
  return path.join(path.dirname(file), `service-${channel}.json`)
}
