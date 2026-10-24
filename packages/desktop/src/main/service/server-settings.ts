import { closeSync, fstatSync, openSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { Option, Schema } from "effect"
import type { SettingsStore } from "../storage/store"

class ServerSettingsError extends Error {}

const Server = Schema.Struct({
  url: Schema.String,
  name: Schema.optional(Schema.String),
  passwordFile: Schema.optional(Schema.String),
})

const Settings = Schema.Struct({
  servers: Schema.optional(Schema.Array(Server)),
  defaultServer: Schema.optional(Schema.String),
  startLocalServer: Schema.optional(Schema.Boolean),
})

/** Validate without putting config values (which may contain misplaced secrets) in errors. */
// SAFETY: this is the boundary for untrusted settings-file values, decoded immediately below.
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- see SAFETY above
export function parseServerSettings(input: unknown) {
  for (const key of ["servers", "defaultServer", "startLocalServer"] as const) {
    if (Option.isNone(Schema.decodeUnknownOption(Schema.Struct({ [key]: Settings.fields[key] }))(input)))
      throw new ServerSettingsError(`${key}: invalid value`)
  }

  const decoded = Schema.decodeUnknownOption(Settings)(input, { onExcessProperty: "error" })

  if (Option.isNone(decoded)) throw new ServerSettingsError("servers: unknown settings or server field")
  const value = decoded.value

  const servers = (value.servers ?? []).map((server, index) => {
    const url = serverOrigin(server.url)

    if (!url)
      throw new ServerSettingsError(
        `servers[${index}].url: expected an HTTP(S) origin without credentials, query, or fragment`,
      )

    if (server.passwordFile !== undefined && !server.passwordFile.trim())
      throw new ServerSettingsError(`servers[${index}].passwordFile: expected a non-empty path`)

    return { ...server, url }
  })

  if (new Set(servers.map((server) => server.url)).size !== servers.length)
    throw new ServerSettingsError("servers: duplicate URL")
  const defaultServer = value.defaultServer === undefined ? undefined : serverOrigin(value.defaultServer)

  if (value.defaultServer !== undefined && (!defaultServer || !servers.some((server) => server.url === defaultServer)))
    throw new ServerSettingsError("defaultServer: must match a configured server URL")

  return {
    servers,
    defaultServer,
    startLocalServer: value.startLocalServer ?? !defaultServer,
  }
}

export function serverOrigin(value: string) {
  if (!URL.canParse(value)) return
  const url = new URL(value)

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    return

  return url.origin
}

/** Read and check the same descriptor; passwords never enter renderer storage. */
export function readServerPassword(file: string, directory: string) {
  const resolved = file.startsWith("~/") ? path.join(homedir(), file.slice(2)) : path.resolve(directory, file)
  const fd = openSync(resolved, "r")

  try {
    const stat = fstatSync(fd)

    if (!stat.isFile()) throw new ServerSettingsError("passwordFile: must be a regular file")

    if (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
      throw new ServerSettingsError("passwordFile: must be accessible only by its owner (chmod 600)")
    const password = readFileSync(fd, "utf8").replace(/\r?\n$/, "")

    if (!password || /[\r\n\0]/.test(password))
      throw new ServerSettingsError("passwordFile: must contain one non-empty line")

    return password
  } finally {
    closeSync(fd)
  }
}

/** The public view is safe to send over IPC; credentials stay in this closure. */
export function resolveServerSettings(settings: ReturnType<typeof parseServerSettings>, directory: string) {
  const passwords = new Map(
    settings.servers.flatMap((server, index) => {
      if (!server.passwordFile) return []

      try {
        return [[server.url, readServerPassword(server.passwordFile, directory)] as const]
      } catch (error) {
        throw new ServerSettingsError(
          `servers[${index}].${error instanceof ServerSettingsError ? error.message : "passwordFile: missing or unreadable file"}`,
        )
      }
    }),
  )

  return {
    startLocalServer: settings.startLocalServer,
    public: {
      servers: settings.servers.map((server) => ({ url: server.url, name: server.name })),
      defaultServer: settings.defaultServer,
    },
    authorization(url: string) {
      if (!URL.canParse(url)) return
      const password = passwords.get(new URL(url).origin)

      return password ? `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` : undefined
    },
  }
}

/** Cache either a valid launch snapshot or the local fallback, so requests never retry bad files. */
export function createServerSettings(store: SettingsStore, report: (message: string) => void) {
  let current: ReturnType<typeof load> | undefined

  function load() {
    try {
      if (store.readError) throw new ServerSettingsError(store.readError)

      return {
        ...resolveServerSettings(
          parseServerSettings({
            servers: store.get("servers"),
            defaultServer: store.get("defaultServer"),
            startLocalServer: store.get("startLocalServer"),
          }),
          path.dirname(store.path),
        ),
        fallback: false,
      }
    } catch (error) {
      const reason =
        error instanceof ServerSettingsError ? error.message : "opencode.settings: could not read server settings"

      report(`Desktop server settings refused; using the local server. ${reason}`)

      return { ...resolveServerSettings(parseServerSettings({}), path.dirname(store.path)), fallback: true }
    }
  }

  return {
    get: () => (current ??= load()),
    reload: () => {
      current = load()
    },
  }
}
