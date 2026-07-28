export namespace ServerConnection {
  export type HttpBase = { url: string; username?: string; password?: string }
  export type Http = { type: "http"; http: HttpBase; authToken?: boolean; displayName?: string; label?: string }
  export type Sidecar = { type: "sidecar"; http: HttpBase; displayName?: string; label?: string } & (
    | { variant: "base" }
    | { variant: "wsl"; distro: string }
  )
  export type Ssh = { type: "ssh"; host: string; http: HttpBase; displayName?: string; label?: string }
  export type Any = Http | Sidecar | Ssh

  export type Key = string & { _brand: "Key" }
  export const Key = { make: (v: string) => v as Key }

  export const key = (conn: Any): Key => {
    switch (conn.type) {
      case "http":
        return Key.make(conn.http.url)
      case "sidecar":
        return conn.variant === "wsl" ? Key.make(`wsl:${conn.distro}`) : Key.make("sidecar")
      case "ssh":
        return Key.make(`ssh:${conn.host}`)
    }
  }

  export const builtin = (conn: Any) => conn.type === "sidecar" && conn.variant === "base"
  export const local = (conn?: Any) => !!conn && builtin(conn)
}

export function serverName(conn?: ServerConnection.Any, ignoreDisplayName = false) {
  if (!conn) return ""
  if (conn.displayName && !ignoreDisplayName) return conn.displayName
  return conn.http.url.replace(/^https?:\/\//, "").replace(/\/+$/, "")
}

export function useServer() {
  return {
    key: ServerConnection.Key.make("http://localhost:3000"),
    name: "localhost",
    list: [{ type: "http" as const, http: { url: "http://localhost:3000" } }],
    ready: Object.assign(() => true, { promise: Promise.resolve() }),
    isLocal: () => true,
  }
}
