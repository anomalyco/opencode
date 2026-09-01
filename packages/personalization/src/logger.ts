import * as fs from "fs"

const LOG_FILE = "/tmp/personalization.log"

export function logPersonalization(event: string, data?: unknown) {
  const timestamp = new Date().toISOString()
  const payload =
    data !== undefined
      ? typeof data === "string"
        ? data
        : data instanceof Error
          ? `${data.name}: ${data.message}\n${data.stack}`
          : JSON.stringify(data, null, 2)
      : ""
  const line = `[${timestamp}] [${event}] ${payload}\n`
  try {
    fs.appendFileSync(LOG_FILE, line, "utf8")
  } catch {
    // ignore
  }
}
