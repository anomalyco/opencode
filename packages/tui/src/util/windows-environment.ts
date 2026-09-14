import { execFile } from "node:child_process"
import { Option, Schema } from "effect"

type Variables = Readonly<Record<string, string>>

const RegistryEnvironment = Schema.Struct({
  machine: Schema.Record(Schema.String, Schema.String),
  user: Schema.Record(Schema.String, Schema.String),
})

const decodeRegistryEnvironment = Schema.decodeUnknownOption(Schema.fromJsonString(RegistryEnvironment))

const script = [
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
  "@{ machine = [Environment]::GetEnvironmentVariables('Machine'); user = [Environment]::GetEnvironmentVariables('User') } | ConvertTo-Json -Compress",
].join("; ")

export function readWindowsEnvironment() {
  return new Promise<typeof RegistryEnvironment.Type>((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return reject(error)
        const decoded = decodeRegistryEnvironment(stdout.trim())
        if (Option.isNone(decoded)) return reject(new Error("Unable to read environment variables from the registry"))
        resolve(decoded.value)
      },
    )
  })
}

// Additive only: values from the launching shell, including Git Bash's own PATH entries, are never replaced.
export function mergeWindowsEnvironment(current: Variables, registry: { machine: Variables; user: Variables }) {
  const present = new Set(Object.keys(current).map((key) => key.toLowerCase()))
  const pathKey = Object.keys(current).find((key) => key.toLowerCase() === "path") ?? "Path"
  const entries = (value: string | undefined) => (value ?? "").split(";").filter((entry) => entry.trim() !== "")
  const normalize = (entry: string) =>
    entry
      .trim()
      .replace(/[\\/]+$/, "")
      .toLowerCase()
  const existing = entries(current[pathKey])
  const seen = new Set(existing.map(normalize))
  const paths = [registry.machine, registry.user]
    .flatMap((variables) => entries(Object.entries(variables).find(([key]) => key.toLowerCase() === "path")?.[1]))
    .filter((entry) => {
      if (seen.has(normalize(entry))) return false
      seen.add(normalize(entry))
      return true
    })
  const variables = new Map(
    [...Object.entries(registry.machine), ...Object.entries(registry.user)]
      .filter(([key]) => key.toLowerCase() !== "path" && !present.has(key.toLowerCase()))
      .map(([key, value]) => [key.toLowerCase(), [key, value] as const]),
  )
  return {
    variables: {
      ...current,
      ...(paths.length === 0 ? {} : { [pathKey]: [...existing, ...paths].join(";") }),
      ...Object.fromEntries(variables.values()),
    },
    paths: paths.length,
    added: variables.size,
  }
}
